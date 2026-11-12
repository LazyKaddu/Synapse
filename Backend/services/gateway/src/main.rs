mod routes;
mod state;

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use state::AppState;
use std::net::SocketAddr;
use std::sync::Arc;
use synapse_common::{init_telemetry, AppConfig};
use synapse_storage::{
    DbRouter, PgAccountRepository, PgCharacterRepository, PgPrefabRepository, RedisStateCache,
};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Load configuration
    dotenvy::dotenv().ok();
    let config = Arc::new(AppConfig::load("config")?);

    // 2. Initialize Telemetry (Logging & Prometheus metrics)
    init_telemetry(&config.telemetry)?;
    tracing::info!(region = %config.server.region, "Starting Synapse API Gateway...");

    // 3. Initialize PostgreSQL & PgBouncer Pool
    let master_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(config.database.max_connections)
        .connect(&config.database.master_url)
        .await?;

    let router = Arc::new(DbRouter::new(
        master_pool,
        vec![],
        config.database.read_after_write_window_secs as i64,
    ));

    // 4. Initialize Redis Cache
    let redis_client = redis::Client::open(config.redis.primary_url.as_str())?;
    let redis_conn = redis::aio::ConnectionManager::new(redis_client).await?;
    let cache = RedisStateCache::new(redis_conn);

    // 5. Build State & Handlers
    let state = AppState {
        config: config.clone(),
        account_repo: Arc::new(PgAccountRepository::new(router.clone())),
        character_repo: Arc::new(PgCharacterRepository::new(router.clone())),
        prefab_repo: Arc::new(PgPrefabRepository::new(router.clone())),
        cache,
    };

    let app = Router::new()
        .route("/healthz", get(|| async { "OK" }))
        .route("/readyz", get(|| async { "READY" }))
        .route("/api/v1/auth/login", post(routes::auth::login_handler))
        .route(
            "/api/v1/auth/register",
            post(routes::auth::register_handler),
        )
        .route(
            "/api/v1/characters",
            get(routes::characters::list_characters_handler),
        )
        .route(
            "/api/v1/characters",
            post(routes::characters::create_character_handler),
        )
        .route(
            "/api/v1/prefabs",
            get(routes::prefabs::list_prefabs_handler).post(routes::prefabs::create_prefab_handler),
        )
        .route(
            "/api/v1/prefabs/:id",
            get(routes::prefabs::get_prefab_handler)
                .delete(routes::prefabs::delete_prefab_handler),
        )
        .route(
            "/api/v1/world/join",
            post(routes::world::join_world_handler),
        )
        .layer(DefaultBodyLimit::max(routes::prefabs::MAX_PREFAB_BYTES))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", config.gateway.host, config.gateway.port).parse()?;
    tracing::info!(addr = %addr, "Synapse Gateway listening for REST connections");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    tracing::info!("Gateway gracefully stopped.");
    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C signal handler");
    tracing::info!("Shutdown signal received, draining Gateway connections...");
}
