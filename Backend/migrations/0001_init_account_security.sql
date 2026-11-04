-- ==============================================================================
-- Migration: 0001_init_account_security
-- Description: Core authentication, identity, and security audit tables
-- ==============================================================================

CREATE TABLE IF NOT EXISTS accounts (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    ban_reason VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'player', 
    
    shard_id INT NOT NULL DEFAULT 1, 
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS login_history (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ip_address INET NOT NULL, 
    user_agent TEXT,
    login_status VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILED_PASSWORD', 'BANNED'
    attempted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_history_account ON login_history(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

CREATE TABLE IF NOT EXISTS account_providers (
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider_name VARCHAR(50) NOT NULL, -- e.g., 'discord', 'google'
    provider_user_id VARCHAR(255) NOT NULL,
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (account_id, provider_name)
);
