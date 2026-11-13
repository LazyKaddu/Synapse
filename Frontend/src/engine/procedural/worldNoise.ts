/**
 * Multi-Noise Procedural World Generator Utility Engine.
 * Inspired by Minecraft-style multi-noise distribution: continentalness, temperature,
 * humidity, erosion, forest density, tree scatter, and macro Voronoi village placement.
 */

import { hash2D, fbm2D, voronoi2D, type VoronoiResult } from './noise.ts';
import {
  ForestSpreadGenerator,
  type ForestTileInfo,
  type TreeMaturity,
  type ForestTreeInfo,
} from './forestGen.ts';

export type { VoronoiResult, ForestTileInfo, TreeMaturity, ForestTreeInfo };

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
  readonly maturity?: TreeMaturity;
  readonly canopyRadius?: number;
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
  readonly forestSpread: ForestSpreadGenerator;

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
    this.forestSpread = new ForestSpreadGenerator({
      seed: this.masterSeed,
      macroScale: this.config.forestDensityScale,
      edgeThreshold: this.config.forestThreshold,
      treeMinSpacing: this.config.treeMinSpacing,
    });
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
   * Delegates to the Natural ForestSpreadGenerator with density-adaptive spacing,
   * maturity hierarchy, and water suppression.
   */
  getTreeAt(tx: number, ty: number): TreePlacement | null {
    if (this.isWaterAt(tx, ty)) {
      return null;
    }
    const tree = this.forestSpread.getTreeAt(tx, ty);
    if (!tree) {
      return null;
    }
    return {
      x: tx,
      y: ty,
      col: tx,
      row: ty,
      variant: tree.variant,
      density: tree.density,
      maturity: tree.maturity,
      canopyRadius: tree.canopyRadius,
    };
  }

  /**
   * Computes full ecological forest tile metadata at (tx, ty).
   */
  getForestAt(tx: number, ty: number): ForestTileInfo {
    return this.forestSpread.getForestAt(tx, ty);
  }

  /**
   * Returns true if (tx, ty) is covered by the overhead canopy of a nearby tree.
   */
  isCanopyAt(tx: number, ty: number): boolean {
    return !this.isWaterAt(tx, ty) && this.forestSpread.isCanopyAt(tx, ty);
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
    description: 'Dense canopy, core old-growth, glades & edge woods',
  },
  {
    id: 'tree',
    label: 'Tree Trunk / Anchor',
    color: 0x064e3b,
    hexColor: '#064e3b',
    description: 'Clustered tree trunk with maturity (Large, Medium, Small, Bush)',
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
    const maturityLabel = tree.maturity ? ` [${tree.maturity.toUpperCase()}]` : '';
    const color =
      tree.maturity === 'large'
        ? 0x022c22
        : tree.maturity === 'small'
          ? 0x047857
          : tree.maturity === 'bush'
            ? 0x10b981
            : 0x064e3b;
    const hexColor =
      tree.maturity === 'large'
        ? '#022c22'
        : tree.maturity === 'small'
          ? '#047857'
          : tree.maturity === 'bush'
            ? '#10b981'
            : '#064e3b';
    return {
      color,
      hexColor,
      label: `Tree${maturityLabel} (Variant ${tree.variant + 1})`,
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
    case 'forest': {
      const forest = worldNoise.getForestAt(tx, ty);
      if (forest.zone === 'core') {
        return {
          color: 0x0f5132,
          hexColor: '#0f5132',
          label: 'Forest Core (Dense Woods)',
          category: 'forest',
          isTree: false,
          isPlaza: false,
          isVillage: false,
          isWater: false,
          biome,
        };
      }
      if (forest.zone === 'clearing') {
        return {
          color: 0x86efac,
          hexColor: '#86efac',
          label: 'Sunlit Glade (Clearing)',
          category: 'forest',
          isTree: false,
          isPlaza: false,
          isVillage: false,
          isWater: false,
          biome,
        };
      }
      if (forest.zone === 'edge') {
        return {
          color: 0x65a30d,
          hexColor: '#65a30d',
          label: 'Forest Edge (Ecotone)',
          category: 'forest',
          isTree: false,
          isPlaza: false,
          isVillage: false,
          isWater: false,
          biome,
        };
      }
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
    }
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
