use crate::config::TelemetryConfig;
use crate::error::{Result, SynapseError};
use metrics_exporter_prometheus::PrometheusBuilder;
use std::net::SocketAddr;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub fn init_telemetry(config: &TelemetryConfig) -> Result<()> {
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(&config.log_level));

    if config.json_logs {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer().json())
            .try_init()
            .map_err(|e| SynapseError::Internal(format!("Failed to init JSON tracer: {}", e)))?;
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer().compact())
            .try_init()
            .map_err(|e| SynapseError::Internal(format!("Failed to init compact tracer: {}", e)))?;
    }

    let metrics_addr: SocketAddr = format!("0.0.0.0:{}", config.metrics_port)
        .parse()
        .map_err(|e| SynapseError::Config(format!("Invalid metrics address: {}", e)))?;

    PrometheusBuilder::new()
        .with_http_listener(metrics_addr)
        .install()
        .map_err(|e| {
            SynapseError::Internal(format!("Failed to install Prometheus exporter: {}", e))
        })?;

    tracing::info!(
        metrics_port = config.metrics_port,
        "Prometheus metrics server started"
    );
    Ok(())
}
