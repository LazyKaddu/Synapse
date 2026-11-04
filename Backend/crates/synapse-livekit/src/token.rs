use chrono::{Duration, Utc};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use synapse_common::{Result, SynapseError};

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoGrants {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room_join: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_publish: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_subscribe: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LiveKitClaims {
    pub sub: String,
    pub iss: String,
    pub exp: i64,
    pub nbf: i64,
    pub video: VideoGrants,
}

pub struct LiveKitTokenGenerator {
    api_key: String,
    api_secret: String,
}

impl LiveKitTokenGenerator {
    pub fn new(api_key: String, api_secret: String) -> Self {
        Self {
            api_key,
            api_secret,
        }
    }

    /// Generates a LiveKit JWT token for a specific room and participant.
    pub fn create_room_token(
        &self,
        participant_identity: &str,
        room_name: &str,
        can_publish: bool,
        can_subscribe: bool,
        validity_hours: i64,
    ) -> Result<String> {
        let now = Utc::now();
        let exp = now + Duration::hours(validity_hours);

        let claims = LiveKitClaims {
            sub: participant_identity.to_string(),
            iss: self.api_key.clone(),
            exp: exp.timestamp(),
            nbf: now.timestamp(),
            video: VideoGrants {
                room: Some(room_name.to_string()),
                room_join: Some(true),
                can_publish: Some(can_publish),
                can_subscribe: Some(can_subscribe),
            },
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.api_secret.as_bytes()),
        )
        .map_err(|e| SynapseError::LiveKit(format!("Failed to generate LiveKit token: {}", e)))
    }
}
