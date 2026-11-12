import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { PrefabCodec, type PrefabData } from '../prefab/PrefabCodec.ts';

describe('PrefabCodec', () => {
  describe('1. Binary Memory Layout', () => {
    it('encodes exact Little-Endian header, palette length, Uint32 palette, and [Count, PaletteIndex] RLE pairs', () => {
      // 4x4 grid: 15 grass tiles (assetId 1001) followed by 1 stone path tile (assetId 2002)
      const grassId = 1001;
      const stoneId = 2002;
      const rawGrid = new Uint32Array(16).fill(grassId);
      rawGrid[15] = stoneId;

      const buffer = PrefabCodec.encode(4, 4, -2, 3, rawGrid);

      // Expected size: 8B header + 1B paletteCount + (2 * 4B palette) + (2 * 2B RLE pairs) = 21 bytes
      assert.strictEqual(buffer.byteLength, 21);

      const view = new DataView(buffer);

      // Header (8 bytes)
      assert.strictEqual(view.getUint16(0, true), 4, 'width');
      assert.strictEqual(view.getUint16(2, true), 4, 'height');
      assert.strictEqual(view.getInt16(4, true), -2, 'anchorX');
      assert.strictEqual(view.getInt16(6, true), 3, 'anchorY');

      // Palette Length (1 byte)
      assert.strictEqual(view.getUint8(8), 2, 'paletteCount');

      // Palette Data (Uint32[])
      assert.strictEqual(view.getUint32(9, true), grassId, 'palette[0]');
      assert.strictEqual(view.getUint32(13, true), stoneId, 'palette[1]');

      // RLE Grid Data: [15, 0], [1, 1]
      assert.strictEqual(view.getUint8(17), 15, 'run 0 count');
      assert.strictEqual(view.getUint8(18), 0, 'run 0 palette index');
      assert.strictEqual(view.getUint8(19), 1, 'run 1 count');
      assert.strictEqual(view.getUint8(20), 1, 'run 1 palette index');
    });

    it('encodes a 0x0 empty prefab into a tight 9-byte buffer', () => {
      const buffer = PrefabCodec.encode(0, 0, -5, 10, new Uint32Array(0));
      assert.strictEqual(buffer.byteLength, 9);

      const view = new DataView(buffer);
      assert.strictEqual(view.getUint16(0, true), 0);
      assert.strictEqual(view.getUint16(2, true), 0);
      assert.strictEqual(view.getInt16(4, true), -5);
      assert.strictEqual(view.getInt16(6, true), 10);
      assert.strictEqual(view.getUint8(8), 0);
    });
  });

  describe('2. Round-Trip Encode & Decode Fidelity', () => {
    it('round-trips a structured building/park prefab with high-range 32-bit asset IDs and extreme Int16 anchors', () => {
      const width = 12;
      const height = 10;
      const rawGrid = new Uint32Array(width * height);

      const GRASS = 0;
      const WALL = 0xdeadbeef;
      const DOOR = 0xffffffff;
      const FOUNTAIN = 0x80000001;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
            rawGrid[idx] = WALL;
          } else if (x >= 5 && x <= 6 && y >= 4 && y <= 5) {
            rawGrid[idx] = FOUNTAIN;
          } else {
            rawGrid[idx] = GRASS;
          }
        }
      }
      rawGrid[(height - 1) * width + 5] = DOOR;

      const buffer = PrefabCodec.encode(width, height, -32768, 32767, rawGrid);
      assert.ok(buffer.byteLength < rawGrid.byteLength, 'RLE should compress structured prefab');

      const decoded = PrefabCodec.decode(buffer);
      assert.strictEqual(decoded.width, width);
      assert.strictEqual(decoded.height, height);
      assert.strictEqual(decoded.anchorX, -32768);
      assert.strictEqual(decoded.anchorY, 32767);
      assert.deepStrictEqual(decoded.grid, rawGrid);
    });

    it('splits RLE runs longer than 255 consecutive tiles cleanly', () => {
      // 300 identical tiles -> [255, 0], [45, 0]
      const width = 20;
      const height = 15;
      const raw300 = new Uint32Array(width * height).fill(42);

      const buf300 = PrefabCodec.encode(width, height, 0, 0, raw300);
      assert.strictEqual(buf300.byteLength, 9 + 4 + 4);

      const view300 = new DataView(buf300);
      assert.strictEqual(view300.getUint8(13), 255);
      assert.strictEqual(view300.getUint8(14), 0);
      assert.strictEqual(view300.getUint8(15), 45);
      assert.strictEqual(view300.getUint8(16), 0);

      const decoded300 = PrefabCodec.decode(buf300);
      assert.deepStrictEqual(decoded300.grid, raw300);

      // Exact multiple of 255: 510 tiles -> [255, 0], [255, 0] with no trailing empty pair
      const raw510 = new Uint32Array(510).fill(99);
      const buf510 = PrefabCodec.encode(510, 1, 0, 0, raw510);
      assert.strictEqual(buf510.byteLength, 9 + 4 + 4);
      const decoded510 = PrefabCodec.decode(buf510);
      assert.deepStrictEqual(decoded510.grid, raw510);
    });

    it('handles worst-case alternating checkerboard and 1x1 grids', () => {
      const single = new Uint32Array([777]);
      const singleDecoded = PrefabCodec.decode(PrefabCodec.encode(1, 1, 0, 0, single));
      assert.deepStrictEqual(singleDecoded.grid, single);

      const checker = new Uint32Array(64);
      for (let i = 0; i < checker.length; i++) {
        checker[i] = i % 2 === 0 ? 10 : 20;
      }
      const buf = PrefabCodec.encode(8, 8, 4, 4, checker);
      assert.strictEqual(buf.byteLength, 9 + 2 * 4 + 64 * 2);
      const decoded = PrefabCodec.decode(buf);
      assert.deepStrictEqual(decoded.grid, checker);
    });

    it('supports up to 255 unique tile IDs in the palette', () => {
      const grid255 = new Uint32Array(255);
      for (let i = 0; i < 255; i++) {
        grid255[i] = 10000 + i;
      }
      const buffer = PrefabCodec.encode(255, 1, 0, 0, grid255);
      const decoded = PrefabCodec.decode(buffer);
      assert.deepStrictEqual(decoded.grid, grid255);
    });

    it('decodes empty 0x0 buffer back to empty Uint32Array', () => {
      const buffer = PrefabCodec.encode(0, 0, 1, -1, new Uint32Array(0));
      const decoded = PrefabCodec.decode(buffer);
      assert.strictEqual(decoded.width, 0);
      assert.strictEqual(decoded.height, 0);
      assert.strictEqual(decoded.anchorX, 1);
      assert.strictEqual(decoded.anchorY, -1);
      assert.strictEqual(decoded.grid.length, 0);
    });
  });

  describe('3. Validation & Malformed Payload Protection', () => {
    it('rejects > 255 unique tiles and out-of-range encode arguments', () => {
      const grid256 = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        grid256[i] = i;
      }
      assert.throws(() => PrefabCodec.encode(256, 1, 0, 0, grid256), RangeError);

      assert.throws(() => PrefabCodec.encode(-1, 1, 0, 0, new Uint32Array(0)), RangeError);
      assert.throws(() => PrefabCodec.encode(65536, 1, 0, 0, new Uint32Array(0)), RangeError);
      assert.throws(() => PrefabCodec.encode(1, 1, -32769, 0, new Uint32Array(1)), RangeError);
      assert.throws(() => PrefabCodec.encode(1, 1, 0, 32768, new Uint32Array(1)), RangeError);
      assert.throws(() => PrefabCodec.encode(2, 2, 0, 0, new Uint32Array(3)), RangeError);
    });

    it('rejects truncated, misaligned, corrupt, or OOM-bomb buffers in decode', () => {
      assert.throws(() => PrefabCodec.decode(new ArrayBuffer(8)), RangeError);

      // Truncated palette (claims 2 entries = 17 bytes min, given 12 bytes)
      const truncPalette = new ArrayBuffer(12);
      const tpView = new DataView(truncPalette);
      tpView.setUint16(0, 1, true);
      tpView.setUint16(2, 1, true);
      tpView.setUint8(8, 2);
      assert.throws(() => PrefabCodec.decode(truncPalette), RangeError);

      // Odd RLE byte count
      const oddRle = new ArrayBuffer(9 + 4 + 3);
      const oddView = new DataView(oddRle);
      oddView.setUint16(0, 1, true);
      oddView.setUint16(2, 1, true);
      oddView.setUint8(8, 1);
      assert.throws(() => PrefabCodec.decode(oddRle), RangeError);

      // Zero run count
      const zeroCount = PrefabCodec.encode(2, 1, 0, 0, new Uint32Array([5, 5]));
      new DataView(zeroCount).setUint8(13, 0);
      assert.throws(() => PrefabCodec.decode(zeroCount), RangeError);

      // Palette index out of bounds
      const badIdx = PrefabCodec.encode(1, 1, 0, 0, new Uint32Array([5]));
      new DataView(badIdx).setUint8(14, 1);
      assert.throws(() => PrefabCodec.decode(badIdx), RangeError);

      // RLE count overflows width*height
      const overflowRle = PrefabCodec.encode(1, 1, 0, 0, new Uint32Array([5]));
      new DataView(overflowRle).setUint8(13, 2);
      assert.throws(() => PrefabCodec.decode(overflowRle), RangeError);

      // RLE count underflows width*height
      const underflowRle = PrefabCodec.encode(2, 1, 0, 0, new Uint32Array([5, 5]));
      new DataView(underflowRle).setUint8(13, 1);
      assert.throws(() => PrefabCodec.decode(underflowRle), RangeError);

      // OOM protection: claims 65535x65535 tiles with only 1 RLE pair
      const oomBuffer = PrefabCodec.encode(1, 1, 0, 0, new Uint32Array([5]));
      const oomView = new DataView(oomBuffer);
      oomView.setUint16(0, 65535, true);
      oomView.setUint16(2, 65535, true);
      assert.throws(() => PrefabCodec.decode(oomBuffer), RangeError);
    });
  });

  describe('4. PixiJS Scene Instantiation', () => {
    it('places sprites at world coordinates factoring in anchors, tileSize=64, and scale=2', () => {
      // 3x2 grid with anchor (1, 1) -> center-bottom tile aligns to (worldX, worldY)
      const prefab: PrefabData = {
        width: 3,
        height: 2,
        anchorX: 1,
        anchorY: 1,
        grid: new Uint32Array([10, 20, 30, 40, 50, 60]),
      };

      const container = new Container();
      const texMap = new Map<number, Texture>();
      for (const id of prefab.grid) {
        texMap.set(id, new Texture({ source: Texture.EMPTY.source, frame: new Rectangle(0, 0, 1, 1) }));
      }

      const sprites = PrefabCodec.instantiate(
        prefab,
        640,
        320,
        container,
        (assetId) => texMap.get(assetId)!
      );

      assert.strictEqual(sprites.length, 6);
      assert.strictEqual(container.children.length, 6);

      // Tile (0,0) -> (640 + (0-1)*64, 320 + (0-1)*64) = (576, 256)
      assert.strictEqual((container.children[0] as Sprite).x, 576);
      assert.strictEqual((container.children[0] as Sprite).y, 256);

      // Tile (1,1) (anchor) -> (640, 320)
      assert.strictEqual((container.children[4] as Sprite).x, 640);
      assert.strictEqual((container.children[4] as Sprite).y, 320);

      // Tile (2,1) -> (704, 320)
      assert.strictEqual((container.children[5] as Sprite).x, 704);
      assert.strictEqual((container.children[5] as Sprite).y, 320);

      for (let i = 0; i < sprites.length; i++) {
        assert.strictEqual(sprites[i].scale.x, 2);
        assert.strictEqual(sprites[i].scale.y, 2);
        assert.strictEqual(sprites[i].texture, texMap.get(prefab.grid[i]));
      }
    });

    it('handles negative anchors, optional emptyAssetId skipping, and custom tileSize/scale', () => {
      const prefab = PrefabCodec.decode(
        PrefabCodec.encode(2, 2, -2, -1, new Uint32Array([0, 1, 1, 0]))
      );

      const container = new Container();
      const requestedIds: number[] = [];
      const sprites = PrefabCodec.instantiate(
        prefab,
        100,
        200,
        container,
        (assetId) => {
          requestedIds.push(assetId);
          return Texture.EMPTY;
        },
        { tileSize: 32, scale: 1, emptyAssetId: 0 }
      );

      // Only the two '1' tiles at (1,0) and (0,1) should be created
      assert.deepStrictEqual(requestedIds, [1, 1]);
      assert.strictEqual(sprites.length, 2);
      assert.strictEqual(container.children.length, 2);

      // Tile (1,0) with anchor (-2,-1), tileSize=32 -> x = 100 + (1 - (-2))*32 = 196, y = 200 + (0 - (-1))*32 = 232
      assert.strictEqual(sprites[0].x, 196);
      assert.strictEqual(sprites[0].y, 232);
      assert.strictEqual(sprites[0].scale.x, 1);

      // Tile (0,1) with anchor (-2,-1), tileSize=32 -> x = 100 + 2*32 = 164, y = 200 + 2*32 = 264
      assert.strictEqual(sprites[1].x, 164);
      assert.strictEqual(sprites[1].y, 264);
    });

    it('returns an empty array without adding children for zero-sized prefabs', () => {
      const emptyPrefab = PrefabCodec.decode(
        PrefabCodec.encode(0, 0, 0, 0, new Uint32Array(0))
      );
      const container = new Container();
      const sprites = PrefabCodec.instantiate(
        emptyPrefab,
        0,
        0,
        container,
        () => Texture.EMPTY
      );

      assert.strictEqual(sprites.length, 0);
      assert.strictEqual(container.children.length, 0);
    });
  });
});

