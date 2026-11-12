use crate::models::InventoryItem;
use crate::router::{DbRouter, QueryIntent, ReadConsistency};
use std::sync::Arc;
use synapse_common::{Result, SynapseError};

#[async_trait::async_trait]
pub trait InventoryRepository: Send + Sync {
    async fn find_by_character(
        &self,
        character_id: i64,
        shard_id: i32,
    ) -> Result<Vec<InventoryItem>>;
    async fn add_item(
        &self,
        character_id: i64,
        shard_id: i32,
        item_definition_id: i32,
        quantity: i32,
    ) -> Result<()>;
}

pub struct PgInventoryRepository {
    router: Arc<DbRouter>,
}

impl PgInventoryRepository {
    pub fn new(router: Arc<DbRouter>) -> Self {
        Self { router }
    }
}

#[async_trait::async_trait]
impl InventoryRepository for PgInventoryRepository {
    async fn find_by_character(
        &self,
        character_id: i64,
        shard_id: i32,
    ) -> Result<Vec<InventoryItem>> {
        let pool = self
            .router
            .resolve_pool(QueryIntent::Read(ReadConsistency::Session), None)
            .await?;
        let items = sqlx::query_as::<_, InventoryItem>(
            "SELECT id, character_id, shard_id, item_definition_id, quantity, acquired_at FROM inventory_items WHERE character_id = $1 AND shard_id = $2"
        )
        .bind(character_id)
        .bind(shard_id)
        .fetch_all(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(items)
    }

    async fn add_item(
        &self,
        character_id: i64,
        shard_id: i32,
        item_definition_id: i32,
        quantity: i32,
    ) -> Result<()> {
        let pool = self.router.resolve_pool(QueryIntent::Write, None).await?;
        sqlx::query(
            r#"
            INSERT INTO inventory_items (character_id, shard_id, item_definition_id, quantity, acquired_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (character_id, item_definition_id)
            DO UPDATE SET quantity = inventory_items.quantity + EXCLUDED.quantity
            "#
        )
        .bind(character_id)
        .bind(shard_id)
        .bind(item_definition_id)
        .bind(quantity)
        .execute(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(())
    }
}
