use bytes::Bytes;
use std::collections::{HashSet, VecDeque};
use synapse_spatial::{ChunkCoord, WorldPos};
use tokio::sync::mpsc;

pub const MAX_INPUT_QUEUE_LEN: usize = 120;
pub const MAX_INPUT_DT_MS: u16 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueuedInput {
    pub seq: u32,
    pub dx: i8,
    pub dy: i8,
    pub sprint: bool,
    pub dt_ms: u16,
}

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
    pub velocity: WorldPos,
    pub last_processed_seq: u32,
    highest_received_seq: Option<u32>,
    pub input_queue: VecDeque<QueuedInput>,
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
            velocity: WorldPos::new(0.0, 0.0),
            last_processed_seq: 0,
            highest_received_seq: None,
            input_queue: VecDeque::new(),
            current_chunk,
            subscribed_chunks: HashSet::new(),
            subscribed_audio_tracks: Vec::new(),
            tx,
        }
    }

    /// Enqueues a client movement input after enforcing anti-cheat bounds:
    /// - Rejects stale or duplicate sequence numbers
    /// - Bounds queue length to `MAX_INPUT_QUEUE_LEN`
    /// - Clamps `dt_ms` to `MAX_INPUT_DT_MS`
    pub fn enqueue_input(&mut self, input: QueuedInput) -> bool {
        if self
            .highest_received_seq
            .is_some_and(|prev| input.seq <= prev)
        {
            return false;
        }
        if self.input_queue.len() >= MAX_INPUT_QUEUE_LEN {
            return false;
        }
        self.highest_received_seq = Some(input.seq);
        self.input_queue.push_back(QueuedInput {
            dt_ms: input.dt_ms.min(MAX_INPUT_DT_MS),
            ..input
        });
        true
    }

    pub fn reset_movement_state(&mut self) {
        self.velocity = WorldPos::new(0.0, 0.0);
        self.input_queue.clear();
    }

    pub fn send(&self, msg: OutgoingMessage) {
        let _ = self.tx.send(msg);
    }
}
