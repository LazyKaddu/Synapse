use crate::token::LiveKitTokenGenerator;
use std::collections::HashSet;
use std::sync::Arc;
use synapse_common::Result;
use synapse_spatial::ChunkCoord;
use tokio::sync::RwLock;

pub struct LiveKitRoomOrchestrator {
    host: String,
    token_generator: LiveKitTokenGenerator,
    active_rooms: Arc<RwLock<HashSet<String>>>,
    _client: reqwest::Client,
}

impl LiveKitRoomOrchestrator {
    pub fn new(host: String, api_key: String, api_secret: String) -> Self {
        Self {
            host,
            token_generator: LiveKitTokenGenerator::new(api_key, api_secret),
            active_rooms: Arc::new(RwLock::new(HashSet::new())),
            _client: reqwest::Client::new(),
        }
    }

    pub fn chunk_room_name(shard_id: i32, coord: ChunkCoord) -> String {
        format!("chunk_room_{}_{}_{}", shard_id, coord.x, coord.y)
    }

    pub fn phone_room_name(call_id: &str) -> String {
        format!("phone_call_{}", call_id)
    }

    /// Evaluates lazy room creation/destruction based on chunk population.
    /// Room created when chunk population >= 2.
    /// Room destroyed when chunk population <= 1.
    pub async fn handle_chunk_population_change(
        &self,
        shard_id: i32,
        coord: ChunkCoord,
        new_count: usize,
    ) -> Result<()> {
        let room_name = Self::chunk_room_name(shard_id, coord);

        if new_count >= 2 {
            let mut rooms = self.active_rooms.write().await;
            if !rooms.contains(&room_name) {
                tracing::info!(room = %room_name, population = new_count, "Creating LiveKit proximity voice room");
                rooms.insert(room_name);
                // Call LiveKit server API to initialize room if needed
            }
        } else if new_count <= 1 {
            let mut rooms = self.active_rooms.write().await;
            if rooms.remove(&room_name) {
                tracing::info!(room = %room_name, "Destroying LiveKit proximity voice room (population <= 1)");
                // Call LiveKit server API to delete room
            }
        }

        Ok(())
    }

    /// Mints proximity voice chat token, downgrading to listen-only if population exceeds mega-crowd threshold (500).
    pub fn mint_chunk_token(
        &self,
        participant_id: &str,
        shard_id: i32,
        coord: ChunkCoord,
        population: usize,
        mega_crowd_threshold: usize,
    ) -> Result<String> {
        let room_name = Self::chunk_room_name(shard_id, coord);
        let can_publish = population <= mega_crowd_threshold;
        let can_subscribe = true;

        if !can_publish {
            tracing::warn!(
                room = %room_name,
                population,
                "Mega-crowd threshold exceeded! Downgrading participant to listen-only mode"
            );
        }

        self.token_generator.create_room_token(
            participant_id,
            &room_name,
            can_publish,
            can_subscribe,
            6,
        )
    }

    /// Mints 1-on-1 private phone call token.
    pub fn mint_phone_token(&self, participant_id: &str, call_id: &str) -> Result<String> {
        let room_name = Self::phone_room_name(call_id);
        self.token_generator
            .create_room_token(participant_id, &room_name, true, true, 2)
    }

    pub fn sfu_url(&self) -> &str {
        &self.host
    }

    pub async fn is_room_active(&self, room_name: &str) -> bool {
        self.active_rooms.read().await.contains(room_name)
    }
}
