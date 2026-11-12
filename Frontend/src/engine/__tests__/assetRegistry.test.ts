import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_SETS,
  EMPTY_ASSET_ID,
  TILE_PIXEL_SIZE,
  decodeAssetId,
  encodeAssetId,
  extractNonEmptyTileIndices,
  getAssetSetBySheetId,
  hasOpaquePixels,
  type AssetSetDefinition,
} from '../prefab/assetRegistry.ts';

function paintPixel(
  rgba: Uint8ClampedArray,
  imageWidth: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number
): void {
  const offset = (y * imageWidth + x) * 4;
  rgba[offset] = r;
  rgba[offset + 1] = g;
  rgba[offset + 2] = b;
  rgba[offset + 3] = a;
}

describe('assetRegistry', () => {
  describe('1. Constants & Global Asset ID Packing', () => {
    it('defines EMPTY_ASSET_ID as 0 and TILE_PIXEL_SIZE as 32', () => {
      assert.strictEqual(EMPTY_ASSET_ID, 0);
      assert.strictEqual(TILE_PIXEL_SIZE, 32);
    });

    it('encodes (sheetId, tileIndex) with exact bit layout and decodes back', () => {
      const cases: Array<[number, number, number]> = [
        [1, 0, ((1 << 16) | 0) >>> 0],
        [1, 61, ((1 << 16) | 61) >>> 0],
        [3, 128, ((3 << 16) | 128) >>> 0],
        [6, 255, ((6 << 16) | 255) >>> 0],
        [255, 65535, ((255 << 16) | 65535) >>> 0],
      ];

      for (const [sheetId, tileIndex, expected] of cases) {
        const encoded = encodeAssetId(sheetId, tileIndex);
        assert.strictEqual(encoded, expected);
        assert.deepStrictEqual(decodeAssetId(encoded), { sheetId, tileIndex });
      }
    });

    it('decodes EMPTY_ASSET_ID (0) to null', () => {
      assert.strictEqual(decodeAssetId(0), null);
      assert.strictEqual(decodeAssetId(EMPTY_ASSET_ID), null);
    });

    it('throws RangeError for invalid sheetId or tileIndex', () => {
      assert.throws(() => encodeAssetId(0, 0), RangeError);
      assert.throws(() => encodeAssetId(-1, 0), RangeError);
      assert.throws(() => encodeAssetId(256, 0), RangeError);
      assert.throws(() => encodeAssetId(1.5, 0), RangeError);
      assert.throws(() => encodeAssetId(Number.NaN, 0), RangeError);

      assert.throws(() => encodeAssetId(1, -1), RangeError);
      assert.throws(() => encodeAssetId(1, 65536), RangeError);
      assert.throws(() => encodeAssetId(1, 0.5), RangeError);
      assert.throws(() => encodeAssetId(1, Number.NaN), RangeError);
    });
  });

  describe('2. ASSET_SETS Catalog & Lookup', () => {
    it('registers the 6 tilesets in exact order with expected metadata', () => {
      assert.strictEqual(ASSET_SETS.length, 6);

      const expectedSets = [
        {
          sheetId: 1,
          id: 'grass',
          label: 'Grass',
          path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Grass.png',
          width: 256,
          height: 256,
          cols: 8,
          rows: 8,
          tileSize: 32,
          excludedIndices: [62, 63],
        },
        {
          sheetId: 2,
          id: 'stone_ground',
          label: 'Stone Ground',
          path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Stone Ground.png',
          width: 256,
          height: 256,
          cols: 8,
          rows: 8,
          tileSize: 32,
        },
        {
          sheetId: 3,
          id: 'wall',
          label: 'Walls',
          path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Wall.png',
          width: 512,
          height: 512,
          cols: 16,
          rows: 16,
          tileSize: 32,
        },
        {
          sheetId: 4,
          id: 'struct',
          label: 'Structures',
          path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Struct.png',
          width: 512,
          height: 512,
          cols: 16,
          rows: 16,
          tileSize: 32,
        },
        {
          sheetId: 5,
          id: 'props',
          label: 'Props',
          path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Props.png',
          width: 512,
          height: 512,
          cols: 16,
          rows: 16,
          tileSize: 32,
        },
        {
          sheetId: 6,
          id: 'plant',
          label: 'Plants',
          path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Plant.png',
          width: 512,
          height: 512,
          cols: 16,
          rows: 16,
          tileSize: 32,
        },
      ];

      for (let i = 0; i < expectedSets.length; i++) {
        const actual = ASSET_SETS[i];
        const expected = expectedSets[i];
        assert.strictEqual(actual.sheetId, expected.sheetId);
        assert.strictEqual(actual.id, expected.id);
        assert.strictEqual(actual.label, expected.label);
        assert.strictEqual(actual.path, expected.path);
        assert.strictEqual(actual.width, expected.width);
        assert.strictEqual(actual.height, expected.height);
        assert.strictEqual(actual.cols, expected.cols);
        assert.strictEqual(actual.rows, expected.rows);
        assert.strictEqual(actual.tileSize, expected.tileSize);
      }

      assert.deepStrictEqual(ASSET_SETS[0].excludedIndices, [62, 63]);
      for (let i = 1; i < ASSET_SETS.length; i++) {
        assert.deepStrictEqual(ASSET_SETS[i].excludedIndices ?? [], []);
      }
    });

    it('looks up asset sets by sheetId and returns undefined for unknown IDs', () => {
      for (const set of ASSET_SETS) {
        assert.strictEqual(getAssetSetBySheetId(set.sheetId), set);
      }

      assert.strictEqual(getAssetSetBySheetId(0), undefined);
      assert.strictEqual(getAssetSetBySheetId(-1), undefined);
      assert.strictEqual(getAssetSetBySheetId(7), undefined);
      assert.strictEqual(getAssetSetBySheetId(255), undefined);
    });
  });

  describe('3. Opaque Pixel & Non-Empty Tile Extraction', () => {
    it('detects opaque pixels inside a tile cell while ignoring alpha=0 pixels', () => {
      const imageWidth = 64;
      const imageHeight = 64;
      const rgba = new Uint8ClampedArray(imageWidth * imageHeight * 4);

      // RGB data with alpha = 0 in cell (0, 0) must still be treated as transparent
      paintPixel(rgba, imageWidth, 10, 10, 255, 128, 64, 0);
      assert.strictEqual(hasOpaquePixels(rgba, imageWidth, 0, 0), false);

      // Paint bottom-right corner of cell (1, 0) -> x = 63, y = 31
      paintPixel(rgba, imageWidth, 63, 31, 10, 20, 30, 1);
      assert.strictEqual(hasOpaquePixels(rgba, imageWidth, 1, 0), true);
      assert.strictEqual(hasOpaquePixels(rgba, imageWidth, 0, 0), false);
      assert.strictEqual(hasOpaquePixels(rgba, imageWidth, 0, 1), false);
      assert.strictEqual(hasOpaquePixels(rgba, imageWidth, 1, 1), false);
    });

    it('supports custom tileSize in hasOpaquePixels', () => {
      const imageWidth = 8;
      const rgba = new Uint8ClampedArray(imageWidth * 8 * 4);
      paintPixel(rgba, imageWidth, 4, 4, 255, 255, 255, 255);

      assert.strictEqual(hasOpaquePixels(rgba, imageWidth, 0, 0, 4), false);
      assert.strictEqual(hasOpaquePixels(rgba, imageWidth, 1, 0, 4), false);
      assert.strictEqual(hasOpaquePixels(rgba, imageWidth, 0, 1, 4), false);
      assert.strictEqual(hasOpaquePixels(rgba, imageWidth, 1, 1, 4), true);
    });

    it('extracts non-empty tile indices and excludes marker indices on Grass', () => {
      const grassSet = ASSET_SETS[0];
      const rgba = new Uint8ClampedArray(grassSet.width * grassSet.height * 4);

      // Tile 0 (col 0, row 0)
      paintPixel(rgba, grassSet.width, 0, 0, 100, 200, 50, 255);
      // Tile 9 (col 1, row 1)
      paintPixel(rgba, grassSet.width, 32 + 15, 32 + 15, 100, 200, 50, 128);
      // Tile 61 (col 5, row 7)
      paintPixel(rgba, grassSet.width, 5 * 32 + 1, 7 * 32 + 1, 200, 200, 200, 255);
      // Excluded marker tiles 62 (col 6, row 7) and 63 (col 7, row 7)
      paintPixel(rgba, grassSet.width, 6 * 32, 7 * 32, 255, 0, 0, 255);
      paintPixel(rgba, grassSet.width, 7 * 32, 7 * 32, 255, 0, 0, 255);

      const indices = extractNonEmptyTileIndices(rgba, grassSet);
      assert.deepStrictEqual(indices, [0, 9, 61]);
    });

    it('extracts non-empty tile indices on 512x512 sets without excluded indices', () => {
      const propsSet: AssetSetDefinition = ASSET_SETS[4];
      const rgba = new Uint8ClampedArray(propsSet.width * propsSet.height * 4);

      // Tile 17 (col 1, row 1) and tile 255 (col 15, row 15)
      paintPixel(rgba, propsSet.width, 1 * 32 + 4, 1 * 32 + 4, 255, 255, 0, 255);
      paintPixel(rgba, propsSet.width, 15 * 32 + 31, 15 * 32 + 31, 0, 255, 255, 255);

      const indices = extractNonEmptyTileIndices(rgba, propsSet);
      assert.deepStrictEqual(indices, [17, 255]);
    });
  });
});
