use crate::models::{
    ChatGroupMemberRecord, ChatGroupRecord, ChatMessageRecord, FriendRequestRecord, FriendshipRecord,
};
use crate::router::{DbRouter, QueryIntent, ReadConsistency};
use chrono::Utc;
use std::sync::{Arc, RwLock};
use synapse_common::{Result, SynapseError};

#[async_trait::async_trait]
pub trait ChatRepository: Send + Sync {
    async fn save_friend_request(&self, request: &FriendRequestRecord) -> Result<FriendRequestRecord>;
    async fn update_friend_request_status(
        &self,
        request_id: &str,
        status: &str,
    ) -> Result<Option<FriendRequestRecord>>;
    async fn get_friend_request(&self, request_id: &str) -> Result<Option<FriendRequestRecord>>;
    async fn create_friendship(&self, user_a_id: &str, user_b_id: &str) -> Result<FriendshipRecord>;
    async fn list_friends(&self, user_id: &str) -> Result<Vec<FriendshipRecord>>;
    async fn list_pending_requests(&self, user_id: &str) -> Result<Vec<FriendRequestRecord>>;
    async fn list_outgoing_requests(&self, user_id: &str) -> Result<Vec<FriendRequestRecord>>;

    async fn create_group(&self, id: &str, name: &str, owner_id: &str) -> Result<ChatGroupRecord>;
    async fn get_group(&self, group_id: &str) -> Result<Option<ChatGroupRecord>>;
    async fn add_group_member(
        &self,
        group_id: &str,
        user_id: &str,
        user_name: &str,
        is_owner: bool,
    ) -> Result<ChatGroupMemberRecord>;
    async fn list_group_members(&self, group_id: &str) -> Result<Vec<ChatGroupMemberRecord>>;
    async fn list_user_groups(&self, user_id: &str) -> Result<Vec<ChatGroupRecord>>;

    async fn save_message(&self, message: &ChatMessageRecord) -> Result<ChatMessageRecord>;
    async fn get_direct_history(
        &self,
        user_a_id: &str,
        user_b_id: &str,
        limit: i64,
    ) -> Result<Vec<ChatMessageRecord>>;
    async fn get_group_history(&self, group_id: &str, limit: i64) -> Result<Vec<ChatMessageRecord>>;
}

pub struct PgChatRepository {
    router: Arc<DbRouter>,
}

impl PgChatRepository {
    pub fn new(router: Arc<DbRouter>) -> Self {
        Self { router }
    }
}

#[async_trait::async_trait]
impl ChatRepository for PgChatRepository {
    async fn save_friend_request(&self, request: &FriendRequestRecord) -> Result<FriendRequestRecord> {
        let pool = self.router.resolve_pool(QueryIntent::Write, None).await?;
        let record = sqlx::query_as::<_, FriendRequestRecord>(
            r#"
            INSERT INTO friend_requests (id, from_user_id, from_user_name, to_user_id, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), COALESCE($7, NOW()))
            ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                updated_at = NOW()
            RETURNING id, from_user_id, from_user_name, to_user_id, status, created_at, updated_at
            "#,
        )
        .bind(&request.id)
        .bind(&request.from_user_id)
        .bind(&request.from_user_name)
        .bind(&request.to_user_id)
        .bind(&request.status)
        .bind(request.created_at)
        .bind(request.updated_at)
        .fetch_one(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(record)
    }

    async fn update_friend_request_status(
        &self,
        request_id: &str,
        status: &str,
    ) -> Result<Option<FriendRequestRecord>> {
        let pool = self.router.resolve_pool(QueryIntent::Write, None).await?;
        let record = sqlx::query_as::<_, FriendRequestRecord>(
            r#"
            UPDATE friend_requests
            SET status = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, from_user_id, from_user_name, to_user_id, status, created_at, updated_at
            "#,
        )
        .bind(status)
        .bind(request_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(record)
    }

    async fn get_friend_request(&self, request_id: &str) -> Result<Option<FriendRequestRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let record = sqlx::query_as::<_, FriendRequestRecord>(
            r#"
            SELECT id, from_user_id, from_user_name, to_user_id, status, created_at, updated_at
            FROM friend_requests
            WHERE id = $1
            "#,
        )
        .bind(request_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(record)
    }

    async fn create_friendship(&self, user_a_id: &str, user_b_id: &str) -> Result<FriendshipRecord> {
        let (first, second) = if user_a_id <= user_b_id {
            (user_a_id, user_b_id)
        } else {
            (user_b_id, user_a_id)
        };

        let pool = self.router.resolve_pool(QueryIntent::Write, None).await?;
        let record = sqlx::query_as::<_, FriendshipRecord>(
            r#"
            INSERT INTO friendships (user_a_id, user_b_id, created_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET created_at = friendships.created_at
            RETURNING id, user_a_id, user_b_id, created_at
            "#,
        )
        .bind(first)
        .bind(second)
        .fetch_one(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(record)
    }

    async fn list_friends(&self, user_id: &str) -> Result<Vec<FriendshipRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let friends = sqlx::query_as::<_, FriendshipRecord>(
            r#"
            SELECT id, user_a_id, user_b_id, created_at
            FROM friendships
            WHERE user_a_id = $1 OR user_b_id = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(friends)
    }

    async fn list_pending_requests(&self, user_id: &str) -> Result<Vec<FriendRequestRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let requests = sqlx::query_as::<_, FriendRequestRecord>(
            r#"
            SELECT id, from_user_id, from_user_name, to_user_id, status, created_at, updated_at
            FROM friend_requests
            WHERE to_user_id = $1 AND status = 'pending'
            ORDER BY created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(requests)
    }

    async fn list_outgoing_requests(&self, user_id: &str) -> Result<Vec<FriendRequestRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let requests = sqlx::query_as::<_, FriendRequestRecord>(
            r#"
            SELECT id, from_user_id, from_user_name, to_user_id, status, created_at, updated_at
            FROM friend_requests
            WHERE from_user_id = $1 AND status = 'pending'
            ORDER BY created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(requests)
    }

    async fn create_group(&self, id: &str, name: &str, owner_id: &str) -> Result<ChatGroupRecord> {
        let pool = self.router.resolve_pool(QueryIntent::Write, None).await?;
        let record = sqlx::query_as::<_, ChatGroupRecord>(
            r#"
            INSERT INTO chat_groups (id, name, owner_id, created_at)
            VALUES ($1, $2, $3, NOW())
            RETURNING id, name, owner_id, created_at
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(owner_id)
        .fetch_one(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(record)
    }

    async fn get_group(&self, group_id: &str) -> Result<Option<ChatGroupRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let record = sqlx::query_as::<_, ChatGroupRecord>(
            r#"
            SELECT id, name, owner_id, created_at
            FROM chat_groups
            WHERE id = $1
            "#,
        )
        .bind(group_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(record)
    }

    async fn add_group_member(
        &self,
        group_id: &str,
        user_id: &str,
        user_name: &str,
        is_owner: bool,
    ) -> Result<ChatGroupMemberRecord> {
        let pool = self.router.resolve_pool(QueryIntent::Write, None).await?;
        let record = sqlx::query_as::<_, ChatGroupMemberRecord>(
            r#"
            INSERT INTO chat_group_members (group_id, user_id, user_name, is_owner, joined_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (group_id, user_id) DO UPDATE SET
                user_name = EXCLUDED.user_name,
                is_owner = EXCLUDED.is_owner
            RETURNING group_id, user_id, user_name, is_owner, joined_at
            "#,
        )
        .bind(group_id)
        .bind(user_id)
        .bind(user_name)
        .bind(is_owner)
        .fetch_one(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(record)
    }

    async fn list_group_members(&self, group_id: &str) -> Result<Vec<ChatGroupMemberRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let members = sqlx::query_as::<_, ChatGroupMemberRecord>(
            r#"
            SELECT group_id, user_id, user_name, is_owner, joined_at
            FROM chat_group_members
            WHERE group_id = $1
            ORDER BY joined_at ASC
            "#,
        )
        .bind(group_id)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(members)
    }

    async fn list_user_groups(&self, user_id: &str) -> Result<Vec<ChatGroupRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let groups = sqlx::query_as::<_, ChatGroupRecord>(
            r#"
            SELECT g.id, g.name, g.owner_id, g.created_at
            FROM chat_groups g
            INNER JOIN chat_group_members m ON g.id = m.group_id
            WHERE m.user_id = $1
            ORDER BY g.created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(groups)
    }

    async fn save_message(&self, message: &ChatMessageRecord) -> Result<ChatMessageRecord> {
        let pool = self.router.resolve_pool(QueryIntent::Write, None).await?;
        let record = sqlx::query_as::<_, ChatMessageRecord>(
            r#"
            INSERT INTO chat_messages (id, message_type, sender_id, sender_name, recipient_id, group_id, content, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
            RETURNING id, message_type, sender_id, sender_name, recipient_id, group_id, content, created_at
            "#,
        )
        .bind(&message.id)
        .bind(&message.message_type)
        .bind(&message.sender_id)
        .bind(&message.sender_name)
        .bind(&message.recipient_id)
        .bind(&message.group_id)
        .bind(&message.content)
        .bind(message.created_at)
        .fetch_one(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(record)
    }

    async fn get_direct_history(
        &self,
        user_a_id: &str,
        user_b_id: &str,
        limit: i64,
    ) -> Result<Vec<ChatMessageRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let messages = sqlx::query_as::<_, ChatMessageRecord>(
            r#"
            SELECT id, message_type, sender_id, sender_name, recipient_id, group_id, content, created_at
            FROM (
                SELECT id, message_type, sender_id, sender_name, recipient_id, group_id, content, created_at
                FROM chat_messages
                WHERE message_type = 'direct'
                  AND ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
                ORDER BY created_at DESC
                LIMIT $3
            ) sub
            ORDER BY created_at ASC
            "#,
        )
        .bind(user_a_id)
        .bind(user_b_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(messages)
    }

    async fn get_group_history(&self, group_id: &str, limit: i64) -> Result<Vec<ChatMessageRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let messages = sqlx::query_as::<_, ChatMessageRecord>(
            r#"
            SELECT id, message_type, sender_id, sender_name, recipient_id, group_id, content, created_at
            FROM (
                SELECT id, message_type, sender_id, sender_name, recipient_id, group_id, content, created_at
                FROM chat_messages
                WHERE group_id = $1
                ORDER BY created_at DESC
                LIMIT $2
            ) sub
            ORDER BY created_at ASC
            "#,
        )
        .bind(group_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(messages)
    }
}

#[derive(Default)]
struct InMemoryState {
    friendships: Vec<FriendshipRecord>,
    friend_requests: Vec<FriendRequestRecord>,
    chat_groups: Vec<ChatGroupRecord>,
    chat_group_members: Vec<ChatGroupMemberRecord>,
    chat_messages: Vec<ChatMessageRecord>,
    next_friendship_id: i64,
}

#[derive(Clone, Default)]
pub struct InMemoryChatRepository {
    state: Arc<RwLock<InMemoryState>>,
}

impl InMemoryChatRepository {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(InMemoryState::default())),
        }
    }
}

#[async_trait::async_trait]
impl ChatRepository for InMemoryChatRepository {
    async fn save_friend_request(&self, request: &FriendRequestRecord) -> Result<FriendRequestRecord> {
        let mut state = self.state.write().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let now = Utc::now();
        let mut rec = request.clone();
        if rec.created_at.is_none() {
            rec.created_at = Some(now);
        }
        rec.updated_at = Some(now);

        if let Some(pos) = state.friend_requests.iter().position(|r| r.id == rec.id) {
            state.friend_requests[pos] = rec.clone();
        } else {
            state.friend_requests.push(rec.clone());
        }
        Ok(rec)
    }

    async fn update_friend_request_status(
        &self,
        request_id: &str,
        status: &str,
    ) -> Result<Option<FriendRequestRecord>> {
        let mut state = self.state.write().map_err(|e| SynapseError::Internal(e.to_string()))?;
        if let Some(req) = state.friend_requests.iter_mut().find(|r| r.id == request_id) {
            req.status = status.to_string();
            req.updated_at = Some(Utc::now());
            Ok(Some(req.clone()))
        } else {
            Ok(None)
        }
    }

    async fn get_friend_request(&self, request_id: &str) -> Result<Option<FriendRequestRecord>> {
        let state = self.state.read().map_err(|e| SynapseError::Internal(e.to_string()))?;
        Ok(state.friend_requests.iter().find(|r| r.id == request_id).cloned())
    }

    async fn create_friendship(&self, user_a_id: &str, user_b_id: &str) -> Result<FriendshipRecord> {
        let mut state = self.state.write().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let (first, second) = if user_a_id <= user_b_id {
            (user_a_id.to_string(), user_b_id.to_string())
        } else {
            (user_b_id.to_string(), user_a_id.to_string())
        };

        if let Some(existing) = state.friendships.iter().find(|f| f.user_a_id == first && f.user_b_id == second) {
            return Ok(existing.clone());
        }

        state.next_friendship_id += 1;
        let record = FriendshipRecord {
            id: state.next_friendship_id,
            user_a_id: first,
            user_b_id: second,
            created_at: Some(Utc::now()),
        };
        state.friendships.push(record.clone());
        Ok(record)
    }

    async fn list_friends(&self, user_id: &str) -> Result<Vec<FriendshipRecord>> {
        let state = self.state.read().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let mut friends: Vec<FriendshipRecord> = state
            .friendships
            .iter()
            .filter(|f| f.user_a_id == user_id || f.user_b_id == user_id)
            .cloned()
            .collect();
        friends.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(friends)
    }

    async fn list_pending_requests(&self, user_id: &str) -> Result<Vec<FriendRequestRecord>> {
        let state = self.state.read().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let mut reqs: Vec<FriendRequestRecord> = state
            .friend_requests
            .iter()
            .filter(|r| r.to_user_id == user_id && r.status == "pending")
            .cloned()
            .collect();
        reqs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(reqs)
    }

    async fn list_outgoing_requests(&self, user_id: &str) -> Result<Vec<FriendRequestRecord>> {
        let state = self.state.read().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let mut reqs: Vec<FriendRequestRecord> = state
            .friend_requests
            .iter()
            .filter(|r| r.from_user_id == user_id && r.status == "pending")
            .cloned()
            .collect();
        reqs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(reqs)
    }

    async fn create_group(&self, id: &str, name: &str, owner_id: &str) -> Result<ChatGroupRecord> {
        let mut state = self.state.write().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let record = ChatGroupRecord {
            id: id.to_string(),
            name: name.to_string(),
            owner_id: owner_id.to_string(),
            created_at: Some(Utc::now()),
        };
        state.chat_groups.push(record.clone());
        Ok(record)
    }

    async fn get_group(&self, group_id: &str) -> Result<Option<ChatGroupRecord>> {
        let state = self.state.read().map_err(|e| SynapseError::Internal(e.to_string()))?;
        Ok(state.chat_groups.iter().find(|g| g.id == group_id).cloned())
    }

    async fn add_group_member(
        &self,
        group_id: &str,
        user_id: &str,
        user_name: &str,
        is_owner: bool,
    ) -> Result<ChatGroupMemberRecord> {
        let mut state = self.state.write().map_err(|e| SynapseError::Internal(e.to_string()))?;
        if let Some(pos) = state
            .chat_group_members
            .iter()
            .position(|m| m.group_id == group_id && m.user_id == user_id)
        {
            let mut member = state.chat_group_members[pos].clone();
            member.user_name = user_name.to_string();
            member.is_owner = is_owner;
            state.chat_group_members[pos] = member.clone();
            Ok(member)
        } else {
            let member = ChatGroupMemberRecord {
                group_id: group_id.to_string(),
                user_id: user_id.to_string(),
                user_name: user_name.to_string(),
                is_owner,
                joined_at: Some(Utc::now()),
            };
            state.chat_group_members.push(member.clone());
            Ok(member)
        }
    }

    async fn list_group_members(&self, group_id: &str) -> Result<Vec<ChatGroupMemberRecord>> {
        let state = self.state.read().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let mut members: Vec<ChatGroupMemberRecord> = state
            .chat_group_members
            .iter()
            .filter(|m| m.group_id == group_id)
            .cloned()
            .collect();
        members.sort_by(|a, b| a.joined_at.cmp(&b.joined_at));
        Ok(members)
    }

    async fn list_user_groups(&self, user_id: &str) -> Result<Vec<ChatGroupRecord>> {
        let state = self.state.read().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let group_ids: Vec<String> = state
            .chat_group_members
            .iter()
            .filter(|m| m.user_id == user_id)
            .map(|m| m.group_id.clone())
            .collect();

        let mut groups: Vec<ChatGroupRecord> = state
            .chat_groups
            .iter()
            .filter(|g| group_ids.contains(&g.id))
            .cloned()
            .collect();
        groups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(groups)
    }

    async fn save_message(&self, message: &ChatMessageRecord) -> Result<ChatMessageRecord> {
        let mut state = self.state.write().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let mut rec = message.clone();
        if rec.created_at.is_none() {
            rec.created_at = Some(Utc::now());
        }
        state.chat_messages.push(rec.clone());
        Ok(rec)
    }

    async fn get_direct_history(
        &self,
        user_a_id: &str,
        user_b_id: &str,
        limit: i64,
    ) -> Result<Vec<ChatMessageRecord>> {
        let state = self.state.read().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let mut matched: Vec<ChatMessageRecord> = state
            .chat_messages
            .iter()
            .filter(|m| {
                m.message_type == "direct"
                    && ((m.sender_id == user_a_id && m.recipient_id.as_deref() == Some(user_b_id))
                        || (m.sender_id == user_b_id && m.recipient_id.as_deref() == Some(user_a_id)))
            })
            .cloned()
            .collect();
        // Sort ascending by created_at
        matched.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        if limit > 0 && matched.len() > limit as usize {
            let start = matched.len() - (limit as usize);
            matched = matched[start..].to_vec();
        }
        Ok(matched)
    }

    async fn get_group_history(&self, group_id: &str, limit: i64) -> Result<Vec<ChatMessageRecord>> {
        let state = self.state.read().map_err(|e| SynapseError::Internal(e.to_string()))?;
        let mut matched: Vec<ChatMessageRecord> = state
            .chat_messages
            .iter()
            .filter(|m| m.group_id.as_deref() == Some(group_id))
            .cloned()
            .collect();
        matched.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        if limit > 0 && matched.len() > limit as usize {
            let start = matched.len() - (limit as usize);
            matched = matched[start..].to_vec();
        }
        Ok(matched)
    }
}
