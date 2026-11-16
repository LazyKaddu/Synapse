use game_server::engine::OutgoingMessage;
use game_server::social::SocialManager;
use std::sync::Arc;
use synapse_protocol::SocialMessage;
use synapse_storage::{ChatRepository, InMemoryChatRepository};
use tokio::sync::mpsc;

#[tokio::test]
async fn test_social_manager_lifecycle_and_friends() {
    let chat_repo = Arc::new(InMemoryChatRepository::new());
    let social = Arc::new(SocialManager::new(chat_repo.clone()));

    let (alice_tx, mut alice_rx) = mpsc::unbounded_channel::<OutgoingMessage>();
    let (bob_tx, mut bob_rx) = mpsc::unbounded_channel::<OutgoingMessage>();

    // 1. Connect Alice
    social
        .on_player_connected("alice_id", 101, "Alice", alice_tx)
        .await;
    assert!(social.is_online("alice_id"));
    assert!(social.is_online("Alice"));

    // Alice should receive initial FriendListSync and GroupListSync
    let msg1 = alice_rx.recv().await.unwrap();
    let msg2 = alice_rx.recv().await.unwrap();
    match msg1 {
        OutgoingMessage::Text(t) => assert!(t.contains("FRIEND_LIST_SYNC")),
        _ => panic!("Expected Text message"),
    }
    match msg2 {
        OutgoingMessage::Text(t) => assert!(t.contains("GROUP_LIST_SYNC")),
        _ => panic!("Expected Text message"),
    }

    // 2. Connect Bob
    social
        .on_player_connected("bob_id", 202, "Bob", bob_tx)
        .await;
    assert!(social.is_online("bob_id"));
    assert!(social.is_online("Bob"));

    // Drain Bob's initial sync messages
    let _ = bob_rx.recv().await.unwrap();
    let _ = bob_rx.recv().await.unwrap();

    // 3. Alice sends friend request to Bob
    social
        .handle_social_message(
            "alice_id",
            "Alice",
            SocialMessage::FriendRequestSend {
                target_user_id: "bob_id".to_string(),
            },
        )
        .await
        .unwrap();

    // Bob receives FRIEND_REQUEST_RECEIVED
    let bob_msg = bob_rx.recv().await.unwrap();
    let req_id: String;
    match bob_msg {
        OutgoingMessage::Text(t) => {
            assert!(t.contains("FRIEND_REQUEST_RECEIVED"));
            assert!(t.contains("Alice"));
            let parsed: SocialMessage = serde_json::from_str(&t).unwrap();
            match parsed {
                SocialMessage::FriendRequestReceived { request } => {
                    req_id = request.id;
                }
                _ => panic!("Unexpected message variant"),
            }
        }
        _ => panic!("Expected Text message"),
    }

    // Alice received updated FRIEND_LIST_SYNC
    let alice_sync = alice_rx.recv().await.unwrap();
    match alice_sync {
        OutgoingMessage::Text(t) => {
            assert!(t.contains("FRIEND_LIST_SYNC"));
            assert!(t.contains("pending_outgoing"));
        }
        _ => panic!("Expected Text message"),
    }

    // 4. Bob accepts friend request
    social
        .handle_social_message(
            "bob_id",
            "Bob",
            SocialMessage::FriendRequestAccept {
                request_id: req_id.clone(),
            },
        )
        .await
        .unwrap();

    // Bob and Alice both receive updated FRIEND_LIST_SYNC and FRIEND_STATUS_UPDATE
    // Verify Bob is now confirmed friend of Alice in repository
    let alice_friends = chat_repo.list_friends("alice_id").await.unwrap();
    assert_eq!(alice_friends.len(), 1);

    // 5. Direct message from Alice to Bob
    social
        .handle_social_message(
            "alice_id",
            "Alice",
            SocialMessage::DirectMsgSend {
                recipient_id: "bob_id".to_string(),
                content: "Meet me at the plaza!".to_string(),
            },
        )
        .await
        .unwrap();

    // Bob receives DIRECT_MSG_RECEIVED
    // Notice Bob might have pending status update or sync in queue; drain until DIRECT_MSG_RECEIVED
    let mut found_direct = false;
    while let Ok(msg) = bob_rx.try_recv() {
        if let OutgoingMessage::Text(t) = msg {
            if t.contains("DIRECT_MSG_RECEIVED") && t.contains("Meet me at the plaza!") {
                found_direct = true;
                break;
            }
        }
    }
    assert!(found_direct, "Bob should receive direct message");

    // 6. Direct history query
    social
        .handle_social_message(
            "alice_id",
            "Alice",
            SocialMessage::FetchChatHistory {
                target_type: "direct".to_string(),
                target_id: "bob_id".to_string(),
                limit: Some(10),
            },
        )
        .await
        .unwrap();

    let mut found_history = false;
    while let Ok(msg) = alice_rx.try_recv() {
        if let OutgoingMessage::Text(t) = msg {
            if t.contains("CHAT_HISTORY_SYNC") && t.contains("Meet me at the plaza!") {
                found_history = true;
                break;
            }
        }
    }
    assert!(found_history, "Alice should receive chat history");
}

#[tokio::test]
async fn test_social_manager_groups() {
    let chat_repo = Arc::new(InMemoryChatRepository::new());
    let social = Arc::new(SocialManager::new(chat_repo.clone()));

    let (alice_tx, mut alice_rx) = mpsc::unbounded_channel::<OutgoingMessage>();
    let (bob_tx, mut bob_rx) = mpsc::unbounded_channel::<OutgoingMessage>();

    social
        .on_player_connected("alice_id", 101, "Alice", alice_tx)
        .await;
    social
        .on_player_connected("bob_id", 202, "Bob", bob_tx)
        .await;

    // Drain initial connects
    while alice_rx.try_recv().is_ok() {}
    while bob_rx.try_recv().is_ok() {}

    // 1. Alice creates group "Guild Guardians" with Bob as initial member
    social
        .handle_social_message(
            "alice_id",
            "Alice",
            SocialMessage::GroupCreate {
                name: "Guild Guardians".to_string(),
                initial_members: vec!["bob_id".to_string()],
            },
        )
        .await
        .unwrap();

    // Alice should receive GROUP_CREATED
    let mut found_group_created = false;
    let mut group_id = String::new();
    while let Ok(msg) = alice_rx.try_recv() {
        if let OutgoingMessage::Text(t) = msg {
            if t.contains("GROUP_CREATED") {
                found_group_created = true;
                let parsed: SocialMessage = serde_json::from_str(&t).unwrap();
                if let SocialMessage::GroupCreated { group } = parsed {
                    group_id = group.id;
                }
            }
        }
    }
    assert!(found_group_created);
    assert!(!group_id.is_empty());

    // 2. Alice sends a group message
    social
        .handle_social_message(
            "alice_id",
            "Alice",
            SocialMessage::GroupMsgSend {
                group_id: group_id.clone(),
                content: "Dungeon raid starting now!".to_string(),
            },
        )
        .await
        .unwrap();

    // Bob receives GROUP_MSG_RECEIVED
    let mut found_group_msg = false;
    while let Ok(msg) = bob_rx.try_recv() {
        if let OutgoingMessage::Text(t) = msg {
            if t.contains("GROUP_MSG_RECEIVED") && t.contains("Dungeon raid starting now!") {
                found_group_msg = true;
                break;
            }
        }
    }
    assert!(found_group_msg, "Bob should receive group message");

    // 3. Fetch Group Chat History
    social
        .handle_social_message(
            "bob_id",
            "Bob",
            SocialMessage::FetchChatHistory {
                target_type: "group".to_string(),
                target_id: group_id.clone(),
                limit: Some(20),
            },
        )
        .await
        .unwrap();

    let mut found_group_history = false;
    while let Ok(msg) = bob_rx.try_recv() {
        if let OutgoingMessage::Text(t) = msg {
            if t.contains("CHAT_HISTORY_SYNC") && t.contains("Dungeon raid starting now!") {
                found_group_history = true;
                break;
            }
        }
    }
    assert!(found_group_history, "Bob should receive group chat history");
}
