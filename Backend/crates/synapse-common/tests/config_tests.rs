use synapse_common::AppConfig;

#[test]
fn test_app_config_deserialize_toml() {
    let toml_str = r#"
        [server]
        environment = "test"
        region = "eu-west"
        shard_id = 1

        [gateway]
        host = "127.0.0.1"
        port = 8080

        [game_server]
        host = "127.0.0.1"
        port = 9000
        tick_rate_hz = 10
        chunk_size = 1000
        world_seed = 42
        max_voice_tracks = 50
        voice_hysteresis_max = 60
        mega_crowd_threshold = 500
        flush_interval_secs = 180

        [telemetry]
        metrics_port = 9100
        log_level = "info"
        json_logs = false

        [database]
        master_url = "postgres://test"
        replica_urls = []
        max_connections = 10
        read_after_write_window_secs = 3

        [redis]
        primary_url = "redis://127.0.0.1:6379/0"
        global_presence_url = "redis://127.0.0.1:6379/1"
        presence_ttl_secs = 120
        session_ttl_secs = 86400
        blacklist_ttl_secs = 3600
        login_rate_limit_secs = 900

        [livekit]
        host = "http://127.0.0.1:7880"
        api_key = "devkey"
        api_secret = "secret"

        [auth]
        jwt_secret = "secret_32_bytes_test_key_must_be_long"
        jwt_expiration_hours = 24
        boarding_pass_expiration_seconds = 60
    "#;

    let config_obj: config::Config = config::Config::builder()
        .add_source(config::File::from_str(toml_str, config::FileFormat::Toml))
        .build()
        .expect("config build failed");

    let cfg = config_obj
        .try_deserialize::<AppConfig>()
        .expect("deserialize failed");

    assert_eq!(cfg.server.region, "eu-west");
    assert_eq!(cfg.game_server.tick_rate_hz, 10);
    assert_eq!(cfg.game_server.chunk_size, 1000);
    assert_eq!(cfg.database.read_after_write_window_secs, 3);
    assert_eq!(cfg.auth.jwt_expiration_hours, 24);
}

