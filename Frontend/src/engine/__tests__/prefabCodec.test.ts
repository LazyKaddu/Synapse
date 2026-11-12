import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  PrefabCodec,
  StackedPrefabCodec,
  type PrefabData,
} from '../prefab/PrefabCodec.ts';

describe('PrefabCodec', () => {
  describe('1. Binary Memory Layout', () => {
    it('encodes exact 10-byte Little-Endian header (with anchorZ), palette length, Uint32 palette, and [Count, PaletteIndex] RLE pairs', () => {
      // 4x4 grid: 15 grass tiles (assetId 1001) followed by 1 stone path tile (assetId 2002)
      const grassId = 1001;
      const stoneId = 2002;
      const rawGrid = new Uint32Array(16).fill(grassId);
      rawGrid[15] = stoneId;

      const buffer = PrefabCodec.encode(4, 4, -2, 3, -1, rawGrid);

      // Expected size: 10B header + 1B paletteCount + (2 * 4B palette) + (2 * 2B RLE pairs) = 23 bytes
      assert.strictEqual(buffer.byteLength, 23);

      const view = new DataView(buffer);

      // Header (10 bytes)
      assert.strictEqual(view.getUint16(0, true), 4, 'width');
      assert.strictEqual(view.getUint16(2, true), 4, 'height');
      assert.strictEqual(view.getInt16(4, true), -2, 'anchorX');
      assert.strictEqual(view.getInt16(6, true), 3, 'anchorY');
      assert.strictEqual(view.getInt16(8, true), -1, 'anchorZ');

      // Palette Length (1 byte)
      assert.strictEqual(view.getUint8(10), 2, 'paletteCount');

      // Palette Data (Uint32[])
      assert.strictEqual(view.getUint32(11, true), grassId, 'palette[0]');
      assert.strictEqual(view.getUint32(15, true), stoneId, 'palette[1]');

      // RLE Grid Data: [15, 0], [1, 1]
      assert.strictEqual(view.getUint8(19), 15, 'run 0 count');
      assert.strictEqual(view.getUint8(20), 0, 'run 0 palette index');
      assert.strictEqual(view.getUint8(21), 1, 'run 1 count');
      assert.strictEqual(view.getUint8(22), 1, 'run 1 palette index');
    });

    it('encodes a 0x0 empty prefab into a tight 11-byte buffer', () => {
      const buffer = PrefabCodec.encode(0, 0, -5, 10, 2, new Uint32Array(0));
      assert.strictEqual(buffer.byteLength, 11);

      const view = new DataView(buffer);
      assert.strictEqual(view.getUint16(0, true), 0);
      assert.strictEqual(view.getUint16(2, true), 0);
      assert.strictEqual(view.getInt16(4, true), -5);
      assert.strictEqual(view.getInt16(6, true), 10);
      assert.strictEqual(view.getInt16(8, true), 2);
      assert.strictEqual(view.getUint8(10), 0);
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

      const buffer = PrefabCodec.encode(width, height, -32768, 32767, -12, rawGrid);
      assert.ok(buffer.byteLength < rawGrid.byteLength, 'RLE should compress structured prefab');

      const decoded = PrefabCodec.decode(buffer);
      assert.strictEqual(decoded.width, width);
      assert.strictEqual(decoded.height, height);
      assert.strictEqual(decoded.anchorX, -32768);
      assert.strictEqual(decoded.anchorY, 32767);
      assert.strictEqual(decoded.anchorZ, -12);
      assert.deepStrictEqual(decoded.grid, rawGrid);
    });

    it('splits RLE runs longer than 255 consecutive tiles cleanly', () => {
      const width = 20;
      const height = 15;
      const raw300 = new Uint32Array(width * height).fill(42);

      const buf300 = PrefabCodec.encode(width, height, 0, 0, 0, raw300);
      assert.strictEqual(buf300.byteLength, 11 + 4 + 4);

      const view300 = new DataView(buf300);
      assert.strictEqual(view300.getUint8(15), 255);
      assert.strictEqual(view300.getUint8(16), 0);
      assert.strictEqual(view300.getUint8(17), 45);
      assert.strictEqual(view300.getUint8(18), 0);

      const decoded300 = PrefabCodec.decode(buf300);
      assert.deepStrictEqual(decoded300.grid, raw300);

      const raw510 = new Uint32Array(510).fill(99);
      const buf510 = PrefabCodec.encode(510, 1, 0, 0, 0, raw510);
      assert.strictEqual(buf510.byteLength, 11 + 4 + 4);
      const decoded510 = PrefabCodec.decode(buf510);
      assert.deepStrictEqual(decoded510.grid, raw510);
    });

    it('handles worst-case alternating checkerboard and 1x1 grids', () => {
      const single = new Uint32Array([777]);
      const singleDecoded = PrefabCodec.decode(PrefabCodec.encode(1, 1, 0, 0, 3, single));
      assert.deepStrictEqual(singleDecoded.grid, single);
      assert.strictEqual(singleDecoded.anchorZ, 3);

      const checker = new Uint32Array(64);
      for (let i = 0; i < checker.length; i++) {
        checker[i] = i % 2 === 0 ? 10 : 20;
      }
      const buf = PrefabCodec.encode(8, 8, 4, 4, -2, checker);
      assert.strictEqual(buf.byteLength, 11 + 2 * 4 + 64 * 2);
      const decoded = PrefabCodec.decode(buf);
      assert.strictEqual(decoded.anchorZ, -2);
      assert.deepStrictEqual(decoded.grid, checker);
    });

    it('supports up to 255 unique tile IDs in the palette', () => {
      const grid255 = new Uint32Array(255);
      for (let i = 0; i < 255; i++) {
        grid255[i] = 10000 + i;
      }
      const buffer = PrefabCodec.encode(255, 1, 0, 0, 0, grid255);
      const decoded = PrefabCodec.decode(buffer);
      assert.deepStrictEqual(decoded.grid, grid255);
    });

    it('decodes empty 0x0 buffer back to empty Uint32Array', () => {
      const buffer = PrefabCodec.encode(0, 0, 1, -1, -7, new Uint32Array(0));
      const decoded = PrefabCodec.decode(buffer);
      assert.strictEqual(decoded.width, 0);
      assert.strictEqual(decoded.height, 0);
      assert.strictEqual(decoded.anchorX, 1);
      assert.strictEqual(decoded.anchorY, -1);
      assert.strictEqual(decoded.anchorZ, -7);
      assert.strictEqual(decoded.grid.length, 0);
    });
  });

  describe('3. Validation & Malformed Payload Protection', () => {
    it('rejects > 255 unique tiles and out-of-range encode arguments', () => {
      const grid256 = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        grid256[i] = i;
      }
      assert.throws(() => PrefabCodec.encode(256, 1, 0, 0, 0, grid256), RangeError);

      assert.throws(() => PrefabCodec.encode(-1, 1, 0, 0, 0, new Uint32Array(0)), RangeError);
      assert.throws(() => PrefabCodec.encode(65536, 1, 0, 0, 0, new Uint32Array(0)), RangeError);
      assert.throws(() => PrefabCodec.encode(1, 1, -32769, 0, 0, new Uint32Array(1)), RangeError);
      assert.throws(() => PrefabCodec.encode(1, 1, 0, 32768, 0, new Uint32Array(1)), RangeError);
      assert.throws(() => PrefabCodec.encode(1, 1, 0, 0, 32768, new Uint32Array(1)), RangeError);
      assert.throws(() => PrefabCodec.encode(2, 2, 0, 0, 0, new Uint32Array(3)), RangeError);
    });

    it('rejects truncated, misaligned, corrupt, or OOM-bomb buffers in decode', () => {
      assert.throws(() => PrefabCodec.decode(new ArrayBuffer(10)), RangeError);

      const truncPalette = new ArrayBuffer(14);
      const tpView = new DataView(truncPalette);
      tpView.setUint16(0, 1, true);
      tpView.setUint16(2, 1, true);
      tpView.setUint8(10, 2);
      assert.throws(() => PrefabCodec.decode(truncPalette), RangeError);

      const oddRle = new ArrayBuffer(11 + 4 + 3);
      const oddView = new DataView(oddRle);
      oddView.setUint16(0, 1, true);
      oddView.setUint16(2, 1, true);
      oddView.setUint8(10, 1);
      assert.throws(() => PrefabCodec.decode(oddRle), RangeError);

      const zeroCount = PrefabCodec.encode(2, 1, 0, 0, 0, new Uint32Array([5, 5]));
      new DataView(zeroCount).setUint8(15, 0);
      assert.throws(() => PrefabCodec.decode(zeroCount), RangeError);

      const badIdx = PrefabCodec.encode(1, 1, 0, 0, 0, new Uint32Array([5]));
      new DataView(badIdx).setUint8(16, 1);
      assert.throws(() => PrefabCodec.decode(badIdx), RangeError);

      const overflowRle = PrefabCodec.encode(1, 1, 0, 0, 0, new Uint32Array([5]));
      new DataView(overflowRle).setUint8(15, 2);
      assert.throws(() => PrefabCodec.decode(overflowRle), RangeError);

      const underflowRle = PrefabCodec.encode(2, 1, 0, 0, 0, new Uint32Array([5, 5]));
      new DataView(underflowRle).setUint8(15, 1);
      assert.throws(() => PrefabCodec.decode(underflowRle), RangeError);

      const oomBuffer = PrefabCodec.encode(1, 1, 0, 0, 0, new Uint32Array([5]));
      const oomView = new DataView(oomBuffer);
      oomView.setUint16(0, 65535, true);
      oomView.setUint16(2, 65535, true);
      assert.throws(() => PrefabCodec.decode(oomBuffer), RangeError);
    });
  });

  describe('4. PixiJS Scene Instantiation', () => {
    it('places sprites at world coordinates factoring in anchors, tileSize=64, and scale=2', () => {
      const prefab: PrefabData = {
        width: 3,
        height: 2,
        anchorX: 1,
        anchorY: 1,
        anchorZ: -1,
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
      assert.strictEqual((container.children[0] as Sprite).x, 576);
      assert.strictEqual((container.children[0] as Sprite).y, 256);
      assert.strictEqual((container.children[4] as Sprite).x, 640);
      assert.strictEqual((container.children[4] as Sprite).y, 320);
      assert.strictEqual((container.children[5] as Sprite).x, 704);
      assert.strictEqual((container.children[5] as Sprite).y, 320);

      for (let i = 0; i < sprites.length; i++) {
        assert.strictEqual(sprites[i].scale.x, 2);
        assert.strictEqual(sprites[i].scale.y, 2);
        assert.strictEqual(sprites[i].zIndex, -1);
        assert.strictEqual(sprites[i].texture, texMap.get(prefab.grid[i]));
      }
    });

    it('handles negative anchors, optional emptyAssetId skipping, and custom tileSize/scale', () => {
      const prefab = PrefabCodec.decode(
        PrefabCodec.encode(2, 2, -2, -1, 0, new Uint32Array([0, 1, 1, 0]))
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

      assert.deepStrictEqual(requestedIds, [1, 1]);
      assert.strictEqual(sprites.length, 2);
      assert.strictEqual(container.children.length, 2);
      assert.strictEqual(sprites[0].x, 196);
      assert.strictEqual(sprites[0].y, 232);
      assert.strictEqual(sprites[0].scale.x, 1);
      assert.strictEqual(sprites[1].x, 164);
      assert.strictEqual(sprites[1].y, 264);
    });

    it('returns an empty array without adding children for zero-sized prefabs', () => {
      const emptyPrefab = PrefabCodec.decode(
        PrefabCodec.encode(0, 0, 0, 0, 0, new Uint32Array(0))
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

  describe('5. StackedPrefabCodec (Anchor Z + Relative Z Ordering)', () => {
    it('encodes single relZ=0 layer with anchorZ in 10B header and multi-layer in SPS\\x01 envelope', () => {
      const grass = new Uint32Array([10, 10, 10, 10]);
      const singleBuf = StackedPrefabCodec.encodeLayers(2, 2, 1, 1, -2, [
        { zIndex: 0, grid: grass },
      ]);
      assert.strictEqual(StackedPrefabCodec.isStackedBuffer(singleBuf), false);
      const decodedSingle = StackedPrefabCodec.decodeAny(singleBuf);
      assert.strictEqual(decodedSingle.anchorZ, -2);
      assert.strictEqual(decodedSingle.layers.length, 1);
      assert.strictEqual(decodedSingle.layers[0].zIndex, 0);

      // AnchorZ = 1, grass relZ = -2 (worldZ = -1), trunk relZ = -1 (worldZ = 0), canopy relZ = +1 (worldZ = +2)
      const trunk = new Uint32Array([0, 20, 0, 0]);
      const canopy = new Uint32Array([0, 30, 0, 0]);
      const stackedBuf = StackedPrefabCodec.encodeLayers(2, 2, 1, 1, 1, [
        { zIndex: 1, grid: canopy },
        { zIndex: -2, grid: grass },
        { zIndex: -1, grid: trunk },
      ]);

      assert.strictEqual(StackedPrefabCodec.isStackedBuffer(stackedBuf), true);
      const decodedStacked = StackedPrefabCodec.decodeAny(stackedBuf);
      assert.strictEqual(decodedStacked.width, 2);
      assert.strictEqual(decodedStacked.height, 2);
      assert.strictEqual(decodedStacked.anchorX, 1);
      assert.strictEqual(decodedStacked.anchorY, 1);
      assert.strictEqual(decodedStacked.anchorZ, 1);
      assert.deepStrictEqual(
        decodedStacked.layers.map((l) => l.zIndex),
        [-2, -1, 1]
      );
    });

    it('routes worldZ <= 0 sprites below character (z=0) and worldZ > 0 above, shifting whole prefab via anchorZOverride', () => {
      const floor = new Uint32Array([10, 10]);
      const roof = new Uint32Array([0, 20]);
      // anchorZ = 0, floor relZ = -1 (worldZ = -1), roof relZ = +1 (worldZ = +1)
      const buf = StackedPrefabCodec.encodeLayers(2, 1, 0, 0, 0, [
        { zIndex: -1, grid: floor },
        { zIndex: 1, grid: roof },
      ]);
      const stacked = StackedPrefabCodec.decodeAny(buf);

      const belowContainer = new Container();
      const aboveContainer = new Container();

      // Default anchorZ=0: floor -> below (-1), roof -> above (+1)
      StackedPrefabCodec.instantiate(stacked, 0, 0, belowContainer, () => Texture.EMPTY, {
        emptyAssetId: 0,
        resolveContainer: (worldZ) => (worldZ > 0 ? aboveContainer : belowContainer),
      });
      assert.strictEqual(belowContainer.children.length, 2);
      assert.strictEqual((belowContainer.children[0] as Sprite).zIndex, -1);
      assert.strictEqual(aboveContainer.children.length, 1);
      assert.strictEqual((aboveContainer.children[0] as Sprite).zIndex, 1);

      // Shift whole prefab above character with anchorZOverride = +2 -> floor becomes +1, roof becomes +3
      const below2 = new Container();
      const above2 = new Container();
      StackedPrefabCodec.instantiate(stacked, 0, 0, below2, () => Texture.EMPTY, {
        emptyAssetId: 0,
        anchorZOverride: 2,
        resolveContainer: (worldZ) => (worldZ > 0 ? above2 : below2),
      });
      assert.strictEqual(below2.children.length, 0);
      assert.strictEqual(above2.children.length, 3);
      assert.deepStrictEqual(
        above2.children.map((c) => (c as Sprite).zIndex),
        [1, 1, 3]
      );

      // Shift whole prefab below character with anchorZOverride = -2 -> floor becomes -3, roof becomes -1
      const below3 = new Container();
      const above3 = new Container();
      StackedPrefabCodec.instantiate(stacked, 0, 0, below3, () => Texture.EMPTY, {
        emptyAssetId: 0,
        anchorZOverride: -2,
        resolveContainer: (worldZ) => (worldZ > 0 ? above3 : below3),
      });
      assert.strictEqual(below3.children.length, 3);
      assert.strictEqual(above3.children.length, 0);
      assert.deepStrictEqual(
        below3.children.map((c) => (c as Sprite).zIndex),
        [-3, -3, -1]
      );
    });

    it('rejects duplicate layer relativeZ values and malformed SPS\\x01 buffers', () => {
      assert.throws(
        () =>
          StackedPrefabCodec.encodeLayers(1, 1, 0, 0, 0, [
            { zIndex: 1, grid: new Uint32Array([5]) },
            { zIndex: 1, grid: new Uint32Array([6]) },
          ]),
        RangeError
      );

      const validBuf = StackedPrefabCodec.encodeLayers(1, 1, 0, 0, 0, [
        { zIndex: 1, grid: new Uint32Array([5]) },
      ]);
      const truncated = validBuf.slice(0, validBuf.byteLength - 2);
      assert.throws(() => StackedPrefabCodec.decodeAny(truncated), RangeError);
    });
  });
});
