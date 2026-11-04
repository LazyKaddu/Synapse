mod jobs;

use jobs::{run_ghost_npc_loop, run_periodic_flusher};
use std::sync::Arc;
use synapse_common::{init_telemetry, AppConfig};
use synapse_storage::{DbRouter, PgCharacterRepository};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let config = Arc::new(AppConfig::load("config")?);
    init_telemetry(&config.telemetry)?;

    tracing::info!(region = %config.server.region, "Starting Synapse Background Worker Daemon...");

    let master_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(config.database.max_connections)
        .connect(&config.database.master_url)
        .await?;

    let router = Arc::new(DbRouter::new(
        master_pool,
        vec![],
        config.database.read_after_write_window_secs as i64,
    ));
    let character_repo = Arc::new(PgCharacterRepository::new(router.clone()));

    // Spawn 3-minute flusher job
    let config_clone = config.clone();
    let repo_clone = character_repo.clone();
    tokio::spawn(async move {
        run_periodic_flusher(config_clone, repo_clone).await;
    });

    // Spawn Ghost NPC simulator
    let config_npc = config.clone();
    tokio::spawn(async move {
        run_ghost_npc_loop(config_npc).await;
    });

    tokio::signal::ctrl_c().await?;
    tracing::info!("Worker daemon shutting down gracefully.");
    Ok(())
}
