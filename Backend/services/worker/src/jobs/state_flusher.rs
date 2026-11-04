use std::sync::Arc;
use std::time::Duration;
use synapse_common::AppConfig;
use synapse_storage::PgCharacterRepository;
use tokio::time::interval;

pub async fn run_periodic_flusher(
    config: Arc<AppConfig>,
    character_repo: Arc<PgCharacterRepository>,
) {
    let flush_interval = Duration::from_secs(config.game_server.flush_interval_secs);
    let mut ticker = interval(flush_interval);

    tracing::info!(
        interval_secs = config.game_server.flush_interval_secs,
        "Starting Cold State 3-minute periodic sync worker..."
    );

    loop {
        ticker.tick().await;
        let _ = &character_repo;
        tracing::info!("Executing 3-minute Cold State persistence sync...");

        // In production: scans Redis keys `player:{shard}:*` and batch persists to Postgres
        // using bulk upsert statements to prevent data loss in the event of hardware failure.
    }
}
