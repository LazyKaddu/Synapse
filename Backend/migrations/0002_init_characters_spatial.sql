-- ==============================================================================
-- Migration: 0002_init_characters_spatial
-- Description: Character persistence and spatial state cold storage
-- ==============================================================================

CREATE TABLE IF NOT EXISTS characters (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    shard_id INT NOT NULL DEFAULT 1,
    display_name VARCHAR(50) UNIQUE NOT NULL,
    
    chunk_x INT NOT NULL DEFAULT 0,
    chunk_y INT NOT NULL DEFAULT 0,
    pos_x REAL NOT NULL DEFAULT 0.0,
    pos_y REAL NOT NULL DEFAULT 0.0,
    
    last_saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_characters_location ON characters(shard_id, chunk_x, chunk_y);
CREATE INDEX IF NOT EXISTS idx_characters_account ON characters(account_id);
