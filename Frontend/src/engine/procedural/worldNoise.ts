/**
 * Multi-Noise Procedural World Generator Utility Engine.
 * Inspired by Minecraft-style multi-noise distribution: continentalness, temperature,
 * humidity, erosion, forest density, tree scatter, and macro Voronoi village placement.
 */

import { hash2D, fbm2D, voronoi2D, type VoronoiResult } from './noise.ts';

export type { VoronoiResult };

/**
 * 5 Canonical World Biome Types.
 */
export type WorldBiome =
  | 'water_pond'
  | 'meadow_plains'
  | 'forest'
  | 'desert_arid'
  | 'rocky_paver';

export const WORLD_BIOMES: readonly WorldBiome[] = Object.freeze([
  'water_pond',
  'meadow_plains',
  'forest',
  'desert_arid',
  'rocky_paver',
] as const);

/**
 * Configuration parameters for procedural world noise samplers and thresholds.
 */
export interface WorldNoiseConfig {
  readonly seed: number;
  readonly continentalnessScale?: number;
  readonly temperatureScale?: number;
  readonly humidityScale?: number;
  readonly erosionScale?: number;
  readonly forestDensityScale?: number;
  readonly villageCellSize?: number;
  readonly waterThreshold?: number;
  readonly forestThreshold?: number;
  readonly villageRarity?: number;
  readonly villageRadius?: number;
  readonly treeMinSpacing?: number;
}

export const DEFAULT_WORLD_NOISE_CONFIG: Required<WorldNoiseConfig> = Object.freeze({
  seed: 0,
  continentalnessScale: 0.01,
  temperatureScale: 0.008,
  humidityScale: 0.008,
  erosionScale: 0.012,
  forestDensityScale: 0.03,
  villageCellSize: 64,
  waterThreshold: 0.35,
  forestThreshold: 0.52,
  villageRarity: 0.5,
  villageRadius: 24,
  treeMinSpacing: 2.0,
});

/**
 * Deterministically derived distinct sub-seeds for independent noise channels.
 */
export interface SubSeeds {
  readonly continentalness: number;
  readonly temperature: number;
  readonly humidity: number;
  readonly erosion: number;
  readonly forestDensity: number;
  readonly treeScatter: number;
  readonly villageVoronoi: number;
}

/**
 * Deterministically derived tree placement metadata.
 */
export interface TreePlacement {
  readonly x: number;
  readonly y: number;
  readonly col: number;
  readonly row: number;
  readonly variant: number;
  readonly density: number;
}

/**
 * Deterministically derived village structure and Voronoi cell metadata.
 */
export interface VillageInfo {
  readonly cellId: number;
  readonly centerCol: number;
  readonly centerRow: number;
  readonly plazaCenter: {
    readonly x: number;
    readonly y: number;
    readonly col: number;
    readonly row: number;
  };
  readonly distanceToCenter: number;
  readonly radius: number;
  readonly normalizedRadius: number;
  readonly hasVillage: boolean;
  readonly isPlaza: boolean;
  readonly isInside: boolean;
}

/**
 * 32-bit integer mixer to derive distinct sub-seeds from a single master seed.
 */
function deriveSubSeed(masterSeed: number, streamTag: number): number {
  let h = ((masterSeed | 0) ^ Math.imul(streamTag, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

function deriveSubSeeds(masterSeed: number): SubSeeds {
  return Object.freeze({
    continentalness: deriveSubSeed(masterSeed, 0x1011),
    temperature: deriveSubSeed(masterSeed, 0x2022),
    humidity: deriveSubSeed(masterSeed, 0x3033),
    erosion: deriveSubSeed(masterSeed, 0x4044),
    forestDensity: deriveSubSeed(masterSeed, 0x5055),
    treeScatter: deriveSubSeed(masterSeed, 0x6066),
    villageVoronoi: deriveSubSeed(masterSeed, 0x7077),
  });
}

/**
 * Procedural WorldNoise generation engine.
 * Computes multi-octave continuous biome channels and cellular macro features.
 */
export class WorldNoise {
  readonly config: Required<WorldNoiseConfig>;
  readonly masterSeed: number;
  readonly seed: number;
  readonly seeds: SubSeeds;

  constructor(configOrSeed: number | WorldNoiseConfig = 0) {
    if (typeof configOrSeed === 'number') {
      this.config = Object.freeze({
        ...DEFAULT_WORLD_NOISE_CONFIG,
        seed: configOrSeed | 0,
      });
    } else {
      this.config = Object.freeze({
        ...DEFAULT_WORLD_NOISE_CONFIG,
        ...configOrSeed,
        seed: (configOrSeed.seed ?? DEFAULT_WORLD_NOISE_CONFIG.seed) | 0,
      });
    }

    this.masterSeed = this.config.seed;
    this.seed = this.config.seed;
    this.seeds = deriveSubSeeds(this.masterSeed);
  }

  // --- Raw Channel Samplers ---

  /**
   * Evaluates continentalness noise in [0, 1].
   * Lower values indicate ocean/lake/pond depressions; higher values indicate inland terrain.
   */
  sampleContinentalness(x: number, y: number): number {
    const scale = this.config.continentalnessScale;
    const val = fbm2D(x * scale, y * scale, this.seeds.continentalness, 4, 2.0, 0.5);
    return Math.max(0, Math.min(1, val));
  }

  /**
   * Evaluates regional temperature noise in [0, 1].
   * Lower values indicate cold/temperate zones; higher values indicate hot/arid zones.
   */
  sampleTemperature(x: number, y: number): number {
    const scale = this.config.temperatureScale;
    const val = fbm2D(x * scale, y * scale, this.seeds.temperature, 3, 2.0, 0.5);
    return Math.max(0, Math.min(1, val));
  }

  /**
   * Evaluates regional humidity / precipitation noise in [0, 1].
   * Lower values indicate arid conditions; higher values indicate lush / moist conditions.
   */
  sampleHumidity(x: number, y: number): number {
    const scale = this.config.humidityScale;
    const val = fbm2D(x * scale, y * scale, this.seeds.humidity, 3, 2.0, 0.5);
    return Math.max(0, Math.min(1, val));
  }

  /**
   * Evaluates erosion / terrain relief noise in [0, 1].
   * Lower values indicate smooth plains; higher values indicate rugged / rocky exposures.
   */
  sampleErosion(x: number, y: number): number {
    const scale = this.config.erosionScale;
    const val = fbm2D(x * scale, y * scale, this.seeds.erosion, 3, 2.0, 0.5);
    return Math.max(0, Math.min(1, val));
  }

  /**
   * Evaluates local forest canopy density noise in [0, 1].
   */
  sampleForestDensity(x: number, y: number): number {
    const scale = this.config.forestDensityScale;
    const val = fbm2D(x * scale, y * scale, this.seeds.forestDensity, 3, 2.0, 0.5);
    return Math.max(0, Math.min(1, val));
  }

  /**
   * Evaluates macro-scale cellular Voronoi partitioning for villages and regional landmarks.
   */
  sampleVillageVoronoi(x: number, y: number, cellSize?: number): VoronoiResult {
    const size = cellSize ?? this.config.villageCellSize;
    return voronoi2D(x / size, y / size, this.seeds.villageVoronoi);
  }

  // --- Semantic Helpers ---

  /**
   * Returns true if continentalness falls below the water threshold depression.
   */
  isWaterAt(x: number, y: number): boolean {
    return this.sampleContinentalness(x, y) < this.config.waterThreshold;
  }

  /**
   * Multi-noise biome classifier mapping continentalness, temperature, humidity,
   * erosion, and forest density to the 5 canonical biomes.
   */
  getBiomeAt(x: number, y: number): WorldBiome {
    if (this.isWaterAt(x, y)) {
      return 'water_pond';
    }

    const temp = this.sampleTemperature(x, y);
    const humidity = this.sampleHumidity(x, y);
    const erosion = this.sampleErosion(x, y);
    const forest = this.sampleForestDensity(x, y);

    // Arid desert: hot and dry conditions
    if (temp > 0.55 && humidity < 0.45) {
      return 'desert_arid';
    }

    // Rocky paver: rugged high-erosion exposures
    if (erosion > 0.62) {
      return 'rocky_paver';
    }

    // Forest: dense canopy or temperate humid woods
    if (forest > this.config.forestThreshold || (humidity > 0.58 && temp < 0.60)) {
      return 'forest';
    }

    // Meadow plains: temperate open grassland
    return 'meadow_plains';
  }

  /**
   * Evaluates whether a tree trunk is placed at integer tile coordinate (tx, ty).
   * Enforces forest density thresholding and deterministic jittered anchor placement
   * with guaranteed minimum spacing to produce natural clustered forests.
   */
  getTreeAt(tx: number, ty: number): TreePlacement | null {
    const minSpacing = this.config.treeMinSpacing;
    const cellSize = Math.max(2, Math.ceil(minSpacing));

    const cellX = Math.floor(tx / cellSize);
    const cellY = Math.floor(ty / cellSize);

    // Candidate anchor within this grid cell
    const jx = Math.floor(hash2D(cellX, cellY, this.seeds.treeScatter) * cellSize);
    const jy = Math.floor(hash2D(cellX, cellY, this.seeds.treeScatter + 1) * cellSize);
    const candX = cellX * cellSize + jx;
    const candY = cellY * cellSize + jy;

    if (candX !== tx || candY !== ty) {
      return null;
    }

    // Water suppression: no trees underwater
    if (this.isWaterAt(tx, ty)) {
      return null;
    }

    // Forest density clustering check
    const density = this.sampleForestDensity(tx, ty);
    if (density < this.config.forestThreshold) {
      return null;
    }

    // Minimum spacing conflict resolution against 3x3 neighboring cells
    const myScore = hash2D(cellX, cellY, this.seeds.treeScatter + 2);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        if (ox === 0 && oy === 0) continue;
        const nx = cellX + ox;
        const ny = cellY + oy;

        const njx = Math.floor(hash2D(nx, ny, this.seeds.treeScatter) * cellSize);
        const njy = Math.floor(hash2D(nx, ny, this.seeds.treeScatter + 1) * cellSize);
        const nCandX = nx * cellSize + njx;
        const nCandY = ny * cellSize + njy;

        const dist = Math.hypot(candX - nCandX, candY - nCandY);
        if (dist < minSpacing) {
          // Check if neighbor is a viable tree candidate
          if (
            !this.isWaterAt(nCandX, nCandY) &&
            this.sampleForestDensity(nCandX, nCandY) >= this.config.forestThreshold
          ) {
            const nScore = hash2D(nx, ny, this.seeds.treeScatter + 2);
            // Deterministic tie-breaker
            if (
              nScore > myScore ||
              (nScore === myScore && (nx > cellX || (nx === cellX && ny > cellY)))
            ) {
              return null;
            }
          }
        }
      }
    }

    const variant = Math.floor(hash2D(tx, ty, this.seeds.treeScatter + 3) * 3);

    return {
      x: tx,
      y: ty,
      col: tx,
      row: ty,
      variant,
      density,
    };
  }

  /**
   * Evaluates macro-scale Voronoi cell for village generation at integer tile coordinate (tx, ty).
   * Checks deterministic village spawn rarity and computes distance to plaza center,
   * plaza radius, and normalized radius. Returns VillageInfo if the cell spawns a village,
   * or null if the Voronoi cell does not spawn a village.
   */
  getVillageAt(tx: number, ty: number): VillageInfo | null {
    const cellSize = this.config.villageCellSize;
    const voronoi = this.sampleVillageVoronoi(tx, ty, cellSize);

    // Deterministic spawn rarity check per Voronoi cell
    const spawnHash = hash2D(voronoi.centerCol, voronoi.centerRow, this.seeds.villageVoronoi + 101);
    const hasVillage = spawnHash < this.config.villageRarity;

    if (!hasVillage) {
      return null;
    }

    // Plaza center derived from Voronoi cell feature point in tile coordinates
    const plazaX = Math.floor(
      (voronoi.centerCol + hash2D(voronoi.centerCol, voronoi.centerRow, this.seeds.villageVoronoi)) *
        cellSize
    );
    const plazaY = Math.floor(
      (voronoi.centerRow +
        hash2D(voronoi.centerCol, voronoi.centerRow, (this.seeds.villageVoronoi ^ 0x9e3779b9) | 0)) *
        cellSize
    );

    const dx = tx - plazaX;
    const dy = ty - plazaY;
    const distanceToCenter = Math.hypot(dx, dy);
    const radius = this.config.villageRadius;
    const normalizedRadius = radius > 0 ? distanceToCenter / radius : 0;
    const isPlaza = distanceToCenter <= Math.max(2, Math.floor(radius * 0.25));
    const isInside = distanceToCenter <= radius;

    return {
      cellId: voronoi.cellId,
      centerCol: voronoi.centerCol,
      centerRow: voronoi.centerRow,
      plazaCenter: {
        x: plazaX,
        y: plazaY,
        col: plazaX,
        row: plazaY,
      },
      distanceToCenter,
      radius,
      normalizedRadius,
      hasVillage: true,
      isPlaza,
      isInside,
    };
  }
}

/**
 * Visual palette definitions for noise verification and procedural debugging.
 */
export interface NoisePaletteEntry {
  readonly id: string;
  readonly label: string;
  readonly color: number;
  readonly hexColor: string;
  readonly description: string;
}

export const NOISE_PALETTE: readonly NoisePaletteEntry[] = Object.freeze([
  {
    id: 'water_pond',
    label: 'Water / Pond',
    color: 0x2563eb,
    hexColor: '#2563eb',
    description: 'Depression basin (continentalness < 0.35)',
  },
  {
    id: 'forest',
    label: 'Forest Canopy',
    color: 0x15803d,
    hexColor: '#15803d',
    description: 'Dense canopy or humid temperate woods',
  },
  {
    id: 'tree',
    label: 'Tree Trunk / Anchor',
    color: 0x064e3b,
    hexColor: '#064e3b',
    description: 'Clustered tree inside forest (min spacing >= 2 tiles)',
  },
  {
    id: 'meadow_plains',
    label: 'Meadow Plains',
    color: 0x4ade80,
    hexColor: '#4ade80',
    description: 'Temperate open grassland',
  },
  {
    id: 'desert_arid',
    label: 'Desert (Arid)',
    color: 0xeab308,
    hexColor: '#eab308',
    description: 'Hot & dry biome (temp > 0.55, humidity < 0.45)',
  },
  {
    id: 'rocky_paver',
    label: 'Rocky Pavers',
    color: 0x64748b,
    hexColor: '#64748b',
    description: 'Highlands & rugged rock exposures (erosion > 0.62)',
  },
  {
    id: 'village',
    label: 'Village Community',
    color: 0x8b5cf6,
    hexColor: '#8b5cf6',
    description: 'Voronoi cellular settlement territory',
  },
  {
    id: 'plaza',
    label: 'Village Plaza',
    color: 0xe11d48,
    hexColor: '#e11d48',
    description: 'Central plaza of village community',
  },
]);

export interface NoiseVisualTile {
  readonly color: number;
  readonly hexColor: string;
  readonly label: string;
  readonly category: 'water' | 'forest' | 'tree' | 'meadow' | 'desert' | 'rocky' | 'village' | 'plaza';
  readonly isTree: boolean;
  readonly isPlaza: boolean;
  readonly isVillage: boolean;
  readonly isWater: boolean;
  readonly biome: WorldBiome;
}

/**
 * Evaluates the visual representation of a tile at (tx, ty) for visual noise checking.
 */
export function getNoiseVisualTile(worldNoise: WorldNoise, tx: number, ty: number): NoiseVisualTile {
  // 1. Village structure check
  const village = worldNoise.getVillageAt(tx, ty);
  if (village && village.isInside) {
    if (village.isPlaza) {
      return {
        color: 0xe11d48,
        hexColor: '#e11d48',
        label: 'Village Plaza',
        category: 'plaza',
        isTree: false,
        isPlaza: true,
        isVillage: true,
        isWater: false,
        biome: 'meadow_plains',
      };
    }
    return {
      color: 0x8b5cf6,
      hexColor: '#8b5cf6',
      label: 'Village Community',
      category: 'village',
      isTree: false,
      isPlaza: false,
      isVillage: true,
      isWater: false,
      biome: 'meadow_plains',
    };
  }

  // 2. Water / Pond check
  if (worldNoise.isWaterAt(tx, ty)) {
    const c = worldNoise.sampleContinentalness(tx, ty);
    const color = c < 0.20 ? 0x1d4ed8 : 0x2563eb;
    const hexColor = c < 0.20 ? '#1d4ed8' : '#2563eb';
    return {
      color,
      hexColor,
      label: 'Water (Pond / Lake)',
      category: 'water',
      isTree: false,
      isPlaza: false,
      isVillage: false,
      isWater: true,
      biome: 'water_pond',
    };
  }

  // 3. Tree check (clustered within forests)
  const tree = worldNoise.getTreeAt(tx, ty);
  if (tree) {
    return {
      color: 0x064e3b,
      hexColor: '#064e3b',
      label: `Tree (Variant ${tree.variant + 1})`,
      category: 'tree',
      isTree: true,
      isPlaza: false,
      isVillage: false,
      isWater: false,
      biome: 'forest',
    };
  }

  // 4. Canonical Biomes
  const biome = worldNoise.getBiomeAt(tx, ty);
  switch (biome) {
    case 'forest':
      return {
        color: 0x15803d,
        hexColor: '#15803d',
        label: 'Forest Canopy (Woods)',
        category: 'forest',
        isTree: false,
        isPlaza: false,
        isVillage: false,
        isWater: false,
        biome,
      };
    case 'desert_arid':
      return {
        color: 0xeab308,
        hexColor: '#eab308',
        label: 'Desert (Arid Dunes)',
        category: 'desert',
        isTree: false,
        isPlaza: false,
        isVillage: false,
        isWater: false,
        biome,
      };
    case 'rocky_paver':
      return {
        color: 0x64748b,
        hexColor: '#64748b',
        label: 'Rocky Mountain (Pavers)',
        category: 'rocky',
        isTree: false,
        isPlaza: false,
        isVillage: false,
        isWater: false,
        biome,
      };
    case 'meadow_plains':
    default:
      return {
        color: 0x4ade80,
        hexColor: '#4ade80',
        label: 'Meadow (Plains Grassland)',
        category: 'meadow',
        isTree: false,
        isPlaza: false,
        isVillage: false,
        isWater: false,
        biome: 'meadow_plains',
      };
  }
}
