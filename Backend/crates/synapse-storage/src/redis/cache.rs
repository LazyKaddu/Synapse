use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use synapse_common::{Result, SynapseError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarmPlayerState {
    pub display_name: String,
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub health: f32,
}

#[derive(Clone)]
pub struct RedisStateCache {
    conn: ConnectionManager,
}

impl RedisStateCache {
    pub fn new(conn: ConnectionManager) -> Self {
        Self { conn }
    }

    /// Updates warm player coordinates during the 10Hz tick.
    /// Key format: player:{shard_id}:{character_id}
    pub async fn update_player_state(
        &self,
        shard_id: i32,
        character_id: i64,
        state: &WarmPlayerState,
    ) -> Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("player:{}:{}", shard_id, character_id);

        let fields = [
            ("display_name", state.display_name.clone()),
            ("chunk_x", state.chunk_x.to_string()),
            ("chunk_y", state.chunk_y.to_string()),
            ("pos_x", state.pos_x.to_string()),
            ("pos_y", state.pos_y.to_string()),
            ("health", state.health.to_string()),
        ];

        conn.hset_multiple::<_, _, _, ()>(&key, &fields)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;

        Ok(())
    }

    /// Spatial grid tracking: adds a character to a chunk set.
    /// Key format: chunk:{shard_id}:{chunk_x}_{chunk_y}
    pub async fn add_to_chunk(
        &self,
        shard_id: i32,
        chunk_x: i32,
        chunk_y: i32,
        character_id: i64,
    ) -> Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("chunk:{}:{}_{}", shard_id, chunk_x, chunk_y);

        conn.sadd::<_, _, ()>(&key, character_id)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;

        Ok(())
    }

    /// Spatial grid tracking: removes a character from a chunk set.
    pub async fn remove_from_chunk(
        &self,
        shard_id: i32,
        chunk_x: i32,
        chunk_y: i32,
        character_id: i64,
    ) -> Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("chunk:{}:{}_{}", shard_id, chunk_x, chunk_y);

        conn.srem::<_, _, ()>(&key, character_id)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;

        Ok(())
    }

    /// Checks if a JWT token is blacklisted.
    pub async fn is_token_blacklisted(&self, token: &str) -> Result<bool> {
        let mut conn = self.conn.clone();
        let key = format!("blacklist:{}", token);

        let exists: bool = conn
            .exists(&key)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;

        Ok(exists)
    }

    /// Blacklists a token for a given TTL in seconds.
    pub async fn blacklist_token(&self, token: &str, ttl_secs: u64) -> Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("blacklist:{}", token);

        conn.set_ex::<_, _, ()>(&key, "banned", ttl_secs)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;

        Ok(())
    }

    /// Increments login attempts for an IP and sets expiry for rate limiting.
    pub async fn check_and_increment_rate_limit(
        &self,
        ip: &str,
        max_attempts: i64,
        ttl_secs: u64,
    ) -> Result<bool> {
        let mut conn = self.conn.clone();
        let key = format!("login_attempts:{}", ip);

        let count: i64 = conn
            .incr(&key, 1)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;

        if count == 1 {
            let _: () = conn
                .expire(&key, ttl_secs as i64)
                .await
                .map_err(|e| SynapseError::Cache(e.to_string()))?;
        }

        Ok(count <= max_attempts)
    }
}
