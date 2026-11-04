use crate::error::{Result, SynapseError};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub gateway: GatewayConfig,
    pub game_server: GameServerConfig,
    pub telemetry: TelemetryConfig,
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub livekit: LiveKitConfig,
    pub auth: AuthConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub environment: String,
    pub region: String,
    pub shard_id: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GatewayConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GameServerConfig {
    pub host: String,
    pub port: u16,
    pub tick_rate_hz: u64,
    pub chunk_size: u32,
    pub world_seed: u64,
    pub max_voice_tracks: usize,
    pub voice_hysteresis_max: usize,
    pub mega_crowd_threshold: usize,
    pub flush_interval_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TelemetryConfig {
    pub metrics_port: u16,
    pub log_level: String,
    pub json_logs: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub master_url: String,
    pub replica_urls: Vec<String>,
    pub max_connections: u32,
    pub read_after_write_window_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    pub primary_url: String,
    pub global_presence_url: String,
    pub presence_ttl_secs: u64,
    pub session_ttl_secs: u64,
    pub blacklist_ttl_secs: u64,
    pub login_rate_limit_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LiveKitConfig {
    pub host: String,
    pub api_key: String,
    pub api_secret: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    pub jwt_secret: String,
    pub jwt_expiration_hours: i64,
    pub boarding_pass_expiration_seconds: i64,
}

impl AppConfig {
    pub fn load(config_dir: &str) -> Result<Self> {
        let env_mode = std::env::var("SYNAPSE_ENV").unwrap_or_else(|_| "development".to_string());
        let config_path = Path::new(config_dir);

        let builder = config::Config::builder()
            .add_source(config::File::from(config_path.join("default.toml")).required(false))
            .add_source(
                config::File::from(config_path.join(format!("{}.toml", env_mode))).required(false),
            )
            .add_source(config::Environment::with_prefix("SYNAPSE").separator("_"));

        let cfg = builder
            .build()
            .map_err(|e| SynapseError::Config(format!("Failed to build configuration: {}", e)))?;

        cfg.try_deserialize::<AppConfig>().map_err(|e| {
            SynapseError::Config(format!("Failed to deserialize configuration: {}", e))
        })
    }
}
