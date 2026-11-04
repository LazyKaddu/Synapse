-- ==============================================================================
-- Migration: 0003_init_inventory_assets
-- Description: ACID-compliant inventory storage with shard key isolation
-- ==============================================================================

CREATE TABLE IF NOT EXISTS inventory_items (
    id BIGSERIAL PRIMARY KEY,
    character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    shard_id INT NOT NULL DEFAULT 1,
    item_definition_id INT NOT NULL, 
    quantity INT NOT NULL DEFAULT 1,
    acquired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(character_id, item_definition_id) 
);

CREATE INDEX IF NOT EXISTS idx_inventory_character ON inventory_items(shard_id, character_id);
