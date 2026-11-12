-- ==============================================================================
-- Migration: 0004_init_prefabs
-- Description: Binary tile prefab persistence with shard key isolation
-- ==============================================================================

CREATE TABLE IF NOT EXISTS prefabs (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    shard_id INT NOT NULL DEFAULT 1,
    name VARCHAR(100) NOT NULL,
    width INT NOT NULL,
    height INT NOT NULL,
    anchor_x SMALLINT NOT NULL,
    anchor_y SMALLINT NOT NULL,
    anchor_z SMALLINT NOT NULL DEFAULT 0,
    payload BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prefabs_account ON prefabs(shard_id, account_id);
