use crate::engine::grid::SpatialGrid;
use crate::engine::session::OutgoingMessage;
use futures_util::StreamExt;
use std::sync::Arc;
use synapse_protocol::SocialMessage;
use synapse_storage::RedisPresenceManager;

pub async fn run_phone_subscriber(
    presence_manager: RedisPresenceManager,
    current_region: String,
    grid: Arc<SpatialGrid>,
) {
    let client = presence_manager.client();
    let topic = format!("topic:region:{}:calls", current_region);

    tracing::info!(topic = %topic, "Listening for cross-region phone calls...");

    if let Ok(mut pubsub) = client.get_async_pubsub().await {
        if pubsub.subscribe(&topic).await.is_ok() {
            let mut stream = pubsub.on_message();
            while let Some(msg) = stream.next().await {
                let payload: String = match msg.get_payload() {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                if let Ok(SocialMessage::PhoneRing { target_id, .. }) =
                    serde_json::from_str::<SocialMessage>(&payload)
                {
                    if let Some(target_session) = grid.sessions.get(&(target_id as i64)) {
                        target_session.send(OutgoingMessage::Text(payload));
                    }
                }
            }
        }
    }
}
