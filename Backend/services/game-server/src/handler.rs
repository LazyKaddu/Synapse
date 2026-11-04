use crate::engine::{OutgoingMessage, PlayerSession, SpatialGrid};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use synapse_common::{verify_boarding_pass, AppConfig};
use synapse_livekit::LiveKitRoomOrchestrator;
use synapse_protocol::{ClientBinaryPacket, SocialMessage};
use synapse_spatial::WorldPos;
use synapse_storage::{CharacterRepository, RedisPresenceManager, RedisStateCache};
use tokio::sync::mpsc;

#[derive(Clone)]
pub struct ServerState {
    pub config: Arc<AppConfig>,
    pub grid: Arc<SpatialGrid>,
    pub cache: RedisStateCache,
    pub presence: RedisPresenceManager,
    pub livekit: Arc<LiveKitRoomOrchestrator>,
    pub character_repo: Arc<dyn CharacterRepository>,
}

#[derive(Deserialize)]
pub struct WsAuthQuery {
    pub ticket: String,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsAuthQuery>,
    State(state): State<ServerState>,
) -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
    // 1. Validate Boarding Pass Ticket
    let claims = verify_boarding_pass(&query.ticket, &state.config.auth.jwt_secret)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;

    // Check JWT blacklist in Redis
    let is_blacklisted = state
        .cache
        .is_token_blacklisted(&query.ticket)
        .await
        .unwrap_or(false);

    if is_blacklisted {
        return Err((StatusCode::FORBIDDEN, "Ticket blacklisted".to_string()));
    }

    // 2. Load Cold State Character from DB
    let character = state
        .character_repo
        .find_by_id(claims.character_id, claims.shard_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Character not found".to_string()))?;

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, character)))
}

async fn handle_socket(
    socket: WebSocket,
    state: ServerState,
    character: synapse_storage::Character,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<OutgoingMessage>();

    let character_id = character.id;
    let initial_pos = WorldPos::new(character.pos_x, character.pos_y);
    let initial_chunk = initial_pos.to_chunk(state.config.game_server.chunk_size as f32);

    // Register active player in RAM Spatial Grid
    let session = PlayerSession::new(
        character_id,
        character.account_id,
        character.shard_id,
        character.display_name.clone(),
        initial_pos,
        initial_chunk,
        tx,
    );
    state.grid.insert_player(session);

    // Update Global Presence Phonebook
    let _ = state
        .presence
        .update_presence(
            character_id,
            &state.config.server.region,
            state.config.redis.presence_ttl_secs,
        )
        .await;

    // Send initial LiveKit Voice Join credentials
    if let Ok(token) = state.livekit.mint_chunk_token(
        &character.display_name,
        character.shard_id,
        initial_chunk,
        2,
        state.config.game_server.mega_crowd_threshold,
    ) {
        let voice_join = SocialMessage::VoiceJoin {
            sfu_url: state.livekit.sfu_url().to_string(),
            token,
        };
        if let Ok(json) = serde_json::to_string(&voice_join) {
            let _ = ws_sender.send(Message::Text(json)).await;
        }
    }

    // Task 1: Pump outgoing messages to WebSocket
    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let ws_msg = match msg {
                OutgoingMessage::Binary(bytes) => Message::Binary(bytes.to_vec()),
                OutgoingMessage::Text(txt) => Message::Text(txt),
            };
            if ws_sender.send(ws_msg).await.is_err() {
                break;
            }
        }
    });

    // Task 2: Receive upstream WebSocket frames (Binary vs JSON demux)
    let state_clone = state.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                // 60FPS Binary Data Plane: Movement (0x01) or Action (0x02)
                Message::Binary(bin_bytes) => {
                    if let Ok(packet) = ClientBinaryPacket::decode(&bin_bytes) {
                        match packet {
                            ClientBinaryPacket::Movement { pos_x, pos_y } => {
                                let new_pos = WorldPos::new(pos_x, pos_y);
                                if let Some(_delta) = state_clone.grid.update_player_position(
                                    character_id,
                                    new_pos,
                                    state_clone.config.game_server.chunk_size as f32,
                                ) {
                                    // Chunk boundary crossed! Handle lazy audio room transition
                                    let new_chunk = new_pos
                                        .to_chunk(state_clone.config.game_server.chunk_size as f32);
                                    let pop = state_clone
                                        .grid
                                        .chunk_players
                                        .get(&new_chunk)
                                        .map(|p| p.len())
                                        .unwrap_or(1);
                                    let _ = state_clone
                                        .livekit
                                        .handle_chunk_population_change(
                                            character.shard_id,
                                            new_chunk,
                                            pop,
                                        )
                                        .await;
                                }
                            }
                            ClientBinaryPacket::Action { action_id } => {
                                tracing::debug!(character_id, action_id, "Action executed");
                            }
                        }
                    }
                }
                // Social Plane: Chat, Calls, Signaling
                Message::Text(json_str) => {
                    if let Ok(social_msg) = serde_json::from_str::<SocialMessage>(&json_str) {
                        match social_msg {
                            SocialMessage::PhoneRing { target_id, .. } => {
                                if let Ok(Some(region_str)) =
                                    state_clone.presence.lookup_presence(target_id as i64).await
                                {
                                    let target_region = region_str.trim_start_matches("region:");
                                    let _ = state_clone
                                        .presence
                                        .publish_call_event(target_region, &json_str)
                                        .await;
                                }
                            }
                            SocialMessage::ChatMessage {
                                channel,
                                sender,
                                content,
                            } => {
                                tracing::info!(channel = %channel, sender = %sender, content = %content, "Chat broadcast");
                            }
                            _ => {}
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait until either task completes (disconnect or client close)
    tokio::select! {
        _ = (&mut send_task) => {},
        _ = (&mut recv_task) => {},
    }

    send_task.abort();
    recv_task.abort();

    // Cleanup: Remove from Hot RAM state & Flush Cold State to PostgreSQL
    if let Some(removed_session) = state.grid.remove_player(character_id) {
        let pos = removed_session.position;
        let chunk = removed_session.current_chunk;
        let _ = state
            .character_repo
            .save_position(
                character_id,
                character.shard_id,
                chunk.x,
                chunk.y,
                pos.x,
                pos.y,
            )
            .await;
        tracing::info!(
            character_id,
            "Player disconnected, cold state flushed to DB"
        );
    }
}
