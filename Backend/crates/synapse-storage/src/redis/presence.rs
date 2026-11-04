use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use synapse_common::{Result, SynapseError};

#[derive(Clone)]
pub struct RedisPresenceManager {
    conn: ConnectionManager,
    redis_client: redis::Client,
}

impl RedisPresenceManager {
    pub fn new(conn: ConnectionManager, redis_client: redis::Client) -> Self {
        Self { conn, redis_client }
    }

    /// Heartbeats the player presence in the Global Phonebook:
    /// Key: presence:{player_id} -> Value: "region:eu-west" (TTL: 120s)
    pub async fn update_presence(&self, player_id: i64, region: &str, ttl_secs: u64) -> Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("presence:{}", player_id);
        let val = format!("region:{}", region);

        conn.set_ex::<_, _, ()>(&key, val, ttl_secs)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;

        Ok(())
    }

    /// Looks up a player's region in the Global Phonebook.
    pub async fn lookup_presence(&self, player_id: i64) -> Result<Option<String>> {
        let mut conn = self.conn.clone();
        let key = format!("presence:{}", player_id);

        let region: Option<String> = conn
            .get(&key)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;

        Ok(region)
    }

    /// Publishes a cross-region call message to a target region topic.
    /// Topic format: topic:region:{region}:calls
    pub async fn publish_call_event(&self, target_region: &str, payload_json: &str) -> Result<()> {
        let mut conn = self.conn.clone();
        let topic = format!("topic:region:{}:calls", target_region);

        conn.publish::<_, _, ()>(&topic, payload_json)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;

        Ok(())
    }

    pub fn client(&self) -> redis::Client {
        self.redis_client.clone()
    }
}
