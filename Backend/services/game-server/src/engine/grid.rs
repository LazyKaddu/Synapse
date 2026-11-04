use crate::engine::session::PlayerSession;
use dashmap::DashMap;
use std::collections::HashSet;
use std::sync::Arc;
use synapse_spatial::{AreaOfInterest, ChunkCoord, GridDelta, WorldPos};

pub struct SpatialGrid {
    // Maps character_id -> PlayerSession
    pub sessions: Arc<DashMap<i64, PlayerSession>>,
    // Maps ChunkCoord -> Set of character_ids currently located in that chunk
    pub chunk_players: Arc<DashMap<ChunkCoord, HashSet<i64>>>,
    // Maps ChunkCoord -> Set of character_ids subscribed to this chunk's AOI updates
    pub chunk_subscribers: Arc<DashMap<ChunkCoord, HashSet<i64>>>,
}

impl Default for SpatialGrid {
    fn default() -> Self {
        Self::new()
    }
}

impl SpatialGrid {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            chunk_players: Arc::new(DashMap::new()),
            chunk_subscribers: Arc::new(DashMap::new()),
        }
    }

    pub fn insert_player(&self, session: PlayerSession) {
        let character_id = session.character_id;
        let chunk = session.current_chunk;

        // Register in chunk players
        self.chunk_players
            .entry(chunk)
            .or_default()
            .insert(character_id);

        // Subscribe to initial 3x3 grid
        let grid_3x3 = AreaOfInterest::get_3x3_grid(chunk);
        for c in grid_3x3 {
            self.chunk_subscribers
                .entry(c)
                .or_default()
                .insert(character_id);
        }

        self.sessions.insert(character_id, session);
    }

    pub fn remove_player(&self, character_id: i64) -> Option<PlayerSession> {
        if let Some((_, session)) = self.sessions.remove(&character_id) {
            // Remove from current chunk
            if let Some(mut set) = self.chunk_players.get_mut(&session.current_chunk) {
                set.remove(&character_id);
            }

            // Unsubscribe from 3x3 grid
            let grid_3x3 = AreaOfInterest::get_3x3_grid(session.current_chunk);
            for c in grid_3x3 {
                if let Some(mut subscribers) = self.chunk_subscribers.get_mut(&c) {
                    subscribers.remove(&character_id);
                }
            }

            Some(session)
        } else {
            None
        }
    }

    pub fn update_player_position(
        &self,
        character_id: i64,
        new_pos: WorldPos,
        chunk_size: f32,
    ) -> Option<GridDelta> {
        let mut session = self.sessions.get_mut(&character_id)?;
        session.position = new_pos;

        let new_chunk = new_pos.to_chunk(chunk_size);
        let old_chunk = session.current_chunk;

        if old_chunk != new_chunk {
            // Cross-boundary chunk transition
            session.current_chunk = new_chunk;

            // Update chunk players
            if let Some(mut old_set) = self.chunk_players.get_mut(&old_chunk) {
                old_set.remove(&character_id);
            }
            self.chunk_players
                .entry(new_chunk)
                .or_default()
                .insert(character_id);

            // Compute grid diff
            let delta = AreaOfInterest::calculate_diff(old_chunk, new_chunk);

            // Unsubscribe trailing chunks
            for c in &delta.to_unsubscribe {
                if let Some(mut sub) = self.chunk_subscribers.get_mut(c) {
                    sub.remove(&character_id);
                }
            }

            // Subscribe new chunks
            for c in &delta.to_subscribe {
                self.chunk_subscribers
                    .entry(*c)
                    .or_default()
                    .insert(character_id);
            }

            Some(delta)
        } else {
            None
        }
    }

    /// Retrieves all subscribers for a given chunk to broadcast neighbor movement
    pub fn get_chunk_subscribers(&self, chunk: ChunkCoord) -> Vec<i64> {
        self.chunk_subscribers
            .get(&chunk)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Gets candidate players located in chunks surrounding a center chunk
    pub fn get_nearby_candidates(&self, center: ChunkCoord) -> Vec<(u32, WorldPos)> {
        let grid = AreaOfInterest::get_3x3_grid(center);
        let mut candidates = Vec::new();

        for c in grid {
            if let Some(player_ids) = self.chunk_players.get(&c) {
                for id in player_ids.iter() {
                    if let Some(session) = self.sessions.get(id) {
                        candidates.push((*id as u32, session.position));
                    }
                }
            }
        }

        candidates
    }
}
