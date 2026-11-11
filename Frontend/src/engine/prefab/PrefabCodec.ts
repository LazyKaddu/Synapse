/**
 * Binary Prefab Codec & PixiJS Instantiator.
 * Compresses structured tile areas (buildings, parks) using Bounding Box +
 * Local Palette + Run-Length Encoding (RLE) into tightly packed ArrayBuffers.
 *
 * Binary Memory Layout (Little-Endian):
 * - Header (8 Bytes): width (Uint16), height (Uint16), anchorX (Int16), anchorY (Int16)
 * - Palette Length (1 Byte): paletteCount (Uint8, 0..255)
 * - Palette Data (4 * paletteCount Bytes): Uint32[] Global Asset IDs
 * - RLE Grid Data (2 * runCount Bytes): [Count (Uint8, 1..255), PaletteIndex (Uint8)]
 */

import type * as PIXI from 'pixi.js';
import { Sprite } from 'pixi.js';
import { RENDER_SCALE, RENDER_TILE_SIZE } from '../procedural/worldGen.ts';

export interface PrefabData {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  grid: Uint32Array; // The fully inflated flat array of Global Asset IDs
}

export interface PrefabInstantiateOptions {
  tileSize?: number;
  scale?: number;
  emptyAssetId?: number;
}

const HEADER_BYTE_LENGTH = 8;
const PALETTE_COUNT_BYTE_LENGTH = 1;
const PREFIX_BYTE_LENGTH = HEADER_BYTE_LENGTH + PALETTE_COUNT_BYTE_LENGTH;
const PALETTE_ENTRY_BYTE_LENGTH = 4;
const RLE_PAIR_BYTE_LENGTH = 2;

const MAX_PALETTE_SIZE = 255;
const MAX_RLE_RUN_LENGTH = 255;
const MAX_UINT16 = 65535;
const MIN_INT16 = -32768;
const MAX_INT16 = 32767;

// Pre-allocated scratch storage for synchronous encode() calls to avoid heap churn.
const SCRATCH_PALETTE_IDS = new Uint32Array(MAX_PALETTE_SIZE);
const SCRATCH_PALETTE_MAP = new Map<number, number>();

function assertIntInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${name}: expected integer in [${min}, ${max}], got ${value}.`);
  }
}

function writeHeaderPrefix(
  view: DataView,
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
  paletteCount: number
): void {
  view.setUint16(0, width, true);
  view.setUint16(2, height, true);
  view.setInt16(4, anchorX, true);
  view.setInt16(6, anchorY, true);
  view.setUint8(8, paletteCount);
}

/**
 * Binary encoder, decoder, and PixiJS scene instantiator for structured tile prefabs.
 */
export class PrefabCodec {
  /**
   * Compresses a flat Uint32Array grid of Global Asset IDs into a tightly packed
   * Little-Endian ArrayBuffer using Local Palette + RLE.
   */
  public static encode(
    width: number,
    height: number,
    anchorX: number,
    anchorY: number,
    rawGrid: Uint32Array
  ): ArrayBuffer {
    assertIntInRange('width', width, 0, MAX_UINT16);
    assertIntInRange('height', height, 0, MAX_UINT16);
    assertIntInRange('anchorX', anchorX, MIN_INT16, MAX_INT16);
    assertIntInRange('anchorY', anchorY, MIN_INT16, MAX_INT16);

    const totalTiles = width * height;
    if (!(rawGrid instanceof Uint32Array)) {
      throw new TypeError('Invalid rawGrid: expected a Uint32Array.');
    }
    if (rawGrid.length !== totalTiles) {
      throw new RangeError(
        `Invalid rawGrid length: expected ${totalTiles} (${width}x${height}), got ${rawGrid.length}.`
      );
    }

    if (totalTiles === 0) {
      const emptyBuffer = new ArrayBuffer(PREFIX_BYTE_LENGTH);
      const emptyView = new DataView(emptyBuffer);
      writeHeaderPrefix(emptyView, width, height, anchorX, anchorY, 0);
      return emptyBuffer;
    }

    SCRATCH_PALETTE_MAP.clear();
    try {
      // Pass 1: Sequential scan over contiguous Uint32Array to build unique palette
      // and determine the exact number of RLE pairs before allocating the output buffer.
      let prevAssetId = rawGrid[0];
      SCRATCH_PALETTE_MAP.set(prevAssetId, 0);
      SCRATCH_PALETTE_IDS[0] = prevAssetId;

      let paletteCount = 1;
      let runLength = 1;
      let runCount = 1;

      for (let i = 1; i < totalTiles; i++) {
        const assetId = rawGrid[i];
        if (assetId === prevAssetId && runLength < MAX_RLE_RUN_LENGTH) {
          runLength++;
        } else {
          runCount++;
          prevAssetId = assetId;
          runLength = 1;

          if (!SCRATCH_PALETTE_MAP.has(assetId)) {
            if (paletteCount >= MAX_PALETTE_SIZE) {
              throw new RangeError(
                `Prefab palette capacity exceeded: maximum ${MAX_PALETTE_SIZE} unique tile IDs supported.`
              );
            }
            SCRATCH_PALETTE_MAP.set(assetId, paletteCount);
            SCRATCH_PALETTE_IDS[paletteCount] = assetId;
            paletteCount++;
          }
        }
      }

      const paletteByteLength = paletteCount * PALETTE_ENTRY_BYTE_LENGTH;
      const rleStartOffset = PREFIX_BYTE_LENGTH + paletteByteLength;
      const totalByteLength = rleStartOffset + runCount * RLE_PAIR_BYTE_LENGTH;

      // Exact single ArrayBuffer allocation with zero dynamic resizing.
      const buffer = new ArrayBuffer(totalByteLength);
      const view = new DataView(buffer);

      writeHeaderPrefix(view, width, height, anchorX, anchorY, paletteCount);

      for (let p = 0; p < paletteCount; p++) {
        view.setUint32(
          PREFIX_BYTE_LENGTH + p * PALETTE_ENTRY_BYTE_LENGTH,
          SCRATCH_PALETTE_IDS[p],
          true
        );
      }

      // Pass 2: Sequential scan writing [Count (Uint8), PaletteIndex (Uint8)] pairs.
      let writeOffset = rleStartOffset;
      let currentAssetId = rawGrid[0];
      let currentPaletteIdx = SCRATCH_PALETTE_MAP.get(currentAssetId)!;
      let currentCount = 1;

      for (let i = 1; i < totalTiles; i++) {
        const assetId = rawGrid[i];
        if (assetId === currentAssetId) {
          if (currentCount < MAX_RLE_RUN_LENGTH) {
            currentCount++;
          } else {
            view.setUint8(writeOffset, MAX_RLE_RUN_LENGTH);
            view.setUint8(writeOffset + 1, currentPaletteIdx);
            writeOffset += RLE_PAIR_BYTE_LENGTH;
            currentCount = 1;
          }
        } else {
          view.setUint8(writeOffset, currentCount);
          view.setUint8(writeOffset + 1, currentPaletteIdx);
          writeOffset += RLE_PAIR_BYTE_LENGTH;
          currentAssetId = assetId;
          currentPaletteIdx = SCRATCH_PALETTE_MAP.get(assetId)!;
          currentCount = 1;
        }
      }

      view.setUint8(writeOffset, currentCount);
      view.setUint8(writeOffset + 1, currentPaletteIdx);

      return buffer;
    } finally {
      SCRATCH_PALETTE_MAP.clear();
    }
  }

  /**
   * Decodes a binary prefab payload back into metadata and an inflated Uint32Array grid.
   */
  public static decode(buffer: ArrayBuffer): PrefabData {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new TypeError('Invalid buffer: expected an ArrayBuffer.');
    }
    if (buffer.byteLength < PREFIX_BYTE_LENGTH) {
      throw new RangeError(
        `Invalid prefab buffer: expected at least ${PREFIX_BYTE_LENGTH} bytes, got ${buffer.byteLength}.`
      );
    }

    const view = new DataView(buffer);
    const width = view.getUint16(0, true);
    const height = view.getUint16(2, true);
    const anchorX = view.getInt16(4, true);
    const anchorY = view.getInt16(6, true);
    const paletteCount = view.getUint8(8);

    const rleStartOffset = PREFIX_BYTE_LENGTH + paletteCount * PALETTE_ENTRY_BYTE_LENGTH;
    if (buffer.byteLength < rleStartOffset) {
      throw new RangeError(
        `Invalid prefab buffer: truncated palette (expected >= ${rleStartOffset} bytes, got ${buffer.byteLength}).`
      );
    }

    const rleByteLength = buffer.byteLength - rleStartOffset;
    if ((rleByteLength & 1) !== 0) {
      throw new RangeError(
        `Invalid prefab buffer: RLE section byte length (${rleByteLength}) must be even.`
      );
    }

    const totalTiles = width * height;
    const maxPossibleTiles = (rleByteLength >>> 1) * MAX_RLE_RUN_LENGTH;
    if (totalTiles > maxPossibleTiles) {
      throw new RangeError(
        `Invalid prefab buffer: dimensions ${width}x${height} (${totalTiles} tiles) exceed RLE capacity (${maxPossibleTiles}).`
      );
    }

    if (totalTiles === 0) {
      if (rleByteLength !== 0) {
        throw new RangeError(
          `Invalid prefab buffer: non-empty RLE payload (${rleByteLength} bytes) for zero-area prefab.`
        );
      }
      return {
        width,
        height,
        anchorX,
        anchorY,
        grid: new Uint32Array(0),
      };
    }

    // L1-cache-resident palette table (<= 1,020 bytes)
    const palette = new Uint32Array(paletteCount);
    for (let i = 0; i < paletteCount; i++) {
      palette[i] = view.getUint32(PREFIX_BYTE_LENGTH + i * PALETTE_ENTRY_BYTE_LENGTH, true);
    }

    const grid = new Uint32Array(totalTiles);
    // Zero-copy view over the RLE byte stream in the incoming ArrayBuffer
    const rleBytes = new Uint8Array(buffer, rleStartOffset, rleByteLength);
    let gridIndex = 0;

    for (let r = 0; r < rleByteLength; r += RLE_PAIR_BYTE_LENGTH) {
      const count = rleBytes[r];
      const paletteIndex = rleBytes[r + 1];

      if (count === 0) {
        throw new RangeError(
          `Invalid prefab RLE run at byte ${rleStartOffset + r}: run count must be >= 1.`
        );
      }
      if (paletteIndex >= paletteCount) {
        throw new RangeError(
          `Invalid prefab RLE palette index ${paletteIndex} (paletteCount is ${paletteCount}).`
        );
      }
      if (gridIndex + count > totalTiles) {
        throw new RangeError(
          `Invalid prefab RLE payload: inflated count exceeds ${width}x${height} (${totalTiles} tiles).`
        );
      }

      const assetId = palette[paletteIndex];
      if (count > 8) {
        grid.fill(assetId, gridIndex, gridIndex + count);
        gridIndex += count;
      } else {
        for (let k = 0; k < count; k++) {
          grid[gridIndex++] = assetId;
        }
      }
    }

    if (gridIndex !== totalTiles) {
      throw new RangeError(
        `Invalid prefab RLE payload: inflated ${gridIndex} tiles, expected ${totalTiles}.`
      );
    }

    return {
      width,
      height,
      anchorX,
      anchorY,
      grid,
    };
  }

  /**
   * Instantiates an inflated PrefabData grid as PixiJS Sprites inside a target Container.
   * Aligns local tile (anchorX, anchorY) to world pixel position (worldX, worldY).
   */
  public static instantiate(
    prefab: PrefabData,
    worldX: number,
    worldY: number,
    container: PIXI.Container,
    getTexture: (assetId: number) => PIXI.Texture,
    options?: PrefabInstantiateOptions
  ): PIXI.Sprite[] {
    const { width, anchorX, anchorY, grid } = prefab;
    if (!Number.isInteger(width) || width < 0) {
      throw new RangeError(`Invalid prefab width: expected non-negative integer, got ${width}.`);
    }

    const tileSize = options?.tileSize ?? RENDER_TILE_SIZE;
    const scale = options?.scale ?? RENDER_SCALE;
    const emptyAssetId = options?.emptyAssetId;

    if (width === 0 || grid.length === 0) {
      return [];
    }

    const sprites: PIXI.Sprite[] = [];

    for (let index = 0; index < grid.length; index++) {
      const assetId = grid[index];
      if (emptyAssetId !== undefined && assetId === emptyAssetId) {
        continue;
      }

      const localX = index % width;
      const localY = Math.floor(index / width);

      const texture = getTexture(assetId);
      const sprite = new Sprite(texture);
      sprite.scale.set(scale);
      sprite.position.set(
        worldX + (localX - anchorX) * tileSize,
        worldY + (localY - anchorY) * tileSize
      );

      container.addChild(sprite);
      sprites.push(sprite);
    }

    return sprites;
  }
}

