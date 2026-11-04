use std::sync::Arc;
use std::time::Duration;
use synapse_common::AppConfig;
use synapse_spatial::{TerrainGenerator, WorldPos};
use tokio::time::interval;

pub async fn run_ghost_npc_loop(config: Arc<AppConfig>) {
    let mut ticker = interval(Duration::from_secs(5));
    let terrain = TerrainGenerator::new(config.game_server.world_seed as u32, 0.005);

    tracing::info!("Initializing Ghost NPC spatial roaming agent loop...");

    loop {
        ticker.tick().await;

        // Simulated Ghost NPC navigation across terrain
        let mock_pos = WorldPos::new(1050.0, 2040.0);
        let biome = terrain.get_biome_at(mock_pos.x as f64, mock_pos.y as f64);
        tracing::debug!(?biome, "Ghost NPC roaming spatial chunk");
    }
}
