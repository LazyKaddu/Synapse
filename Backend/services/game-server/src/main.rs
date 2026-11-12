use axum::{
    routing::{any, get},
    Router,
};
use game_server::engine::{run_phone_subscriber, run_tick_loop, OutgoingMessage, SpatialGrid};
use game_server::handler::{ws_handler, ServerState};
use std::net::SocketAddr;
use std::sync::Arc;
use synapse_common::{init_telemetry, AppConfig};
use synapse_livekit::LiveKitRoomOrchestrator;
use synapse_protocol::SocialMessage;
use synapse_storage::{
    CharacterRepository, DbRouter, PgCharacterRepository, RedisPresenceManager, RedisStateCache,
};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Load configuration & initialize telemetry
    dotenvy::dotenv().ok();
    let config = Arc::new(AppConfig::load("config")?);
    init_telemetry(&config.telemetry)?;

    tracing::info!(
        region = %config.server.region,
        shard_id = config.server.shard_id,
        tick_rate = config.game_server.tick_rate_hz,
        "Initializing Synapse Spatial Game Engine..."
    );

    // 2. Database connection & DbRouter
    let master_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(config.database.max_connections)
        .connect(&config.database.master_url)
        .await?;

    let router = Arc::new(DbRouter::new(
        master_pool,
        vec![],
        config.database.read_after_write_window_secs as i64,
    ));
    let _router_cleanup = router.spawn_cleanup_task(std::time::Duration::from_secs(30));
    let character_repo: Arc<dyn CharacterRepository> =
        Arc::new(PgCharacterRepository::new(router.clone()));

    // 3. Redis Connections (State cache & Global presence)
    let primary_redis = redis::Client::open(config.redis.primary_url.as_str())?;
    let primary_conn = redis::aio::ConnectionManager::new(primary_redis).await?;
    let cache = RedisStateCache::new(primary_conn);

    let global_redis = redis::Client::open(config.redis.global_presence_url.as_str())?;
    let global_conn = redis::aio::ConnectionManager::new(global_redis.clone()).await?;
    let presence = RedisPresenceManager::new(global_conn, global_redis);

    // 4. LiveKit SFU Room Orchestrator
    let livekit = Arc::new(LiveKitRoomOrchestrator::new(
        config.livekit.host.clone(),
        config.livekit.api_key.clone(),
        config.livekit.api_secret.clone(),
    ));

    // 5. Initialize Spatial Engine Grid & State
    let grid = Arc::new(SpatialGrid::new());

    let state = ServerState {
        config: config.clone(),
        grid: grid.clone(),
        cache: cache.clone(),
        presence: presence.clone(),
        livekit: livekit.clone(),
        character_repo: character_repo.clone(),
    };

    // 6. Spawn Background Tasks
    // 10Hz Spatial Tick Loop
    let config_clone = config.clone();
    let grid_clone = grid.clone();
    let cache_clone = cache.clone();
    let livekit_clone = livekit.clone();
    tokio::spawn(async move {
        run_tick_loop(config_clone, grid_clone, cache_clone, livekit_clone).await;
    });

    // Cross-Region Phone Call Pub/Sub Subscriber
    let presence_clone = presence.clone();
    let region = config.server.region.clone();
    let grid_for_phone = grid.clone();
    tokio::spawn(async move {
        run_phone_subscriber(presence_clone, region, grid_for_phone).await;
    });

    // 7. HTTP/WebSocket Router
    let app = Router::new()
        .route("/healthz", get(|| async { "OK" }))
        .route("/readyz", get(|| async { "READY" }))
        .route("/socket", any(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr =
        format!("{}:{}", config.game_server.host, config.game_server.port).parse()?;
    tracing::info!(addr = %addr, "Synapse Game Server WebSocket listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal(
        grid,
        character_repo,
        config.server.shard_id,
    ))
    .await?;

    tracing::info!("Game Server terminated cleanly.");
    Ok(())
}

async fn shutdown_signal(
    grid: Arc<SpatialGrid>,
    character_repo: Arc<dyn CharacterRepository>,
    shard_id: i32,
) {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C signal handler");

    tracing::warn!("SIGTERM received: executing preStop graceful drain hook...");

    // 1. Notify connected clients to migrate smoothly
    let restart_msg = SocialMessage::ServerRestart {
        message: "Server migrating. Requesting new boarding pass...".to_string(),
    };
    if let Ok(json_str) = serde_json::to_string(&restart_msg) {
        for item in grid.sessions.iter() {
            item.value().send(OutgoingMessage::Text(json_str.clone()));
        }
    }

    // 2. Flush all active Hot RAM state to Cold PostgreSQL storage
    for item in grid.sessions.iter() {
        let session = item.value();
        let _ = character_repo
            .save_position(
                session.character_id,
                shard_id,
                session.current_chunk.x,
                session.current_chunk.y,
                session.position.x,
                session.position.y,
            )
            .await;
    }

    tracing::info!("All active player states flushed to database. PreStop drain complete.");
}
