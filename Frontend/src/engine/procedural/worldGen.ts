/**
 * Procedural World Generator and Tileset Mapping.
 * Partitions 62 valid tiles from the 8x8 atlas and strictly excludes
 * editor alignment marker tiles (6,7) and (7,7).
 */

import { hash2D, fbm2D } from './noise.ts';

export interface TileCoord {
  readonly col: number;
  readonly row: number;
}

export type BiomeType = 'grass_meadow' | 'wildflower_patch' | 'stone_paver';

export interface WorldTile {
  readonly col: number;
  readonly row: number;
  readonly biome: BiomeType;
  readonly linearIndex: number;
}

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 8;
export const TILE_SOURCE_SIZE = 32;
export const RENDER_SCALE = 2;
export const RENDER_TILE_SIZE = TILE_SOURCE_SIZE * RENDER_SCALE; // 64px

/**
 * Grass Meadow Pool (16 tiles): rows 0-3, cols 0-3.
 * Subtle clean grass blade variations.
 */
export const GRASS_MEADOW_TILES: readonly TileCoord[] = Object.freeze(
  Array.from({ length: 16 }, (_, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    return Object.freeze({ col, row });
  })
);

/**
 * Wildflower Patch Pool (16 tiles): rows 0-3, cols 4-7.
 * Flower blossoms, clovers, and foliage accents.
 */
export const WILDFLOWER_TILES: readonly TileCoord[] = Object.freeze(
  Array.from({ length: 16 }, (_, i) => {
    const row = Math.floor(i / 4);
    const col = 4 + (i % 4);
    return Object.freeze({ col, row });
  })
);

/**
 * Stone Paver Clearing Pool (30 tiles):
 * Rows 4-6 (cols 0-7, 24 tiles) + Row 7 (cols 0-5, 6 tiles).
 * Note: Row 7 cols 6 and 7 are strictly excluded marker tiles.
 */
export const STONE_PAVER_TILES: readonly TileCoord[] = Object.freeze(
  Array.from({ length: 30 }, (_, i) => {
    if (i < 24) {
      const row = 4 + Math.floor(i / 8);
      const col = i % 8;
      return Object.freeze({ col, row });
    } else {
      const row = 7;
      const col = i - 24; // 0..5
      return Object.freeze({ col, row });
    }
  })
);

/**
 * Returns true if the coordinate matches the excluded editor alignment markers:
 * Tile (6,7) or Tile (7,7) (0-indexed).
 */
export function isMarkerTile(col: number, row: number): boolean {
  return row === 7 && (col === 6 || col === 7);
}

/**
 * Returns true if the linear index matches the excluded editor alignment markers:
 * Index 62 (row 7, col 6) or Index 63 (row 7, col 7).
 */
export function isMarkerIndex(linearIndex: number): boolean {
  return linearIndex === 62 || linearIndex === 63;
}

/**
 * Validates that a tile does not violate the alignment marker exclusion invariant.
 */
export function assertValidTile(tile: TileCoord): void {
  if (isMarkerTile(tile.col, tile.row)) {
    throw new Error(
      `Invariant violation: Excluded marker tile (${tile.col}, ${tile.row}) was generated.`
    );
  }
}

/**
 * Procedurally selects a deterministic tile for integer coordinate (tx, ty) given a world seed.
 * Guarantees zero selection of marker tiles (6,7) and (7,7).
 */
export function getTileAt(tx: number, ty: number, seed: number): WorldTile {
  // Density noises for biome distribution
  const stoneDensity = fbm2D(tx * 0.04, ty * 0.04, seed + 100);
  const flowerDensity = fbm2D(tx * 0.07, ty * 0.07, seed + 200);

  // Variant selector hash for tile within the biome pool
  const variantHash = hash2D(tx, ty, seed + 300);

  let selected: TileCoord;
  let biome: BiomeType;

  if (stoneDensity > 0.65) {
    const idx = Math.floor(variantHash * STONE_PAVER_TILES.length);
    selected = STONE_PAVER_TILES[idx];
    biome = 'stone_paver';
  } else if (flowerDensity > 0.55) {
    const idx = Math.floor(variantHash * WILDFLOWER_TILES.length);
    selected = WILDFLOWER_TILES[idx];
    biome = 'wildflower_patch';
  } else {
    const idx = Math.floor(variantHash * GRASS_MEADOW_TILES.length);
    selected = GRASS_MEADOW_TILES[idx];
    biome = 'grass_meadow';
  }

  assertValidTile(selected);

  const linearIndex = selected.row * ATLAS_COLS + selected.col;

  return {
    col: selected.col,
    row: selected.row,
    biome,
    linearIndex,
  };
}
