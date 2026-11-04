use synapse_spatial::TerrainGenerator;

#[test]
fn test_deterministic_terrain_generation() {
    let gen1 = TerrainGenerator::new(133742, 0.005);
    let gen2 = TerrainGenerator::new(133742, 0.005);

    let biome1 = gen1.get_biome_at(1050.0, 2040.0);
    let biome2 = gen2.get_biome_at(1050.0, 2040.0);

    // Deterministic: identical coordinates with identical seed MUST yield identical biome
    assert_eq!(biome1, biome2);
}

#[test]
fn test_terrain_generation_different_seeds() {
    let gen1 = TerrainGenerator::new(100, 0.05);
    let gen2 = TerrainGenerator::new(999, 0.05);

    // Different seeds should generally generate distinct biomes across coordinates
    let mut different_count = 0;
    for i in 0..10 {
        let x = (i * 1000) as f64;
        let y = (i * 1000) as f64;
        if gen1.get_biome_at(x, y) != gen2.get_biome_at(x, y) {
            different_count += 1;
        }
    }
    assert!(
        different_count > 0,
        "Different seeds must produce varying biomes"
    );
}
