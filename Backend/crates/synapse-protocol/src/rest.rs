use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResponse {
    pub token: String,
    pub account_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterDto {
    pub character_id: i64,
    pub display_name: String,
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub pos_x: f32,
    pub pos_y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCharacterRequest {
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldJoinRequest {
    pub character_id: i64,
    pub target_region: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldJoinResponse {
    pub ws_url: String,
    pub ticket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrefabSummaryDto {
    pub id: i64,
    pub name: String,
    pub width: i32,
    pub height: i32,
    pub anchor_x: i16,
    pub anchor_y: i16,
    pub anchor_z: i16,
    pub byte_length: usize,
    pub created_at: String,
}
