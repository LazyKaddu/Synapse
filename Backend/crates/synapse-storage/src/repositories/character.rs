use crate::models::Character;
use crate::router::{DbRouter, QueryIntent, ReadConsistency};
use chrono::Utc;
use std::sync::Arc;
use synapse_common::{Result, SynapseError};

#[async_trait::async_trait]
pub trait CharacterRepository: Send + Sync {
    async fn find_by_id(&self, id: i64, shard_id: i32) -> Result<Option<Character>>;
    async fn find_by_account(&self, account_id: i64, shard_id: i32) -> Result<Vec<Character>>;
    async fn create(&self, account_id: i64, display_name: &str, shard_id: i32)
        -> Result<Character>;
    async fn save_position(
        &self,
        character_id: i64,
        shard_id: i32,
        chunk_x: i32,
        chunk_y: i32,
        pos_x: f32,
        pos_y: f32,
    ) -> Result<()>;
}

pub struct PgCharacterRepository {
    router: Arc<DbRouter>,
}

impl PgCharacterRepository {
    pub fn new(router: Arc<DbRouter>) -> Self {
        Self { router }
    }
}

#[async_trait::async_trait]
impl CharacterRepository for PgCharacterRepository {
    async fn find_by_id(&self, id: i64, shard_id: i32) -> Result<Option<Character>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let character = sqlx::query_as::<_, Character>(
            "SELECT id, account_id, shard_id, display_name, chunk_x, chunk_y, pos_x, pos_y, last_saved_at FROM characters WHERE id = $1 AND shard_id = $2"
        )
        .bind(id)
        .bind(shard_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(character)
    }

    async fn find_by_account(&self, account_id: i64, shard_id: i32) -> Result<Vec<Character>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), Some(account_id))
            .await?;
        let characters = sqlx::query_as::<_, Character>(
            "SELECT id, account_id, shard_id, display_name, chunk_x, chunk_y, pos_x, pos_y, last_saved_at FROM characters WHERE account_id = $1 AND shard_id = $2"
        )
        .bind(account_id)
        .bind(shard_id)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(characters)
    }

    async fn create(
        &self,
        account_id: i64,
        display_name: &str,
        shard_id: i32,
    ) -> Result<Character> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Write, Some(account_id))
            .await?;
        let character = sqlx::query_as::<_, Character>(
            r#"
            INSERT INTO characters (account_id, shard_id, display_name, chunk_x, chunk_y, pos_x, pos_y, last_saved_at)
            VALUES ($1, $2, $3, 0, 0, 0.0, 0.0, NOW())
            RETURNING id, account_id, shard_id, display_name, chunk_x, chunk_y, pos_x, pos_y, last_saved_at
            "#
        )
        .bind(account_id)
        .bind(shard_id)
        .bind(display_name)
        .fetch_one(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        self.router.complete_write(account_id).await;
        Ok(character)
    }

    async fn save_position(
        &self,
        character_id: i64,
        shard_id: i32,
        chunk_x: i32,
        chunk_y: i32,
        pos_x: f32,
        pos_y: f32,
    ) -> Result<()> {
        let pool = self.router.resolve_pool(QueryIntent::Write, None).await?;
        sqlx::query(
            r#"
            UPDATE characters
            SET chunk_x = $1, chunk_y = $2, pos_x = $3, pos_y = $4, last_saved_at = $5
            WHERE id = $6 AND shard_id = $7
            "#,
        )
        .bind(chunk_x)
        .bind(chunk_y)
        .bind(pos_x)
        .bind(pos_y)
        .bind(Utc::now())
        .bind(character_id)
        .bind(shard_id)
        .execute(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(())
    }
}
