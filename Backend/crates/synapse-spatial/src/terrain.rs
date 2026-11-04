use noise::{NoiseFn, OpenSimplex};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BiomeType {
    DeepOcean,
    Ocean,
    Beach,
    Plains,
    Forest,
    Desert,
    Mountain,
    SnowPeak,
}

pub struct TerrainGenerator {
    noise: OpenSimplex,
    scale: f64,
}

impl TerrainGenerator {
    pub fn new(seed: u32, scale: f64) -> Self {
        Self {
            noise: OpenSimplex::new(seed),
            scale,
        }
    }

    /// Evaluates biome at world coordinates deterministically without transmitting map files.
    pub fn get_biome_at(&self, x: f64, y: f64) -> BiomeType {
        let elevation = self.noise.get([x * self.scale, y * self.scale]);

        if elevation < -0.4 {
            BiomeType::DeepOcean
        } else if elevation < -0.15 {
            BiomeType::Ocean
        } else if elevation < -0.05 {
            BiomeType::Beach
        } else if elevation < 0.25 {
            BiomeType::Plains
        } else if elevation < 0.55 {
            BiomeType::Forest
        } else if elevation < 0.75 {
            BiomeType::Desert
        } else if elevation < 0.90 {
            BiomeType::Mountain
        } else {
            BiomeType::SnowPeak
        }
    }
}
