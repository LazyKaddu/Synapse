use crate::state::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use synapse_common::{create_boarding_pass, verify_jwt};
use synapse_protocol::{WorldJoinRequest, WorldJoinResponse};
use synapse_storage::CharacterRepository;

fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
}

pub async fn join_world_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<WorldJoinRequest>,
) -> std::result::Result<Json<WorldJoinResponse>, (StatusCode, String)> {
    let token = extract_bearer_token(&headers).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "Missing authorization header".to_string(),
        )
    })?;

    let claims = verify_jwt(token, &state.config.auth.jwt_secret)
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;

    // Verify character ownership
    let character = state
        .character_repo
        .find_by_id(payload.character_id, claims.shard_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Character not found".to_string()))?;

    if character.account_id != claims.account_id {
        return Err((
            StatusCode::FORBIDDEN,
            "Unauthorized character access".to_string(),
        ));
    }

    // Mint short-lived Boarding Pass ticket (e.g. 60 seconds)
    let ticket = create_boarding_pass(
        character.id,
        claims.account_id,
        character.shard_id,
        &payload.target_region,
        &state.config.auth.jwt_secret,
        state.config.auth.boarding_pass_expiration_seconds,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let ws_url = format!("wss://{}.game.com/socket", payload.target_region);

    Ok(Json(WorldJoinResponse { ws_url, ticket }))
}
