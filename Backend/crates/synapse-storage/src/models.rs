use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Account {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub password_hash: String,
    pub is_banned: bool,
    pub ban_reason: Option<String>,
    pub role: String,
    pub shard_id: i32,
    pub created_at: Option<DateTime<Utc>>,
    pub last_login_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Character {
    pub id: i64,
    pub account_id: i64,
    pub shard_id: i32,
    pub display_name: String,
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub last_saved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct InventoryItem {
    pub id: i64,
    pub character_id: i64,
    pub shard_id: i32,
    pub item_definition_id: i32,
    pub quantity: i32,
    pub acquired_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PrefabRecord {
    pub id: i64,
    pub account_id: i64,
    pub shard_id: i32,
    pub name: String,
    pub width: i32,
    pub height: i32,
    pub anchor_x: i16,
    pub anchor_y: i16,
    pub anchor_z: i16,
    pub payload: Vec<u8>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}
