use crate::models::Account;
use crate::router::{DbRouter, QueryIntent};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use std::sync::Arc;
use synapse_common::{Result, SynapseError};

#[async_trait::async_trait]
pub trait AccountRepository: Send + Sync {
    async fn find_by_id(&self, id: i64, shard_id: i32) -> Result<Option<Account>>;
    async fn find_by_username(&self, username: &str, shard_id: i32) -> Result<Option<Account>>;
    async fn create(
        &self,
        username: &str,
        email: &str,
        password: &str,
        shard_id: i32,
    ) -> Result<Account>;
    async fn verify_password(&self, account: &Account, password: &str) -> Result<bool>;
    async fn update_last_login(&self, id: i64, shard_id: i32) -> Result<()>;
    async fn log_login_attempt(
        &self,
        account_id: i64,
        ip: &str,
        user_agent: Option<&str>,
        status: &str,
    ) -> Result<()>;
}

pub struct PgAccountRepository {
    router: Arc<DbRouter>,
}

impl PgAccountRepository {
    pub fn new(router: Arc<DbRouter>) -> Self {
        Self { router }
    }
}

#[async_trait::async_trait]
impl AccountRepository for PgAccountRepository {
    async fn find_by_id(&self, id: i64, shard_id: i32) -> Result<Option<Account>> {
        let pool = self
            .router
            .get_pool(QueryIntent::Read, Some(id), shard_id)?;
        let account = sqlx::query_as::<_, Account>(
            "SELECT id, username, email, password_hash, is_banned, ban_reason, role, shard_id, created_at, last_login_at FROM accounts WHERE id = $1 AND shard_id = $2"
        )
        .bind(id)
        .bind(shard_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(account)
    }

    async fn find_by_username(&self, username: &str, shard_id: i32) -> Result<Option<Account>> {
        let pool = self.router.get_pool(QueryIntent::Read, None, shard_id)?;
        let account = sqlx::query_as::<_, Account>(
            "SELECT id, username, email, password_hash, is_banned, ban_reason, role, shard_id, created_at, last_login_at FROM accounts WHERE username = $1 AND shard_id = $2"
        )
        .bind(username)
        .bind(shard_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(account)
    }

    async fn create(
        &self,
        username: &str,
        email: &str,
        password: &str,
        shard_id: i32,
    ) -> Result<Account> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| SynapseError::Internal(format!("Password hashing failed: {}", e)))?
            .to_string();

        let pool = self.router.get_pool(QueryIntent::Write, None, shard_id)?;
        let account = sqlx::query_as::<_, Account>(
            r#"
            INSERT INTO accounts (username, email, password_hash, shard_id, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id, username, email, password_hash, is_banned, ban_reason, role, shard_id, created_at, last_login_at
            "#
        )
        .bind(username)
        .bind(email)
        .bind(password_hash)
        .bind(shard_id)
        .fetch_one(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        self.router.flag_write(account.id);
        Ok(account)
    }

    async fn verify_password(&self, account: &Account, password: &str) -> Result<bool> {
        let parsed_hash = PasswordHash::new(&account.password_hash)
            .map_err(|e| SynapseError::Authentication(format!("Invalid password hash: {}", e)))?;
        Ok(Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_ok())
    }

    async fn update_last_login(&self, id: i64, shard_id: i32) -> Result<()> {
        let pool = self
            .router
            .get_pool(QueryIntent::Write, Some(id), shard_id)?;
        sqlx::query("UPDATE accounts SET last_login_at = $1 WHERE id = $2 AND shard_id = $3")
            .bind(Utc::now())
            .bind(id)
            .bind(shard_id)
            .execute(pool)
            .await
            .map_err(|e| SynapseError::Database(e.to_string()))?;

        self.router.flag_write(id);
        Ok(())
    }

    async fn log_login_attempt(
        &self,
        account_id: i64,
        ip: &str,
        user_agent: Option<&str>,
        status: &str,
    ) -> Result<()> {
        let pool = self.router.master();
        sqlx::query(
            r#"
            INSERT INTO login_history (account_id, ip_address, user_agent, login_status, attempted_at)
            VALUES ($1, $2::inet, $3, $4, NOW())
            "#
        )
        .bind(account_id)
        .bind(ip)
        .bind(user_agent)
        .bind(status)
        .execute(pool)
        .await
        .map_err(|e| SynapseError::Database(e.to_string()))?;

        Ok(())
    }
}
