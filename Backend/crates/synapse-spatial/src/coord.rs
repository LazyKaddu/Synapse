use serde::{Deserialize, Serialize};

pub const DEFAULT_CHUNK_SIZE: f32 = 1000.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WorldPos {
    pub x: f32,
    pub y: f32,
}

impl WorldPos {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    #[inline]
    pub fn to_chunk(&self, chunk_size: f32) -> ChunkCoord {
        ChunkCoord {
            x: (self.x / chunk_size).floor() as i32,
            y: (self.y / chunk_size).floor() as i32,
        }
    }

    #[inline]
    pub fn distance_squared(&self, other: &WorldPos) -> f32 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        dx * dx + dy * dy
    }

    #[inline]
    pub fn distance(&self, other: &WorldPos) -> f32 {
        self.distance_squared(other).sqrt()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ChunkCoord {
    pub x: i32,
    pub y: i32,
}

impl ChunkCoord {
    pub fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }

    pub fn to_key_string(&self) -> String {
        format!("{}_{}", self.x, self.y)
    }
}
