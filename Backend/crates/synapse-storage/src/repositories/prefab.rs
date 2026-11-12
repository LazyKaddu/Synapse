use crate::models::PrefabRecord;
use crate::router::{DbRouter, QueryIntent, ReadConsistency};
use std::sync::Arc;
use synapse_common::{Result, SynapseError};

const MAX_PREFAB_NAME_CHARS: usize = 100;

/// Trims and validates a prefab name (must be non-empty and at most 100 characters).
pub fn validate_prefab_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(SynapseError::Validation(
            "Prefab name cannot be empty".to_string(),
        ));
    }
    if trimmed.chars().count() > MAX_PREFAB_NAME_CHARS {
        return Err(SynapseError::Validation(format!(
            "Prefab name must be at most {} characters",
            MAX_PREFAB_NAME_CHARS
        )));
    }
    Ok(trimmed.to_string())
}

#[async_trait::async_trait]
pub trait PrefabRepository: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    async fn create(
        &self,
        account_id: i64,
        shard_id: i32,
        name: &str,
        width: i32,
        height: i32,
        anchor_x: i16,
        anchor_y: i16,
        anchor_z: i16,
        payload: Vec<u8>,
    ) -> Result<PrefabRecord>;

    async fn list_by_account(
        &self,
        account_id: i64,
        shard_id: i32,
    ) -> Result<Vec<PrefabRecord>>;

    async fn find_by_id(
        &self,
        id: i64,
        account_id: i64,
        shard_id: i32,
    ) -> Result<Option<PrefabRecord>>;

    async fn delete(&self, id: i64, account_id: i64, shard_id: i32) -> Result<bool>;
}

pub struct PgPrefabRepository {
    router: Arc<DbRouter>,
}

impl PgPrefabRepository {
    pub fn new(router: Arc<DbRouter>) -> Self {
        Self { router }
    }
}

#[async_trait::async_trait]
impl PrefabRepository for PgPrefabRepository {
    async fn create(
        &self,
        account_id: i64,
        shard_id: i32,
        name: &str,
        width: i32,
        height: i32,
        anchor_x: i16,
        anchor_y: i16,
        anchor_z: i16,
        payload: Vec<u8>,
    ) -> Result<PrefabRecord> {
        let valid_name = validate_prefab_name(name)?;
        let pool = self
            .router
            .resolve_pool(QueryIntent::Write, Some(account_id))
            .await?;

        let record = sqlx::query_as::<_, PrefabRecord>(
            r#"
            INSERT INTO prefabs (account_id, shard_id, name, width, height, anchor_x, anchor_y, anchor_z, payload, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            RETURNING id, account_id, shard_id, name, width, height, anchor_x, anchor_y, anchor_z, payload, created_at, updated_at
            "#,
        )
        .bind(account_id)
        .bind(shard_id)
        .bind(valid_name)
        .bind(width)
        .bind(height)
        .bind(anchor_x)
        .bind(anchor_y)
        .bind(anchor_z)
        .bind(payload)
        .fetch_one(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        self.router.complete_write(account_id).await;
        Ok(record)
    }

    async fn list_by_account(
        &self,
        account_id: i64,
        shard_id: i32,
    ) -> Result<Vec<PrefabRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), Some(account_id))
            .await?;

        let records = sqlx::query_as::<_, PrefabRecord>(
            r#"
            SELECT id, account_id, shard_id, name, width, height, anchor_x, anchor_y, anchor_z, payload, created_at, updated_at
            FROM prefabs
            WHERE account_id = $1 AND shard_id = $2
            ORDER BY created_at DESC, id DESC
            "#,
        )
        .bind(account_id)
        .bind(shard_id)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(records)
    }

    async fn find_by_id(
        &self,
        id: i64,
        account_id: i64,
        shard_id: i32,
    ) -> Result<Option<PrefabRecord>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), Some(account_id))
            .await?;

        let record = sqlx::query_as::<_, PrefabRecord>(
            r#"
            SELECT id, account_id, shard_id, name, width, height, anchor_x, anchor_y, anchor_z, payload, created_at, updated_at
            FROM prefabs
            WHERE id = $1 AND account_id = $2 AND shard_id = $3
            "#,
        )
        .bind(id)
        .bind(account_id)
        .bind(shard_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(record)
    }

    async fn delete(&self, id: i64, account_id: i64, shard_id: i32) -> Result<bool> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Write, Some(account_id))
            .await?;

        let result = sqlx::query(
            r#"
            DELETE FROM prefabs
            WHERE id = $1 AND account_id = $2 AND shard_id = $3
            "#,
        )
        .bind(id)
        .bind(account_id)
        .bind(shard_id)
        .execute(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        self.router.complete_write(account_id).await;
        Ok(result.rows_affected() > 0)
    }
}
