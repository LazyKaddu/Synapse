use synapse_livekit::LiveKitTokenGenerator;

#[test]
fn test_livekit_token_generator_not_empty() {
    let gen = LiveKitTokenGenerator::new("devkey".to_string(), "test_secret_12345678".to_string());
    let token = gen
        .create_room_token("user_4092", "chunk_room_1_23_25", true, true, 6)
        .expect("token generation failed");

    assert!(!token.is_empty());
    // JWT tokens have 3 base64 parts separated by dots
    let parts: Vec<&str> = token.split('.').collect();
    assert_eq!(
        parts.len(),
        3,
        "JWT must consist of header, payload, and signature"
    );
}
