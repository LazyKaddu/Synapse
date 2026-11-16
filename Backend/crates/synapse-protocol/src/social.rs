use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FriendDto {
    #[serde(alias = "id")]
    pub user_id: String,
    #[serde(alias = "user_name")]
    pub username: String,
    #[serde(default)]
    pub is_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FriendRequestDto {
    #[serde(alias = "request_id")]
    pub id: String,
    pub from_user_id: String,
    pub from_user_name: String,
    pub to_user_id: String,
    #[serde(default = "default_pending_status")]
    pub status: String,
    #[serde(default)]
    pub created_at: String,
}

fn default_pending_status() -> String {
    "pending".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GroupMemberDto {
    pub user_id: String,
    #[serde(alias = "user_name")]
    pub username: String,
    #[serde(default)]
    pub is_owner: bool,
    #[serde(default)]
    pub joined_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GroupDto {
    #[serde(alias = "group_id")]
    pub id: String,
    pub name: String,
    pub owner_id: String,
    #[serde(default)]
    pub members: Vec<GroupMemberDto>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatMessageDto {
    pub id: String,
    #[serde(default)]
    pub message_type: String,
    pub sender_id: String,
    pub sender_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipient_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub content: String,
    #[serde(default)]
    pub created_at: String,
}

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

    // Friend actions
    #[serde(rename = "FRIEND_REQUEST_SEND")]
    FriendRequestSend { target_user_id: String },

    #[serde(rename = "FRIEND_REQUEST_RECEIVED")]
    FriendRequestReceived { request: FriendRequestDto },

    #[serde(rename = "FRIEND_REQUEST_ACCEPT")]
    FriendRequestAccept { request_id: String },

    #[serde(rename = "FRIEND_REQUEST_DECLINE")]
    FriendRequestDecline { request_id: String },

    #[serde(rename = "FRIEND_LIST_SYNC")]
    FriendListSync {
        friends: Vec<FriendDto>,
        pending_incoming: Vec<FriendRequestDto>,
        pending_outgoing: Vec<FriendRequestDto>,
    },

    #[serde(rename = "FRIEND_STATUS_UPDATE")]
    FriendStatusUpdate { user_id: String, is_online: bool },

    // Direct messages
    #[serde(rename = "DIRECT_MSG_SEND")]
    DirectMsgSend {
        recipient_id: String,
        content: String,
    },

    #[serde(rename = "DIRECT_MSG_RECEIVED")]
    DirectMsgReceived { message: ChatMessageDto },

    // Group chat
    #[serde(rename = "GROUP_CREATE")]
    GroupCreate {
        name: String,
        initial_members: Vec<String>,
    },

    #[serde(rename = "GROUP_CREATED")]
    GroupCreated { group: GroupDto },

    #[serde(rename = "GROUP_INVITE")]
    GroupInvite {
        group_id: String,
        target_user_id: String,
    },

    #[serde(rename = "GROUP_MEMBER_JOINED")]
    GroupMemberJoined {
        group_id: String,
        member: GroupMemberDto,
    },

    #[serde(rename = "GROUP_MSG_SEND")]
    GroupMsgSend {
        group_id: String,
        content: String,
    },

    #[serde(rename = "GROUP_MSG_RECEIVED")]
    GroupMsgReceived { message: ChatMessageDto },

    #[serde(rename = "GROUP_LIST_SYNC")]
    GroupListSync { groups: Vec<GroupDto> },

    // Chat history
    #[serde(rename = "FETCH_CHAT_HISTORY")]
    FetchChatHistory {
        target_type: String,
        target_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
    },

    #[serde(rename = "CHAT_HISTORY_SYNC")]
    ChatHistorySync {
        target_type: String,
        target_id: String,
        messages: Vec<ChatMessageDto>,
    },
}
