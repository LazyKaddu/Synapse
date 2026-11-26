use game_server::engine::{
    simulate_and_broadcast_tick, OutgoingMessage, PlayerSession, QueuedInput, SpatialGrid,
    MAX_INPUT_DT_MS, MAX_INPUT_QUEUE_LEN,
};
use game_server::handler::apply_teleport;
use std::f32::consts::FRAC_1_SQRT_2;
use synapse_protocol::ServerBinaryPacket;
use synapse_spatial::{CollisionEngine, WorldNoise, WorldPos, AABB};
use tokio::sync::mpsc;

const CHUNK_SIZE: f32 = 1000.0;
const WORLD_SEED: i32 = 42;

fn find_open_tile_center(engine: &CollisionEngine) -> (f64, f64) {
    for tx in -50..=50 {
        for ty in -50..=50 {
            let cx = (tx as f64) * engine.tile_size + 32.0;
            let cy = (ty as f64) * engine.tile_size + 32.0;
            // Ensure a 3x3 tile neighborhood is completely free of colliders
            let wide_box = AABB {
                min_x: cx - engine.tile_size,
                min_y: cy - engine.tile_size,
                max_x: cx + engine.tile_size,
                max_y: cy + engine.tile_size,
            };
            if engine.check_collision(&wide_box).is_none() {
                return (cx, cy);
            }
        }
    }
    panic!("Could not find open 3x3 tile area");
}

fn make_session(
    id: i64,
    pos: WorldPos,
) -> (PlayerSession, mpsc::UnboundedReceiver<OutgoingMessage>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let session = PlayerSession::new(
        id,
        1,
        1,
        format!("Player{}", id),
        pos,
        pos.to_chunk(CHUNK_SIZE),
        tx,
    );
    (session, rx)
}

#[test]
fn test_60hz_input_processing_walk_sprint_and_diagonal() {
    let engine = CollisionEngine::new(WorldNoise::new(WORLD_SEED));
    let (start_x, start_y) = find_open_tile_center(&engine);
    let grid = SpatialGrid::new();
    let (session, _rx) = make_session(1, WorldPos::new(start_x as f32, start_y as f32));
    grid.insert_player(session);

    // 1. Walk right (+X) for 50ms at 240.0 px/s -> +12.0 px
    {
        let mut s = grid.sessions.get_mut(&1).unwrap();
        assert!(s.enqueue_input(QueuedInput {
            seq: 1,
            dx: 1,
            dy: 0,
            sprint: false,
            dt_ms: 50,
        }));
    }
    simulate_and_broadcast_tick(&grid, &engine, 1, CHUNK_SIZE, 6);

    {
        let s = grid.sessions.get(&1).unwrap();
        assert!((s.position.x - (start_x as f32 + 12.0)).abs() < 1e-3);
        assert!((s.position.y - start_y as f32).abs() < 1e-3);
        assert_eq!(s.last_processed_seq, 1);
        assert!((s.velocity.x - 240.0).abs() < 1e-3);
        assert!(s.velocity.y.abs() < 1e-3);
    }

    // 2. Sprint up (-Y) for 50ms at 480.0 px/s -> -24.0 px
    let pos_after_walk = grid.sessions.get(&1).unwrap().position;
    {
        let mut s = grid.sessions.get_mut(&1).unwrap();
        assert!(s.enqueue_input(QueuedInput {
            seq: 2,
            dx: 0,
            dy: -1,
            sprint: true,
            dt_ms: 50,
        }));
    }
    simulate_and_broadcast_tick(&grid, &engine, 2, CHUNK_SIZE, 6);

    {
        let s = grid.sessions.get(&1).unwrap();
        assert!((s.position.x - pos_after_walk.x).abs() < 1e-3);
        assert!((s.position.y - (pos_after_walk.y - 24.0)).abs() < 1e-3);
        assert_eq!(s.last_processed_seq, 2);
        assert!(s.velocity.x.abs() < 1e-3);
        assert!((s.velocity.y - (-480.0)).abs() < 1e-3);
    }

    // 3. Diagonal walk (1, 1) for 50ms -> normalized by FRAC_1_SQRT_2
    let pos_before_diag = grid.sessions.get(&1).unwrap().position;
    {
        let mut s = grid.sessions.get_mut(&1).unwrap();
        assert!(s.enqueue_input(QueuedInput {
            seq: 3,
            dx: 1,
            dy: 1,
            sprint: false,
            dt_ms: 50,
        }));
    }
    simulate_and_broadcast_tick(&grid, &engine, 3, CHUNK_SIZE, 6);

    let expected_step = 240.0 * FRAC_1_SQRT_2 * 0.05;
    let expected_vel = 240.0 * FRAC_1_SQRT_2;
    {
        let s = grid.sessions.get(&1).unwrap();
        assert!((s.position.x - (pos_before_diag.x + expected_step)).abs() < 1e-2);
        assert!((s.position.y - (pos_before_diag.y + expected_step)).abs() < 1e-2);
        assert_eq!(s.last_processed_seq, 3);
        assert!((s.velocity.x - expected_vel).abs() < 1e-2);
        assert!((s.velocity.y - expected_vel).abs() < 1e-2);
    }
}

#[test]
fn test_collision_parity_blocks_and_slides() {
    let engine = CollisionEngine::new(WorldNoise::new(WORLD_SEED));

    // Find a land tile directly left of a water tile, with free space below
    let mut found = None;
    for tx in -100..=100 {
        for ty in -100..=100 {
            if !engine.world_noise.is_water_at(tx, ty)
                && engine.world_noise.is_water_at(tx + 1, ty)
            {
                let cx = (tx as f64) * engine.tile_size + 32.0;
                let cy = (ty as f64) * engine.tile_size + 32.0;
                let here = AABB {
                    min_x: cx - 14.0,
                    min_y: cy - 14.0,
                    max_x: cx + 14.0,
                    max_y: cy + 14.0,
                };
                let below = AABB {
                    min_x: cx - 14.0,
                    min_y: cy + 12.0 - 14.0,
                    max_x: cx + 14.0,
                    max_y: cy + 12.0 + 14.0,
                };
                if engine.check_collision(&here).is_none()
                    && engine.check_collision(&below).is_none()
                {
                    found = Some((tx, ty));
                    break;
                }
            }
        }
        if found.is_some() {
            break;
        }
    }
    let (tx, ty) = found.expect("Need land tile adjacent to water tile");

    let start_x = (((tx + 1) as f64) * engine.tile_size - 14.0 - 2.0) as f32;
    let start_y = ((ty as f64) * engine.tile_size + 32.0) as f32;

    let grid = SpatialGrid::new();
    let (session, _rx) = make_session(1, WorldPos::new(start_x, start_y));
    grid.insert_player(session);

    // Move diagonally (+1, +1): X into water must be blocked, Y must slide smoothly
    {
        let mut s = grid.sessions.get_mut(&1).unwrap();
        s.enqueue_input(QueuedInput {
            seq: 1,
            dx: 1,
            dy: 1,
            sprint: false,
            dt_ms: 50,
        });
    }
    simulate_and_broadcast_tick(&grid, &engine, 1, CHUNK_SIZE, 6);

    let s = grid.sessions.get(&1).unwrap();
    assert!(
        (s.position.x - start_x).abs() < 1e-3,
        "X movement into water must be blocked"
    );
    assert!(
        s.position.y > start_y + 5.0,
        "Y movement must slide along the water edge"
    );
    assert!(s.velocity.x.abs() < 1e-3, "Blocked X axis velocity should be 0");
    assert!(s.velocity.y > 0.0, "Free Y axis velocity should be positive");
}

#[test]
fn test_anti_cheat_bounds_dt_clamp_queue_limit_and_stale_seq() {
    let engine = CollisionEngine::new(WorldNoise::new(WORLD_SEED));
    let (start_x, start_y) = find_open_tile_center(&engine);
    let grid = SpatialGrid::new();
    let (session, _rx) = make_session(1, WorldPos::new(start_x as f32, start_y as f32));
    grid.insert_player(session);

    // 1. dt_ms > 100 is clamped to 100ms
    {
        let mut s = grid.sessions.get_mut(&1).unwrap();
        assert!(s.enqueue_input(QueuedInput {
            seq: 1,
            dx: 1,
            dy: 0,
            sprint: false,
            dt_ms: 5000,
        }));
        assert_eq!(s.input_queue.back().unwrap().dt_ms, MAX_INPUT_DT_MS);

        // Stale / duplicate seq rejected
        assert!(!s.enqueue_input(QueuedInput {
            seq: 1,
            dx: 1,
            dy: 0,
            sprint: false,
            dt_ms: 16,
        }));
    }

    simulate_and_broadcast_tick(&grid, &engine, 1, CHUNK_SIZE, 6);

    {
        let s = grid.sessions.get(&1).unwrap();
        // Max 100ms at 240 px/s = 24.0 px
        assert!((s.position.x - (start_x as f32 + 24.0)).abs() < 1e-3);
    }

    // 2. input_queue bounded at MAX_INPUT_QUEUE_LEN (120)
    {
        let mut s = grid.sessions.get_mut(&1).unwrap();
        for seq in 2..=(MAX_INPUT_QUEUE_LEN as u32 + 50) {
            s.enqueue_input(QueuedInput {
                seq,
                dx: 1,
                dy: 0,
                sprint: false,
                dt_ms: 16,
            });
        }
        assert_eq!(s.input_queue.len(), MAX_INPUT_QUEUE_LEN);
    }
}

#[test]
fn test_10hz_snapshot_cadence_over_12_ticks() {
    let engine = CollisionEngine::new(WorldNoise::new(WORLD_SEED));
    let (start_x, start_y) = find_open_tile_center(&engine);
    let grid = SpatialGrid::new();

    let (s1, mut rx1) = make_session(1, WorldPos::new(start_x as f32, start_y as f32));
    let (s2, mut rx2) = make_session(2, WorldPos::new(start_x as f32 + 50.0, start_y as f32));
    grid.insert_player(s1);
    grid.insert_player(s2);

    // Run 12 simulation ticks (60Hz) with 10Hz broadcast (every 6 ticks)
    for tick in 1..=12u64 {
        {
            let mut s = grid.sessions.get_mut(&1).unwrap();
            s.enqueue_input(QueuedInput {
                seq: tick as u32,
                dx: 1,
                dy: 0,
                sprint: false,
                dt_ms: 16,
            });
        }
        simulate_and_broadcast_tick(&grid, &engine, tick, CHUNK_SIZE, 6);
    }

    // Player 1 should receive:
    // - 2 PlayerStateAck (0x13) packets (at tick 6 and tick 12)
    // - 2 NeighborMovement (0x10) packets for Player 2 (at tick 6 and tick 12)
    let mut acks_p1 = Vec::new();
    let mut neighbors_p1 = Vec::new();
    while let Ok(msg) = rx1.try_recv() {
        if let OutgoingMessage::Binary(bytes) = msg {
            match ServerBinaryPacket::decode(&bytes).unwrap() {
                ServerBinaryPacket::PlayerStateAck {
                    last_processed_seq,
                    server_tick,
                    ..
                } => acks_p1.push((last_processed_seq, server_tick)),
                ServerBinaryPacket::NeighborMovement {
                    player_id,
                    server_tick,
                    ..
                } => neighbors_p1.push((player_id, server_tick)),
                _ => {}
            }
        }
    }

    assert_eq!(acks_p1.len(), 2, "Expected exactly 2 PlayerStateAck packets");
    assert_eq!(acks_p1[0], (6, 6));
    assert_eq!(acks_p1[1], (12, 12));
    assert_eq!(neighbors_p1.len(), 2);
    assert_eq!(neighbors_p1[0], (2, 6));
    assert_eq!(neighbors_p1[1], (2, 12));

    // Player 2 should receive 2 NeighborMovement (0x10) packets for Player 1 and 2 PlayerStateAck packets
    let mut acks_p2 = 0;
    let mut neighbors_p2 = Vec::new();
    while let Ok(msg) = rx2.try_recv() {
        if let OutgoingMessage::Binary(bytes) = msg {
            match ServerBinaryPacket::decode(&bytes).unwrap() {
                ServerBinaryPacket::PlayerStateAck { .. } => acks_p2 += 1,
                ServerBinaryPacket::NeighborMovement {
                    player_id,
                    vel_x,
                    server_tick,
                    ..
                } => neighbors_p2.push((player_id, vel_x, server_tick)),
                _ => {}
            }
        }
    }

    assert_eq!(acks_p2, 2);
    assert_eq!(neighbors_p2.len(), 2);
    assert_eq!(neighbors_p2[0].0, 1);
    assert!((neighbors_p2[0].1 - 240.0).abs() < 1e-3);
    assert_eq!(neighbors_p2[0].2, 6);
    assert_eq!(neighbors_p2[1].0, 1);
    assert_eq!(neighbors_p2[1].2, 12);
}

#[test]
fn test_teleport_resolves_safe_spawn_and_resets_velocity() {
    let engine = CollisionEngine::new(WorldNoise::new(WORLD_SEED));

    // Find a water tile to teleport into
    let mut water_tile = None;
    for tx in -100..=100 {
        for ty in -100..=100 {
            if engine.world_noise.is_water_at(tx, ty) {
                water_tile = Some((tx, ty));
                break;
            }
        }
        if water_tile.is_some() {
            break;
        }
    }
    let (wtx, wty) = water_tile.expect("Need a water tile");
    let bad_x = ((wtx as f64) * engine.tile_size + 32.0) as f32;
    let bad_y = ((wty as f64) * engine.tile_size + 32.0) as f32;

    let grid = SpatialGrid::new();
    let (mut session, _rx) = make_session(1, WorldPos::new(0.0, 0.0));
    session.velocity = WorldPos::new(240.0, 0.0);
    session.enqueue_input(QueuedInput {
        seq: 1,
        dx: 1,
        dy: 0,
        sprint: false,
        dt_ms: 16,
    });
    grid.insert_player(session);

    apply_teleport(&grid, &engine, 1, bad_x, bad_y, CHUNK_SIZE);

    let s = grid.sessions.get(&1).unwrap();
    // Should not land on the water tile center
    assert!(
        (s.position.x - bad_x).abs() > 1.0 || (s.position.y - bad_y).abs() > 1.0,
        "Teleport must move player out of water via find_safe_spawn"
    );
    // Safe spawn box must be collision-free
    let safe_box = AABB {
        min_x: s.position.x as f64 - engine.player_half_size,
        min_y: s.position.y as f64 - engine.player_half_size,
        max_x: s.position.x as f64 + engine.player_half_size,
        max_y: s.position.y as f64 + engine.player_half_size,
    };
    assert!(engine.check_collision(&safe_box).is_none());
    // Velocity & pending input queue must be reset
    assert_eq!(s.velocity, WorldPos::new(0.0, 0.0));
    assert!(s.input_queue.is_empty());
}
