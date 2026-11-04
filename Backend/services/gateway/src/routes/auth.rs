use crate::state::AppState;
use axum::{
    extract::{ConnectInfo, State},
    http::StatusCode,
    Json,
};
use std::net::SocketAddr;
use synapse_common::create_jwt;
use synapse_protocol::{LoginRequest, LoginResponse, RegisterRequest};
use synapse_storage::AccountRepository;

pub async fn login_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(payload): Json<LoginRequest>,
) -> std::result::Result<Json<LoginResponse>, (StatusCode, String)> {
    let ip = addr.ip().to_string();

    // 1. Check IP rate limit (10 attempts / 15 minutes)
    let allowed = state
        .cache
        .check_and_increment_rate_limit(&ip, 10, state.config.redis.login_rate_limit_secs)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !allowed {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Too many login attempts. Please try again later.".to_string(),
        ));
    }

    // 2. Fetch account by username
    let account = state
        .account_repo
        .find_by_username(&payload.username, state.config.server.shard_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                "Invalid username or password".to_string(),
            )
        })?;

    // 3. Check if banned
    if account.is_banned {
        let _ = state
            .account_repo
            .log_login_attempt(account.id, &ip, None, "BANNED")
            .await;
        return Err((
            StatusCode::FORBIDDEN,
            account
                .ban_reason
                .unwrap_or_else(|| "Account is banned".to_string()),
        ));
    }

    // 4. Verify password
    let valid = state
        .account_repo
        .verify_password(&account, &payload.password)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !valid {
        let _ = state
            .account_repo
            .log_login_attempt(account.id, &ip, None, "FAILED_PASSWORD")
            .await;
        return Err((
            StatusCode::UNAUTHORIZED,
            "Invalid username or password".to_string(),
        ));
    }

    // 5. Update last login & log audit
    let _ = state
        .account_repo
        .update_last_login(account.id, account.shard_id)
        .await;
    let _ = state
        .account_repo
        .log_login_attempt(account.id, &ip, None, "SUCCESS")
        .await;

    // 6. Mint JWT token
    let token = create_jwt(
        account.id,
        &account.role,
        account.shard_id,
        &state.config.auth.jwt_secret,
        state.config.auth.jwt_expiration_hours,
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(LoginResponse {
        token,
        account_id: account.id,
    }))
}

pub async fn register_handler(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> std::result::Result<StatusCode, (StatusCode, String)> {
    state
        .account_repo
        .create(
            &payload.username,
            &payload.email,
            &payload.password,
            state.config.server.shard_id,
        )
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    Ok(StatusCode::CREATED)
}
