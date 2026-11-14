/**
 * Natural Forest Spread & Ecological Canopy Generator.
 * Simulates organic multi-scale forest spread:
 * 1. Macro forest contours & meso grove clustering.
 * 2. Glade clearings & sunlit meadows punched naturally inside dense woods.
 * 3. Edge ecotone falloff (thinning transition into plains instead of abrupt walls).
 * 4. Tree maturity hierarchy: Large canopy anchors, Medium standard trees, Small saplings, and Bushes.
 * 5. Overhead canopy coverage footprint tracking.
 */

import { hash2D, fbm2D } from './noise.ts';

export type ForestZoneType = 'core' | 'interior' | 'clearing' | 'edge' | 'none';
export type TreeMaturity = 'large' | 'medium' | 'small' | 'bush';

export interface ForestTreeInfo {
  readonly x: number;
  readonly y: number;
  readonly maturity: TreeMaturity;
  readonly canopyRadius: number; // in tiles: large=2, medium=1, small=0
  readonly variant: number;      // 0..3
  readonly density: number;
}

export interface ForestTileInfo {
  readonly tx: number;
  readonly ty: number;
  readonly zone: ForestZoneType;
  readonly density: number;          // continuous [0, 1]
  readonly gladeFactor: number;      // clearing factor [0, 1]
  readonly tree: ForestTreeInfo | null;
  readonly isCanopy: boolean;        // covered by nearby tree canopy
  readonly canopyDistance: number;   // distance to closest trunk
  readonly undergrowth: 'moss_soil' | 'dense_foliage' | 'glade_flower' | 'meadow_grass';
}

export interface ForestSpreadConfig {
  readonly seed: number;
  readonly macroScale?: number;        // Default 0.03
  readonly groveScale?: number;        // Default 0.055
  readonly gladeScale?: number;        // Default 0.038
  readonly coreThreshold?: number;     // Default 0.70
  readonly interiorThreshold?: number; // Default 0.58
  readonly edgeThreshold?: number;     // Default 0.52
  readonly gladeThreshold?: number;    // Default 0.30
  readonly treeMinSpacing?: number;    // Default 2.0
}

export const DEFAULT_FOREST_SPREAD_CONFIG: Required<ForestSpreadConfig> = Object.freeze({
  seed: 0,
  macroScale: 0.03,
  groveScale: 0.055,
  gladeScale: 0.038,
  coreThreshold: 0.70,
  interiorThreshold: 0.58,
  edgeThreshold: 0.52,
  gladeThreshold: 0.30,
  treeMinSpacing: 2.0,
});

/**
 * 32-bit integer mixer to derive distinct sub-seeds from master seed.
 */
function deriveSubSeed(masterSeed: number, streamTag: number): number {
  let h = ((masterSeed | 0) ^ Math.imul(streamTag, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

interface ForestSubSeeds {
  readonly macro: number;
  readonly grove: number;
  readonly glade: number;
  readonly scatter: number;
  readonly maturity: number;
}

/**
 * Deterministic Natural Forest Spread Generator.
 */
export class ForestSpreadGenerator {
  readonly config: Required<ForestSpreadConfig>;
  readonly masterSeed: number;
  private readonly seeds: ForestSubSeeds;

  constructor(configOrSeed: number | ForestSpreadConfig = 0) {
    if (typeof configOrSeed === 'number') {
      this.config = Object.freeze({
        ...DEFAULT_FOREST_SPREAD_CONFIG,
        seed: configOrSeed | 0,
      });
    } else {
      this.config = Object.freeze({
        ...DEFAULT_FOREST_SPREAD_CONFIG,
        ...configOrSeed,
        seed: (configOrSeed.seed ?? DEFAULT_FOREST_SPREAD_CONFIG.seed) | 0,
      });
    }

    this.masterSeed = this.config.seed;
    this.seeds = Object.freeze({
      macro: deriveSubSeed(this.masterSeed, 0x5a01),
      grove: deriveSubSeed(this.masterSeed, 0x5a02),
      glade: deriveSubSeed(this.masterSeed, 0x5a03),
      scatter: deriveSubSeed(this.masterSeed, 0x5a04),
      maturity: deriveSubSeed(this.masterSeed, 0x5a05),
    });
  }

  /**
   * Evaluates raw macro forest canopy density in [0, 1].
   */
  sampleMacroDensity(x: number, y: number): number {
    const scale = this.config.macroScale;
    const val = fbm2D(x * scale, y * scale, this.seeds.macro, 3, 2.0, 0.5);
    return Math.max(0, Math.min(1, val));
  }

  /**
   * Evaluates meso-scale grove clumping density in [0, 1].
   */
  sampleGroveDensity(x: number, y: number): number {
    const scale = this.config.groveScale;
    const val = fbm2D(x * scale, y * scale, this.seeds.grove, 3, 2.0, 0.5);
    return Math.max(0, Math.min(1, val));
  }

  /**
   * Evaluates micro glade clearing factor in [0, 1].
   * Lower values indicate natural sunlit clearings inside the woods.
   */
  sampleGladeFactor(x: number, y: number): number {
    const scale = this.config.gladeScale;
    const val = fbm2D(x * scale, y * scale, this.seeds.glade, 3, 2.0, 0.5);
    return Math.max(0, Math.min(1, val));
  }

  /**
   * Computes the combined organic forest density at (tx, ty) factoring in
   * macro coverage (70%) and local grove clumping (30%).
   */
  getEffectiveDensity(tx: number, ty: number): number {
    const macro = this.sampleMacroDensity(tx, ty);
    const grove = this.sampleGroveDensity(tx, ty);
    return Math.max(0, Math.min(1, macro * 0.70 + grove * 0.30));
  }

  /**
   * Classifies the ecological forest zone at integer tile coordinate (tx, ty).
   */
  getZoneAt(tx: number, ty: number): ForestZoneType {
    const density = this.getEffectiveDensity(tx, ty);

    if (density < this.config.edgeThreshold) {
      return 'none';
    }

    // Inside forest territory: check for natural glade clearings
    const glade = this.sampleGladeFactor(tx, ty);
    if (glade < this.config.gladeThreshold && density >= this.config.interiorThreshold) {
      return 'clearing';
    }

    if (density >= this.config.coreThreshold) {
      return 'core';
    }

    if (density >= this.config.interiorThreshold) {
      return 'interior';
    }

    return 'edge';
  }

  /**
   * Deterministically evaluates whether a tree trunk anchor is positioned at (tx, ty).
   * Spacing and maturity adapt naturally to the local forest zone:
   * - Core: closely spaced (2-3 tiles), large canopy anchors.
   * - Interior: standard spacing (3-4 tiles), medium trees.
   * - Edge: sparse spacing (5-6 tiles), small saplings and bushes.
   * - Clearing & None: 0 trees.
   */
  getTreeAt(tx: number, ty: number): ForestTreeInfo | null {
    const minSpacing = this.config.treeMinSpacing;
    const cellSize = Math.max(2, Math.ceil(minSpacing));

    const cellX = Math.floor(tx / cellSize);
    const cellY = Math.floor(ty / cellSize);

    // Candidate anchor within this grid cell
    const jx = Math.floor(hash2D(cellX, cellY, this.seeds.scatter + 1) * cellSize);
    const jy = Math.floor(hash2D(cellX, cellY, this.seeds.scatter + 2) * cellSize);
    const candX = cellX * cellSize + jx;
    const candY = cellY * cellSize + jy;

    if (candX !== tx || candY !== ty) {
      return null;
    }

    const zone = this.getZoneAt(tx, ty);
    if (zone === 'none' || zone === 'clearing') {
      return null;
    }

    // Probability filter per cell adapting to ecological zone:
    // Core: dense old-growth (95%)
    // Interior: balanced woodlands (70%)
    // Edge: thinned ecotone transition (35%)
    const spawnProb = zone === 'core' ? 0.95 : zone === 'interior' ? 0.70 : 0.35;
    const cellHash = hash2D(cellX, cellY, this.seeds.scatter);
    if (cellHash > spawnProb) {
      return null;
    }

    // Neighborhood spacing conflict resolution against 3x3 surrounding cells
    const myScore = hash2D(cellX, cellY, this.seeds.scatter + 3);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        if (ox === 0 && oy === 0) continue;
        const nx = cellX + ox;
        const ny = cellY + oy;

        const njx = Math.floor(hash2D(nx, ny, this.seeds.scatter + 1) * cellSize);
        const njy = Math.floor(hash2D(nx, ny, this.seeds.scatter + 2) * cellSize);
        const nCandX = nx * cellSize + njx;
        const nCandY = ny * cellSize + njy;

        const dist = Math.hypot(candX - nCandX, candY - nCandY);
        if (dist < minSpacing) {
          const nZone = this.getZoneAt(nCandX, nCandY);
          if (nZone !== 'none' && nZone !== 'clearing') {
            const nSpawnProb = nZone === 'core' ? 0.95 : nZone === 'interior' ? 0.70 : 0.35;
            const nHash = hash2D(nx, ny, this.seeds.scatter);
            if (nHash <= nSpawnProb) {
              const nScore = hash2D(nx, ny, this.seeds.scatter + 3);
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
    }

    // Determine tree maturity and canopy radius based on ecological zone
    const maturityHash = hash2D(tx, ty, this.seeds.maturity);
    let maturity: TreeMaturity;
    let canopyRadius: number;

    if (zone === 'core') {
      if (maturityHash < 0.65) {
        maturity = 'large';
        canopyRadius = 2;
      } else {
        maturity = 'medium';
        canopyRadius = 1;
      }
    } else if (zone === 'interior') {
      if (maturityHash < 0.30) {
        maturity = 'large';
        canopyRadius = 2;
      } else if (maturityHash < 0.85) {
        maturity = 'medium';
        canopyRadius = 1;
      } else {
        maturity = 'small';
        canopyRadius = 0;
      }
    } else {
      // edge ecotone
      if (maturityHash < 0.40) {
        maturity = 'medium';
        canopyRadius = 1;
      } else if (maturityHash < 0.80) {
        maturity = 'small';
        canopyRadius = 0;
      } else {
        maturity = 'bush';
        canopyRadius = 0;
      }
    }

    const variant = Math.floor(hash2D(tx, ty, this.seeds.maturity + 10) * 3);
    const density = this.getEffectiveDensity(tx, ty);

    return {
      x: tx,
      y: ty,
      maturity,
      canopyRadius,
      variant,
      density,
    };
  }

  /**
   * Checks whether integer tile coordinate (tx, ty) falls under the overhead canopy
   * of any nearby tree trunk. Searches candidate trunks within radius $\le 2$ tiles.
   */
  isCanopyAt(tx: number, ty: number): boolean {
    for (let ox = -2; ox <= 2; ox++) {
      for (let oy = -2; oy <= 2; oy++) {
        const nx = tx + ox;
        const ny = ty + oy;
        const tree = this.getTreeAt(nx, ny);
        if (tree && tree.canopyRadius > 0) {
          const dist = Math.hypot(tx - nx, ty - ny);
          if (dist <= tree.canopyRadius + 0.35) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Computes full ecological forest tile metadata at (tx, ty).
   */
  getForestAt(tx: number, ty: number): ForestTileInfo {
    const zone = this.getZoneAt(tx, ty);
    const density = this.getEffectiveDensity(tx, ty);
    const gladeFactor = this.sampleGladeFactor(tx, ty);
    const tree = this.getTreeAt(tx, ty);

    // Compute distance to closest tree trunk within 3x3 search window
    let minDist = Infinity;
    let isCanopy = false;

    for (let ox = -3; ox <= 3; ox++) {
      for (let oy = -3; oy <= 3; oy++) {
        const nx = tx + ox;
        const ny = ty + oy;
        const nearbyTree = this.getTreeAt(nx, ny);
        if (nearbyTree) {
          const dist = Math.hypot(tx - nx, ty - ny);
          if (dist < minDist) {
            minDist = dist;
          }
          if (nearbyTree.canopyRadius > 0 && dist <= nearbyTree.canopyRadius + 0.35) {
            isCanopy = true;
          }
        }
      }
    }

    // Determine undergrowth ground foliage type
    let undergrowth: ForestTileInfo['undergrowth'];
    if (zone === 'clearing') {
      undergrowth = 'glade_flower';
    } else if (zone === 'core') {
      undergrowth = isCanopy ? 'moss_soil' : 'dense_foliage';
    } else if (zone === 'interior') {
      undergrowth = isCanopy ? 'dense_foliage' : 'meadow_grass';
    } else {
      undergrowth = 'meadow_grass';
    }

    return {
      tx,
      ty,
      zone,
      density,
      gladeFactor,
      tree,
      isCanopy,
      canopyDistance: minDist === Infinity ? -1 : minDist,
      undergrowth,
    };
  }
}
