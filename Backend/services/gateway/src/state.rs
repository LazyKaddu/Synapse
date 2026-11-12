use std::sync::Arc;
use synapse_common::AppConfig;
use synapse_storage::{
    PgAccountRepository, PgCharacterRepository, PgPrefabRepository, RedisStateCache,
};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub account_repo: Arc<PgAccountRepository>,
    pub character_repo: Arc<PgCharacterRepository>,
    pub prefab_repo: Arc<PgPrefabRepository>,
    pub cache: RedisStateCache,
}
