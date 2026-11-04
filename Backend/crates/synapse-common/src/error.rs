use thiserror::Error;

pub type Result<T> = std::result::Result<T, SynapseError>;

#[derive(Error, Debug)]
pub enum SynapseError {
    #[error("Authentication failed: {0}")]
    Authentication(String),

    #[error("Authorization denied: {0}")]
    Unauthorized(String),

    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Redis cache error: {0}")]
    Cache(String),

    #[error("Spatial engine error: {0}")]
    Spatial(String),

    #[error("Protocol serialization/deserialization error: {0}")]
    Protocol(String),

    #[error("LiveKit SFU error: {0}")]
    LiveKit(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Internal system error: {0}")]
    Internal(String),
}
