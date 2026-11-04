use crate::engine::grid::SpatialGrid;
use crate::engine::session::OutgoingMessage;
use std::sync::Arc;
use std::time::Duration;
use synapse_common::AppConfig;
use synapse_livekit::LiveKitRoomOrchestrator;
use synapse_protocol::{ServerBinaryPacket, SocialMessage};
use synapse_spatial::AudioCuller;
use synapse_storage::{RedisStateCache, WarmPlayerState};
use tokio::time::interval;

pub async fn run_tick_loop(
    config: Arc<AppConfig>,
    grid: Arc<SpatialGrid>,
    cache: RedisStateCache,
    _livekit: Arc<LiveKitRoomOrchestrator>,
) {
    let tick_interval = Duration::from_millis(1000 / config.game_server.tick_rate_hz);
    let mut ticker = interval(tick_interval);

    let audio_culler = AudioCuller::new(
        config.game_server.max_voice_tracks,
        config.game_server.voice_hysteresis_max,
    );

    let mut tick_counter: u64 = 0;

    loop {
        ticker.tick().await;
        tick_counter += 1;

        // 1. Process 10Hz Broadcasts & Warm State Sync
        for item in grid.sessions.iter() {
            let session = item.value();
            let character_id = session.character_id;
            let current_pos = session.position;
            let current_chunk = session.current_chunk;

            // Prepare downstream neighbor movement packet (OpCode 0x10)
            let packet = ServerBinaryPacket::NeighborMovement {
                player_id: character_id as u32,
                pos_x: current_pos.x,
                pos_y: current_pos.y,
            };
            let binary_bytes = packet.encode();

            // Broadcast to all players subscribed to this chunk's AOI
            let subscribers = grid.get_chunk_subscribers(current_chunk);
            for sub_id in subscribers {
                if sub_id != character_id {
                    if let Some(target_session) = grid.sessions.get(&sub_id) {
                        target_session.send(OutgoingMessage::Binary(binary_bytes.clone()));
                    }
                }
            }

            // 2. Periodic Warm State Flush to Redis (e.g. every 10 ticks / 1 second)
            if tick_counter.is_multiple_of(10) {
                let warm_state = WarmPlayerState {
                    display_name: session.display_name.clone(),
                    chunk_x: current_chunk.x,
                    chunk_y: current_chunk.y,
                    pos_x: current_pos.x,
                    pos_y: current_pos.y,
                    health: 100.0,
                };
                let cache_clone = cache.clone();
                let shard_id = session.shard_id;
                tokio::spawn(async move {
                    let _ = cache_clone
                        .update_player_state(shard_id, character_id, &warm_state)
                        .await;
                });
            }

            // 3. Audio Culling: Top 50 nearest neighbor tracks (evaluated every 5 ticks / 500ms)
            if tick_counter.is_multiple_of(5) {
                let candidates = grid.get_nearby_candidates(current_chunk);
                let culled_tracks = audio_culler.cull_audio_tracks(
                    &current_pos,
                    &session.subscribed_audio_tracks,
                    candidates,
                );

                let track_names: Vec<String> = culled_tracks
                    .iter()
                    .map(|id| format!("trk_{}", id))
                    .collect();

                let voice_msg = SocialMessage::VoiceSetTracks {
                    subscribe_to: track_names,
                };

                if let Ok(json_str) = serde_json::to_string(&voice_msg) {
                    session.send(OutgoingMessage::Text(json_str));
                }
            }
        }
    }
}
