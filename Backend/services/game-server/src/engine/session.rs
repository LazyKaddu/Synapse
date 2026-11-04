use bytes::Bytes;
use std::collections::HashSet;
use synapse_spatial::{ChunkCoord, WorldPos};
use tokio::sync::mpsc;

#[derive(Debug)]
pub enum OutgoingMessage {
    Binary(Bytes),
    Text(String),
}

pub struct PlayerSession {
    pub character_id: i64,
    pub account_id: i64,
    pub shard_id: i32,
    pub display_name: String,
    pub position: WorldPos,
    pub current_chunk: ChunkCoord,
    pub subscribed_chunks: HashSet<ChunkCoord>,
    pub subscribed_audio_tracks: Vec<u32>,
    pub tx: mpsc::UnboundedSender<OutgoingMessage>,
}

impl PlayerSession {
    pub fn new(
        character_id: i64,
        account_id: i64,
        shard_id: i32,
        display_name: String,
        position: WorldPos,
        current_chunk: ChunkCoord,
        tx: mpsc::UnboundedSender<OutgoingMessage>,
    ) -> Self {
        Self {
            character_id,
            account_id,
            shard_id,
            display_name,
            position,
            current_chunk,
            subscribed_chunks: HashSet::new(),
            subscribed_audio_tracks: Vec::new(),
            tx,
        }
    }

    pub fn send(&self, msg: OutgoingMessage) {
        let _ = self.tx.send(msg);
    }
}
