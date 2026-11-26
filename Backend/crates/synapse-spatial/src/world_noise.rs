use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// 32-bit integer coordinate hash returning a deterministic float in `[0, 1)`.
/// Matches JS `hash2D` using `Math.imul` and unsigned 32-bit shifts.
pub fn hash_2d(x: i32, y: i32, seed: i32) -> f64 {
    let mut h: u32 = (seed as u32)
        ^ (x as u32).wrapping_mul(0x1656_67b1)
        ^ (y as u32).wrapping_mul(0x27d4_eb2f);
    h = (h ^ (h >> 13)).wrapping_mul(0x4f4d_29a1);
    h = (h ^ (h >> 16)).wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    (h as f64) / 4_294_967_296.0
}

/// 2D Value Noise with C2 quintic Hermite interpolation: `6t^5 - 15t^4 + 10t^3`.
pub fn value_noise_2d(x: f64, y: f64, seed: i32) -> f64 {
    let ix = x.floor();
    let iy = y.floor();

    let fx = x - ix;
    let fy = y - iy;

    let u = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
    let v = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);

    let ixi = ix as i32;
    let iyi = iy as i32;

    let n00 = hash_2d(ixi, iyi, seed);
    let n10 = hash_2d(ixi + 1, iyi, seed);
    let n01 = hash_2d(ixi, iyi + 1, seed);
    let n11 = hash_2d(ixi + 1, iyi + 1, seed);

    let nx0 = n00 * (1.0 - u) + n10 * u;
    let nx1 = n01 * (1.0 - u) + n11 * u;

    nx0 * (1.0 - v) + nx1 * v
}

/// Multi-octave Fractal Brownian Motion (fBm) using 2D Value Noise.
pub fn fbm_2d(
    x: f64,
    y: f64,
    seed: i32,
    octaves: u32,
    lacunarity: f64,
    persistence: f64,
) -> f64 {
    let mut total = 0.0;
    let mut frequency = 1.0;
    let mut amplitude = 1.0;
    let mut max_value = 0.0;

    for i in 0..octaves {
        let octave_seed = seed.wrapping_add((i as i32).wrapping_mul(1013));
        total += value_noise_2d(x * frequency, y * frequency, octave_seed) * amplitude;
        max_value += amplitude;
        frequency *= lacunarity;
        amplitude *= persistence;
    }

    if max_value > 0.0 {
        total / max_value
    } else {
        0.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VoronoiResult {
    pub d1: f64,
    pub d2: f64,
    pub cell_id: u32,
    pub center_col: i32,
    pub center_row: i32,
}

/// 2D Cellular / Voronoi noise evaluated over 3x3 neighbor grid cells.
pub fn voronoi_2d(x: f64, y: f64, seed: i32) -> VoronoiResult {
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;

    let mut d1 = f64::INFINITY;
    let mut d2 = f64::INFINITY;
    let mut center_col = 0;
    let mut center_row = 0;

    let py_seed = seed ^ (0x9e37_79b9_u32 as i32);

    for ox in -1..=1 {
        for oy in -1..=1 {
            let cx = ix + ox;
            let cy = iy + oy;

            let px = (cx as f64) + hash_2d(cx, cy, seed);
            let py = (cy as f64) + hash_2d(cx, cy, py_seed);

            let dx = x - px;
            let dy = y - py;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist < d1 {
                d2 = d1;
                d1 = dist;
                center_col = cx;
                center_row = cy;
            } else if dist < d2 {
                d2 = dist;
            }
        }
    }

    let mut h: u32 = (seed as u32)
        ^ (center_col as u32).wrapping_mul(0x1656_67b1)
        ^ (center_row as u32).wrapping_mul(0x27d4_eb2f);
    h = (h ^ (h >> 13)).wrapping_mul(0x4f4d_29a1);
    h = (h ^ (h >> 16)).wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;

    VoronoiResult {
        d1,
        d2,
        cell_id: h,
        center_col,
        center_row,
    }
}

fn derive_sub_seed(master_seed: i32, stream_tag: i32) -> i32 {
    let mut h: u32 = (master_seed as u32) ^ (stream_tag as u32).wrapping_mul(0x9e37_79b9);
    h = (h ^ (h >> 16)).wrapping_mul(0x85eb_ca6b);
    h = (h ^ (h >> 13)).wrapping_mul(0xc2b2_ae35);
    (h ^ (h >> 16)) as i32
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForestZoneType {
    Core,
    Interior,
    Clearing,
    Edge,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreeMaturity {
    Large,
    Medium,
    Small,
    Bush,
}

impl TreeMaturity {
    pub fn as_str(&self) -> &'static str {
        match self {
            TreeMaturity::Large => "LARGE",
            TreeMaturity::Medium => "MEDIUM",
            TreeMaturity::Small => "SMALL",
            TreeMaturity::Bush => "BUSH",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TreePlacement {
    pub x: i32,
    pub y: i32,
    pub variant: i32,
    pub density: f64,
    pub maturity: TreeMaturity,
    pub canopy_radius: i32,
}

struct ForestSpreadGenerator {
    macro_scale: f64,
    grove_scale: f64,
    glade_scale: f64,
    core_threshold: f64,
    interior_threshold: f64,
    edge_threshold: f64,
    glade_threshold: f64,
    tree_min_spacing: f64,
    macro_seed: i32,
    grove_seed: i32,
    glade_seed: i32,
    scatter_seed: i32,
    maturity_seed: i32,
}

impl ForestSpreadGenerator {
    fn new(seed: i32, macro_scale: f64, edge_threshold: f64, tree_min_spacing: f64) -> Self {
        Self {
            macro_scale,
            grove_scale: 0.055,
            glade_scale: 0.038,
            core_threshold: 0.70,
            interior_threshold: 0.58,
            edge_threshold,
            glade_threshold: 0.30,
            tree_min_spacing,
            macro_seed: derive_sub_seed(seed, 0x5a01),
            grove_seed: derive_sub_seed(seed, 0x5a02),
            glade_seed: derive_sub_seed(seed, 0x5a03),
            scatter_seed: derive_sub_seed(seed, 0x5a04),
            maturity_seed: derive_sub_seed(seed, 0x5a05),
        }
    }

    fn get_effective_density(&self, tx: i32, ty: i32) -> f64 {
        let fx = tx as f64;
        let fy = ty as f64;
        let macro_val = fbm_2d(
            fx * self.macro_scale,
            fy * self.macro_scale,
            self.macro_seed,
            3,
            2.0,
            0.5,
        )
        .clamp(0.0, 1.0);
        let grove_val = fbm_2d(
            fx * self.grove_scale,
            fy * self.grove_scale,
            self.grove_seed,
            3,
            2.0,
            0.5,
        )
        .clamp(0.0, 1.0);
        (macro_val * 0.70 + grove_val * 0.30).clamp(0.0, 1.0)
    }

    fn get_zone_at(&self, tx: i32, ty: i32) -> ForestZoneType {
        let density = self.get_effective_density(tx, ty);
        if density < self.edge_threshold {
            return ForestZoneType::None;
        }

        let glade = fbm_2d(
            (tx as f64) * self.glade_scale,
            (ty as f64) * self.glade_scale,
            self.glade_seed,
            3,
            2.0,
            0.5,
        )
        .clamp(0.0, 1.0);

        if glade < self.glade_threshold && density >= self.interior_threshold {
            return ForestZoneType::Clearing;
        }
        if density >= self.core_threshold {
            return ForestZoneType::Core;
        }
        if density >= self.interior_threshold {
            return ForestZoneType::Interior;
        }
        ForestZoneType::Edge
    }

    fn spawn_prob(zone: ForestZoneType) -> f64 {
        match zone {
            ForestZoneType::Core => 0.95,
            ForestZoneType::Interior => 0.70,
            _ => 0.35,
        }
    }

    fn get_tree_at(&self, tx: i32, ty: i32) -> Option<TreePlacement> {
        let cell_size = (self.tree_min_spacing.ceil() as i32).max(2);
        let cell_x = (tx as f64 / cell_size as f64).floor() as i32;
        let cell_y = (ty as f64 / cell_size as f64).floor() as i32;

        let jx = (hash_2d(cell_x, cell_y, self.scatter_seed.wrapping_add(1)) * cell_size as f64)
            .floor() as i32;
        let jy = (hash_2d(cell_x, cell_y, self.scatter_seed.wrapping_add(2)) * cell_size as f64)
            .floor() as i32;
        let cand_x = cell_x * cell_size + jx;
        let cand_y = cell_y * cell_size + jy;

        if cand_x != tx || cand_y != ty {
            return None;
        }

        let zone = self.get_zone_at(tx, ty);
        if zone == ForestZoneType::None || zone == ForestZoneType::Clearing {
            return None;
        }

        let spawn_prob = Self::spawn_prob(zone);
        let cell_hash = hash_2d(cell_x, cell_y, self.scatter_seed);
        if cell_hash > spawn_prob {
            return None;
        }

        let my_score = hash_2d(cell_x, cell_y, self.scatter_seed.wrapping_add(3));
        for ox in -1..=1 {
            for oy in -1..=1 {
                if ox == 0 && oy == 0 {
                    continue;
                }
                let nx = cell_x + ox;
                let ny = cell_y + oy;

                let njx = (hash_2d(nx, ny, self.scatter_seed.wrapping_add(1)) * cell_size as f64)
                    .floor() as i32;
                let njy = (hash_2d(nx, ny, self.scatter_seed.wrapping_add(2)) * cell_size as f64)
                    .floor() as i32;
                let n_cand_x = nx * cell_size + njx;
                let n_cand_y = ny * cell_size + njy;

                let dist = ((cand_x - n_cand_x) as f64).hypot((cand_y - n_cand_y) as f64);
                if dist < self.tree_min_spacing {
                    let n_zone = self.get_zone_at(n_cand_x, n_cand_y);
                    if n_zone != ForestZoneType::None && n_zone != ForestZoneType::Clearing {
                        let n_spawn_prob = Self::spawn_prob(n_zone);
                        let n_hash = hash_2d(nx, ny, self.scatter_seed);
                        if n_hash <= n_spawn_prob {
                            let n_score = hash_2d(nx, ny, self.scatter_seed.wrapping_add(3));
                            if n_score > my_score
                                || (n_score == my_score
                                    && (nx > cell_x || (nx == cell_x && ny > cell_y)))
                            {
                                return None;
                            }
                        }
                    }
                }
            }
        }

        let maturity_hash = hash_2d(tx, ty, self.maturity_seed);
        let (maturity, canopy_radius) = match zone {
            ForestZoneType::Core => {
                if maturity_hash < 0.65 {
                    (TreeMaturity::Large, 2)
                } else {
                    (TreeMaturity::Medium, 1)
                }
            }
            ForestZoneType::Interior => {
                if maturity_hash < 0.30 {
                    (TreeMaturity::Large, 2)
                } else if maturity_hash < 0.85 {
                    (TreeMaturity::Medium, 1)
                } else {
                    (TreeMaturity::Small, 0)
                }
            }
            _ => {
                if maturity_hash < 0.40 {
                    (TreeMaturity::Medium, 1)
                } else if maturity_hash < 0.80 {
                    (TreeMaturity::Small, 0)
                } else {
                    (TreeMaturity::Bush, 0)
                }
            }
        };

        let variant =
            (hash_2d(tx, ty, self.maturity_seed.wrapping_add(10)) * 3.0).floor() as i32;
        let density = self.get_effective_density(tx, ty);

        Some(TreePlacement {
            x: tx,
            y: ty,
            variant,
            density,
            maturity,
            canopy_radius,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildingModelId {
    ManorGrand,
    CottageRed,
    CottageBlue,
    OutpostSmall,
    Watchtower,
}

#[derive(Debug, Clone, Copy)]
struct BuildingModelDef {
    id: BuildingModelId,
    name: &'static str,
    width: i32,
    height: i32,
    door_x: i32,
    door_y: i32,
}

const MANOR_GRAND: BuildingModelDef = BuildingModelDef {
    id: BuildingModelId::ManorGrand,
    name: "Grand Town Manor",
    width: 8,
    height: 6,
    door_x: 4,
    door_y: 5,
};
const COTTAGE_RED: BuildingModelDef = BuildingModelDef {
    id: BuildingModelId::CottageRed,
    name: "Red Shingle Cottage",
    width: 6,
    height: 4,
    door_x: 3,
    door_y: 3,
};
const COTTAGE_BLUE: BuildingModelDef = BuildingModelDef {
    id: BuildingModelId::CottageBlue,
    name: "Blue Slate Cottage",
    width: 6,
    height: 4,
    door_x: 3,
    door_y: 3,
};
const OUTPOST_SMALL: BuildingModelDef = BuildingModelDef {
    id: BuildingModelId::OutpostSmall,
    name: "Small Shop Outpost",
    width: 4,
    height: 4,
    door_x: 2,
    door_y: 3,
};
const WATCHTOWER: BuildingModelDef = BuildingModelDef {
    id: BuildingModelId::Watchtower,
    name: "Perimeter Watchtower",
    width: 2,
    height: 7,
    door_x: 1,
    door_y: 6,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HousePart {
    Roof,
    Wall,
    Door,
    Interior,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VillagePropType {
    Well,
    Lantern,
    Bench,
    CrateStack,
    NoticeBoard,
}

#[derive(Debug, Clone)]
pub struct VillageProp {
    pub x: i32,
    pub y: i32,
    pub prop_type: VillagePropType,
    pub label: &'static str,
}

#[derive(Debug, Clone)]
pub struct HouseTileEntry {
    pub house_name: &'static str,
    pub part: HousePart,
}

#[derive(Debug, Clone)]
pub struct VillageTileInfo {
    pub house: Option<HouseTileEntry>,
    pub prop: Option<VillageProp>,
    pub is_walkable: bool,
}

#[derive(Debug, Clone)]
pub struct VillageInfo {
    pub cell_id: u32,
    pub center_col: i32,
    pub center_row: i32,
    pub plaza_x: i32,
    pub plaza_y: i32,
    pub distance_to_center: f64,
    pub is_inside: bool,
    pub tile_info: Option<VillageTileInfo>,
}

struct PlacedHouseRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

struct VillageLayout {
    pavement_tiles: HashSet<(i32, i32)>,
    house_tile_map: HashMap<(i32, i32), HouseTileEntry>,
    prop_tile_map: HashMap<(i32, i32), VillageProp>,
    yard_tiles: HashSet<(i32, i32)>,
}

struct VillageGenerator {
    village_seed: i32,
    village_radius: i32,
    plaza_radius: i32,
    house_min_spacing: i32,
    cache: Mutex<HashMap<(i32, i32, u32), std::sync::Arc<VillageLayout>>>,
}

impl VillageGenerator {
    fn new(seed: i32, village_radius: i32, plaza_radius: i32) -> Self {
        Self {
            village_seed: derive_sub_seed(seed, 0x7a01),
            village_radius,
            plaza_radius,
            house_min_spacing: 2,
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn get_layout(
        &self,
        cell_id: u32,
        center_col: i32,
        center_row: i32,
        plaza_x: i32,
        plaza_y: i32,
    ) -> std::sync::Arc<VillageLayout> {
        let key = (center_col, center_row, cell_id);
        {
            let cache = self.cache.lock().unwrap();
            if let Some(layout) = cache.get(&key) {
                return layout.clone();
            }
        }

        let layout = std::sync::Arc::new(self.build_village_layout(
            cell_id,
            center_col,
            center_row,
            plaza_x,
            plaza_y,
        ));
        let mut cache = self.cache.lock().unwrap();
        if cache.len() >= 16 {
            if let Some(first_key) = cache.keys().next().cloned() {
                cache.remove(&first_key);
            }
        }
        cache.insert(key, layout.clone());
        layout
    }

    fn build_village_layout(
        &self,
        cell_id: u32,
        center_col: i32,
        center_row: i32,
        plaza_x: i32,
        plaza_y: i32,
    ) -> VillageLayout {
        let tag = center_col.wrapping_mul(73856093)
            ^ center_row.wrapping_mul(19349663)
            ^ (cell_id as i32);
        let local_seed = derive_sub_seed(self.village_seed, tag);

        let radius = self.village_radius;
        let plaza_r = self.plaza_radius;

        let mut pavement_tiles = HashSet::new();
        let mut house_tile_map = HashMap::new();
        let mut prop_tile_map = HashMap::new();
        let mut yard_tiles = HashSet::new();
        let mut placed_houses: Vec<PlacedHouseRect> = Vec::new();

        // 1. Central Town Square Plaza
        for dx in -plaza_r..=plaza_r {
            for dy in -plaza_r..=plaza_r {
                if dx.abs() == plaza_r && dy.abs() == plaza_r {
                    continue;
                }
                pavement_tiles.insert((plaza_x + dx, plaza_y + dy));
            }
        }

        // 2. Central Well & Plaza Accents
        prop_tile_map.insert(
            (plaza_x, plaza_y),
            VillageProp {
                x: plaza_x,
                y: plaza_y,
                prop_type: VillagePropType::Well,
                label: "Town Well",
            },
        );

        let plaza_accents = [
            (0, -(plaza_r - 1), VillagePropType::NoticeBoard, "Town Notice Board"),
            (-(plaza_r - 1), 0, VillagePropType::Bench, "Plaza Bench"),
            (plaza_r - 1, 0, VillagePropType::Bench, "Plaza Bench"),
        ];
        for (dx, dy, prop_type, label) in plaza_accents {
            let ax = plaza_x + dx;
            let ay = plaza_y + dy;
            prop_tile_map.insert(
                (ax, ay),
                VillageProp {
                    x: ax,
                    y: ay,
                    prop_type,
                    label,
                },
            );
        }

        // 3. Organic Branching Street Corridors
        let branch_configs = [
            (0, -1, radius - 3),
            (0, 1, radius - 3),
            (1, 0, radius - 3),
            (-1, 0, radius - 3),
        ];
        let mut road_tiles_list: Vec<(i32, i32)> = Vec::new();

        for (b_idx, &(bdx, bdy, length)) in branch_configs.iter().enumerate() {
            let mut cur_x = plaza_x + bdx * plaza_r;
            let mut cur_y = plaza_y + bdy * plaza_r;

            for step in 0..length {
                if bdx == 0 {
                    pavement_tiles.insert((cur_x, cur_y));
                    pavement_tiles.insert((cur_x + 1, cur_y));
                    road_tiles_list.push((cur_x, cur_y));
                    road_tiles_list.push((cur_x + 1, cur_y));
                } else {
                    pavement_tiles.insert((cur_x, cur_y));
                    pavement_tiles.insert((cur_x, cur_y + 1));
                    road_tiles_list.push((cur_x, cur_y));
                    road_tiles_list.push((cur_x, cur_y + 1));
                }

                let meander_hash = hash_2d(
                    cur_x,
                    cur_y,
                    local_seed.wrapping_add((b_idx as i32) * 50 + step),
                );
                if step > 4 && step % 6 == 0 {
                    if bdx == 0 {
                        cur_x += if meander_hash > 0.5 { 1 } else { -1 };
                    } else {
                        cur_y += if meander_hash > 0.5 { 1 } else { -1 };
                    }
                }

                cur_x += bdx;
                cur_y += bdy;

                if step > 0 && step % 7 == 0 {
                    let lx = if bdx == 0 { cur_x + 2 } else { cur_x };
                    let ly = if bdx == 0 { cur_y } else { cur_y + 2 };
                    prop_tile_map.insert(
                        (lx, ly),
                        VillageProp {
                            x: lx,
                            y: ly,
                            prop_type: VillagePropType::Lantern,
                            label: "Street Lantern",
                        },
                    );
                }
            }
        }

        // 4. Hierarchical House Lot Allocation
        let planned_buildings = [
            MANOR_GRAND,
            COTTAGE_RED,
            COTTAGE_BLUE,
            COTTAGE_RED,
            COTTAGE_BLUE,
            OUTPOST_SMALL,
            WATCHTOWER,
        ];
        let quadrant_offsets = [(1.0, -1.0), (1.0, 1.0), (-1.0, 1.0), (-1.0, -1.0)];

        for (i, model) in planned_buildings.iter().enumerate() {
            let mut placed = false;

            for attempt in 0..24 {
                if placed {
                    break;
                }
                let q_idx = (i + attempt) % 4;
                let (qx, qy) = quadrant_offsets[q_idx];

                let base_r = match model.id {
                    BuildingModelId::ManorGrand => 6.5,
                    BuildingModelId::Watchtower => (radius - 6) as f64,
                    _ => (8 + (attempt % 3) * 4) as f64,
                };

                let jitter_x = (hash_2d(
                    center_col + i as i32,
                    center_row + attempt as i32,
                    local_seed.wrapping_add(100),
                ) * 4.0)
                    .floor() as i32
                    - 2;
                let jitter_y = (hash_2d(
                    center_col + attempt as i32,
                    center_row + i as i32,
                    local_seed.wrapping_add(200),
                ) * 4.0)
                    .floor() as i32
                    - 2;

                let cand_x = (plaza_x as f64 + qx * base_r + jitter_x as f64 - model.width as f64 / 2.0)
                    .floor() as i32;
                let cand_y = (plaza_y as f64 + qy * base_r + jitter_y as f64 - model.height as f64 / 2.0)
                    .floor() as i32;

                let center_dist = ((cand_x as f64 + model.width as f64 / 2.0) - plaza_x as f64)
                    .hypot((cand_y as f64 + model.height as f64 / 2.0) - plaza_y as f64);
                if center_dist > (radius - 2) as f64 {
                    continue;
                }

                // canPlaceHouse
                if center_dist < (plaza_r as f64) + 2.5 {
                    continue;
                }
                let margin = self.house_min_spacing;
                let mut overlaps = false;
                for h in &placed_houses {
                    if cand_x < h.x + h.width + margin
                        && cand_x + model.width + margin > h.x
                        && cand_y < h.y + h.height + margin
                        && cand_y + model.height + margin > h.y
                    {
                        overlaps = true;
                        break;
                    }
                }
                if overlaps {
                    continue;
                }
                for x in cand_x..(cand_x + model.width) {
                    for y in cand_y..(cand_y + model.height) {
                        if pavement_tiles.contains(&(x, y)) {
                            overlaps = true;
                            break;
                        }
                    }
                    if overlaps {
                        break;
                    }
                }
                if overlaps {
                    continue;
                }

                // Place house
                let door_x = cand_x + model.door_x;
                let door_y = cand_y + model.door_y;
                placed_houses.push(PlacedHouseRect {
                    x: cand_x,
                    y: cand_y,
                    width: model.width,
                    height: model.height,
                });
                placed = true;

                let roof_cutoff = ((model.height as f64) * 0.6).floor().max(1.0) as i32;
                for hx in 0..model.width {
                    for hy in 0..model.height {
                        let tx = cand_x + hx;
                        let ty = cand_y + hy;
                        let part = if tx == door_x && ty == door_y {
                            HousePart::Door
                        } else if hy < roof_cutoff {
                            HousePart::Roof
                        } else if hx == 0 || hx == model.width - 1 || hy == model.height - 1 {
                            HousePart::Wall
                        } else {
                            HousePart::Interior
                        };
                        house_tile_map.insert(
                            (tx, ty),
                            HouseTileEntry {
                                house_name: model.name,
                                part,
                            },
                        );
                    }
                }

                // Door walkway to closest road tile
                let mut closest_road: Option<(i32, i32)> = None;
                let mut min_road_dist = f64::INFINITY;
                for &(rx, ry) in &road_tiles_list {
                    let d = ((door_x - rx) as f64).hypot((door_y - ry) as f64);
                    if d < min_road_dist {
                        min_road_dist = d;
                        closest_road = Some((rx, ry));
                    }
                }
                if let Some((rx, ry)) = closest_road {
                    let mut wx = door_x;
                    let mut wy = door_y + 1;
                    while wx != rx || wy != ry {
                        pavement_tiles.insert((wx, wy));
                        if wx < rx {
                            wx += 1;
                        } else if wx > rx {
                            wx -= 1;
                        } else if wy < ry {
                            wy += 1;
                        } else if wy > ry {
                            wy -= 1;
                        }
                    }
                    pavement_tiles.insert((wx, wy));
                }

                // Side crate prop
                let side_x = cand_x - 1;
                let side_y = cand_y + model.height - 1;
                if !pavement_tiles.contains(&(side_x, side_y))
                    && !prop_tile_map.contains_key(&(side_x, side_y))
                {
                    prop_tile_map.insert(
                        (side_x, side_y),
                        VillageProp {
                            x: side_x,
                            y: side_y,
                            prop_type: VillagePropType::CrateStack,
                            label: "Wood Crates",
                        },
                    );
                }

                // Backyard garden yard
                let yard_start_x = cand_x;
                let yard_start_y = cand_y - 2;
                for yx in 0..model.width.min(3) {
                    for yy in 0..2 {
                        let ytx = yard_start_x + yx;
                        let yty = yard_start_y + yy;
                        let yk = (ytx, yty);
                        if !pavement_tiles.contains(&yk)
                            && !house_tile_map.contains_key(&yk)
                            && !prop_tile_map.contains_key(&yk)
                        {
                            yard_tiles.insert(yk);
                        }
                    }
                }
            }
        }

        VillageLayout {
            pavement_tiles,
            house_tile_map,
            prop_tile_map,
            yard_tiles,
        }
    }

    fn get_village_tile_at(
        &self,
        tx: i32,
        ty: i32,
        cell_id: u32,
        center_col: i32,
        center_row: i32,
        plaza_x: i32,
        plaza_y: i32,
    ) -> VillageTileInfo {
        let dist_to_plaza = ((tx - plaza_x) as f64).hypot((ty - plaza_y) as f64);
        if dist_to_plaza > self.village_radius as f64 {
            return VillageTileInfo {
                house: None,
                prop: None,
                is_walkable: true,
            };
        }

        let layout = self.get_layout(cell_id, center_col, center_row, plaza_x, plaza_y);
        let key = (tx, ty);

        if let Some(entry) = layout.house_tile_map.get(&key) {
            return VillageTileInfo {
                house: Some(entry.clone()),
                prop: None,
                is_walkable: entry.part == HousePart::Door || entry.part == HousePart::Interior,
            };
        }

        if let Some(prop) = layout.prop_tile_map.get(&key) {
            return VillageTileInfo {
                house: None,
                prop: Some(prop.clone()),
                is_walkable: false,
            };
        }

        VillageTileInfo {
            house: None,
            prop: None,
            is_walkable: true,
        }
    }

    fn is_structural_at(
        &self,
        tx: i32,
        ty: i32,
        cell_id: u32,
        center_col: i32,
        center_row: i32,
        plaza_x: i32,
        plaza_y: i32,
    ) -> bool {
        let dist_to_plaza = ((tx - plaza_x) as f64).hypot((ty - plaza_y) as f64);
        if dist_to_plaza > self.village_radius as f64 {
            return false;
        }
        let layout = self.get_layout(cell_id, center_col, center_row, plaza_x, plaza_y);
        let key = (tx, ty);
        layout.house_tile_map.contains_key(&key)
            || layout.pavement_tiles.contains(&key)
            || layout.prop_tile_map.contains_key(&key)
            || layout.yard_tiles.contains(&key)
    }
}

pub struct WorldNoise {
    pub seed: i32,
    continentalness_scale: f64,
    village_cell_size: f64,
    water_threshold: f64,
    village_rarity: f64,
    village_radius: f64,
    continentalness_seed: i32,
    village_voronoi_seed: i32,
    forest_spread: ForestSpreadGenerator,
    village_gen: VillageGenerator,
}

impl WorldNoise {
    pub fn new(seed: i32) -> Self {
        let village_radius: f64 = 24.0;
        let forest_density_scale = 0.03;
        let forest_threshold = 0.52;
        let tree_min_spacing = 2.0;
        let plaza_radius = (village_radius * 0.25).floor().max(2.0) as i32;

        Self {
            seed,
            continentalness_scale: 0.01,
            village_cell_size: 64.0,
            water_threshold: 0.35,
            village_rarity: 0.5,
            village_radius,
            continentalness_seed: derive_sub_seed(seed, 0x1011),
            village_voronoi_seed: derive_sub_seed(seed, 0x7077),
            forest_spread: ForestSpreadGenerator::new(
                seed,
                forest_density_scale,
                forest_threshold,
                tree_min_spacing,
            ),
            village_gen: VillageGenerator::new(seed, village_radius as i32, plaza_radius),
        }
    }

    pub fn sample_continentalness(&self, x: f64, y: f64) -> f64 {
        fbm_2d(
            x * self.continentalness_scale,
            y * self.continentalness_scale,
            self.continentalness_seed,
            4,
            2.0,
            0.5,
        )
        .clamp(0.0, 1.0)
    }

    pub fn is_water_at(&self, tx: i32, ty: i32) -> bool {
        self.sample_continentalness(tx as f64, ty as f64) < self.water_threshold
    }

    pub fn get_tree_at(&self, tx: i32, ty: i32) -> Option<TreePlacement> {
        if self.is_water_at(tx, ty) {
            return None;
        }

        if let Some(village) = self.get_village_at(tx, ty) {
            if village.is_inside
                && self.village_gen.is_structural_at(
                    tx,
                    ty,
                    village.cell_id,
                    village.center_col,
                    village.center_row,
                    village.plaza_x,
                    village.plaza_y,
                )
            {
                return None;
            }
        }

        self.forest_spread.get_tree_at(tx, ty)
    }

    pub fn get_village_at(&self, tx: i32, ty: i32) -> Option<VillageInfo> {
        let cell_size = self.village_cell_size;
        let voronoi = voronoi_2d(
            (tx as f64) / cell_size,
            (ty as f64) / cell_size,
            self.village_voronoi_seed,
        );

        let spawn_hash = hash_2d(
            voronoi.center_col,
            voronoi.center_row,
            self.village_voronoi_seed.wrapping_add(101),
        );
        if spawn_hash >= self.village_rarity {
            return None;
        }

        let plaza_x = (((voronoi.center_col as f64)
            + hash_2d(
                voronoi.center_col,
                voronoi.center_row,
                self.village_voronoi_seed,
            ))
            * cell_size)
            .floor() as i32;
        let plaza_y = (((voronoi.center_row as f64)
            + hash_2d(
                voronoi.center_col,
                voronoi.center_row,
                self.village_voronoi_seed ^ (0x9e37_79b9_u32 as i32),
            ))
            * cell_size)
            .floor() as i32;

        let distance_to_center = ((tx - plaza_x) as f64).hypot((ty - plaza_y) as f64);
        let is_inside = distance_to_center <= self.village_radius;

        let tile_info = if is_inside {
            Some(self.village_gen.get_village_tile_at(
                tx,
                ty,
                voronoi.cell_id,
                voronoi.center_col,
                voronoi.center_row,
                plaza_x,
                plaza_y,
            ))
        } else {
            None
        };

        Some(VillageInfo {
            cell_id: voronoi.cell_id,
            center_col: voronoi.center_col,
            center_row: voronoi.center_row,
            plaza_x,
            plaza_y,
            distance_to_center,
            is_inside,
            tile_info,
        })
    }
}
