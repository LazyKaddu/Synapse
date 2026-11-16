use chrono::Utc;
use synapse_storage::models::{
    ChatGroupMemberRecord, ChatGroupRecord, ChatMessageRecord, FriendRequestRecord, FriendshipRecord,
};
use synapse_storage::repositories::{ChatRepository, InMemoryChatRepository};

#[tokio::test]
async fn test_friend_request_flow() {
    let repo = InMemoryChatRepository::new();

    let req = FriendRequestRecord {
        id: "req-101".to_string(),
        from_user_id: "user-alice".to_string(),
        from_user_name: "Alice".to_string(),
        to_user_id: "user-bob".to_string(),
        status: "pending".to_string(),
        created_at: None,
        updated_at: None,
    };

    let saved = repo.save_friend_request(&req).await.unwrap();
    assert_eq!(saved.id, "req-101");
    assert_eq!(saved.status, "pending");
    assert!(saved.created_at.is_some());

    // Check Bob's pending incoming requests
    let bob_pending = repo.list_pending_requests("user-bob").await.unwrap();
    assert_eq!(bob_pending.len(), 1);
    assert_eq!(bob_pending[0].from_user_id, "user-alice");

    // Check Alice's pending outgoing requests
    let alice_outgoing = repo.list_outgoing_requests("user-alice").await.unwrap();
    assert_eq!(alice_outgoing.len(), 1);
    assert_eq!(alice_outgoing[0].to_user_id, "user-bob");

    // Alice has no pending incoming
    let alice_incoming = repo.list_pending_requests("user-alice").await.unwrap();
    assert_eq!(alice_incoming.len(), 0);

    // Update status to accepted
    let updated = repo
        .update_friend_request_status("req-101", "accepted")
        .await
        .unwrap();
    assert!(updated.is_some());
    assert_eq!(updated.unwrap().status, "accepted");

    // Bob no longer has pending requests
    let bob_pending_after = repo.list_pending_requests("user-bob").await.unwrap();
    assert_eq!(bob_pending_after.len(), 0);
}

#[tokio::test]
async fn test_friendship_creation_and_listing() {
    let repo = InMemoryChatRepository::new();

    let friendship = repo
        .create_friendship("user-alice", "user-bob")
        .await
        .unwrap();
    assert_eq!(friendship.user_a_id, "user-alice");
    assert_eq!(friendship.user_b_id, "user-bob");

    // Reverse order should return the existing friendship
    let friendship2 = repo
        .create_friendship("user-bob", "user-alice")
        .await
        .unwrap();
    assert_eq!(friendship2.id, friendship.id);

    // List friends for Alice and Bob
    let alice_friends = repo.list_friends("user-alice").await.unwrap();
    assert_eq!(alice_friends.len(), 1);

    let bob_friends = repo.list_friends("user-bob").await.unwrap();
    assert_eq!(bob_friends.len(), 1);

    let charlie_friends = repo.list_friends("user-charlie").await.unwrap();
    assert_eq!(charlie_friends.len(), 0);
}

#[tokio::test]
async fn test_group_chat_management() {
    let repo = InMemoryChatRepository::new();

    let group = repo
        .create_group("grp-1", "Adventure Guild", "user-alice")
        .await
        .unwrap();
    assert_eq!(group.id, "grp-1");
    assert_eq!(group.name, "Adventure Guild");

    // Add members
    let m1 = repo
        .add_group_member("grp-1", "user-alice", "Alice", true)
        .await
        .unwrap();
    assert!(m1.is_owner);

    let m2 = repo
        .add_group_member("grp-1", "user-bob", "Bob", false)
        .await
        .unwrap();
    assert!(!m2.is_owner);

    let members = repo.list_group_members("grp-1").await.unwrap();
    assert_eq!(members.len(), 2);

    let alice_groups = repo.list_user_groups("user-alice").await.unwrap();
    assert_eq!(alice_groups.len(), 1);
    assert_eq!(alice_groups[0].name, "Adventure Guild");

    let bob_groups = repo.list_user_groups("user-bob").await.unwrap();
    assert_eq!(bob_groups.len(), 1);

    let charlie_groups = repo.list_user_groups("user-charlie").await.unwrap();
    assert_eq!(charlie_groups.len(), 0);
}

#[tokio::test]
async fn test_chat_message_history() {
    let repo = InMemoryChatRepository::new();

    // 1. Direct Messages
    let msg1 = ChatMessageRecord {
        id: "msg-1".to_string(),
        message_type: "direct".to_string(),
        sender_id: "user-alice".to_string(),
        sender_name: "Alice".to_string(),
        recipient_id: Some("user-bob".to_string()),
        group_id: None,
        content: "Hello Bob!".to_string(),
        created_at: Some(Utc::now()),
    };
    repo.save_message(&msg1).await.unwrap();

    let msg2 = ChatMessageRecord {
        id: "msg-2".to_string(),
        message_type: "direct".to_string(),
        sender_id: "user-bob".to_string(),
        sender_name: "Bob".to_string(),
        recipient_id: Some("user-alice".to_string()),
        group_id: None,
        content: "Hey Alice, ready for the raid?".to_string(),
        created_at: Some(Utc::now()),
    };
    repo.save_message(&msg2).await.unwrap();

    let direct_history = repo
        .get_direct_history("user-alice", "user-bob", 10)
        .await
        .unwrap();
    assert_eq!(direct_history.len(), 2);
    assert_eq!(direct_history[0].content, "Hello Bob!");
    assert_eq!(direct_history[1].content, "Hey Alice, ready for the raid?");

    // 2. Group Messages
    let gmsg = ChatMessageRecord {
        id: "msg-g1".to_string(),
        message_type: "group".to_string(),
        sender_id: "user-alice".to_string(),
        sender_name: "Alice".to_string(),
        recipient_id: None,
        group_id: Some("grp-1".to_string()),
        content: "Guild quest starts in 5 minutes!".to_string(),
        created_at: Some(Utc::now()),
    };
    repo.save_message(&gmsg).await.unwrap();

    let group_history = repo.get_group_history("grp-1", 10).await.unwrap();
    assert_eq!(group_history.len(), 1);
    assert_eq!(group_history[0].content, "Guild quest starts in 5 minutes!");
}

#[test]
fn test_models_json_serde() {
    let friendship = FriendshipRecord {
        id: 1,
        user_a_id: "u1".to_string(),
        user_b_id: "u2".to_string(),
        created_at: Some(Utc::now()),
    };
    let json = serde_json::to_string(&friendship).unwrap();
    let deserialized: FriendshipRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(friendship, deserialized);

    let group = ChatGroupRecord {
        id: "g1".to_string(),
        name: "Test Group".to_string(),
        owner_id: "u1".to_string(),
        created_at: Some(Utc::now()),
    };
    let json = serde_json::to_string(&group).unwrap();
    let deserialized: ChatGroupRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(group, deserialized);

    let member = ChatGroupMemberRecord {
        group_id: "g1".to_string(),
        user_id: "u1".to_string(),
        user_name: "Alice".to_string(),
        is_owner: true,
        joined_at: Some(Utc::now()),
    };
    let json = serde_json::to_string(&member).unwrap();
    let deserialized: ChatGroupMemberRecord = serde_json::from_str(&json).unwrap();
    assert_eq!(member, deserialized);
}
