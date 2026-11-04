use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum SocialMessage {
    #[serde(rename = "VOICE_JOIN")]
    VoiceJoin { sfu_url: String, token: String },

    #[serde(rename = "VOICE_SET_TRACKS")]
    VoiceSetTracks { subscribe_to: Vec<String> },

    #[serde(rename = "CHAT_MSG")]
    ChatMessage {
        channel: String,
        sender: String,
        content: String,
    },

    #[serde(rename = "PHONE_RING")]
    PhoneRing { caller_id: u32, target_id: u32 },

    #[serde(rename = "PHONE_ANSWER")]
    PhoneAnswer {
        caller_id: u32,
        target_id: u32,
        accepted: bool,
    },

    #[serde(rename = "PHONE_HANGUP")]
    PhoneHangup { session_id: String },

    #[serde(rename = "SERVER_RESTART")]
    ServerRestart { message: String },
}
