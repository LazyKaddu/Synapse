use synapse_protocol::{
    ChatMessageDto, FriendDto, FriendRequestDto, GroupDto, GroupMemberDto, SocialMessage,
};

#[test]
fn test_voice_join_message_serialization() {
    let msg = SocialMessage::VoiceJoin {
        sfu_url: "wss://sfu.game.com".to_string(),
        token: "jwt_token_123".to_string(),
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"VOICE_JOIN""#));
    assert!(json.contains("jwt_token_123"));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_voice_set_tracks_message_serialization() {
    let msg = SocialMessage::VoiceSetTracks {
        subscribe_to: vec!["trk_10".to_string(), "trk_20".to_string()],
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"VOICE_SET_TRACKS""#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_phone_ring_message_serialization() {
    let msg = SocialMessage::PhoneRing {
        caller_id: 8812,
        target_id: 4092,
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"PHONE_RING""#));
    assert!(json.contains(r#""caller_id":8812"#));
    assert!(json.contains(r#""target_id":4092"#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_server_restart_migration_message() {
    let msg = SocialMessage::ServerRestart {
        message: "Server migrating. Requesting new boarding pass...".to_string(),
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"SERVER_RESTART""#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_friend_request_send_roundtrip() {
    let msg = SocialMessage::FriendRequestSend {
        target_user_id: "user_456".to_string(),
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"FRIEND_REQUEST_SEND""#));
    assert!(json.contains(r#""target_user_id":"user_456""#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_friend_request_received_roundtrip() {
    let req = FriendRequestDto {
        id: "req_101".to_string(),
        from_user_id: "user_111".to_string(),
        from_user_name: "Aria".to_string(),
        to_user_id: "user_222".to_string(),
        status: "pending".to_string(),
        created_at: "2026-11-16T12:00:00Z".to_string(),
    };
    let msg = SocialMessage::FriendRequestReceived { request: req };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"FRIEND_REQUEST_RECEIVED""#));
    assert!(json.contains(r#""from_user_name":"Aria""#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_friend_request_accept_and_decline_roundtrip() {
    let accept_msg = SocialMessage::FriendRequestAccept {
        request_id: "req_777".to_string(),
    };
    let accept_json = serde_json::to_string(&accept_msg).expect("serialize failed");
    assert!(accept_json.contains(r#""type":"FRIEND_REQUEST_ACCEPT""#));
    assert!(accept_json.contains(r#""request_id":"req_777""#));
    let deserialized_accept: SocialMessage =
        serde_json::from_str(&accept_json).expect("deserialize failed");
    assert_eq!(accept_msg, deserialized_accept);

    let decline_msg = SocialMessage::FriendRequestDecline {
        request_id: "req_888".to_string(),
    };
    let decline_json = serde_json::to_string(&decline_msg).expect("serialize failed");
    assert!(decline_json.contains(r#""type":"FRIEND_REQUEST_DECLINE""#));
    assert!(decline_json.contains(r#""request_id":"req_888""#));
    let deserialized_decline: SocialMessage =
        serde_json::from_str(&decline_json).expect("deserialize failed");
    assert_eq!(decline_msg, deserialized_decline);
}

#[test]
fn test_friend_list_sync_roundtrip() {
    let msg = SocialMessage::FriendListSync {
        friends: vec![
            FriendDto {
                user_id: "u_1".to_string(),
                username: "Kaelen".to_string(),
                is_online: true,
            },
            FriendDto {
                user_id: "u_2".to_string(),
                username: "Lyra".to_string(),
                is_online: false,
            },
        ],
        pending_incoming: vec![FriendRequestDto {
            id: "req_inc_1".to_string(),
            from_user_id: "u_3".to_string(),
            from_user_name: "Bob".to_string(),
            to_user_id: "u_current".to_string(),
            status: "pending".to_string(),
            created_at: "2026-11-16T12:05:00Z".to_string(),
        }],
        pending_outgoing: vec![FriendRequestDto {
            id: "req_out_1".to_string(),
            from_user_id: "u_current".to_string(),
            from_user_name: "Me".to_string(),
            to_user_id: "u_4".to_string(),
            status: "pending".to_string(),
            created_at: "2026-11-16T12:06:00Z".to_string(),
        }],
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"FRIEND_LIST_SYNC""#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_friend_status_update_roundtrip() {
    let msg = SocialMessage::FriendStatusUpdate {
        user_id: "u_online_1".to_string(),
        is_online: true,
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"FRIEND_STATUS_UPDATE""#));
    assert!(json.contains(r#""is_online":true"#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_direct_msg_send_and_received_roundtrip() {
    let send_msg = SocialMessage::DirectMsgSend {
        recipient_id: "u_target".to_string(),
        content: "Hello there in Synapse!".to_string(),
    };
    let send_json = serde_json::to_string(&send_msg).expect("serialize failed");
    assert!(send_json.contains(r#""type":"DIRECT_MSG_SEND""#));
    assert!(send_json.contains(r#""recipient_id":"u_target""#));
    let deserialized_send: SocialMessage =
        serde_json::from_str(&send_json).expect("deserialize failed");
    assert_eq!(send_msg, deserialized_send);

    let chat_dto = ChatMessageDto {
        id: "msg_direct_1".to_string(),
        message_type: "direct".to_string(),
        sender_id: "u_sender".to_string(),
        sender_name: "Alice".to_string(),
        recipient_id: Some("u_target".to_string()),
        group_id: None,
        content: "Hello there in Synapse!".to_string(),
        created_at: "2026-11-16T12:10:00Z".to_string(),
    };
    let recv_msg = SocialMessage::DirectMsgReceived { message: chat_dto };
    let recv_json = serde_json::to_string(&recv_msg).expect("serialize failed");
    assert!(recv_json.contains(r#""type":"DIRECT_MSG_RECEIVED""#));
    let deserialized_recv: SocialMessage =
        serde_json::from_str(&recv_json).expect("deserialize failed");
    assert_eq!(recv_msg, deserialized_recv);
}

#[test]
fn test_group_create_and_created_roundtrip() {
    let create_msg = SocialMessage::GroupCreate {
        name: "Raid Guild Alpha".to_string(),
        initial_members: vec!["u_1".to_string(), "u_2".to_string()],
    };
    let create_json = serde_json::to_string(&create_msg).expect("serialize failed");
    assert!(create_json.contains(r#""type":"GROUP_CREATE""#));
    let deserialized_create: SocialMessage =
        serde_json::from_str(&create_json).expect("deserialize failed");
    assert_eq!(create_msg, deserialized_create);

    let group_dto = GroupDto {
        id: "grp_001".to_string(),
        name: "Raid Guild Alpha".to_string(),
        owner_id: "u_creator".to_string(),
        members: vec![GroupMemberDto {
            user_id: "u_creator".to_string(),
            username: "Leader".to_string(),
            is_owner: true,
            joined_at: "2026-11-16T12:00:00Z".to_string(),
        }],
        created_at: "2026-11-16T12:00:00Z".to_string(),
    };
    let created_msg = SocialMessage::GroupCreated { group: group_dto };
    let created_json = serde_json::to_string(&created_msg).expect("serialize failed");
    assert!(created_json.contains(r#""type":"GROUP_CREATED""#));
    let deserialized_created: SocialMessage =
        serde_json::from_str(&created_json).expect("deserialize failed");
    assert_eq!(created_msg, deserialized_created);
}

#[test]
fn test_group_invite_and_member_joined_roundtrip() {
    let invite_msg = SocialMessage::GroupInvite {
        group_id: "grp_001".to_string(),
        target_user_id: "u_friend".to_string(),
    };
    let invite_json = serde_json::to_string(&invite_msg).expect("serialize failed");
    assert!(invite_json.contains(r#""type":"GROUP_INVITE""#));
    let deserialized_invite: SocialMessage =
        serde_json::from_str(&invite_json).expect("deserialize failed");
    assert_eq!(invite_msg, deserialized_invite);

    let joined_member = GroupMemberDto {
        user_id: "u_friend".to_string(),
        username: "Newbie".to_string(),
        is_owner: false,
        joined_at: "2026-11-16T12:15:00Z".to_string(),
    };
    let joined_msg = SocialMessage::GroupMemberJoined {
        group_id: "grp_001".to_string(),
        member: joined_member,
    };
    let joined_json = serde_json::to_string(&joined_msg).expect("serialize failed");
    assert!(joined_json.contains(r#""type":"GROUP_MEMBER_JOINED""#));
    let deserialized_joined: SocialMessage =
        serde_json::from_str(&joined_json).expect("deserialize failed");
    assert_eq!(joined_msg, deserialized_joined);
}

#[test]
fn test_group_msg_send_and_received_roundtrip() {
    let send_msg = SocialMessage::GroupMsgSend {
        group_id: "grp_001".to_string(),
        content: "Attack the dragon at 20:00!".to_string(),
    };
    let send_json = serde_json::to_string(&send_msg).expect("serialize failed");
    assert!(send_json.contains(r#""type":"GROUP_MSG_SEND""#));
    let deserialized_send: SocialMessage =
        serde_json::from_str(&send_json).expect("deserialize failed");
    assert_eq!(send_msg, deserialized_send);

    let chat_dto = ChatMessageDto {
        id: "msg_grp_99".to_string(),
        message_type: "group".to_string(),
        sender_id: "u_tank".to_string(),
        sender_name: "Gorr".to_string(),
        recipient_id: None,
        group_id: Some("grp_001".to_string()),
        content: "Attack the dragon at 20:00!".to_string(),
        created_at: "2026-11-16T12:18:00Z".to_string(),
    };
    let recv_msg = SocialMessage::GroupMsgReceived { message: chat_dto };
    let recv_json = serde_json::to_string(&recv_msg).expect("serialize failed");
    assert!(recv_json.contains(r#""type":"GROUP_MSG_RECEIVED""#));
    let deserialized_recv: SocialMessage =
        serde_json::from_str(&recv_json).expect("deserialize failed");
    assert_eq!(recv_msg, deserialized_recv);
}

#[test]
fn test_group_list_sync_roundtrip() {
    let msg = SocialMessage::GroupListSync {
        groups: vec![
            GroupDto {
                id: "grp_1".to_string(),
                name: "Explorers".to_string(),
                owner_id: "u_1".to_string(),
                members: vec![],
                created_at: "2026-11-16T10:00:00Z".to_string(),
            },
            GroupDto {
                id: "grp_2".to_string(),
                name: "Defenders".to_string(),
                owner_id: "u_2".to_string(),
                members: vec![],
                created_at: "2026-11-16T11:00:00Z".to_string(),
            },
        ],
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"GROUP_LIST_SYNC""#));
    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_fetch_chat_history_and_sync_roundtrip() {
    let fetch_with_limit = SocialMessage::FetchChatHistory {
        target_type: "direct".to_string(),
        target_id: "u_friend".to_string(),
        limit: Some(50),
    };
    let fetch_json = serde_json::to_string(&fetch_with_limit).expect("serialize failed");
    assert!(fetch_json.contains(r#""type":"FETCH_CHAT_HISTORY""#));
    assert!(fetch_json.contains(r#""limit":50"#));
    let deserialized_fetch: SocialMessage =
        serde_json::from_str(&fetch_json).expect("deserialize failed");
    assert_eq!(fetch_with_limit, deserialized_fetch);

    let fetch_no_limit = SocialMessage::FetchChatHistory {
        target_type: "group".to_string(),
        target_id: "grp_001".to_string(),
        limit: None,
    };
    let fetch_no_limit_json =
        serde_json::to_string(&fetch_no_limit).expect("serialize failed");
    let deserialized_no_limit: SocialMessage =
        serde_json::from_str(&fetch_no_limit_json).expect("deserialize failed");
    assert_eq!(fetch_no_limit, deserialized_no_limit);

    let sync_msg = SocialMessage::ChatHistorySync {
        target_type: "direct".to_string(),
        target_id: "u_friend".to_string(),
        messages: vec![
            ChatMessageDto {
                id: "m_1".to_string(),
                message_type: "direct".to_string(),
                sender_id: "u_friend".to_string(),
                sender_name: "Friend".to_string(),
                recipient_id: Some("u_me".to_string()),
                group_id: None,
                content: "Hey".to_string(),
                created_at: "2026-11-16T12:00:00Z".to_string(),
            },
            ChatMessageDto {
                id: "m_2".to_string(),
                message_type: "direct".to_string(),
                sender_id: "u_me".to_string(),
                sender_name: "Me".to_string(),
                recipient_id: Some("u_friend".to_string()),
                group_id: None,
                content: "Yo!".to_string(),
                created_at: "2026-11-16T12:01:00Z".to_string(),
            },
        ],
    };
    let sync_json = serde_json::to_string(&sync_msg).expect("serialize failed");
    assert!(sync_json.contains(r#""type":"CHAT_HISTORY_SYNC""#));
    let deserialized_sync: SocialMessage =
        serde_json::from_str(&sync_json).expect("deserialize failed");
    assert_eq!(sync_msg, deserialized_sync);
}

#[test]
fn test_dto_aliases_and_defaults() {
    // Test FriendDto alias "id" and "user_name"
    let friend_json = r#"{"id":"u_test","user_name":"Tester"}"#;
    let friend: FriendDto = serde_json::from_str(friend_json).expect("parse friend failed");
    assert_eq!(friend.user_id, "u_test");
    assert_eq!(friend.username, "Tester");
    assert!(!friend.is_online);

    // Test FriendRequestDto alias "request_id" and default status
    let req_json = r#"{"request_id":"r_9","from_user_id":"u_a","from_user_name":"A","to_user_id":"u_b"}"#;
    let req: FriendRequestDto = serde_json::from_str(req_json).expect("parse req failed");
    assert_eq!(req.id, "r_9");
    assert_eq!(req.status, "pending");

    // Test GroupDto alias "group_id" and default members/created_at
    let grp_json = r#"{"group_id":"g_88","name":"Rangers","owner_id":"u_ranger"}"#;
    let grp: GroupDto = serde_json::from_str(grp_json).expect("parse group failed");
    assert_eq!(grp.id, "g_88");
    assert!(grp.members.is_empty());
    assert_eq!(grp.created_at, "");

    // Test GroupMemberDto alias "user_name" and defaults
    let member_json = r#"{"user_id":"u_m","user_name":"Archer"}"#;
    let member: GroupMemberDto = serde_json::from_str(member_json).expect("parse member failed");
    assert_eq!(member.username, "Archer");
    assert!(!member.is_owner);
    assert_eq!(member.joined_at, "");
}
