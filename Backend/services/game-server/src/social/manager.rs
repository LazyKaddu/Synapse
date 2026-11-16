use crate::engine::OutgoingMessage;
use chrono::Utc;
use dashmap::DashMap;
use std::sync::Arc;
use synapse_common::Result;
use synapse_protocol::{
    ChatMessageDto, FriendDto, FriendRequestDto, GroupDto, GroupMemberDto, SocialMessage,
};
use synapse_storage::{
    models::{ChatGroupMemberRecord, ChatMessageRecord, FriendRequestRecord},
    ChatRepository,
};
use tokio::sync::mpsc;
use uuid::Uuid;

#[derive(Clone)]
pub struct OnlinePlayer {
    pub user_id: String,
    pub character_id: i64,
    pub display_name: String,
    pub sender: mpsc::UnboundedSender<OutgoingMessage>,
}

impl OnlinePlayer {
    pub fn send_social_message(&self, msg: &SocialMessage) -> bool {
        if let Ok(json) = serde_json::to_string(msg) {
            self.sender.send(OutgoingMessage::Text(json)).is_ok()
        } else {
            false
        }
    }
}

pub struct SocialManager {
    chat_repo: Arc<dyn ChatRepository>,
    online_players: Arc<DashMap<String, OnlinePlayer>>,
    known_usernames: Arc<DashMap<String, String>>,
}

impl SocialManager {
    pub fn new(chat_repo: Arc<dyn ChatRepository>) -> Self {
        Self {
            chat_repo,
            online_players: Arc::new(DashMap::new()),
            known_usernames: Arc::new(DashMap::new()),
        }
    }

    pub fn is_online(&self, query: &str) -> bool {
        self.find_online_player(query).is_some()
    }

    pub fn find_online_player(&self, query: &str) -> Option<OnlinePlayer> {
        if let Some(player) = self.online_players.get(query) {
            return Some(player.clone());
        }
        if let Some(stripped) = query.strip_prefix("p-") {
            if let Some(player) = self.online_players.get(stripped) {
                return Some(player.clone());
            }
        }
        for item in self.online_players.iter() {
            if item.user_id.eq_ignore_ascii_case(query)
                || item.display_name.eq_ignore_ascii_case(query)
            {
                return Some(item.clone());
            }
        }
        None
    }

    pub fn send_to_user(&self, query: &str, msg: &SocialMessage) -> bool {
        if let Some(player) = self.find_online_player(query) {
            player.send_social_message(msg)
        } else {
            false
        }
    }

    pub async fn on_player_connected(
        &self,
        user_id: &str,
        character_id: i64,
        display_name: &str,
        sender: mpsc::UnboundedSender<OutgoingMessage>,
    ) {
        self.known_usernames
            .insert(user_id.to_string(), display_name.to_string());
        self.online_players.insert(
            user_id.to_string(),
            OnlinePlayer {
                user_id: user_id.to_string(),
                character_id,
                display_name: display_name.to_string(),
                sender,
            },
        );

        let _ = self.sync_friend_list(user_id).await;
        let _ = self.sync_group_list(user_id).await;

        if let Ok(friendships) = self.chat_repo.list_friends(user_id).await {
            let status_msg = SocialMessage::FriendStatusUpdate {
                user_id: user_id.to_string(),
                is_online: true,
            };
            for f in friendships {
                let friend_id = if f.user_a_id == user_id {
                    &f.user_b_id
                } else {
                    &f.user_a_id
                };
                self.send_to_user(friend_id, &status_msg);
            }
        }
    }

    pub async fn on_player_disconnected(&self, user_id: &str) {
        self.online_players.remove(user_id);

        if let Ok(friendships) = self.chat_repo.list_friends(user_id).await {
            let status_msg = SocialMessage::FriendStatusUpdate {
                user_id: user_id.to_string(),
                is_online: false,
            };
            for f in friendships {
                let friend_id = if f.user_a_id == user_id {
                    &f.user_b_id
                } else {
                    &f.user_a_id
                };
                self.send_to_user(friend_id, &status_msg);
            }
        }
    }

    pub async fn sync_friend_list(&self, user_id: &str) -> Result<()> {
        let friendships = self.chat_repo.list_friends(user_id).await?;
        let mut friends = Vec::with_capacity(friendships.len());

        for f in friendships {
            let friend_id = if f.user_a_id == user_id {
                f.user_b_id
            } else {
                f.user_a_id
            };
            let is_online = self.is_online(&friend_id);
            let username = if let Some(p) = self.find_online_player(&friend_id) {
                p.display_name
            } else if let Some(n) = self.known_usernames.get(&friend_id) {
                n.value().clone()
            } else {
                friend_id.clone()
            };

            friends.push(FriendDto {
                user_id: friend_id,
                username,
                is_online,
            });
        }

        let pending_incoming = self
            .chat_repo
            .list_pending_requests(user_id)
            .await?
            .into_iter()
            .map(record_to_friend_request_dto)
            .collect();

        let pending_outgoing = self
            .chat_repo
            .list_outgoing_requests(user_id)
            .await?
            .into_iter()
            .map(record_to_friend_request_dto)
            .collect();

        let sync_msg = SocialMessage::FriendListSync {
            friends,
            pending_incoming,
            pending_outgoing,
        };

        self.send_to_user(user_id, &sync_msg);
        Ok(())
    }

    pub async fn sync_group_list(&self, user_id: &str) -> Result<()> {
        let groups_rec = self.chat_repo.list_user_groups(user_id).await?;
        let mut groups = Vec::with_capacity(groups_rec.len());

        for g in groups_rec {
            let members = self
                .chat_repo
                .list_group_members(&g.id)
                .await?
                .into_iter()
                .map(record_to_group_member_dto)
                .collect();

            groups.push(GroupDto {
                id: g.id,
                name: g.name,
                owner_id: g.owner_id,
                members,
                created_at: g.created_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
            });
        }

        let sync_msg = SocialMessage::GroupListSync { groups };
        self.send_to_user(user_id, &sync_msg);
        Ok(())
    }

    pub async fn handle_friend_request_send(
        &self,
        sender_id: &str,
        sender_name: &str,
        target_user_id: &str,
    ) -> Result<()> {
        let resolved_target_id = self
            .find_online_player(target_user_id)
            .map(|p| p.user_id)
            .unwrap_or_else(|| target_user_id.to_string());

        if sender_id == resolved_target_id {
            return Ok(());
        }

        let request_id = format!("req_{}", Uuid::new_v4().simple());
        let now = Utc::now();
        let record = FriendRequestRecord {
            id: request_id,
            from_user_id: sender_id.to_string(),
            from_user_name: sender_name.to_string(),
            to_user_id: resolved_target_id.clone(),
            status: "pending".to_string(),
            created_at: Some(now),
            updated_at: Some(now),
        };

        let saved = self.chat_repo.save_friend_request(&record).await?;
        let dto = record_to_friend_request_dto(saved);

        self.send_to_user(
            &resolved_target_id,
            &SocialMessage::FriendRequestReceived { request: dto },
        );

        let _ = self.sync_friend_list(sender_id).await;
        let _ = self.sync_friend_list(&resolved_target_id).await;
        Ok(())
    }

    pub async fn handle_friend_request_accept(
        &self,
        _user_id: &str,
        request_id: &str,
    ) -> Result<()> {
        if let Some(req) = self
            .chat_repo
            .update_friend_request_status(request_id, "accepted")
            .await?
        {
            self.chat_repo
                .create_friendship(&req.from_user_id, &req.to_user_id)
                .await?;

            let _ = self.sync_friend_list(&req.from_user_id).await;
            let _ = self.sync_friend_list(&req.to_user_id).await;

            let from_online = self.is_online(&req.from_user_id);
            let to_online = self.is_online(&req.to_user_id);

            self.send_to_user(
                &req.to_user_id,
                &SocialMessage::FriendStatusUpdate {
                    user_id: req.from_user_id.clone(),
                    is_online: from_online,
                },
            );
            self.send_to_user(
                &req.from_user_id,
                &SocialMessage::FriendStatusUpdate {
                    user_id: req.to_user_id.clone(),
                    is_online: to_online,
                },
            );
        }
        Ok(())
    }

    pub async fn handle_friend_request_decline(
        &self,
        _user_id: &str,
        request_id: &str,
    ) -> Result<()> {
        if let Some(req) = self
            .chat_repo
            .update_friend_request_status(request_id, "declined")
            .await?
        {
            let _ = self.sync_friend_list(&req.from_user_id).await;
            let _ = self.sync_friend_list(&req.to_user_id).await;
        }
        Ok(())
    }

    pub async fn handle_direct_message_send(
        &self,
        sender_id: &str,
        sender_name: &str,
        recipient_id: &str,
        content: &str,
    ) -> Result<()> {
        let resolved_recipient_id = self
            .find_online_player(recipient_id)
            .map(|p| p.user_id)
            .unwrap_or_else(|| recipient_id.to_string());

        let msg_id = format!("msg_{}", Uuid::new_v4().simple());
        let record = ChatMessageRecord {
            id: msg_id,
            message_type: "direct".to_string(),
            sender_id: sender_id.to_string(),
            sender_name: sender_name.to_string(),
            recipient_id: Some(resolved_recipient_id.clone()),
            group_id: None,
            content: content.to_string(),
            created_at: Some(Utc::now()),
        };

        let saved = self.chat_repo.save_message(&record).await?;
        let dto = record_to_chat_dto(saved);

        self.send_to_user(
            &resolved_recipient_id,
            &SocialMessage::DirectMsgReceived {
                message: dto.clone(),
            },
        );

        self.send_to_user(sender_id, &SocialMessage::DirectMsgReceived { message: dto });

        Ok(())
    }

    pub async fn handle_group_create(
        &self,
        creator_id: &str,
        creator_name: &str,
        name: &str,
        initial_members: &[String],
    ) -> Result<()> {
        let group_id = format!("grp_{}", Uuid::new_v4().simple());
        let group = self
            .chat_repo
            .create_group(&group_id, name, creator_id)
            .await?;
        self.chat_repo
            .add_group_member(&group_id, creator_id, creator_name, true)
            .await?;

        for member_query in initial_members {
            if member_query != creator_id {
                let (target_id, target_name) = if let Some(p) = self.find_online_player(member_query) {
                    (p.user_id, p.display_name)
                } else if let Some(n) = self.known_usernames.get(member_query) {
                    (member_query.to_string(), n.value().clone())
                } else {
                    (member_query.to_string(), member_query.to_string())
                };

                let _ = self
                    .chat_repo
                    .add_group_member(&group_id, &target_id, &target_name, false)
                    .await;
            }
        }

        let members = self
            .chat_repo
            .list_group_members(&group_id)
            .await?
            .into_iter()
            .map(record_to_group_member_dto)
            .collect::<Vec<_>>();

        let group_dto = GroupDto {
            id: group.id.clone(),
            name: group.name.clone(),
            owner_id: group.owner_id.clone(),
            members: members.clone(),
            created_at: group.created_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
        };

        self.send_to_user(
            creator_id,
            &SocialMessage::GroupCreated {
                group: group_dto.clone(),
            },
        );

        for m in &members {
            let _ = self.sync_group_list(&m.user_id).await;
        }

        Ok(())
    }

    pub async fn handle_group_invite(
        &self,
        _inviter_id: &str,
        group_id: &str,
        target_user_id: &str,
    ) -> Result<()> {
        let (target_id, target_name) = if let Some(p) = self.find_online_player(target_user_id) {
            (p.user_id, p.display_name)
        } else if let Some(n) = self.known_usernames.get(target_user_id) {
            (target_user_id.to_string(), n.value().clone())
        } else {
            (target_user_id.to_string(), target_user_id.to_string())
        };

        let member_record = self
            .chat_repo
            .add_group_member(group_id, &target_id, &target_name, false)
            .await?;

        let member_dto = record_to_group_member_dto(member_record);

        let joined_msg = SocialMessage::GroupMemberJoined {
            group_id: group_id.to_string(),
            member: member_dto,
        };

        let members = self.chat_repo.list_group_members(group_id).await?;
        for m in &members {
            self.send_to_user(&m.user_id, &joined_msg);
            let _ = self.sync_group_list(&m.user_id).await;
        }

        Ok(())
    }

    pub async fn handle_group_msg_send(
        &self,
        sender_id: &str,
        sender_name: &str,
        group_id: &str,
        content: &str,
    ) -> Result<()> {
        let msg_id = format!("msg_{}", Uuid::new_v4().simple());
        let record = ChatMessageRecord {
            id: msg_id,
            message_type: "group".to_string(),
            sender_id: sender_id.to_string(),
            sender_name: sender_name.to_string(),
            recipient_id: None,
            group_id: Some(group_id.to_string()),
            content: content.to_string(),
            created_at: Some(Utc::now()),
        };

        let saved = self.chat_repo.save_message(&record).await?;
        let dto = record_to_chat_dto(saved);

        let group_msg = SocialMessage::GroupMsgReceived { message: dto };

        let members = self.chat_repo.list_group_members(group_id).await?;
        for m in members {
            self.send_to_user(&m.user_id, &group_msg);
        }

        Ok(())
    }

    pub async fn handle_fetch_chat_history(
        &self,
        requester_id: &str,
        target_type: &str,
        target_id: &str,
        limit: Option<u32>,
    ) -> Result<()> {
        let limit_val = limit.unwrap_or(50) as i64;
        let messages = if target_type == "direct" {
            let resolved_target_id = self
                .find_online_player(target_id)
                .map(|p| p.user_id)
                .unwrap_or_else(|| target_id.to_string());
            self.chat_repo
                .get_direct_history(requester_id, &resolved_target_id, limit_val)
                .await?
                .into_iter()
                .map(record_to_chat_dto)
                .collect()
        } else if target_type == "group" {
            self.chat_repo
                .get_group_history(target_id, limit_val)
                .await?
                .into_iter()
                .map(record_to_chat_dto)
                .collect()
        } else {
            vec![]
        };

        let sync_msg = SocialMessage::ChatHistorySync {
            target_type: target_type.to_string(),
            target_id: target_id.to_string(),
            messages,
        };
        self.send_to_user(requester_id, &sync_msg);
        Ok(())
    }

    pub async fn handle_social_message(
        &self,
        sender_user_id: &str,
        sender_name: &str,
        msg: SocialMessage,
    ) -> Result<()> {
        match msg {
            SocialMessage::FriendRequestSend { target_user_id } => {
                self.handle_friend_request_send(sender_user_id, sender_name, &target_user_id)
                    .await?;
            }
            SocialMessage::FriendRequestAccept { request_id } => {
                self.handle_friend_request_accept(sender_user_id, &request_id)
                    .await?;
            }
            SocialMessage::FriendRequestDecline { request_id } => {
                self.handle_friend_request_decline(sender_user_id, &request_id)
                    .await?;
            }
            SocialMessage::DirectMsgSend {
                recipient_id,
                content,
            } => {
                self.handle_direct_message_send(sender_user_id, sender_name, &recipient_id, &content)
                    .await?;
            }
            SocialMessage::GroupCreate {
                name,
                initial_members,
            } => {
                self.handle_group_create(sender_user_id, sender_name, &name, &initial_members)
                    .await?;
            }
            SocialMessage::GroupInvite {
                group_id,
                target_user_id,
            } => {
                self.handle_group_invite(sender_user_id, &group_id, &target_user_id)
                    .await?;
            }
            SocialMessage::GroupMsgSend { group_id, content } => {
                self.handle_group_msg_send(sender_user_id, sender_name, &group_id, &content)
                    .await?;
            }
            SocialMessage::FetchChatHistory {
                target_type,
                target_id,
                limit,
            } => {
                self.handle_fetch_chat_history(sender_user_id, &target_type, &target_id, limit)
                    .await?;
            }
            _ => {}
        }
        Ok(())
    }
}

fn record_to_chat_dto(record: ChatMessageRecord) -> ChatMessageDto {
    ChatMessageDto {
        id: record.id,
        message_type: record.message_type,
        sender_id: record.sender_id,
        sender_name: record.sender_name,
        recipient_id: record.recipient_id,
        group_id: record.group_id,
        content: record.content,
        created_at: record.created_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
    }
}

fn record_to_friend_request_dto(record: FriendRequestRecord) -> FriendRequestDto {
    FriendRequestDto {
        id: record.id,
        from_user_id: record.from_user_id,
        from_user_name: record.from_user_name,
        to_user_id: record.to_user_id,
        status: record.status,
        created_at: record.created_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
    }
}

fn record_to_group_member_dto(record: ChatGroupMemberRecord) -> GroupMemberDto {
    GroupMemberDto {
        user_id: record.user_id,
        username: record.user_name,
        is_owner: record.is_owner,
        joined_at: record.joined_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
    }
}
