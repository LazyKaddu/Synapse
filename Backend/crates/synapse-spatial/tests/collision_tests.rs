use synapse_spatial::{
    fbm_2d, hash_2d, value_noise_2d, voronoi_2d, CollisionEngine, WorldNoise, BASE_SPEED,
    DEFAULT_PLAYER_HALF_SIZE, DEFAULT_TILE_SIZE, SPRINT_SPEED,
};

#[test]
fn test_hash_2d_determinism_and_range() {
    // Same inputs must always produce exact same float in [0, 1)
    let h1 = hash_2d(0, 0, 42);
    let h2 = hash_2d(0, 0, 42);
    assert_eq!(h1, h2);
    assert!((0.0..1.0).contains(&h1));

    // Negative coordinates must be stable and in [0, 1)
    let hn = hash_2d(-123, -456, 999);
    assert_eq!(hn, hash_2d(-123, -456, 999));
    assert!((0.0..1.0).contains(&hn));

    // Different coordinates produce different hashes
    assert_ne!(hash_2d(10, 20, 42), hash_2d(10, 21, 42));
    assert_ne!(hash_2d(10, 20, 42), hash_2d(10, 20, 43));
}

#[test]
fn test_value_noise_and_fbm_range_and_determinism() {
    let v = value_noise_2d(12.34, -56.78, 1337);
    assert_eq!(v, value_noise_2d(12.34, -56.78, 1337));
    assert!((0.0..=1.0).contains(&v));

    let f = fbm_2d(1.5, -2.5, 1337, 4, 2.0, 0.5);
    assert_eq!(f, fbm_2d(1.5, -2.5, 1337, 4, 2.0, 0.5));
    assert!((0.0..=1.0).contains(&f));
}

#[test]
fn test_voronoi_2d_invariants() {
    let res = voronoi_2d(3.25, -4.75, 42);
    assert!(res.d1 <= res.d2);
    assert!(res.d1 >= 0.0);

    // Same cell_id across repeated calls
    let res2 = voronoi_2d(3.25, -4.75, 42);
    assert_eq!(res.cell_id, res2.cell_id);
    assert_eq!(res.center_col, res2.center_col);
    assert_eq!(res.center_row, res2.center_row);
}

#[test]
fn test_world_noise_water_determinism() {
    let world_a = WorldNoise::new(42);
    let world_b = WorldNoise::new(42);

    // Deterministic across instances
    for tx in -20..=20 {
        for ty in -20..=20 {
            assert_eq!(world_a.is_water_at(tx, ty), world_b.is_water_at(tx, ty));
        }
    }

    // Should find both water and land in a large enough scan
    let mut found_water = false;
    let mut found_land = false;
    for tx in -100..=100 {
        for ty in -100..=100 {
            if world_a.is_water_at(tx, ty) {
                found_water = true;
            } else {
                found_land = true;
            }
            if found_water && found_land {
                break;
            }
        }
        if found_water && found_land {
            break;
        }
    }
    assert!(found_water, "Expected at least one water tile");
    assert!(found_land, "Expected at least one land tile");
}

#[test]
fn test_collision_engine_constants() {
    let engine = CollisionEngine::new(WorldNoise::new(42));
    assert_eq!(engine.tile_size, 64.0);
    assert_eq!(engine.player_half_size, 14.0);
    assert_eq!(engine.base_speed, 240.0);
    assert_eq!(engine.sprint_speed, 480.0);
    assert_eq!(DEFAULT_TILE_SIZE, 64.0);
    assert_eq!(DEFAULT_PLAYER_HALF_SIZE, 14.0);
    assert_eq!(BASE_SPEED, 240.0);
    assert_eq!(SPRINT_SPEED, 480.0);
}

#[test]
fn test_find_safe_spawn_avoids_obstacles() {
    let world = WorldNoise::new(42);
    let engine = CollisionEngine::new(world);

    // Find a water tile to test spawning inside an obstacle
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
    let (wtx, wty) = water_tile.expect("Need a water tile for test");
    let bad_x = (wtx as f64) * engine.tile_size + 32.0;
    let bad_y = (wty as f64) * engine.tile_size + 32.0;

    let (safe_x, safe_y) = engine.find_safe_spawn(bad_x, bad_y, 14.0, 14.0);
    assert_ne!((safe_x, safe_y), (bad_x, bad_y));

    let safe_box = synapse_spatial::AABB {
        min_x: safe_x - 14.0,
        min_y: safe_y - 14.0,
        max_x: safe_x + 14.0,
        max_y: safe_y + 14.0,
    };
    assert!(
        engine.check_collision(&safe_box).is_none(),
        "Safe spawn must be collision-free"
    );
}

#[test]
fn test_resolve_movement_and_axis_separated_wall_sliding() {
    let world = WorldNoise::new(42);
    let engine = CollisionEngine::new(world);

    // Find a land tile directly to the left of a water tile:
    // (tx, ty) is free of any colliders, and (tx + 1, ty) is water.
    let mut test_tile = None;
    for tx in -100..=100 {
        for ty in -100..=100 {
            if !engine.world_noise.is_water_at(tx, ty)
                && engine.world_noise.is_water_at(tx + 1, ty)
            {
                let cx = (tx as f64) * engine.tile_size + 32.0;
                let cy = (ty as f64) * engine.tile_size + 32.0;
                let box_here = synapse_spatial::AABB {
                    min_x: cx - 14.0,
                    min_y: cy - 14.0,
                    max_x: cx + 14.0,
                    max_y: cy + 14.0,
                };
                // Also ensure (tx, ty + 1) is free so Y can slide down
                let box_below = synapse_spatial::AABB {
                    min_x: cx - 14.0,
                    min_y: cy + 10.0 - 14.0,
                    max_x: cx + 14.0,
                    max_y: cy + 10.0 + 14.0,
                };
                if engine.check_collision(&box_here).is_none()
                    && engine.check_collision(&box_below).is_none()
                {
                    test_tile = Some((tx, ty));
                    break;
                }
            }
        }
        if test_tile.is_some() {
            break;
        }
    }

    let (tx, ty) = test_tile.expect("Need land tile adjacent to water tile");
    // Position player near the right edge of (tx, ty) so moving +X collides with water at (tx + 1, ty)
    let start_x = ((tx + 1) as f64) * engine.tile_size - 14.0 - 2.0;
    let start_y = (ty as f64) * engine.tile_size + 32.0;

    // Move diagonally (+X, +Y): X should be blocked by water, Y should slide smoothly!
    let res = engine.resolve_movement(start_x, start_y, 1.0, 1.0, 240.0, 0.05, 14.0, 14.0);
    assert!(res.x_blocked, "X movement into water must be blocked");
    assert!(!res.y_blocked, "Y movement along water edge must slide");
    assert_eq!(res.new_x, start_x);
    assert!((res.new_y - (start_y + 12.0)).abs() < 1e-6);
    assert!(res.collider.is_some());
}

#[test]
fn test_resolve_movement_zero_input() {
    let engine = CollisionEngine::new(WorldNoise::new(42));
    let res = engine.resolve_movement(100.0, 200.0, 0.0, 0.0, 240.0, 0.016, 14.0, 14.0);
    assert_eq!(res.new_x, 100.0);
    assert_eq!(res.new_y, 200.0);
    assert!(!res.x_blocked);
    assert!(!res.y_blocked);
    assert!(res.collider.is_none());
}
