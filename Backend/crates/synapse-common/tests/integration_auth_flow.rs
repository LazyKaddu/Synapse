use synapse_common::{create_boarding_pass, create_jwt, verify_boarding_pass, verify_jwt};

#[test]
fn test_auth_and_boarding_pass_tokens_e2e() {
    let secret = "super_secure_production_secret_key_at_least_32_bytes_long";
    let bad_secret = "wrong_secret_key_used_for_testing_signature_failure";

    // 1. Account login -> generate JWT
    let account_id = 4092;
    let role = "player";
    let shard_id = 1;

    let token = create_jwt(account_id, role, shard_id, secret, 24).expect("JWT creation failed");
    assert!(!token.is_empty());

    // 2. Verify with valid secret
    let claims = verify_jwt(&token, secret).expect("JWT verification failed");
    assert_eq!(claims.account_id, 4092);
    assert_eq!(claims.role, "player");
    assert_eq!(claims.shard_id, 1);

    // 3. Verify rejection with invalid secret
    assert!(
        verify_jwt(&token, bad_secret).is_err(),
        "Verification with wrong secret must fail"
    );

    // 4. Server Handoff: mint Boarding Pass ticket for target region (eu-west)
    let character_id = 1001;
    let target_region = "eu-west";
    let ticket = create_boarding_pass(
        character_id,
        account_id,
        shard_id,
        target_region,
        secret,
        60,
    )
    .expect("Boarding pass creation failed");
    assert!(!ticket.is_empty());

    // 5. Target region verifies Boarding Pass
    let pass_claims =
        verify_boarding_pass(&ticket, secret).expect("Boarding pass verification failed");
    assert_eq!(pass_claims.character_id, 1001);
    assert_eq!(pass_claims.account_id, 4092);
    assert_eq!(pass_claims.shard_id, 1);
    assert_eq!(pass_claims.target_region, "eu-west");

    // 6. Target region rejects with wrong secret
    assert!(
        verify_boarding_pass(&ticket, bad_secret).is_err(),
        "Boarding pass with wrong secret must fail"
    );
}
