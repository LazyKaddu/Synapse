use crate::engine::grid::SpatialGrid;
use crate::engine::pubsub::PubSubContext;
use crate::engine::session::{OutgoingMessage, QueuedInput, MAX_INPUT_DT_MS};
use std::sync::Arc;
use std::time::Duration;
use synapse_common::AppConfig;
use synapse_livekit::LiveKitRoomOrchestrator;
use synapse_protocol::{ServerBinaryPacket, SocialMessage};
use synapse_spatial::{AudioCuller, CollisionEngine, WorldNoise, WorldPos};
use synapse_storage::{spatial_topic, RedisStateCache, SpatialPubSubEvent, WarmPlayerState};
use tokio::time::interval;

/// Simulates one 60Hz tick for all connected players and, on broadcast ticks,
/// emits `PlayerStateAck` (0x13) to each player and `NeighborMovement` (0x10)
/// to AOI subscribers.
pub fn simulate_and_broadcast_tick(
    grid: &SpatialGrid,
    collision: &CollisionEngine,
    tick_counter: u64,
    chunk_size: f32,
    broadcast_interval_ticks: u64,
) {
    // 1. Simulate queued inputs at 60Hz
    let player_ids: Vec<i64> = grid.sessions.iter().map(|s| *s.key()).collect();

    for character_id in player_ids {
        let (start_pos, drained_inputs) = {
            let Some(mut session) = grid.sessions.get_mut(&character_id) else {
                continue;
            };
            let inputs: Vec<QueuedInput> = session.input_queue.drain(..).collect();
            (session.position, inputs)
        };

        if drained_inputs.is_empty() {
            if let Some(mut session) = grid.sessions.get_mut(&character_id) {
                session.velocity = WorldPos::new(0.0, 0.0);
            }
            continue;
        }

        let mut pos_x = start_pos.x as f64;
        let mut pos_y = start_pos.y as f64;
        let mut final_vel = WorldPos::new(0.0, 0.0);
        let mut last_seq = None;

        for input in drained_inputs {
            let raw_dx = input.dx as f64;
            let raw_dy = input.dy as f64;
            let (dir_x, dir_y) = if raw_dx != 0.0 || raw_dy != 0.0 {
                let len = (raw_dx * raw_dx + raw_dy * raw_dy).sqrt();
                (raw_dx / len, raw_dy / len)
            } else {
                (0.0, 0.0)
            };

            let speed = if input.sprint {
                collision.sprint_speed
            } else {
                collision.base_speed
            };
            let dt = (input.dt_ms.min(MAX_INPUT_DT_MS) as f64) / 1000.0;

            let res = collision.resolve_movement(
                pos_x,
                pos_y,
                dir_x,
                dir_y,
                speed,
                dt,
                collision.player_half_size,
                collision.player_half_size,
            );
            pos_x = res.new_x;
            pos_y = res.new_y;

            let vx = if res.x_blocked || dir_x == 0.0 {
                0.0
            } else {
                (dir_x * speed) as f32
            };
            let vy = if res.y_blocked || dir_y == 0.0 {
                0.0
            } else {
                (dir_y * speed) as f32
            };
            final_vel = WorldPos::new(vx, vy);
            last_seq = Some(input.seq);
        }

        if let Some(mut session) = grid.sessions.get_mut(&character_id) {
            session.velocity = final_vel;
            if let Some(seq) = last_seq {
                session.last_processed_seq = seq;
            }
        }

        let new_pos = WorldPos::new(pos_x as f32, pos_y as f32);
        if new_pos != start_pos {
            grid.update_player_position(character_id, new_pos, chunk_size);
        }
    }

    // 2. Broadcast 10Hz state snapshots (every `broadcast_interval_ticks`, default 6)
    let interval = broadcast_interval_ticks.max(1);
    if !tick_counter.is_multiple_of(interval) {
        return;
    }

    let server_tick = tick_counter as u32;
    for item in grid.sessions.iter() {
        let session = item.value();
        let character_id = session.character_id;
        let current_pos = session.position;
        let current_vel = session.velocity;
        let current_chunk = session.current_chunk;

        // Authoritative ack to owning player (OpCode 0x13)
        let ack_packet = ServerBinaryPacket::PlayerStateAck {
            last_processed_seq: session.last_processed_seq,
            pos_x: current_pos.x,
            pos_y: current_pos.y,
            vel_x: current_vel.x,
            vel_y: current_vel.y,
            server_tick,
        };
        session.send(OutgoingMessage::Binary(ack_packet.encode()));

        // Neighbor movement broadcast to AOI subscribers (OpCode 0x10)
        let neighbor_packet = ServerBinaryPacket::NeighborMovement {
            player_id: character_id as u32,
            pos_x: current_pos.x,
            pos_y: current_pos.y,
            vel_x: current_vel.x,
            vel_y: current_vel.y,
            server_tick,
        };
        let neighbor_bytes = neighbor_packet.encode();

        let subscribers = grid.get_chunk_subscribers(current_chunk);
        for sub_id in subscribers {
            if sub_id != character_id {
                if let Some(target_session) = grid.sessions.get(&sub_id) {
                    target_session.send(OutgoingMessage::Binary(neighbor_bytes.clone()));
                }
            }
        }
    }
}

/// Runs one 60Hz simulation tick and, when `publish_snapshots` is true (10Hz),
/// sends local acks/neighbor broadcasts AND publishes `SpatialPubSubEvent::NeighborMovement`
/// for remote pods in the same region/shard.
pub async fn simulate_and_broadcast_tick_with_pubsub(
    grid: &SpatialGrid,
    collision: &CollisionEngine,
    chunk_size: f32,
    server_tick: u64,
    publish_snapshots: bool,
    pubsub: Option<&PubSubContext>,
) {
    let broadcast_interval = if publish_snapshots { 1 } else { u64::MAX };
    simulate_and_broadcast_tick(grid, collision, server_tick, chunk_size, broadcast_interval);

    if !publish_snapshots {
        return;
    }

    let Some(ctx) = pubsub else {
        return;
    };

    let topic = spatial_topic(&ctx.region, ctx.shard_id);
    let tick_u32 = server_tick as u32;

    for item in grid.sessions.iter() {
        let session = item.value();
        let event = SpatialPubSubEvent::NeighborMovement {
            origin_pod_id: ctx.pod_id.clone(),
            player_id: session.character_id as u32,
            chunk_x: session.current_chunk.x,
            chunk_y: session.current_chunk.y,
            pos_x: session.position.x,
            pos_y: session.position.y,
            vel_x: session.velocity.x,
            vel_y: session.velocity.y,
            server_tick: tick_u32,
        };
        if let Ok(payload) = serde_json::to_string(&event) {
            let _ = ctx.publisher.publish(&topic, &payload).await;
        }
    }
}

pub async fn run_tick_loop(
    config: Arc<AppConfig>,
    grid: Arc<SpatialGrid>,
    cache: RedisStateCache,
    _livekit: Arc<LiveKitRoomOrchestrator>,
    pubsub: Option<PubSubContext>,
) {
    let tick_interval = Duration::from_micros(16_667); // 60Hz simulation
    let mut ticker = interval(tick_interval);

    let collision = CollisionEngine::new(WorldNoise::new(config.game_server.world_seed as i32));
    let audio_culler = AudioCuller::new(
        config.game_server.max_voice_tracks,
        config.game_server.voice_hysteresis_max,
    );

    let chunk_size = config.game_server.chunk_size as f32;
    let broadcast_interval_ticks = (60 / config.game_server.tick_rate_hz.max(1)).max(1);

    let mut tick_counter: u64 = 0;

    loop {
        ticker.tick().await;
        tick_counter += 1;

        // 1. 60Hz physics/collision simulation & 10Hz snapshot broadcast + Redis pub/sub fan-out
        let publish_snapshots = tick_counter.is_multiple_of(broadcast_interval_ticks);
        simulate_and_broadcast_tick_with_pubsub(
            &grid,
            &collision,
            chunk_size,
            tick_counter,
            publish_snapshots,
            pubsub.as_ref(),
        )
        .await;

        // 2. Periodic Warm State Flush to Redis & stale remote player prune (every 60 ticks / 1 second)
        if tick_counter.is_multiple_of(60) {
            grid.prune_stale_remote_players(Duration::from_secs(5));
            for item in grid.sessions.iter() {
                let session = item.value();
                let warm_state = WarmPlayerState {
                    display_name: session.display_name.clone(),
                    chunk_x: session.current_chunk.x,
                    chunk_y: session.current_chunk.y,
                    pos_x: session.position.x,
                    pos_y: session.position.y,
                    health: 100.0,
                };
                let cache_clone = cache.clone();
                let shard_id = session.shard_id;
                let character_id = session.character_id;
                tokio::spawn(async move {
                    let _ = cache_clone
                        .update_player_state(shard_id, character_id, &warm_state)
                        .await;
                });
            }
        }

        // 3. Audio Culling: Top 50 nearest neighbor tracks (every 30 ticks / 500ms)
        if tick_counter.is_multiple_of(30) {
            for item in grid.sessions.iter() {
                let session = item.value();
                let candidates = grid.get_nearby_candidates(session.current_chunk);
                let culled_tracks = audio_culler.cull_audio_tracks(
                    &session.position,
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
