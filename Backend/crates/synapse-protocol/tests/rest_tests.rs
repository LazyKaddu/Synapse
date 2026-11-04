use synapse_protocol::{
    CharacterDto, CreateCharacterRequest, LoginRequest, LoginResponse, RegisterRequest,
    WorldJoinRequest, WorldJoinResponse,
};

#[test]
fn test_login_request_and_response_dto() {
    let req = LoginRequest {
        username: "LazyKaddu".to_string(),
        password: "password123".to_string(),
    };
    let json = serde_json::to_string(&req).unwrap();
    let decoded: LoginRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded.username, "LazyKaddu");

    let resp = LoginResponse {
        token: "auth_jwt_sample".to_string(),
        account_id: 4092,
    };
    let json_resp = serde_json::to_string(&resp).unwrap();
    let decoded_resp: LoginResponse = serde_json::from_str(&json_resp).unwrap();
    assert_eq!(decoded_resp.account_id, 4092);

    let reg = RegisterRequest {
        username: "LazyKaddu".to_string(),
        email: "kaddu@synapse.mmo".to_string(),
        password: "secure_password".to_string(),
    };
    let json_reg = serde_json::to_string(&reg).unwrap();
    let decoded_reg: RegisterRequest = serde_json::from_str(&json_reg).unwrap();
    assert_eq!(decoded_reg.email, "kaddu@synapse.mmo");
}

#[test]
fn test_character_dtos() {
    let dto = CharacterDto {
        character_id: 1,
        display_name: "LazyKaddu".to_string(),
        chunk_x: 23,
        chunk_y: 25,
        pos_x: 23500.5,
        pos_y: 25100.2,
    };
    let json = serde_json::to_string(&dto).unwrap();
    let decoded: CharacterDto = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded.display_name, "LazyKaddu");
    assert_eq!(decoded.chunk_x, 23);

    let create_req = CreateCharacterRequest {
        display_name: "Warrior".to_string(),
    };
    let create_json = serde_json::to_string(&create_req).unwrap();
    let decoded_create: CreateCharacterRequest = serde_json::from_str(&create_json).unwrap();
    assert_eq!(decoded_create.display_name, "Warrior");
}

#[test]
fn test_world_join_boarding_pass_dto() {
    let join_req = WorldJoinRequest {
        character_id: 1,
        target_region: "eu-west".to_string(),
    };
    let json = serde_json::to_string(&join_req).unwrap();
    let decoded_req: WorldJoinRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded_req.target_region, "eu-west");

    let join_resp = WorldJoinResponse {
        ws_url: "wss://eu-west.game.com/socket".to_string(),
        ticket: "short_lived_ticket".to_string(),
    };
    let json_resp = serde_json::to_string(&join_resp).unwrap();
    let decoded_resp: WorldJoinResponse = serde_json::from_str(&json_resp).unwrap();
    assert_eq!(decoded_resp.ws_url, "wss://eu-west.game.com/socket");
}

