use crate::coord::ChunkCoord;
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq)]
pub struct GridDelta {
    pub to_unsubscribe: Vec<ChunkCoord>,
    pub to_subscribe: Vec<ChunkCoord>,
    pub retained: Vec<ChunkCoord>,
}

pub struct AreaOfInterest;

impl AreaOfInterest {
    /// Returns the 3x3 chunk grid surrounding the given center chunk.
    pub fn get_3x3_grid(center: ChunkCoord) -> Vec<ChunkCoord> {
        let mut chunks = Vec::with_capacity(9);
        for dy in -1..=1 {
            for dx in -1..=1 {
                chunks.push(ChunkCoord::new(center.x + dx, center.y + dy));
            }
        }
        chunks
    }

    /// Calculates grid diff when crossing a chunk boundary.
    /// Unsubscribes from the 3 trailing chunks and subscribes to the 3 new ones,
    /// minimizing Redis Pub/Sub operations.
    pub fn calculate_diff(old_center: ChunkCoord, new_center: ChunkCoord) -> GridDelta {
        if old_center == new_center {
            return GridDelta {
                to_unsubscribe: Vec::new(),
                to_subscribe: Vec::new(),
                retained: Self::get_3x3_grid(old_center),
            };
        }

        let old_grid: HashSet<ChunkCoord> = Self::get_3x3_grid(old_center).into_iter().collect();
        let new_grid: HashSet<ChunkCoord> = Self::get_3x3_grid(new_center).into_iter().collect();

        let to_unsubscribe: Vec<ChunkCoord> = old_grid.difference(&new_grid).copied().collect();
        let to_subscribe: Vec<ChunkCoord> = new_grid.difference(&old_grid).copied().collect();
        let retained: Vec<ChunkCoord> = old_grid.intersection(&new_grid).copied().collect();

        GridDelta {
            to_unsubscribe,
            to_subscribe,
            retained,
        }
    }
}
