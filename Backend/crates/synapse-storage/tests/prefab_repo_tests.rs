use chrono::{DateTime, Utc};
use synapse_storage::models::PrefabRecord;
use synapse_storage::repositories::prefab::validate_prefab_name;

#[test]
fn test_prefab_record_fields_and_types() {
    let now: DateTime<Utc> = Utc::now();
    let payload: Vec<u8> = vec![4, 0, 4, 0, 254, 255, 3, 0, 1, 1, 0, 1, 0, 16, 0];

    let record = PrefabRecord {
        id: 101i64,
        account_id: 4092i64,
        shard_id: 1i32,
        name: "Starter House".to_string(),
        width: 4i32,
        height: 4i32,
        anchor_x: -2i16,
        anchor_y: 3i16,
        anchor_z: -1i16,
        payload: payload.clone(),
        created_at: Some(now),
        updated_at: Some(now),
    };

    let id: i64 = record.id;
    let account_id: i64 = record.account_id;
    let shard_id: i32 = record.shard_id;
    let name: String = record.name;
    let width: i32 = record.width;
    let height: i32 = record.height;
    let anchor_x: i16 = record.anchor_x;
    let anchor_y: i16 = record.anchor_y;
    let anchor_z: i16 = record.anchor_z;
    let stored_payload: Vec<u8> = record.payload;
    let created_at: Option<DateTime<Utc>> = record.created_at;
    let updated_at: Option<DateTime<Utc>> = record.updated_at;

    assert_eq!(id, 101);
    assert_eq!(account_id, 4092);
    assert_eq!(shard_id, 1);
    assert_eq!(name, "Starter House");
    assert_eq!(width, 4);
    assert_eq!(height, 4);
    assert_eq!(anchor_x, -2);
    assert_eq!(anchor_y, 3);
    assert_eq!(anchor_z, -1);
    assert_eq!(stored_payload, payload);
    assert_eq!(created_at, Some(now));
    assert_eq!(updated_at, Some(now));

    let record_without_timestamps = PrefabRecord {
        id: 102,
        account_id: 4092,
        shard_id: 1,
        name: "Empty Plot".to_string(),
        width: 0,
        height: 0,
        anchor_x: 0,
        anchor_y: 0,
        anchor_z: 0,
        payload: vec![0; 11],
        created_at: None,
        updated_at: None,
    };

    assert!(record_without_timestamps.created_at.is_none());
    assert!(record_without_timestamps.updated_at.is_none());
}

#[test]
fn test_validate_prefab_name_accepts_and_trims_valid_names() {
    let basic = validate_prefab_name("Starter House").expect("Starter House should be valid");
    assert_eq!(basic, "Starter House");

    let trimmed = validate_prefab_name("  Starter House \t\n ").expect("padded name should trim");
    assert_eq!(trimmed, "Starter House");

    let max_len = "a".repeat(100);
    let max_result = validate_prefab_name(&max_len).expect("100-char name should be accepted");
    assert_eq!(max_result, max_len);

    let padded_max = format!("  {}  ", max_len);
    let padded_result =
        validate_prefab_name(&padded_max).expect("padded 100-char name should trim and pass");
    assert_eq!(padded_result, max_len);
}

#[test]
fn test_validate_prefab_name_rejects_empty_and_whitespace() {
    assert!(validate_prefab_name("").is_err());
    assert!(validate_prefab_name("   ").is_err());
    assert!(validate_prefab_name("\t\n\r ").is_err());
}

#[test]
fn test_validate_prefab_name_rejects_names_over_100_chars() {
    let over_limit = "a".repeat(101);
    assert!(validate_prefab_name(&over_limit).is_err());

    let padded_over_limit = format!(" {} ", over_limit);
    assert!(validate_prefab_name(&padded_over_limit).is_err());
}
