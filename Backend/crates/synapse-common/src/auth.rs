use crate::error::{Result, SynapseError};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthClaims {
    pub sub: String, // account_id as string
    pub account_id: i64,
    pub role: String,
    pub shard_id: i32,
    pub exp: i64,
    pub iat: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoardingPassClaims {
    pub sub: String, // character_id as string
    pub character_id: i64,
    pub account_id: i64,
    pub shard_id: i32,
    pub target_region: String,
    pub exp: i64,
    pub iat: i64,
}

pub fn create_jwt(
    account_id: i64,
    role: &str,
    shard_id: i32,
    secret: &str,
    hours: i64,
) -> Result<String> {
    let now = Utc::now();
    let expiration = now + Duration::hours(hours);

    let claims = AuthClaims {
        sub: account_id.to_string(),
        account_id,
        role: role.to_string(),
        shard_id,
        exp: expiration.timestamp(),
        iat: now.timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| SynapseError::Authentication(format!("Token creation failed: {}", e)))
}

pub fn verify_jwt(token: &str, secret: &str) -> Result<AuthClaims> {
    let token_data = decode::<AuthClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| SynapseError::Authentication(format!("Token validation failed: {}", e)))?;

    Ok(token_data.claims)
}

pub fn create_boarding_pass(
    character_id: i64,
    account_id: i64,
    shard_id: i32,
    target_region: &str,
    secret: &str,
    seconds: i64,
) -> Result<String> {
    let now = Utc::now();
    let expiration = now + Duration::seconds(seconds);

    let claims = BoardingPassClaims {
        sub: character_id.to_string(),
        character_id,
        account_id,
        shard_id,
        target_region: target_region.to_string(),
        exp: expiration.timestamp(),
        iat: now.timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| SynapseError::Authentication(format!("Boarding pass creation failed: {}", e)))
}

pub fn verify_boarding_pass(token: &str, secret: &str) -> Result<BoardingPassClaims> {
    let token_data = decode::<BoardingPassClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| SynapseError::Authentication(format!("Boarding pass validation failed: {}", e)))?;

    Ok(token_data.claims)
}
