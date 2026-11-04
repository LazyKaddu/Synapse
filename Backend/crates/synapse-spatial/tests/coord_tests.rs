use synapse_spatial::{ChunkCoord, WorldPos, DEFAULT_CHUNK_SIZE};

#[test]
fn test_chunk_math_integer_division_positive_coords() {
    let pos = WorldPos::new(23500.5, 25100.2);
    let chunk = pos.to_chunk(DEFAULT_CHUNK_SIZE);
    assert_eq!(chunk, ChunkCoord::new(23, 25));
}

#[test]
fn test_chunk_math_integer_division_negative_coords() {
    let pos = WorldPos::new(-500.0, -1500.0);
    let chunk = pos.to_chunk(DEFAULT_CHUNK_SIZE);
    assert_eq!(chunk, ChunkCoord::new(-1, -2));
}

#[test]
fn test_euclidean_distance_calculation() {
    let p1 = WorldPos::new(0.0, 0.0);
    let p2 = WorldPos::new(300.0, 400.0);
    assert_eq!(p1.distance(&p2), 500.0);
    assert_eq!(p1.distance_squared(&p2), 250000.0);
}

#[test]
fn test_chunk_coord_key_string() {
    let coord = ChunkCoord::new(23, 25);
    assert_eq!(coord.to_key_string(), "23_25");
}

