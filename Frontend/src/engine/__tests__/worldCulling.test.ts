import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hash2D, valueNoise2D, fbm2D } from '../procedural/noise.ts';
import {
  getTileAt,
  isMarkerTile,
  isMarkerIndex,
  assertValidTile,
  GRASS_MEADOW_TILES,
  WILDFLOWER_TILES,
  STONE_PAVER_TILES,
  ATLAS_COLS,
  ATLAS_ROWS,
} from '../procedural/worldGen.ts';
import { calculateTileBounds, isTileVisible, isTileBuffered } from '../culling/looseCulling.ts';
import { SpritePool } from '../culling/spritePool.ts';

describe('1. Deterministic 2D Noise & Integer Coordinate Hashing', () => {
  it('guarantees deterministic output across identical coordinates and seeds', () => {
    const coords = [
      [0, 0],
      [10, 20],
      [-500, 300],
      [42000, -84000],
      [-12345, -67890],
    ];

    for (const [x, y] of coords) {
      const h1 = hash2D(x, y, 1337);
      const h2 = hash2D(x, y, 1337);
      assert.strictEqual(h1, h2, `hash2D must be strictly deterministic at (${x}, ${y})`);

      const v1 = valueNoise2D(x * 0.05, y * 0.05, 1337);
      const v2 = valueNoise2D(x * 0.05, y * 0.05, 1337);
      assert.strictEqual(v1, v2, `valueNoise2D must be strictly deterministic at (${x}, ${y})`);

      const f1 = fbm2D(x * 0.02, y * 0.02, 1337);
      const f2 = fbm2D(x * 0.02, y * 0.02, 1337);
      assert.strictEqual(f1, f2, `fbm2D must be strictly deterministic at (${x}, ${y})`);
    }
  });

  it('bounds hash and noise outputs strictly in [0, 1)', () => {
    for (let x = -100; x <= 100; x += 10) {
      for (let y = -100; y <= 100; y += 10) {
        const h = hash2D(x, y, 42);
        assert.ok(h >= 0 && h < 1, `hash2D(${x}, ${y}) out of range: ${h}`);

        const v = valueNoise2D(x * 0.1, y * 0.1, 42);
        assert.ok(v >= 0 && v <= 1, `valueNoise2D(${x}, ${y}) out of range: ${v}`);

        const f = fbm2D(x * 0.05, y * 0.05, 42);
        assert.ok(f >= 0 && f <= 1, `fbm2D(${x}, ${y}) out of range: ${f}`);
      }
    }
  });

  it('produces spatial variance and responds to differing seeds', () => {
    const h1 = hash2D(100, 200, 1337);
    const h2 = hash2D(100, 200, 9999);
    assert.notStrictEqual(h1, h2, 'Different seeds should produce different hashes');

    const h3 = hash2D(101, 200, 1337);
    assert.notStrictEqual(h1, h3, 'Adjacent coordinates should produce different hashes');
  });

  it('smoothly interpolates across zero crossings with no NaN or infinite values', () => {
    for (let x = -2.0; x <= 2.0; x += 0.25) {
      for (let y = -2.0; y <= 2.0; y += 0.25) {
        const v = valueNoise2D(x, y, 777);
        assert.ok(!Number.isNaN(v), `valueNoise2D produced NaN at (${x}, ${y})`);
        assert.ok(Number.isFinite(v), `valueNoise2D produced non-finite at (${x}, ${y})`);
      }
    }
  });
});

describe('2. Strict Alignment Marker Exclusion (Tiles (6,7) and (7,7))', () => {
  it('correctly identifies marker tiles and indices', () => {
    assert.strictEqual(isMarkerTile(6, 7), true, 'Tile (6,7) must be marked');
    assert.strictEqual(isMarkerTile(7, 7), true, 'Tile (7,7) must be marked');
    assert.strictEqual(isMarkerTile(0, 0), false);
    assert.strictEqual(isMarkerTile(6, 6), false);
    assert.strictEqual(isMarkerTile(7, 6), false);
    assert.strictEqual(isMarkerTile(5, 7), false);

    assert.strictEqual(isMarkerIndex(62), true, 'Index 62 must be marker index');
    assert.strictEqual(isMarkerIndex(63), true, 'Index 63 must be marker index');
    for (let i = 0; i < 62; i++) {
      assert.strictEqual(isMarkerIndex(i), false, `Index ${i} should not be marker index`);
    }
  });

  it('verifies static tile pools contain no excluded marker tiles', () => {
    assert.strictEqual(GRASS_MEADOW_TILES.length, 16);
    for (const t of GRASS_MEADOW_TILES) {
      assert.strictEqual(isMarkerTile(t.col, t.row), false);
      assert.ok(t.col < ATLAS_COLS && t.row < ATLAS_ROWS);
    }

    assert.strictEqual(WILDFLOWER_TILES.length, 16);
    for (const t of WILDFLOWER_TILES) {
      assert.strictEqual(isMarkerTile(t.col, t.row), false);
      assert.ok(t.col < ATLAS_COLS && t.row < ATLAS_ROWS);
    }

    assert.strictEqual(STONE_PAVER_TILES.length, 30);
    for (const t of STONE_PAVER_TILES) {
      assert.strictEqual(isMarkerTile(t.col, t.row), false);
      assert.ok(t.col < ATLAS_COLS && t.row < ATLAS_ROWS);
    }

    // Total non-marker tiles in atlas: 16 + 16 + 30 = 62 (out of 64 total)
    assert.strictEqual(
      GRASS_MEADOW_TILES.length + WILDFLOWER_TILES.length + STONE_PAVER_TILES.length,
      62
    );
  });

  it('assertValidTile throws on excluded coordinates and succeeds on valid tiles', () => {
    assert.throws(() => assertValidTile({ col: 6, row: 7 }), /Invariant violation/);
    assert.throws(() => assertValidTile({ col: 7, row: 7 }), /Invariant violation/);
    assert.doesNotThrow(() => assertValidTile({ col: 0, row: 0 }));
    assert.doesNotThrow(() => assertValidTile({ col: 5, row: 7 }));
  });

  it('evaluates 60,000+ procedural coordinates across negative and positive space with ZERO marker violations', () => {
    const seed = 133742;
    let grassCount = 0;
    let flowerCount = 0;
    let stoneCount = 0;
    let totalSamples = 0;

    for (let x = -150; x <= 150; x++) {
      for (let y = -100; y <= 100; y++) {
        const tile = getTileAt(x, y, seed);
        totalSamples++;

        // Assert no marker tile can ever be returned
        assert.notStrictEqual(tile.linearIndex, 62, `Marker tile index 62 at (${x}, ${y})`);
        assert.notStrictEqual(tile.linearIndex, 63, `Marker tile index 63 at (${x}, ${y})`);
        assert.ok(
          !(tile.row === 7 && (tile.col === 6 || tile.col === 7)),
          `Marker coordinate (${tile.col}, ${tile.row}) at (${x}, ${y})`
        );

        if (tile.biome === 'grass_meadow') grassCount++;
        else if (tile.biome === 'wildflower_patch') flowerCount++;
        else if (tile.biome === 'stone_paver') stoneCount++;
      }
    }

    assert.strictEqual(totalSamples, 301 * 201, 'Should evaluate exactly 60,501 samples');
    assert.ok(grassCount > 0, 'Grass meadow biome should be generated');
    assert.ok(flowerCount > 0, 'Wildflower biome should be generated');
    assert.ok(stoneCount > 0, 'Stone paver clearing biome should be generated');
    assert.strictEqual(grassCount + flowerCount + stoneCount, totalSamples);
  });
});

describe('3. Loose Viewport Culling Boundary Calculation Math', () => {
  it('calculates exact visible and buffered tile bounds at origin', () => {
    // Camera at (0, 0), 800x600 viewport, 64px tileSize, buffer 2
    const bounds = calculateTileBounds(0, 0, 800, 600, 64, 2);

    // Half width = 400, half height = 300
    // Visible X: [-400, 400) -> min = floor(-400/64) = -7, max = floor(399.999/64) = 6
    // Visible Y: [-300, 300) -> min = floor(-300/64) = -5, max = floor(299.999/64) = 4
    assert.strictEqual(bounds.minVisX, -7);
    assert.strictEqual(bounds.maxVisX, 6);
    assert.strictEqual(bounds.minVisY, -5);
    assert.strictEqual(bounds.maxVisY, 4);

    // Visible tile count = (6 - (-7) + 1) * (4 - (-5) + 1) = 14 * 10 = 140
    assert.strictEqual(bounds.visibleTileCount, 140);

    // Preload buffer margin of 2 tiles:
    // Buf X: [-7 - 2, 6 + 2] = [-9, 8] -> count = 8 - (-9) + 1 = 18
    // Buf Y: [-5 - 2, 4 + 2] = [-7, 6] -> count = 6 - (-7) + 1 = 14
    assert.strictEqual(bounds.minBufX, -9);
    assert.strictEqual(bounds.maxBufX, 8);
    assert.strictEqual(bounds.minBufY, -7);
    assert.strictEqual(bounds.maxBufY, 6);
    assert.strictEqual(bounds.bufferedTileCount, 18 * 14); // 252
  });

  it('correctly adapts bounds for configurable buffer margin of 3 tiles', () => {
    const bounds = calculateTileBounds(0, 0, 800, 600, 64, 3);

    assert.strictEqual(bounds.minBufX, -10);
    assert.strictEqual(bounds.maxBufX, 9);
    assert.strictEqual(bounds.minBufY, -8);
    assert.strictEqual(bounds.maxBufY, 7);
    assert.strictEqual(bounds.bufferedTileCount, 20 * 16); // 320
  });

  it('handles arbitrary floating-point camera positions and negative coordinates', () => {
    const bounds = calculateTileBounds(-1532.7, 842.3, 1920, 1080, 64, 2);

    assert.ok(bounds.minBufX < bounds.minVisX);
    assert.ok(bounds.maxBufX > bounds.maxVisX);
    assert.ok(bounds.minBufY < bounds.minVisY);
    assert.ok(bounds.maxBufY > bounds.maxVisY);

    assert.strictEqual(bounds.minVisX - bounds.minBufX, 2);
    assert.strictEqual(bounds.maxBufX - bounds.maxVisX, 2);
    assert.strictEqual(bounds.minVisY - bounds.minBufY, 2);
    assert.strictEqual(bounds.maxBufY - bounds.maxVisY, 2);
  });

  it('isTileVisible and isTileBuffered predicates return expected membership', () => {
    const bounds = calculateTileBounds(0, 0, 800, 600, 64, 2);

    // Visible center tile
    assert.strictEqual(isTileVisible(0, 0, bounds), true);
    assert.strictEqual(isTileBuffered(0, 0, bounds), true);

    // Border visible tile
    assert.strictEqual(isTileVisible(-7, -5, bounds), true);
    assert.strictEqual(isTileBuffered(-7, -5, bounds), true);

    // Tile in buffer but outside visible viewport
    assert.strictEqual(isTileVisible(-8, -6, bounds), false);
    assert.strictEqual(isTileBuffered(-8, -6, bounds), true);

    // Tile completely outside buffer
    assert.strictEqual(isTileVisible(-15, 0, bounds), false);
    assert.strictEqual(isTileBuffered(-15, 0, bounds), false);
  });
});

describe('4. Sprite Pool Recycling Math & Zero-Allocation Invariant', () => {
  interface MockSprite {
    id: number;
    active: boolean;
    tx: number;
    ty: number;
  }

  it('maintains zero continuous allocations during simulated movement', () => {
    let nextId = 1;
    const pool = new SpritePool<MockSprite>({
      createItem: () => ({
        id: nextId++,
        active: false,
        tx: 0,
        ty: 0,
      }),
      onActivate: (item, tx, ty) => {
        item.active = true;
        item.tx = tx;
        item.ty = ty;
      },
      onRecycle: (item) => {
        item.active = false;
      },
    });

    // Initial frame at camera (0, 0)
    let camX = 0;
    let camY = 0;
    const initialBounds = calculateTileBounds(camX, camY, 800, 600, 64, 2);

    const initialResult = pool.update(initialBounds, (tx, ty) => getTileAt(tx, ty, 1337));
    assert.strictEqual(initialResult.acquired, 252);
    assert.strictEqual(pool.totalAllocated, 252);
    assert.strictEqual(pool.activeTiles.size, 252);
    assert.strictEqual(pool.freePool.length, 0);

    const initialTelemetry = pool.getTelemetry(initialBounds);
    assert.strictEqual(initialTelemetry.loadedCount, 252);
    assert.strictEqual(initialTelemetry.pooledCount, 0);
    assert.strictEqual(initialTelemetry.totalAllocated, 252);

    // Initial warm-up across sub-tile fractional alignments:
    // Viewport dimensions (800x600) produce bounding boxes between 238 and 270 tiles
    // depending on fractional sub-tile offsets (800/64 = 12.5 tiles, 600/64 = 9.375 tiles).
    for (let x = 0; x <= 64; x += 8) {
      for (let y = 0; y <= 64; y += 8) {
        const bounds = calculateTileBounds(x, y, 800, 600, 64, 2);
        pool.update(bounds, (tx, ty) => getTileAt(tx, ty, 1337));
      }
    }

    const steadyStateCap = pool.totalAllocated;
    assert.strictEqual(steadyStateCap, 270, 'Steady state capacity should cap at max buffer bounds 270');

    // Continuous simulated camera movement over 500 frames in arbitrary directions
    camX = 64;
    camY = 64;
    for (let frame = 1; frame <= 500; frame++) {
      camX += 17.5;
      camY += 13.2;

      const currentBounds = calculateTileBounds(camX, camY, 800, 600, 64, 2);
      pool.update(currentBounds, (tx, ty) => getTileAt(tx, ty, 1337));

      // Invariant 1: Conservation of sprites - active + freePool strictly equals steadyStateCap
      assert.strictEqual(
        pool.activeTiles.size + pool.freePool.length,
        steadyStateCap,
        `Conservation of sprites violated at frame ${frame}`
      );

      // Invariant 2: Zero steady-state allocations - totalAllocated NEVER increases
      assert.strictEqual(
        pool.totalAllocated,
        steadyStateCap,
        `Zero-allocation invariant failed: allocation grew at frame ${frame}`
      );
    }
  });

  it('pool.clear() recycles all active sprites into the free pool', () => {
    let nextId = 1;
    const pool = new SpritePool<MockSprite>({
      createItem: () => ({ id: nextId++, active: false, tx: 0, ty: 0 }),
      onActivate: (item) => { item.active = true; },
      onRecycle: (item) => { item.active = false; },
    });

    const bounds = calculateTileBounds(0, 0, 800, 600, 64, 2);
    pool.update(bounds, (tx, ty) => getTileAt(tx, ty, 1337));

    assert.ok(pool.activeTiles.size > 0);
    const totalAlloc = pool.totalAllocated;

    pool.clear();

    assert.strictEqual(pool.activeTiles.size, 0);
    assert.strictEqual(pool.freePool.length, totalAlloc);
  });
});
