use crate::coord::WorldPos;

pub struct AudioCuller {
    max_tracks: usize,
    hysteresis_max: usize,
}

impl AudioCuller {
    pub fn new(max_tracks: usize, hysteresis_max: usize) -> Self {
        Self {
            max_tracks,
            hysteresis_max,
        }
    }

    /// Selects up to `max_tracks` closest player candidates, maintaining tracks in the
    /// hysteresis window (e.g. between 50 and 60) to prevent rapid disconnect/reconnect jitter.
    pub fn cull_audio_tracks(
        &self,
        listener_pos: &WorldPos,
        currently_subscribed: &[u32],
        mut candidates: Vec<(u32, WorldPos)>,
    ) -> Vec<u32> {
        // Sort candidates by Euclidean distance to listener
        candidates.sort_by(|a, b| {
            let dist_a = listener_pos.distance_squared(&a.1);
            let dist_b = listener_pos.distance_squared(&b.1);
            dist_a
                .partial_cmp(&dist_b)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut selected = Vec::with_capacity(self.hysteresis_max);

        // Include top candidates up to max_tracks
        for (id, _) in candidates.iter().take(self.max_tracks) {
            selected.push(*id);
        }

        // Hysteresis buffer: retain existing tracks if they are within hysteresis_max
        for (id, _) in candidates
            .iter()
            .skip(self.max_tracks)
            .take(self.hysteresis_max - self.max_tracks)
        {
            if currently_subscribed.contains(id) {
                selected.push(*id);
            }
        }

        selected
    }
}
