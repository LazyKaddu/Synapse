use crate::world_noise::{HousePart, VillagePropType, WorldNoise};

pub const DEFAULT_TILE_SIZE: f64 = 64.0;
pub const DEFAULT_PLAYER_HALF_SIZE: f64 = 14.0;
pub const BASE_SPEED: f64 = 240.0;
pub const SPRINT_SPEED: f64 = 480.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AABB {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColliderType {
    Water,
    TreeTrunk,
    HouseWall,
    HouseRoof,
    PropWell,
    PropObstacle,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorldCollider {
    pub collider_type: ColliderType,
    pub label: String,
    pub tx: i32,
    pub ty: i32,
    pub aabb: AABB,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MovementResolution {
    pub new_x: f64,
    pub new_y: f64,
    pub x_blocked: bool,
    pub y_blocked: bool,
    pub collider: Option<WorldCollider>,
}

/// Returns true if two Axis-Aligned Bounding Boxes intersect.
/// Uses strict inequality on borders so touching edges do not register false collisions.
pub fn aabb_intersects(a: &AABB, b: &AABB) -> bool {
    a.min_x < b.max_x && a.max_x > b.min_x && a.min_y < b.max_y && a.max_y > b.min_y
}

pub struct CollisionEngine {
    pub world_noise: WorldNoise,
    pub tile_size: f64,
    pub player_half_size: f64,
    pub base_speed: f64,
    pub sprint_speed: f64,
}

impl CollisionEngine {
    pub fn new(world_noise: WorldNoise) -> Self {
        Self {
            world_noise,
            tile_size: DEFAULT_TILE_SIZE,
            player_half_size: DEFAULT_PLAYER_HALF_SIZE,
            base_speed: BASE_SPEED,
            sprint_speed: SPRINT_SPEED,
        }
    }

    pub fn get_colliders_in_area(&self, area: &AABB) -> Vec<WorldCollider> {
        let min_tx = (area.min_x / self.tile_size).floor() as i32;
        let max_tx = (area.max_x / self.tile_size).floor() as i32;
        let min_ty = (area.min_y / self.tile_size).floor() as i32;
        let max_ty = (area.max_y / self.tile_size).floor() as i32;

        let mut colliders = Vec::new();

        for tx in min_tx..=max_tx {
            for ty in min_ty..=max_ty {
                let tile_origin_x = (tx as f64) * self.tile_size;
                let tile_origin_y = (ty as f64) * self.tile_size;

                // 1. Water Body Check
                if self.world_noise.is_water_at(tx, ty) {
                    colliders.push(WorldCollider {
                        collider_type: ColliderType::Water,
                        label: "Water Basin".to_string(),
                        tx,
                        ty,
                        aabb: AABB {
                            min_x: tile_origin_x,
                            min_y: tile_origin_y,
                            max_x: tile_origin_x + self.tile_size,
                            max_y: tile_origin_y + self.tile_size,
                        },
                    });
                    continue;
                }

                // 2. Village Structure Check
                if let Some(village) = self.world_noise.get_village_at(tx, ty) {
                    if village.is_inside {
                        if let Some(info) = village.tile_info {
                            if let Some(house) = info.house {
                                match house.part {
                                    HousePart::Wall => {
                                        colliders.push(WorldCollider {
                                            collider_type: ColliderType::HouseWall,
                                            label: format!("House Wall ({})", house.house_name),
                                            tx,
                                            ty,
                                            aabb: AABB {
                                                min_x: tile_origin_x,
                                                min_y: tile_origin_y,
                                                max_x: tile_origin_x + self.tile_size,
                                                max_y: tile_origin_y + self.tile_size,
                                            },
                                        });
                                        continue;
                                    }
                                    HousePart::Roof => {
                                        colliders.push(WorldCollider {
                                            collider_type: ColliderType::HouseRoof,
                                            label: format!("House Roof ({})", house.house_name),
                                            tx,
                                            ty,
                                            aabb: AABB {
                                                min_x: tile_origin_x,
                                                min_y: tile_origin_y,
                                                max_x: tile_origin_x + self.tile_size,
                                                max_y: tile_origin_y + self.tile_size,
                                            },
                                        });
                                        continue;
                                    }
                                    HousePart::Door | HousePart::Interior => {}
                                }
                            }

                            if let Some(prop) = info.prop {
                                match prop.prop_type {
                                    VillagePropType::Well => {
                                        colliders.push(WorldCollider {
                                            collider_type: ColliderType::PropWell,
                                            label: "Town Well".to_string(),
                                            tx,
                                            ty,
                                            aabb: AABB {
                                                min_x: tile_origin_x + 8.0,
                                                min_y: tile_origin_y + 8.0,
                                                max_x: tile_origin_x + self.tile_size - 8.0,
                                                max_y: tile_origin_y + self.tile_size - 8.0,
                                            },
                                        });
                                        continue;
                                    }
                                    VillagePropType::Lantern => {
                                        colliders.push(WorldCollider {
                                            collider_type: ColliderType::PropObstacle,
                                            label: "Street Lantern".to_string(),
                                            tx,
                                            ty,
                                            aabb: AABB {
                                                min_x: tile_origin_x + 20.0,
                                                min_y: tile_origin_y + 20.0,
                                                max_x: tile_origin_x + self.tile_size - 20.0,
                                                max_y: tile_origin_y + self.tile_size - 20.0,
                                            },
                                        });
                                        continue;
                                    }
                                    _ => {
                                        colliders.push(WorldCollider {
                                            collider_type: ColliderType::PropObstacle,
                                            label: prop.label.to_string(),
                                            tx,
                                            ty,
                                            aabb: AABB {
                                                min_x: tile_origin_x + 12.0,
                                                min_y: tile_origin_y + 12.0,
                                                max_x: tile_origin_x + self.tile_size - 12.0,
                                                max_y: tile_origin_y + self.tile_size - 12.0,
                                            },
                                        });
                                        continue;
                                    }
                                }
                            }
                        }
                    }
                }

                // 3. Tree Trunk Anchor Check
                if let Some(tree) = self.world_noise.get_tree_at(tx, ty) {
                    colliders.push(WorldCollider {
                        collider_type: ColliderType::TreeTrunk,
                        label: format!("Tree Trunk [{}]", tree.maturity.as_str()),
                        tx,
                        ty,
                        aabb: AABB {
                            min_x: tile_origin_x + 16.0,
                            min_y: tile_origin_y + 16.0,
                            max_x: tile_origin_x + self.tile_size - 16.0,
                            max_y: tile_origin_y + self.tile_size - 16.0,
                        },
                    });
                }
            }
        }

        colliders
    }

    pub fn check_collision(&self, box_: &AABB) -> Option<WorldCollider> {
        let colliders = self.get_colliders_in_area(box_);
        for collider in colliders {
            if aabb_intersects(box_, &collider.aabb) {
                return Some(collider);
            }
        }
        None
    }

    #[allow(clippy::too_many_arguments)]
    pub fn resolve_movement(
        &self,
        current_x: f64,
        current_y: f64,
        dx: f64,
        dy: f64,
        speed: f64,
        dt: f64,
        half_width: f64,
        half_height: f64,
    ) -> MovementResolution {
        if dx == 0.0 && dy == 0.0 {
            return MovementResolution {
                new_x: current_x,
                new_y: current_y,
                x_blocked: false,
                y_blocked: false,
                collider: None,
            };
        }

        let mut resolved_x = current_x;
        let mut resolved_y = current_y;
        let mut x_blocked = false;
        let mut y_blocked = false;
        let mut blocking_collider: Option<WorldCollider> = None;

        // 1. Sweep along X axis
        if dx != 0.0 {
            let step_x = dx * speed * dt;
            let target_x = current_x + step_x;
            let box_x = AABB {
                min_x: target_x - half_width,
                min_y: current_y - half_height,
                max_x: target_x + half_width,
                max_y: current_y + half_height,
            };

            if let Some(hit_x) = self.check_collision(&box_x) {
                x_blocked = true;
                blocking_collider = Some(hit_x);
            } else {
                resolved_x = target_x;
            }
        }

        // 2. Sweep along Y axis starting from resolved_x
        if dy != 0.0 {
            let step_y = dy * speed * dt;
            let target_y = current_y + step_y;
            let box_y = AABB {
                min_x: resolved_x - half_width,
                min_y: target_y - half_height,
                max_x: resolved_x + half_width,
                max_y: target_y + half_height,
            };

            if let Some(hit_y) = self.check_collision(&box_y) {
                y_blocked = true;
                if blocking_collider.is_none() {
                    blocking_collider = Some(hit_y);
                }
            } else {
                resolved_y = target_y;
            }
        }

        MovementResolution {
            new_x: resolved_x,
            new_y: resolved_y,
            x_blocked,
            y_blocked,
            collider: blocking_collider,
        }
    }

    pub fn find_safe_spawn(
        &self,
        preferred_x: f64,
        preferred_y: f64,
        half_width: f64,
        half_height: f64,
    ) -> (f64, f64) {
        let initial_box = AABB {
            min_x: preferred_x - half_width,
            min_y: preferred_y - half_height,
            max_x: preferred_x + half_width,
            max_y: preferred_y + half_height,
        };

        if self.check_collision(&initial_box).is_none() {
            return (preferred_x, preferred_y);
        }

        let step = 32.0;
        let angles = [
            0.0,
            std::f64::consts::FRAC_PI_4,
            std::f64::consts::FRAC_PI_2,
            3.0 * std::f64::consts::FRAC_PI_4,
            std::f64::consts::PI,
            -3.0 * std::f64::consts::FRAC_PI_4,
            -std::f64::consts::FRAC_PI_2,
            -std::f64::consts::FRAC_PI_4,
        ];

        for r in 1..=20 {
            let dist = (r as f64) * step;
            for &angle in &angles {
                let test_x = preferred_x + angle.cos() * dist;
                let test_y = preferred_y + angle.sin() * dist;
                let test_box = AABB {
                    min_x: test_x - half_width,
                    min_y: test_y - half_height,
                    max_x: test_x + half_width,
                    max_y: test_y + half_height,
                };
                if self.check_collision(&test_box).is_none() {
                    return (test_x, test_y);
                }
            }
        }

        (preferred_x, preferred_y)
    }
}
