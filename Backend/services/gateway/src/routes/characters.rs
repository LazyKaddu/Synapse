use crate::state::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use synapse_common::verify_jwt;
use synapse_protocol::{CharacterDto, CreateCharacterRequest};
use synapse_storage::CharacterRepository;

fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
}

pub async fn list_characters_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> std::result::Result<Json<Vec<CharacterDto>>, (StatusCode, String)> {
    let token = extract_bearer_token(&headers).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "Missing authorization header".to_string(),
        )
    })?;

    let claims = verify_jwt(token, &state.config.auth.jwt_secret)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;

    let characters = state
        .character_repo
        .find_by_account(claims.account_id, claims.shard_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let dtos = characters
        .into_iter()
        .map(|c| CharacterDto {
            character_id: c.id,
            display_name: c.display_name,
            chunk_x: c.chunk_x,
            chunk_y: c.chunk_y,
            pos_x: c.pos_x,
            pos_y: c.pos_y,
        })
        .collect();

    Ok(Json(dtos))
}

pub async fn create_character_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateCharacterRequest>,
) -> std::result::Result<Json<CharacterDto>, (StatusCode, String)> {
    let token = extract_bearer_token(&headers).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "Missing authorization header".to_string(),
        )
    })?;

    let claims = verify_jwt(token, &state.config.auth.jwt_secret)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;

    let character = state
        .character_repo
        .create(claims.account_id, &payload.display_name, claims.shard_id)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    Ok(Json(CharacterDto {
        character_id: character.id,
        display_name: character.display_name,
        chunk_x: character.chunk_x,
        chunk_y: character.chunk_y,
        pos_x: character.pos_x,
        pos_y: character.pos_y,
    }))
}
