use crate::state::AppState;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use synapse_common::{verify_jwt, AuthClaims, SynapseError};
use synapse_protocol::{validate_prefab_payload, PrefabSummaryDto};
use synapse_storage::{repositories::validate_prefab_name, PrefabRecord, PrefabRepository};

pub const MAX_PREFAB_BYTES: usize = 1024 * 1024;
pub const PREFAB_NAME_HEADER: &str = "X-Prefab-Name";

#[derive(Debug, Deserialize)]
pub struct CreatePrefabQuery {
    pub name: Option<String>,
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
}

fn authenticate(
    headers: &HeaderMap,
    jwt_secret: &str,
) -> std::result::Result<AuthClaims, (StatusCode, String)> {
    let token = extract_bearer_token(headers).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "Missing authorization header".to_string(),
        )
    })?;

    verify_jwt(token, jwt_secret).map_err(map_synapse_error)
}

pub(crate) fn extract_prefab_name(
    headers: &HeaderMap,
    query_name: Option<&str>,
) -> std::result::Result<String, (StatusCode, String)> {
    let raw_name = match headers.get(PREFAB_NAME_HEADER) {
        Some(value) => value.to_str().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "Invalid UTF-8 in X-Prefab-Name header".to_string(),
            )
        })?,
        None => query_name.ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "Missing prefab name: provide X-Prefab-Name header or ?name= query parameter"
                    .to_string(),
            )
        })?,
    };

    validate_prefab_name(raw_name).map_err(map_synapse_error)
}

pub(crate) fn map_synapse_error(err: SynapseError) -> (StatusCode, String) {
    let status = match &err {
        SynapseError::Authentication(_) => StatusCode::UNAUTHORIZED,
        SynapseError::Unauthorized(_) => StatusCode::FORBIDDEN,
        SynapseError::NotFound(_) => StatusCode::NOT_FOUND,
        SynapseError::Validation(_) | SynapseError::Protocol(_) => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, err.to_string())
}

fn record_to_summary_dto(record: &PrefabRecord) -> PrefabSummaryDto {
    PrefabSummaryDto {
        id: record.id,
        name: record.name.clone(),
        width: record.width,
        height: record.height,
        anchor_x: record.anchor_x,
        anchor_y: record.anchor_y,
        anchor_z: record.anchor_z,
        byte_length: record.payload.len(),
        created_at: record
            .created_at
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default(),
    }
}

pub async fn create_prefab_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CreatePrefabQuery>,
    body: Bytes,
) -> std::result::Result<(StatusCode, Json<PrefabSummaryDto>), (StatusCode, String)> {
    let claims = authenticate(&headers, &state.config.auth.jwt_secret)?;

    if body.len() > MAX_PREFAB_BYTES {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "Prefab payload exceeds maximum size of {} bytes",
                MAX_PREFAB_BYTES
            ),
        ));
    }

    let name = extract_prefab_name(&headers, query.name.as_deref())?;
    let meta = validate_prefab_payload(&body).map_err(map_synapse_error)?;

    let record = state
        .prefab_repo
        .create(
            claims.account_id,
            claims.shard_id,
            &name,
            i32::from(meta.width),
            i32::from(meta.height),
            meta.anchor_x,
            meta.anchor_y,
            meta.anchor_z,
            body.to_vec(),
        )
        .await
        .map_err(map_synapse_error)?;

    Ok((StatusCode::CREATED, Json(record_to_summary_dto(&record))))
}

pub async fn list_prefabs_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> std::result::Result<Json<Vec<PrefabSummaryDto>>, (StatusCode, String)> {
    let claims = authenticate(&headers, &state.config.auth.jwt_secret)?;

    let records = state
        .prefab_repo
        .list_by_account(claims.account_id, claims.shard_id)
        .await
        .map_err(map_synapse_error)?;

    let dtos = records.iter().map(record_to_summary_dto).collect();
    Ok(Json(dtos))
}

pub async fn get_prefab_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> std::result::Result<(StatusCode, [(header::HeaderName, &'static str); 1], Vec<u8>), (StatusCode, String)> {
    let claims = authenticate(&headers, &state.config.auth.jwt_secret)?;

    let record = state
        .prefab_repo
        .find_by_id(id, claims.account_id, claims.shard_id)
        .await
        .map_err(map_synapse_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Prefab not found".to_string()))?;

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/octet-stream")],
        record.payload,
    ))
}

pub async fn delete_prefab_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> std::result::Result<StatusCode, (StatusCode, String)> {
    let claims = authenticate(&headers, &state.config.auth.jwt_secret)?;

    let deleted = state
        .prefab_repo
        .delete(id, claims.account_id, claims.shard_id)
        .await
        .map_err(map_synapse_error)?;

    if !deleted {
        return Err((StatusCode::NOT_FOUND, "Prefab not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn test_extract_prefab_name_prefers_header_and_trims() {
        let mut headers = HeaderMap::new();
        headers.insert(
            PREFAB_NAME_HEADER,
            HeaderValue::from_static("  Tavern Keep  "),
        );

        let name = extract_prefab_name(&headers, Some("Query Fallback"))
            .expect("header name should be accepted");
        assert_eq!(name, "Tavern Keep");
    }

    #[test]
    fn test_extract_prefab_name_falls_back_to_query() {
        let headers = HeaderMap::new();
        let name = extract_prefab_name(&headers, Some("  Stone Well  "))
            .expect("query name should be accepted");
        assert_eq!(name, "Stone Well");
    }

    #[test]
    fn test_extract_prefab_name_rejects_missing_and_invalid() {
        let headers = HeaderMap::new();
        let (status, _) =
            extract_prefab_name(&headers, None).expect_err("missing name should fail");
        assert_eq!(status, StatusCode::BAD_REQUEST);

        let (status, _) =
            extract_prefab_name(&headers, Some("   ")).expect_err("blank query name should fail");
        assert_eq!(status, StatusCode::BAD_REQUEST);

        let mut bad_headers = HeaderMap::new();
        bad_headers.insert(
            PREFAB_NAME_HEADER,
            HeaderValue::from_bytes(&[0xFF, 0xFE]).expect("non-utf8 header value"),
        );
        let (status, _) =
            extract_prefab_name(&bad_headers, Some("Valid")).expect_err("invalid utf8 should fail");
        assert_eq!(status, StatusCode::BAD_REQUEST);

        let over_limit = "x".repeat(101);
        let (status, _) = extract_prefab_name(&headers, Some(&over_limit))
            .expect_err("over-100 char name should fail");
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_extract_bearer_token() {
        let mut headers = HeaderMap::new();
        assert_eq!(extract_bearer_token(&headers), None);

        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Basic abc123"),
        );
        assert_eq!(extract_bearer_token(&headers), None);

        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer jwt.token.here"),
        );
        assert_eq!(extract_bearer_token(&headers), Some("jwt.token.here"));
    }

    #[test]
    fn test_map_synapse_error_status_codes() {
        assert_eq!(
            map_synapse_error(SynapseError::Authentication("bad token".into())).0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            map_synapse_error(SynapseError::Unauthorized("forbidden".into())).0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            map_synapse_error(SynapseError::NotFound("missing".into())).0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            map_synapse_error(SynapseError::Validation("bad payload".into())).0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            map_synapse_error(SynapseError::Protocol("bad packet".into())).0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            map_synapse_error(SynapseError::Database("pg down".into())).0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            map_synapse_error(SynapseError::Internal("oops".into())).0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_record_to_summary_dto_preserves_metadata() {
        let created = sqlx::types::chrono::DateTime::from_timestamp(1_794_484_800, 0);
        let record = PrefabRecord {
            id: 77,
            account_id: 10,
            shard_id: 1,
            name: "Watchtower".to_string(),
            width: 5,
            height: 6,
            anchor_x: -2,
            anchor_y: 5,
            anchor_z: -1,
            payload: vec![0u8; 21],
            created_at: created,
            updated_at: created,
        };

        let dto = record_to_summary_dto(&record);
        assert_eq!(dto.id, 77);
        assert_eq!(dto.name, "Watchtower");
        assert_eq!(dto.width, 5);
        assert_eq!(dto.height, 6);
        assert_eq!(dto.anchor_x, -2);
        assert_eq!(dto.anchor_y, 5);
        assert_eq!(dto.anchor_z, -1);
        assert_eq!(dto.byte_length, 21);
        assert_eq!(
            dto.created_at,
            created.expect("valid timestamp").to_rfc3339()
        );
    }
}
