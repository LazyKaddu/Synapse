use synapse_common::{create_boarding_pass, create_jwt, verify_boarding_pass, verify_jwt};

#[test]
fn test_jwt_generation_and_validation() {
    let secret = "super_secret_test_key_minimum_32_bytes_long";
    let token = create_jwt(4092, "player", 1, secret, 24).expect("create_jwt failed");
    let claims = verify_jwt(&token, secret).expect("verify_jwt failed");

    assert_eq!(claims.account_id, 4092);
    assert_eq!(claims.role, "player");
    assert_eq!(claims.shard_id, 1);
}

#[test]
fn test_boarding_pass_ticket_lifecycle() {
    let secret = "super_secret_test_key_minimum_32_bytes_long";
    let ticket = create_boarding_pass(101, 4092, 1, "eu-west", secret, 60)
        .expect("create_boarding_pass failed");
    let claims = verify_boarding_pass(&ticket, secret).expect("verify_boarding_pass failed");

    assert_eq!(claims.character_id, 101);
    assert_eq!(claims.account_id, 4092);
    assert_eq!(claims.shard_id, 1);
    assert_eq!(claims.target_region, "eu-west");
}

#[test]
fn test_jwt_tampered_secret_rejection() {
    let valid_secret = "super_secret_test_key_minimum_32_bytes_long";
    let invalid_secret = "attacker_secret_key_used_to_forge_claims";

    let token = create_jwt(4092, "player", 1, valid_secret, 24).unwrap();
    assert!(verify_jwt(&token, invalid_secret).is_err());
}

#[test]
fn test_boarding_pass_tampered_secret_rejection() {
    let valid_secret = "super_secret_test_key_minimum_32_bytes_long";
    let invalid_secret = "attacker_secret_key_used_to_forge_claims";

    let ticket = create_boarding_pass(101, 4092, 1, "eu-west", valid_secret, 60).unwrap();
    assert!(verify_boarding_pass(&ticket, invalid_secret).is_err());
}

