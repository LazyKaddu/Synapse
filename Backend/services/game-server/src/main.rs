use axum::{
    routing::{any, get},
    Router,
};
use game_server::engine::{
    run_phone_subscriber, run_social_subscriber, run_spatial_subscriber, run_tick_loop,
    OutgoingMessage, PubSubContext, SpatialGrid,
};
use game_server::handler::{ws_handler, ServerState};
use game_server::social::SocialManager;
use std::net::SocketAddr;
use std::sync::Arc;
use synapse_common::{init_telemetry, AppConfig};
use synapse_livekit::LiveKitRoomOrchestrator;
use synapse_protocol::SocialMessage;
use synapse_spatial::{CollisionEngine, WorldNoise};
use synapse_storage::{
    CharacterRepository, ChatRepository, DbRouter, PgCharacterRepository, PgChatRepository,
    RedisPresenceManager, RedisPubSubBus, RedisStateCache,
};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

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
    let chat_repo: Arc<dyn ChatRepository> = Arc::new(PgChatRepository::new(router.clone()));

    // 3. Redis Connections (State cache, Global presence & Pub/Sub)
    let primary_redis = redis::Client::open(config.redis.primary_url.as_str())?;
    let primary_conn = redis::aio::ConnectionManager::new(primary_redis).await?;
    let cache = RedisStateCache::new(primary_conn);

    let global_redis = redis::Client::open(config.redis.global_presence_url.as_str())?;
    let global_conn = redis::aio::ConnectionManager::new(global_redis.clone()).await?;
    let presence = RedisPresenceManager::new(global_conn.clone(), global_redis.clone());

    let pod_id = Uuid::new_v4().to_string();
    let pubsub_bus = RedisPubSubBus::new(global_conn, global_redis);
    let pubsub_ctx = PubSubContext {
        publisher: Arc::new(pubsub_bus.clone()),
        pod_id: pod_id.clone(),
        region: config.server.region.clone(),
        shard_id: config.server.shard_id,
    };

    let social = Arc::new(SocialManager::with_pubsub(
        chat_repo.clone(),
        pod_id.clone(),
        config.server.region.clone(),
        pubsub_ctx.publisher.clone(),
    ));

    // 4. LiveKit SFU Room Orchestrator
    let livekit = Arc::new(LiveKitRoomOrchestrator::new(
        config.livekit.host.clone(),
        config.livekit.api_key.clone(),
        config.livekit.api_secret.clone(),
    ));

    // 5. Initialize Spatial Engine Grid, CollisionEngine & State
    let grid = Arc::new(SpatialGrid::new());
    let collision = Arc::new(CollisionEngine::new(WorldNoise::new(
        config.game_server.world_seed as i32,
    )));

    let state = ServerState {
        config: config.clone(),
        grid: grid.clone(),
        collision,
        cache: cache.clone(),
        presence: presence.clone(),
        livekit: livekit.clone(),
        character_repo: character_repo.clone(),
        social: social.clone(),
        pubsub: Some(pubsub_ctx.clone()),
    };

    // 6. Spawn Background Tasks
    // 60Hz Spatial Simulation & 10Hz Broadcast Tick Loop
    let config_clone = config.clone();
    let grid_clone = grid.clone();
    let cache_clone = cache.clone();
    let livekit_clone = livekit.clone();
    let pubsub_for_tick = Some(pubsub_ctx.clone());
    tokio::spawn(async move {
        run_tick_loop(
            config_clone,
            grid_clone,
            cache_clone,
            livekit_clone,
            pubsub_for_tick,
        )
        .await;
    });

    // Cross-Pod Spatial & Proximity Chat Pub/Sub Subscriber
    let spatial_bus = pubsub_bus.clone();
    let spatial_pod_id = pod_id.clone();
    let spatial_region = config.server.region.clone();
    let spatial_shard = config.server.shard_id;
    let grid_for_spatial = grid.clone();
    tokio::spawn(async move {
        run_spatial_subscriber(
            spatial_bus,
            spatial_pod_id,
            spatial_region,
            spatial_shard,
            grid_for_spatial,
        )
        .await;
    });

    // Cross-Pod Regional Social Messaging Pub/Sub Subscriber
    let social_bus = pubsub_bus;
    let social_pod_id = pod_id;
    let social_region = config.server.region.clone();
    let social_for_sub = social.clone();
    tokio::spawn(async move {
        run_social_subscriber(social_bus, social_pod_id, social_region, social_for_sub).await;
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
