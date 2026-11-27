use async_trait::async_trait;
use dashmap::DashMap;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use synapse_common::{Result, SynapseError};
use synapse_protocol::SocialMessage;
use tokio::sync::broadcast;

#[inline]
pub fn spatial_topic(region: &str, shard_id: i32) -> String {
    format!("topic:region:{}:shard:{}:spatial", region, shard_id)
}

#[inline]
pub fn social_topic(region: &str) -> String {
    format!("topic:region:{}:social", region)
}

#[inline]
pub fn calls_topic(region: &str) -> String {
    format!("topic:region:{}:calls", region)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SpatialPubSubEvent {
    NeighborMovement {
        origin_pod_id: String,
        player_id: u32,
        chunk_x: i32,
        chunk_y: i32,
        pos_x: f32,
        pos_y: f32,
        vel_x: f32,
        vel_y: f32,
        server_tick: u32,
    },
    ProximityChat {
        origin_pod_id: String,
        chunk_x: i32,
        chunk_y: i32,
        payload_json: String,
    },
}

impl SpatialPubSubEvent {
    pub fn origin_pod_id(&self) -> &str {
        match self {
            SpatialPubSubEvent::NeighborMovement { origin_pod_id, .. } => origin_pod_id,
            SpatialPubSubEvent::ProximityChat { origin_pod_id, .. } => origin_pod_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SocialPubSubEvent {
    UserMessage {
        origin_pod_id: String,
        target_user_id: String,
        message: SocialMessage,
    },
}

impl SocialPubSubEvent {
    pub fn origin_pod_id(&self) -> &str {
        match self {
            SocialPubSubEvent::UserMessage { origin_pod_id, .. } => origin_pod_id,
        }
    }
}

#[async_trait]
pub trait PubSubPublisher: Send + Sync {
    async fn publish(&self, topic: &str, payload: &str) -> Result<()>;
}

#[derive(Clone)]
pub struct RedisPubSubBus {
    conn: ConnectionManager,
    redis_client: redis::Client,
}

impl RedisPubSubBus {
    pub fn new(conn: ConnectionManager, redis_client: redis::Client) -> Self {
        Self { conn, redis_client }
    }

    pub fn client(&self) -> redis::Client {
        self.redis_client.clone()
    }
}

#[async_trait]
impl PubSubPublisher for RedisPubSubBus {
    async fn publish(&self, topic: &str, payload: &str) -> Result<()> {
        let mut conn = self.conn.clone();
        conn.publish::<_, _, ()>(topic, payload)
            .await
            .map_err(|e| SynapseError::Cache(e.to_string()))?;
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct InMemoryPubSubBus {
    topics: std::sync::Arc<DashMap<String, broadcast::Sender<String>>>,
}

impl InMemoryPubSubBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self, topic: &str) -> broadcast::Receiver<String> {
        let sender = self
            .topics
            .entry(topic.to_string())
            .or_insert_with(|| broadcast::channel(1024).0);
        sender.subscribe()
    }
}

#[async_trait]
impl PubSubPublisher for InMemoryPubSubBus {
    async fn publish(&self, topic: &str, payload: &str) -> Result<()> {
        if let Some(sender) = self.topics.get(topic) {
            let _ = sender.send(payload.to_string());
        }
        Ok(())
    }
}

