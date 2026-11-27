use crate::engine::grid::SpatialGrid;
use crate::engine::session::OutgoingMessage;
use crate::social::SocialManager;
use futures_util::StreamExt;
use std::sync::Arc;
use std::time::Duration;
use synapse_protocol::ServerBinaryPacket;
use synapse_spatial::{ChunkCoord, WorldPos};
use synapse_storage::{
    social_topic, spatial_topic, PubSubPublisher, RedisPubSubBus, SocialPubSubEvent,
    SpatialPubSubEvent,
};
use tokio::time::sleep;

#[derive(Clone)]
pub struct PubSubContext {
    pub publisher: Arc<dyn PubSubPublisher>,
    pub pod_id: String,
    pub region: String,
    pub shard_id: i32,
}

/// Processes a single serialized `SpatialPubSubEvent` received from Redis Pub/Sub.
/// Ignores events originating from `local_pod_id` to prevent self-echo loops.
pub fn handle_spatial_pubsub_payload(local_pod_id: &str, grid: &SpatialGrid, payload: &str) {
    let Ok(event) = serde_json::from_str::<SpatialPubSubEvent>(payload) else {
        return;
    };

    if event.origin_pod_id() == local_pod_id {
        return;
    }

    match event {
        SpatialPubSubEvent::NeighborMovement {
            player_id,
            chunk_x,
            chunk_y,
            pos_x,
            pos_y,
            vel_x,
            vel_y,
            server_tick,
            ..
        } => {
            let chunk = ChunkCoord::new(chunk_x, chunk_y);
            grid.upsert_remote_player(player_id as i64, WorldPos::new(pos_x, pos_y), chunk);

            let packet = ServerBinaryPacket::NeighborMovement {
                player_id,
                pos_x,
                pos_y,
                vel_x,
                vel_y,
                server_tick,
            };
            let bytes = packet.encode();

            let subscribers = grid.get_chunk_subscribers(chunk);
            for sub_id in subscribers {
                if sub_id != player_id as i64 {
                    if let Some(target_session) = grid.sessions.get(&sub_id) {
                        target_session.send(OutgoingMessage::Binary(bytes.clone()));
                    }
                }
            }
        }
        SpatialPubSubEvent::ProximityChat {
            chunk_x,
            chunk_y,
            payload_json,
            ..
        } => {
            let chunk = ChunkCoord::new(chunk_x, chunk_y);
            let subscribers = grid.get_chunk_subscribers(chunk);
            for sub_id in subscribers {
                if let Some(sub_session) = grid.sessions.get(&sub_id) {
                    sub_session.send(OutgoingMessage::Text(payload_json.clone()));
                }
            }
        }
    }
}

/// Processes a single serialized `SocialPubSubEvent` received from Redis Pub/Sub.
/// Ignores events originating from `local_pod_id` and delivers only to local sessions.
pub fn handle_social_pubsub_payload(local_pod_id: &str, social: &SocialManager, payload: &str) {
    let Ok(event) = serde_json::from_str::<SocialPubSubEvent>(payload) else {
        return;
    };

    if event.origin_pod_id() == local_pod_id {
        return;
    }

    match event {
        SocialPubSubEvent::UserMessage {
            target_user_id,
            message,
            ..
        } => {
            social.deliver_local_user(&target_user_id, &message);
        }
    }
}

/// Subscribes to `topic:region:{region}:shard:{shard_id}:spatial` with automatic reconnect.
pub async fn run_spatial_subscriber(
    pubsub_bus: RedisPubSubBus,
    pod_id: String,
    region: String,
    shard_id: i32,
    grid: Arc<SpatialGrid>,
) {
    let client = pubsub_bus.client();
    let topic = spatial_topic(&region, shard_id);
    let mut backoff = Duration::from_millis(250);

    loop {
        tracing::info!(topic = %topic, pod_id = %pod_id, "Subscribing to spatial pub/sub...");
        match client.get_async_pubsub().await {
            Ok(mut pubsub) => {
                if pubsub.subscribe(&topic).await.is_ok() {
                    backoff = Duration::from_millis(250);
                    let mut stream = pubsub.on_message();
                    while let Some(msg) = stream.next().await {
                        if let Ok(payload) = msg.get_payload::<String>() {
                            handle_spatial_pubsub_payload(&pod_id, &grid, &payload);
                        }
                    }
                    tracing::warn!(topic = %topic, "Spatial pub/sub stream ended; reconnecting");
                }
            }
            Err(err) => {
                tracing::warn!(%err, topic = %topic, "Failed to connect spatial pub/sub");
            }
        }

        sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(10));
    }
}

/// Subscribes to `topic:region:{region}:social` with automatic reconnect.
pub async fn run_social_subscriber(
    pubsub_bus: RedisPubSubBus,
    pod_id: String,
    region: String,
    social: Arc<SocialManager>,
) {
    let client = pubsub_bus.client();
    let topic = social_topic(&region);
    let mut backoff = Duration::from_millis(250);

    loop {
        tracing::info!(topic = %topic, pod_id = %pod_id, "Subscribing to social pub/sub...");
        match client.get_async_pubsub().await {
            Ok(mut pubsub) => {
                if pubsub.subscribe(&topic).await.is_ok() {
                    backoff = Duration::from_millis(250);
                    let mut stream = pubsub.on_message();
                    while let Some(msg) = stream.next().await {
                        if let Ok(payload) = msg.get_payload::<String>() {
                            handle_social_pubsub_payload(&pod_id, &social, &payload);
                        }
                    }
                    tracing::warn!(topic = %topic, "Social pub/sub stream ended; reconnecting");
                }
            }
            Err(err) => {
                tracing::warn!(%err, topic = %topic, "Failed to connect social pub/sub");
            }
        }

        sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(10));
    }
}

