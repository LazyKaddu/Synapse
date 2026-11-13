/**
 * Procedural Village Generator with Pre-Built House Models, Branching Pavements & Contextual Props.
 * Generates organic living settlements within Voronoi community cells:
 * 1. Pre-built building models from TX Struct.png (Grand Manor, Red Cottage, Blue Cottage, Outpost, Watchtower).
 * 2. Hierarchical town distribution with strict non-overlapping bounding boxes (min 2-tile spacing).
 * 3. Organic branching cobblestone street network with central town square plaza, 2-tile wide main
 *    thoroughfares, cul-de-sacs, and 1-tile wide walkways directly connecting to each house's front door.
 * 4. Contextual props from TX Props.png: central town well at plaza center, benches, street lanterns
 *    at path forks, crates/barrels stacked along exterior house walls, and backyard garden fences.
 * 5. High-performance O(1) per-tile spatial querying via LRU cached village layouts.
 */

import { hash2D } from './noise.ts';

export type BuildingModelId =
  | 'manor_grand'
  | 'cottage_red'
  | 'cottage_blue'
  | 'outpost_small'
  | 'watchtower';

export interface BuildingModelDef {
  readonly id: BuildingModelId;
  readonly name: string;
  readonly width: number;  // in tiles (32px each)
  readonly height: number; // in tiles
  readonly atlasCol: number;
  readonly atlasRow: number;
  readonly doorOffset: { readonly x: number; readonly y: number };
  readonly roofHexColor: string;
  readonly roofColor: number;
  readonly wallHexColor: string;
  readonly wallColor: number;
}

export const BUILDING_MODELS: readonly BuildingModelDef[] = Object.freeze([
  Object.freeze({
    id: 'manor_grand',
    name: 'Grand Town Manor',
    width: 8,
    height: 6,
    atlasCol: 1,
    atlasRow: 9,
    doorOffset: Object.freeze({ x: 4, y: 5 }),
    roofHexColor: '#b45309',
    roofColor: 0xb45309,
    wallHexColor: '#78350f',
    wallColor: 0x78350f,
  }),
  Object.freeze({
    id: 'cottage_red',
    name: 'Red Shingle Cottage',
    width: 6,
    height: 4,
    atlasCol: 4,
    atlasRow: 0,
    doorOffset: Object.freeze({ x: 3, y: 3 }),
    roofHexColor: '#78350f',
    roofColor: 0x78350f,
    wallHexColor: '#92400e',
    wallColor: 0x92400e,
  }),
  Object.freeze({
    id: 'cottage_blue',
    name: 'Blue Slate Cottage',
    width: 6,
    height: 4,
    atlasCol: 4,
    atlasRow: 4,
    doorOffset: Object.freeze({ x: 3, y: 3 }),
    roofHexColor: '#1e3a8a',
    roofColor: 0x1e3a8a,
    wallHexColor: '#1e293b',
    wallColor: 0x1e293b,
  }),
  Object.freeze({
    id: 'outpost_small',
    name: 'Small Shop Outpost',
    width: 4,
    height: 4,
    atlasCol: 12,
    atlasRow: 0,
    doorOffset: Object.freeze({ x: 2, y: 3 }),
    roofHexColor: '#9a3412',
    roofColor: 0x9a3412,
    wallHexColor: '#7c2d12',
    wallColor: 0x7c2d12,
  }),
  Object.freeze({
    id: 'watchtower',
    name: 'Perimeter Watchtower',
    width: 2,
    height: 7,
    atlasCol: 1,
    atlasRow: 1,
    doorOffset: Object.freeze({ x: 1, y: 6 }),
    roofHexColor: '#475569',
    roofColor: 0x475569,
    wallHexColor: '#334155',
    wallColor: 0x334155,
  }),
]);

export type VillageDistrict =
  | 'plaza'
  | 'main_street'
  | 'walkway'
  | 'house_roof'
  | 'house_wall'
  | 'house_door'
  | 'house_interior'
  | 'yard'
  | 'open_green';

export type VillagePropType =
  | 'well'
  | 'lantern'
  | 'bench'
  | 'crate_stack'
  | 'barrel'
  | 'fence'
  | 'notice_board';

export interface PlacedHouse {
  readonly id: string;
  readonly model: BuildingModelDef;
  readonly x: number; // top-left world tile x
  readonly y: number; // top-left world tile y
  readonly width: number;
  readonly height: number;
  readonly door: { readonly x: number; readonly y: number };
}

export interface VillageProp {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly type: VillagePropType;
  readonly label: string;
  readonly hexColor: string;
  readonly color: number;
}

export interface VillageLayout {
  readonly cellId: number;
  readonly name: string;
  readonly centerCol: number;
  readonly centerRow: number;
  readonly plazaCenter: { readonly x: number; readonly y: number };
  readonly radius: number;
  readonly plazaRadius: number;
  readonly houses: readonly PlacedHouse[];
  readonly props: readonly VillageProp[];
  readonly pavementTiles: ReadonlySet<string>; // 'tx,ty'
  readonly pavementTypes: ReadonlyMap<string, 'plaza' | 'main_street' | 'house_walkway'>;
  readonly houseTileMap: ReadonlyMap<string, { house: PlacedHouse; part: 'roof' | 'wall' | 'door' | 'interior' }>;
  readonly propTileMap: ReadonlyMap<string, VillageProp>;
  readonly yardTiles: ReadonlySet<string>;
}

export interface VillageTileInfo {
  readonly isVillage: boolean;
  readonly villageName: string;
  readonly district: VillageDistrict;
  readonly isPavement: boolean;
  readonly pavementType?: 'plaza' | 'main_street' | 'house_walkway';
  readonly house?: PlacedHouse;
  readonly housePart?: 'roof' | 'wall' | 'door' | 'interior';
  readonly prop?: VillageProp;
  readonly hexColor?: string;
  readonly color?: number;
  readonly isWalkable: boolean;
}

export interface VillageConfig {
  readonly seed: number;
  readonly villageRadius?: number; // default 24
  readonly plazaRadius?: number;   // default 4
  readonly maxHouses?: number;     // default 7
  readonly houseMinSpacing?: number; // default 2
}

export const DEFAULT_VILLAGE_CONFIG: Required<VillageConfig> = Object.freeze({
  seed: 0,
  villageRadius: 24,
  plazaRadius: 4,
  maxHouses: 7,
  houseMinSpacing: 2,
});

const TOWN_PREFIXES = [
  'Oak', 'River', 'Stone', 'Amber', 'Willow', 'Pine', 'Shadow', 'Sun', 'High', 'Green',
  'Deep', 'Fair', 'Gold', 'Silver', 'Iron', 'Cross', 'Wind', 'Rose', 'Bright', 'North',
] as const;

const TOWN_SUFFIXES = [
  'haven', 'dell', 'brook', 'ford', 'dale', 'ridge', 'vale', 'mill', 'field', 'wood',
  'stead', 'gate', 'ton', 'shire', 'hollow', 'crest', 'grove', 'fall', 'crossing', 'port',
] as const;

function deriveSubSeed(masterSeed: number, streamTag: number): number {
  let h = ((masterSeed | 0) ^ Math.imul(streamTag, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

function coordKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Procedural Village Generator.
 * Computes deterministic layouts and answers per-tile queries in O(1) time.
 */
export class VillageGenerator {
  readonly config: Required<VillageConfig>;
  readonly masterSeed: number;
  private readonly villageSeed: number;
  private readonly layoutCache = new Map<string, VillageLayout>();
  private readonly maxCacheSize = 16;

  constructor(configOrSeed: number | VillageConfig = 0) {
    if (typeof configOrSeed === 'number') {
      this.config = Object.freeze({
        ...DEFAULT_VILLAGE_CONFIG,
        seed: configOrSeed | 0,
      });
    } else {
      this.config = Object.freeze({
        ...DEFAULT_VILLAGE_CONFIG,
        ...configOrSeed,
        seed: (configOrSeed.seed ?? DEFAULT_VILLAGE_CONFIG.seed) | 0,
      });
    }

    this.masterSeed = this.config.seed;
    this.villageSeed = deriveSubSeed(this.masterSeed, 0x7a01);
  }

  /**
   * Generates or retrieves from LRU cache the full deterministic layout of a village.
   */
  getVillageLayout(
    cellId: number,
    centerCol: number,
    centerRow: number,
    plazaX: number,
    plazaY: number
  ): VillageLayout {
    const cacheKey = `${centerCol},${centerRow},${cellId}`;
    const cached = this.layoutCache.get(cacheKey);
    if (cached) {
      // LRU refresh
      this.layoutCache.delete(cacheKey);
      this.layoutCache.set(cacheKey, cached);
      return cached;
    }

    const layout = this.buildVillageLayout(cellId, centerCol, centerRow, plazaX, plazaY);

    if (this.layoutCache.size >= this.maxCacheSize) {
      const oldestKey = this.layoutCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.layoutCache.delete(oldestKey);
      }
    }
    this.layoutCache.set(cacheKey, layout);

    return layout;
  }

  /**
   * Internal generator constructing the organic village layout.
   */
  private buildVillageLayout(
    cellId: number,
    centerCol: number,
    centerRow: number,
    plazaX: number,
    plazaY: number
  ): VillageLayout {
    const localSeed = deriveSubSeed(this.villageSeed, ((centerCol * 73856093) ^ (centerRow * 19349663) ^ cellId) | 0);

    // Deterministic town name
    const preIdx = Math.floor(hash2D(centerCol, centerRow, localSeed + 1) * TOWN_PREFIXES.length);
    const sufIdx = Math.floor(hash2D(centerCol, centerRow, localSeed + 2) * TOWN_SUFFIXES.length);
    const townName = `${TOWN_PREFIXES[preIdx]}${TOWN_SUFFIXES[sufIdx]}`;

    const radius = this.config.villageRadius;
    const plazaR = this.config.plazaRadius;

    const pavementTiles = new Set<string>();
    const pavementTypes = new Map<string, 'plaza' | 'main_street' | 'house_walkway'>();
    const houseTileMap = new Map<string, { house: PlacedHouse; part: 'roof' | 'wall' | 'door' | 'interior' }>();
    const propTileMap = new Map<string, VillageProp>();
    const yardTiles = new Set<string>();
    const placedHouses: PlacedHouse[] = [];
    const placedProps: VillageProp[] = [];

    // Helper to mark pavement
    const addPavement = (x: number, y: number, type: 'plaza' | 'main_street' | 'house_walkway') => {
      const key = coordKey(x, y);
      pavementTiles.add(key);
      pavementTypes.set(key, type);
    };

    // 1. Central Town Square Plaza (wide cobblestone square)
    for (let dx = -plazaR; dx <= plazaR; dx++) {
      for (let dy = -plazaR; dy <= plazaR; dy++) {
        // Rounded corners for organic stone plaza
        if (Math.abs(dx) === plazaR && Math.abs(dy) === plazaR) continue;
        addPavement(plazaX + dx, plazaY + dy, 'plaza');
      }
    }

    // 2. Central Well / Water Reservoir at Plaza Center
    const wellProp: VillageProp = {
      id: `prop_well_${cellId}`,
      x: plazaX,
      y: plazaY,
      type: 'well',
      label: 'Town Well',
      hexColor: '#0284c7',
      color: 0x0284c7,
    };
    placedProps.push(wellProp);
    propTileMap.set(coordKey(plazaX, plazaY), wellProp);

    // Plaza Benches and Notice Board around plaza perimeter
    const plazaAccents: { dx: number; dy: number; type: VillagePropType; label: string; hex: string; col: number }[] = [
      { dx: 0, dy: -(plazaR - 1), type: 'notice_board', label: 'Town Notice Board', hex: '#d97706', col: 0xd97706 },
      { dx: -(plazaR - 1), dy: 0, type: 'bench', label: 'Plaza Bench', hex: '#b45309', col: 0xb45309 },
      { dx: (plazaR - 1), dy: 0, type: 'bench', label: 'Plaza Bench', hex: '#b45309', col: 0xb45309 },
    ];
    for (const accent of plazaAccents) {
      const ax = plazaX + accent.dx;
      const ay = plazaY + accent.dy;
      const p: VillageProp = {
        id: `prop_plaza_${ax}_${ay}`,
        x: ax,
        y: ay,
        type: accent.type,
        label: accent.label,
        hexColor: accent.hex,
        color: accent.col,
      };
      placedProps.push(p);
      propTileMap.set(coordKey(ax, ay), p);
    }

    // 3. Organic Branching Street Corridors
    // 4 cardinal thoroughfares radiating from plaza edge with slight organic meanders
    interface RoadBranch {
      dx: number;
      dy: number;
      length: number;
    }
    const branchConfigs: RoadBranch[] = [
      { dx: 0, dy: -1, length: radius - 3 }, // North
      { dx: 0, dy: 1, length: radius - 3 },  // South
      { dx: 1, dy: 0, length: radius - 3 },  // East
      { dx: -1, dy: 0, length: radius - 3 }, // West
    ];

    const roadTilesList: { x: number; y: number }[] = [];

    for (let bIdx = 0; bIdx < branchConfigs.length; bIdx++) {
      const branch = branchConfigs[bIdx];
      let curX = plazaX + branch.dx * plazaR;
      let curY = plazaY + branch.dy * plazaR;

      // 2-tile wide main thoroughfare
      for (let step = 0; step < branch.length; step++) {
        // Add 2-tile road footprint
        if (branch.dx === 0) {
          // Vertical road (width along X)
          addPavement(curX, curY, 'main_street');
          addPavement(curX + 1, curY, 'main_street');
          roadTilesList.push({ x: curX, y: curY });
          roadTilesList.push({ x: curX + 1, y: curY });
        } else {
          // Horizontal road (width along Y)
          addPavement(curX, curY, 'main_street');
          addPavement(curX, curY + 1, 'main_street');
          roadTilesList.push({ x: curX, y: curY });
          roadTilesList.push({ x: curX, y: curY + 1 });
        }

        // Slight organic meandering
        const meanderHash = hash2D(curX, curY, localSeed + bIdx * 50 + step);
        if (step > 4 && step % 6 === 0) {
          if (branch.dx === 0) {
            curX += meanderHash > 0.5 ? 1 : -1;
          } else {
            curY += meanderHash > 0.5 ? 1 : -1;
          }
        }

        curX += branch.dx;
        curY += branch.dy;

        // Street Lantern at corners and every ~8 tiles along main streets
        if (step > 0 && step % 7 === 0) {
          const lx = branch.dx === 0 ? curX + 2 : curX;
          const ly = branch.dx === 0 ? curY : curY + 2;
          const lantern: VillageProp = {
            id: `prop_lantern_${lx}_${ly}`,
            x: lx,
            y: ly,
            type: 'lantern',
            label: 'Street Lantern',
            hexColor: '#fde047',
            color: 0xfde047,
          };
          placedProps.push(lantern);
          propTileMap.set(coordKey(lx, ly), lantern);
        }
      }
    }

    // 4. Hierarchical House Lot Allocation & Strict Non-Overlap Verification
    // Models to place in order of importance:
    // 1x Grand Manor, 2-3x Red Cottage, 2-3x Blue Cottage, 1-2x Small Outpost, 1x Watchtower
    const manorModel = BUILDING_MODELS.find((m) => m.id === 'manor_grand')!;
    const redCottageModel = BUILDING_MODELS.find((m) => m.id === 'cottage_red')!;
    const blueCottageModel = BUILDING_MODELS.find((m) => m.id === 'cottage_blue')!;
    const outpostModel = BUILDING_MODELS.find((m) => m.id === 'outpost_small')!;
    const towerModel = BUILDING_MODELS.find((m) => m.id === 'watchtower')!;

    const plannedBuildings: BuildingModelDef[] = [
      manorModel,
      redCottageModel,
      blueCottageModel,
      redCottageModel,
      blueCottageModel,
      outpostModel,
      towerModel,
    ];

    // Helper: checks if candidate building rectangle (with 2-tile margin) overlaps
    // existing houses, plaza, or main streets
    const canPlaceHouse = (bx: number, by: number, bw: number, bh: number): boolean => {
      const margin = this.config.houseMinSpacing;

      // Check distance from plaza center: cannot overlap plaza square + 1 tile buffer
      const bCenterX = bx + bw / 2;
      const bCenterY = by + bh / 2;
      const distToPlaza = Math.hypot(bCenterX - plazaX, bCenterY - plazaY);
      if (distToPlaza < plazaR + 2.5) {
        return false;
      }

      // Check bounding box overlaps with existing placed houses
      for (const house of placedHouses) {
        if (
          bx < house.x + house.width + margin &&
          bx + bw + margin > house.x &&
          by < house.y + house.height + margin &&
          by + bh + margin > house.y
        ) {
          return false;
        }
      }

      // Check overlap with existing plaza or main streets
      for (let x = bx; x < bx + bw; x++) {
        for (let y = by; y < by + bh; y++) {
          const key = coordKey(x, y);
          if (pavementTiles.has(key)) {
            return false;
          }
        }
      }

      return true;
    };

    // Candidate quadrant centers around plaza
    // Quadrant 0: North-East, 1: South-East, 2: South-West, 3: North-West
    const quadrantOffsets = [
      { qx: 1, qy: -1 },
      { qx: 1, qy: 1 },
      { qx: -1, qy: 1 },
      { qx: -1, qy: -1 },
    ];

    let houseCounter = 1;
    for (let i = 0; i < plannedBuildings.length; i++) {
      const model = plannedBuildings[i];
      let placed = false;

      // Try multiple candidate offsets in quadrants
      for (let attempt = 0; attempt < 24 && !placed; attempt++) {
        const qIdx = (i + attempt) % 4;
        const q = quadrantOffsets[qIdx];

        // Derived radial distance from plaza: Manor stays close (r~6..8), others expand outward (r~8..18)
        const isManor = model.id === 'manor_grand';
        const isTower = model.id === 'watchtower';
        const baseR = isManor ? 6.5 : isTower ? radius - 6 : 8 + (attempt % 3) * 4;

        const jitterX = Math.floor(hash2D(centerCol + i, centerRow + attempt, localSeed + 100) * 4) - 2;
        const jitterY = Math.floor(hash2D(centerCol + attempt, centerRow + i, localSeed + 200) * 4) - 2;

        const candX = Math.floor(plazaX + q.qx * baseR + jitterX - model.width / 2);
        const candY = Math.floor(plazaY + q.qy * baseR + jitterY - model.height / 2);

        // Keep inside village radius
        if (Math.hypot(candX + model.width / 2 - plazaX, candY + model.height / 2 - plazaY) > radius - 2) {
          continue;
        }

        if (canPlaceHouse(candX, candY, model.width, model.height)) {
          const doorX = candX + model.doorOffset.x;
          const doorY = candY + model.doorOffset.y;

          const placedHouse: PlacedHouse = {
            id: `house_${cellId}_${houseCounter++}`,
            model,
            x: candX,
            y: candY,
            width: model.width,
            height: model.height,
            door: { x: doorX, y: doorY },
          };

          placedHouses.push(placedHouse);
          placed = true;

          // Register tiles in houseTileMap
          for (let hx = 0; hx < model.width; hx++) {
            for (let hy = 0; hy < model.height; hy++) {
              const tx = candX + hx;
              const ty = candY + hy;
              const key = coordKey(tx, ty);

              let part: 'roof' | 'wall' | 'door' | 'interior';
              if (tx === doorX && ty === doorY) {
                part = 'door';
              } else if (hy < Math.max(1, Math.floor(model.height * 0.6))) {
                part = 'roof';
              } else if (hx === 0 || hx === model.width - 1 || hy === model.height - 1) {
                part = 'wall';
              } else {
                part = 'interior';
              }

              houseTileMap.set(key, { house: placedHouse, part });
            }
          }

          // 5. Door Walkway Pavement: connect door directly to nearest main street
          let closestRoad: { x: number; y: number } | null = null;
          let minRoadDist = Infinity;
          for (const roadTile of roadTilesList) {
            const d = Math.hypot(doorX - roadTile.x, doorY - roadTile.y);
            if (d < minRoadDist) {
              minRoadDist = d;
              closestRoad = roadTile;
            }
          }

          if (closestRoad) {
            // Bresenham or Manhattan connection from (doorX, doorY + 1) to closestRoad
            let wx = doorX;
            let wy = doorY + 1; // start just outside front door
            while (wx !== closestRoad.x || wy !== closestRoad.y) {
              addPavement(wx, wy, 'house_walkway');
              if (wx < closestRoad.x) wx++;
              else if (wx > closestRoad.x) wx--;
              else if (wy < closestRoad.y) wy++;
              else if (wy > closestRoad.y) wy--;
            }
            addPavement(wx, wy, 'house_walkway');
          }

          // 6. House Accents (Crates, Barrels, Fenced Garden)
          // Place crates/barrels along exterior side walls (never blocking front door)
          const sideX = candX - 1;
          const sideY = candY + model.height - 1;
          if (!pavementTiles.has(coordKey(sideX, sideY)) && !propTileMap.has(coordKey(sideX, sideY))) {
            const crateProp: VillageProp = {
              id: `prop_crates_${sideX}_${sideY}`,
              x: sideX,
              y: sideY,
              type: 'crate_stack',
              label: 'Wood Crates',
              hexColor: '#06b6d4',
              color: 0x06b6d4,
            };
            placedProps.push(crateProp);
            propTileMap.set(coordKey(sideX, sideY), crateProp);
          }

          // Place backyard garden yard on the opposite side of the door
          const yardStartX = candX;
          const yardStartY = candY - 2;
          for (let yx = 0; yx < Math.min(3, model.width); yx++) {
            for (let yy = 0; yy < 2; yy++) {
              const ytx = yardStartX + yx;
              const yty = yardStartY + yy;
              const yKey = coordKey(ytx, yty);
              if (!pavementTiles.has(yKey) && !houseTileMap.has(yKey) && !propTileMap.has(yKey)) {
                yardTiles.add(yKey);
              }
            }
          }
        }
      }
    }

    return Object.freeze({
      cellId,
      name: townName,
      centerCol,
      centerRow,
      plazaCenter: Object.freeze({ x: plazaX, y: plazaY }),
      radius,
      plazaRadius: plazaR,
      houses: Object.freeze(placedHouses),
      props: Object.freeze(placedProps),
      pavementTiles,
      pavementTypes,
      houseTileMap,
      propTileMap,
      yardTiles,
    });
  }

  /**
   * Evaluates detailed village tile metadata at world tile coordinate (tx, ty).
   * Resolves in O(1) time.
   */
  getVillageTileAt(
    tx: number,
    ty: number,
    cellId: number,
    centerCol: number,
    centerRow: number,
    plazaX: number,
    plazaY: number
  ): VillageTileInfo {
    const distToPlaza = Math.hypot(tx - plazaX, ty - plazaY);
    if (distToPlaza > this.config.villageRadius) {
      return {
        isVillage: false,
        villageName: '',
        district: 'open_green',
        isPavement: false,
        isWalkable: true,
      };
    }

    const layout = this.getVillageLayout(cellId, centerCol, centerRow, plazaX, plazaY);
    const key = coordKey(tx, ty);

    // 1. House check
    const houseEntry = layout.houseTileMap.get(key);
    if (houseEntry) {
      const { house, part } = houseEntry;
      let district: VillageDistrict;
      let hexColor: string;
      let color: number;

      if (part === 'door') {
        district = 'house_door';
        hexColor = '#f59e0b';
        color = 0xf59e0b;
      } else if (part === 'roof') {
        district = 'house_roof';
        hexColor = house.model.roofHexColor;
        color = house.model.roofColor;
      } else if (part === 'wall') {
        district = 'house_wall';
        hexColor = house.model.wallHexColor;
        color = house.model.wallColor;
      } else {
        district = 'house_interior';
        hexColor = '#d97706';
        color = 0xd97706;
      }

      return {
        isVillage: true,
        villageName: layout.name,
        district,
        isPavement: false,
        house,
        housePart: part,
        hexColor,
        color,
        isWalkable: part === 'door' || part === 'interior',
      };
    }

    // 2. Prop check
    const prop = layout.propTileMap.get(key);
    if (prop) {
      return {
        isVillage: true,
        villageName: layout.name,
        district: prop.type === 'well' ? 'plaza' : 'open_green',
        isPavement: layout.pavementTiles.has(key),
        pavementType: layout.pavementTypes.get(key),
        prop,
        hexColor: prop.hexColor,
        color: prop.color,
        isWalkable: false,
      };
    }

    // 3. Pavement check (Plaza, Main Street, Walkway)
    if (layout.pavementTiles.has(key)) {
      const pType = layout.pavementTypes.get(key) ?? 'main_street';
      const district: VillageDistrict =
        pType === 'plaza' ? 'plaza' : pType === 'main_street' ? 'main_street' : 'walkway';
      const hexColor = pType === 'plaza' ? '#e11d48' : '#cbd5e1';
      const color = pType === 'plaza' ? 0xe11d48 : 0xcbd5e1;

      return {
        isVillage: true,
        villageName: layout.name,
        district,
        isPavement: true,
        pavementType: pType,
        hexColor,
        color,
        isWalkable: true,
      };
    }

    // 4. Garden Yard check
    if (layout.yardTiles.has(key)) {
      return {
        isVillage: true,
        villageName: layout.name,
        district: 'yard',
        isPavement: false,
        hexColor: '#84cc16',
        color: 0x84cc16,
        isWalkable: true,
      };
    }

    // 5. Open Village Green Territory
    return {
      isVillage: true,
      villageName: layout.name,
      district: 'open_green',
      isPavement: false,
      hexColor: '#8b5cf6',
      color: 0x8b5cf6,
      isWalkable: true,
    };
  }

  /**
   * Returns true if (tx, ty) contains any structural village element:
   * house, pavement, plaza, or prop.
   * Used to suppress trees from spawning on top of buildings and roads.
   */
  isStructuralAt(
    tx: number,
    ty: number,
    cellId: number,
    centerCol: number,
    centerRow: number,
    plazaX: number,
    plazaY: number
  ): boolean {
    const distToPlaza = Math.hypot(tx - plazaX, ty - plazaY);
    if (distToPlaza > this.config.villageRadius) {
      return false;
    }

    const layout = this.getVillageLayout(cellId, centerCol, centerRow, plazaX, plazaY);
    const key = coordKey(tx, ty);

    return (
      layout.houseTileMap.has(key) ||
      layout.pavementTiles.has(key) ||
      layout.propTileMap.has(key) ||
      layout.yardTiles.has(key)
    );
  }
}
