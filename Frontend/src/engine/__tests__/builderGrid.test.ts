import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PrefabCodec,
  StackedPrefabCodec,
  type PrefabData,
} from '../prefab/PrefabCodec.ts';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  clampFreePixelPosition,
  commitFloatingTilesToGrid,
  commitFloatingTilesToLayerStack,
  computeStampPreviewCells,
  computeStackedStampPreviewCells,
  createEmptyGrid,
  createLayerStack,
  eraseCellFromLayerStack,
  getCellStack,
  resizeGrid,
  resizeLayerStack,
  setCellInLayerStack,
  snapPixelToGridCell,
  stampPrefabOntoGrid,
  stampPrefabOntoLayerStack,
  trimAndEncodeLayerStack,
  trimAndEncodePrefab,
  updateCellTileZIndex,
} from '../prefab/builderGrid.ts';

describe('builderGrid', () => {
  describe('1. Grid Creation & Resizing', () => {
    it('creates zero-filled Uint32Array grids of the requested dimensions', () => {
      const empty = createEmptyGrid(0, 0);
      assert.ok(empty instanceof Uint32Array);
      assert.strictEqual(empty.length, 0);

      const grid = createEmptyGrid(4, 3);
      assert.ok(grid instanceof Uint32Array);
      assert.strictEqual(grid.length, 12);
      assert.ok(grid.every((value) => value === 0));
    });

    it('resizes grids while preserving top-left overlap, zero-padding expansions, and cropping shrinkages', () => {
      const source = new Uint32Array([
        11, 12,
        21, 22,
      ]);

      const expanded = resizeGrid(source, 2, 2, 4, 3);
      assert.deepStrictEqual(
        expanded,
        new Uint32Array([
          11, 12, 0, 0,
          21, 22, 0, 0,
          0, 0, 0, 0,
        ])
      );
      // Must not mutate input grid
      assert.deepStrictEqual(source, new Uint32Array([11, 12, 21, 22]));

      const cropped = resizeGrid(expanded, 4, 3, 2, 2);
      assert.deepStrictEqual(cropped, source);

      // Asymmetric resize: wider and shorter (3x3 -> 4x2)
      const grid3x3 = new Uint32Array([
        1, 2, 3,
        4, 5, 6,
        7, 8, 9,
      ]);
      const asym = resizeGrid(grid3x3, 3, 3, 4, 2);
      assert.deepStrictEqual(
        asym,
        new Uint32Array([
          1, 2, 3, 0,
          4, 5, 6, 0,
        ])
      );

      assert.strictEqual(resizeGrid(source, 2, 2, 0, 0).length, 0);
    });
  });

  describe('2. Trimming & Encoding Prefabs', () => {
    it('crops to the tightest non-zero bounding box, adjusts in-bounds anchor, and round-trips through PrefabCodec', () => {
      // 6x5 canvas with non-empty tiles spanning cols 2..4 (width 3), rows 1..3 (height 3)
      const width = 6;
      const height = 5;
      const grid = createEmptyGrid(width, height);
      grid[1 * width + 2] = 65536;
      grid[1 * width + 4] = 65537;
      grid[2 * width + 3] = 65538;
      grid[3 * width + 2] = 65539;
      grid[3 * width + 4] = 65540;

      // Anchor at (3, 3) is inside crop [2..4, 1..3] -> relative anchor (1, 2)
      const result = trimAndEncodePrefab(width, height, 3, 3, grid);

      assert.strictEqual(result.prefab.width, 3);
      assert.strictEqual(result.prefab.height, 3);
      assert.strictEqual(result.prefab.anchorX, 1);
      assert.strictEqual(result.prefab.anchorY, 2);
      assert.deepStrictEqual(
        result.prefab.grid,
        new Uint32Array([
          65536, 0, 65537,
          0, 65538, 0,
          65539, 0, 65540,
        ])
      );

      assert.strictEqual(result.compressedByteLength, result.buffer.byteLength);
      assert.ok(result.rawByteLength > 0);
      assert.ok(Number.isFinite(result.compressionRatio) && result.compressionRatio > 0);

      const decoded = PrefabCodec.decode(result.buffer);
      assert.strictEqual(decoded.width, 3);
      assert.strictEqual(decoded.height, 3);
      assert.strictEqual(decoded.anchorX, 1);
      assert.strictEqual(decoded.anchorY, 2);
      assert.deepStrictEqual(decoded.grid, result.prefab.grid);
    });

    it('defaults anchor to bottom-center of cropped bounds when input anchor falls outside the crop', () => {
      // 5x5 canvas with 3x3 occupied region at cols 1..3, rows 1..3
      const width = 5;
      const height = 5;
      const grid = createEmptyGrid(width, height);
      grid[1 * width + 1] = 101;
      grid[3 * width + 3] = 102;

      // Input anchor (0, 0) is outside [1..3, 1..3] -> bottom-center of 3x3 is (1, 2)
      const result = trimAndEncodePrefab(width, height, 0, 0, grid);
      assert.strictEqual(result.prefab.width, 3);
      assert.strictEqual(result.prefab.height, 3);
      assert.strictEqual(result.prefab.anchorX, 1);
      assert.strictEqual(result.prefab.anchorY, 2);

      // Single-tile crop with out-of-bounds anchor defaults to (0, 0)
      const single = createEmptyGrid(4, 4);
      single[2 * 4 + 3] = 200;
      const singleResult = trimAndEncodePrefab(4, 4, 0, 0, single);
      assert.strictEqual(singleResult.prefab.width, 1);
      assert.strictEqual(singleResult.prefab.height, 1);
      assert.strictEqual(singleResult.prefab.anchorX, 0);
      assert.strictEqual(singleResult.prefab.anchorY, 0);
    });

    it('returns a 0x0 prefab and 9-byte buffer when the grid contains only emptyAssetId', () => {
      const emptyGrid = createEmptyGrid(4, 4);
      const result = trimAndEncodePrefab(4, 4, 2, 2, emptyGrid);

      assert.strictEqual(result.prefab.width, 0);
      assert.strictEqual(result.prefab.height, 0);
      assert.strictEqual(result.prefab.grid.length, 0);
      assert.strictEqual(result.buffer.byteLength, 11);
      assert.strictEqual(result.compressedByteLength, 11);

      const decoded = PrefabCodec.decode(result.buffer);
      assert.strictEqual(decoded.width, 0);
      assert.strictEqual(decoded.height, 0);
      assert.strictEqual(decoded.grid.length, 0);
    });

    it('respects a custom emptyAssetId when trimming', () => {
      const EMPTY = 999;
      const grid = new Uint32Array(9).fill(EMPTY);
      grid[4] = 500; // Center cell (1, 1)

      const result = trimAndEncodePrefab(3, 3, 1, 1, grid, EMPTY);
      assert.strictEqual(result.prefab.width, 1);
      assert.strictEqual(result.prefab.height, 1);
      assert.strictEqual(result.prefab.anchorX, 0);
      assert.strictEqual(result.prefab.anchorY, 0);
      assert.deepStrictEqual(result.prefab.grid, new Uint32Array([500]));
    });
  });

  describe('3. Stamping & Preview Cells', () => {
    it('stamps prefab aligned to anchor without overwriting existing tiles on empty cells and without mutating input', () => {
      const targetW = 5;
      const targetH = 5;
      const targetGrid = new Uint32Array(targetW * targetH).fill(10);
      const snapshot = new Uint32Array(targetGrid);

      const prefab: PrefabData = {
        width: 3,
        height: 2,
        anchorX: 1,
        anchorY: 1,
        anchorZ: 0,
        grid: new Uint32Array([
          100, 0, 200,
          0, 300, 400,
        ]),
      };

      // Anchor (1, 1) drops onto (2, 2) -> spans x=[1..3], y=[1..2]
      const stamped = stampPrefabOntoGrid(targetGrid, targetW, targetH, prefab, 2, 2);

      // Input grid remains untouched
      assert.deepStrictEqual(targetGrid, snapshot);

      // Row 1: (1,1)=100, (2,1)=10 (preserved!), (3,1)=200
      assert.strictEqual(stamped[1 * targetW + 1], 100);
      assert.strictEqual(stamped[1 * targetW + 2], 10);
      assert.strictEqual(stamped[1 * targetW + 3], 200);
      // Row 2: (1,2)=10 (preserved!), (2,2)=300, (3,2)=400
      assert.strictEqual(stamped[2 * targetW + 1], 10);
      assert.strictEqual(stamped[2 * targetW + 2], 300);
      assert.strictEqual(stamped[2 * targetW + 3], 400);
    });

    it('clips stamped tiles cleanly at all four grid boundaries', () => {
      const targetW = 4;
      const targetH = 4;
      const targetGrid = createEmptyGrid(targetW, targetH);

      const prefab: PrefabData = {
        width: 3,
        height: 3,
        anchorX: 1,
        anchorY: 1,
        anchorZ: 0,
        grid: new Uint32Array([
          1, 2, 3,
          4, 5, 6,
          7, 8, 9,
        ]),
      };

      // Drop at top-left corner (0, 0) -> only bottom-right 2x2 of prefab lands on [0..1, 0..1]
      const topLeft = stampPrefabOntoGrid(targetGrid, targetW, targetH, prefab, 0, 0);
      assert.strictEqual(topLeft[0], 5);
      assert.strictEqual(topLeft[1], 6);
      assert.strictEqual(topLeft[targetW], 8);
      assert.strictEqual(topLeft[targetW + 1], 9);

      // Drop at bottom-right corner (3, 3) -> only top-left 2x2 of prefab lands on [2..3, 2..3]
      const bottomRight = stampPrefabOntoGrid(targetGrid, targetW, targetH, prefab, 3, 3);
      assert.strictEqual(bottomRight[2 * targetW + 2], 1);
      assert.strictEqual(bottomRight[2 * targetW + 3], 2);
      assert.strictEqual(bottomRight[3 * targetW + 2], 4);
      assert.strictEqual(bottomRight[3 * targetW + 3], 5);
    });

    it('computes clipped non-empty preview cells relative to hover coordinates and anchor', () => {
      const prefab: PrefabData = {
        width: 2,
        height: 2,
        anchorX: 1,
        anchorY: 1,
        anchorZ: 0,
        grid: new Uint32Array([
          11, 0,
          22, 33,
        ]),
      };

      // Hover at (0, 0) with anchor (1, 1):
      // (0,0)->(-1,-1) clipped; (1,0)->(0,-1) empty & clipped; (0,1)->(-1,0) clipped; (1,1)->(0,0) = 33
      const clippedPreview = computeStampPreviewCells(4, 4, prefab, 0, 0);
      assert.deepStrictEqual(clippedPreview, [{ x: 0, y: 0, assetId: 33 }]);

      // Hover at (2, 2): (1,1)=11, (1,2)=22, (2,2)=33
      const centerPreview = computeStampPreviewCells(4, 4, prefab, 2, 2);
      assert.deepStrictEqual(centerPreview, [
        { x: 1, y: 1, assetId: 11 },
        { x: 1, y: 2, assetId: 22 },
        { x: 2, y: 2, assetId: 33 },
      ]);

      // Empty 0x0 prefab yields []
      const emptyPreview = computeStampPreviewCells(
        4,
        4,
        { width: 0, height: 0, anchorX: 0, anchorY: 0, anchorZ: 0, grid: new Uint32Array(0) },
        2,
        2
      );
      assert.deepStrictEqual(emptyPreview, []);
    });
  });

  describe('4. Free-Drag & Snap Helpers', () => {
    it('clamps free pixel positions inside the grid canvas bounds', () => {
      assert.deepStrictEqual(clampFreePixelPosition(-25, -10, 8, 6, 32), {
        pixelX: 0,
        pixelY: 0,
      });

      assert.deepStrictEqual(clampFreePixelPosition(75, 110, 8, 6, 32), {
        pixelX: 75,
        pixelY: 110,
      });

      assert.deepStrictEqual(clampFreePixelPosition(999, 999, 8, 6, 32), {
        pixelX: 7 * 32,
        pixelY: 5 * 32,
      });
    });

    it('snaps pixel positions to the nearest valid grid cell coordinates', () => {
      assert.deepStrictEqual(snapPixelToGridCell(0, 0, 8, 6, 32), { col: 0, row: 0 });
      assert.deepStrictEqual(snapPixelToGridCell(32 + 12, 64 - 10, 8, 6, 32), {
        col: 1,
        row: 2,
      });
      assert.deepStrictEqual(snapPixelToGridCell(-50, -50, 8, 6, 32), { col: 0, row: 0 });
      assert.deepStrictEqual(snapPixelToGridCell(9999, 9999, 8, 6, 32), {
        col: 7,
        row: 5,
      });
    });

    it('commits floating tiles into a cloned grid at snapped cell coordinates', () => {
      const gridW = 4;
      const gridH = 4;
      const baseGrid = createEmptyGrid(gridW, gridH);
      baseGrid[0] = 10;

      const committed = commitFloatingTilesToGrid(baseGrid, gridW, gridH, 32, [
        { id: 't1', assetId: 1001, pixelX: 30, pixelY: 66 }, // snaps to col 1, row 2
        { id: 't2', assetId: 1002, pixelX: 99, pixelY: 94 }, // snaps to col 3, row 3
      ]);

      // Does not mutate input grid
      assert.strictEqual(baseGrid[2 * gridW + 1], 0);
      assert.strictEqual(committed[0], 10);
      assert.strictEqual(committed[2 * gridW + 1], 1001);
      assert.strictEqual(committed[3 * gridW + 3], 1002);
    });
  });

  describe('5. Base64 ArrayBuffer Serialization', () => {
    it('round-trips arbitrary binary buffers and encoded prefabs cleanly', () => {
      const raw = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x42, 0x13]);
      const roundTripped = base64ToArrayBuffer(arrayBufferToBase64(raw.buffer));
      assert.ok(roundTripped instanceof ArrayBuffer);
      assert.deepStrictEqual(new Uint8Array(roundTripped), raw);

      const encodedPrefab = PrefabCodec.encode(2, 2, 1, 1, 0, new Uint32Array([65536, 0, 131072, 65536]));
      const decodedBytes = base64ToArrayBuffer(arrayBufferToBase64(encodedPrefab));
      assert.deepStrictEqual(new Uint8Array(decodedBytes), new Uint8Array(encodedPrefab));

      const empty = new ArrayBuffer(0);
      assert.strictEqual(base64ToArrayBuffer(arrayBufferToBase64(empty)).byteLength, 0);
    });
  });

  describe('6. Tile Stacking & Z-Index Layer Operations', () => {
    it('stacks a tree on top of grass when stackOnTop=true and replaces only active zIndex when stackOnTop=false', () => {
      let layers = createLayerStack(4, 4);
      const GRASS = 65536;
      const TREE = 393216;
      const FLOWER = 65537;

      // Place grass at (1, 1) on z=0
      const step1 = setCellInLayerStack(layers, 4, 4, 1, 1, GRASS, 0, false);
      layers = step1.layers;
      assert.strictEqual(step1.placedZIndex, 0);

      // With stackOnTop=true and activeZ=0, placing TREE stacks it at z=1 without erasing GRASS
      const step2 = setCellInLayerStack(layers, 4, 4, 1, 1, TREE, 0, true);
      layers = step2.layers;
      assert.strictEqual(step2.placedZIndex, 1);
      assert.deepStrictEqual(getCellStack(layers, 4, 1, 1), [
        { zIndex: 0, assetId: GRASS },
        { zIndex: 1, assetId: TREE },
      ]);

      // With stackOnTop=false at z=0, placing FLOWER replaces only z=0 while keeping z=1 TREE intact
      const step3 = setCellInLayerStack(layers, 4, 4, 1, 1, FLOWER, 0, false);
      layers = step3.layers;
      assert.strictEqual(step3.placedZIndex, 0);
      assert.deepStrictEqual(getCellStack(layers, 4, 1, 1), [
        { zIndex: 0, assetId: FLOWER },
        { zIndex: 1, assetId: TREE },
      ]);
    });

    it('reorders stack via updateCellTileZIndex (swap on occupied zIndex, move on free zIndex) and erases topmost first', () => {
      let layers = createLayerStack(3, 3);
      layers = setCellInLayerStack(layers, 3, 3, 1, 1, 100, 0, false).layers;
      layers = setCellInLayerStack(layers, 3, 3, 1, 1, 200, 1, false).layers;

      // Swap z=1 (200) and z=0 (100)
      layers = updateCellTileZIndex(layers, 3, 3, 1, 1, 1, 0);
      assert.deepStrictEqual(getCellStack(layers, 3, 1, 1), [
        { zIndex: 0, assetId: 200 },
        { zIndex: 1, assetId: 100 },
      ]);

      // Move z=0 (200) to unoccupied z=5
      layers = updateCellTileZIndex(layers, 3, 3, 1, 1, 0, 5);
      assert.deepStrictEqual(getCellStack(layers, 3, 1, 1), [
        { zIndex: 1, assetId: 100 },
        { zIndex: 5, assetId: 200 },
      ]);

      // Erase without explicit zIndex removes topmost (z=5) first, leaving z=1
      layers = eraseCellFromLayerStack(layers, 3, 1, 1);
      assert.deepStrictEqual(getCellStack(layers, 3, 1, 1), [{ zIndex: 1, assetId: 100 }]);

      // Resize preserves stacked layers
      const resized = resizeLayerStack(layers, 3, 3, 5, 5);
      assert.deepStrictEqual(getCellStack(resized, 5, 1, 1), [{ zIndex: 1, assetId: 100 }]);
    });

    it('trims across union bounding box of all layers, encodes/decodes stacked payload, and stamps onto another stack', () => {
      let layers = createLayerStack(6, 6);
      layers = setCellInLayerStack(layers, 6, 6, 2, 2, 10, 0, false).layers;
      layers = setCellInLayerStack(layers, 6, 6, 3, 3, 11, 0, false).layers;
      layers = setCellInLayerStack(layers, 6, 6, 3, 3, 22, 2, false).layers;

      const encoded = trimAndEncodeLayerStack(6, 6, 3, 3, layers, 0, -1);
      assert.strictEqual(encoded.stacked.width, 2);
      assert.strictEqual(encoded.stacked.height, 2);
      assert.strictEqual(encoded.stacked.anchorX, 1);
      assert.strictEqual(encoded.stacked.anchorY, 1);
      assert.strictEqual(encoded.stacked.anchorZ, -1);
      assert.strictEqual(encoded.layerCount, 2);
      assert.strictEqual(StackedPrefabCodec.isStackedBuffer(encoded.buffer), true);

      const decoded = StackedPrefabCodec.decodeAny(encoded.buffer);
      assert.strictEqual(decoded.layers.length, 2);
      assert.strictEqual(decoded.anchorZ, -1);

      // Stamp onto a 5x5 canvas at (2, 2) with baseZOffset=2 -> anchorZ(-1)+layerZ(0)+2=1, anchorZ(-1)+layerZ(2)+2=3
      let target = createLayerStack(5, 5);
      target = setCellInLayerStack(target, 5, 5, 2, 2, 99, 0, false).layers; // base grass at (2,2) z=0
      const preview = computeStackedStampPreviewCells(5, 5, decoded, 2, 2, 2);
      assert.strictEqual(preview.length, 3);
      assert.deepStrictEqual(preview[2], { x: 2, y: 2, zIndex: 3, assetId: 22 });

      const stamped = stampPrefabOntoLayerStack(target, 5, 5, decoded, 2, 2, 2);
      assert.deepStrictEqual(getCellStack(stamped, 5, 2, 2), [
        { zIndex: 0, assetId: 99 },
        { zIndex: 1, assetId: 11 },
        { zIndex: 3, assetId: 22 },
      ]);
    });

    it('commits floating tiles into their respective zIndex layers', () => {
      const base = createLayerStack(4, 4);
      const committed = commitFloatingTilesToLayerStack(base, 4, 4, 32, [
        { id: 'f1', assetId: 50, pixelX: 32, pixelY: 32, zIndex: 0 },
        { id: 'f2', assetId: 60, pixelX: 34, pixelY: 30, zIndex: 2 },
      ]);

      assert.deepStrictEqual(getCellStack(committed, 4, 1, 1), [
        { zIndex: 0, assetId: 50 },
        { zIndex: 2, assetId: 60 },
      ]);
    });
  });
});
