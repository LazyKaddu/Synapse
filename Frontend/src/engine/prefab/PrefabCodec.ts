/**
 * Binary Prefab Codec & PixiJS Instantiator.
 * Compresses structured tile areas (buildings, parks) using Bounding Box +
 * Local Palette + Run-Length Encoding (RLE) into tightly packed ArrayBuffers.
 *
 * Binary Memory Layout (Little-Endian):
 * - Header (10 Bytes): width (Uint16), height (Uint16), anchorX (Int16), anchorY (Int16), anchorZ (Int16)
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
  anchorZ: number;
  grid: Uint32Array; // The fully inflated flat array of Global Asset IDs
}

export interface PrefabInstantiateOptions {
  tileSize?: number;
  scale?: number;
  emptyAssetId?: number;
  /** Layer Z-offset relative to anchorZ (worldZ = anchorZ + relativeZ). */
  relativeZ?: number;
  /** Optional override for anchorZ when instantiating in world without re-encoding. */
  anchorZOverride?: number;
  /** Routes spawned sprites to a container based on effective worldZ (e.g. <=0 below player, >0 above). */
  resolveContainer?: (worldZ: number) => PIXI.Container;
}

export interface PrefabLayer {
  /** Z-index relative to the prefab's anchorZ (negative renders below anchor, positive above). */
  zIndex: number;
  prefab: PrefabData;
}

export interface StackedPrefabData {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  layers: PrefabLayer[];
}

export interface StackedLayerInput {
  /** Z-index relative to anchorZ. */
  zIndex: number;
  grid: Uint32Array;
}

const HEADER_BYTE_LENGTH = 10;
const PALETTE_COUNT_BYTE_LENGTH = 1;
const PREFIX_BYTE_LENGTH = HEADER_BYTE_LENGTH + PALETTE_COUNT_BYTE_LENGTH; // 11 bytes
const PALETTE_ENTRY_BYTE_LENGTH = 4;
const RLE_PAIR_BYTE_LENGTH = 2;

const MAX_PALETTE_SIZE = 255;
const MAX_RLE_RUN_LENGTH = 255;
const MAX_UINT16 = 65535;
const MIN_INT16 = -32768;
const MAX_INT16 = 32767;

const STACK_MAGIC_0 = 0x53; // 'S'
const STACK_MAGIC_1 = 0x50; // 'P'
const STACK_MAGIC_2 = 0x53; // 'S'
const STACK_MAGIC_3 = 0x01; // version 1
const STACK_HEADER_BYTE_LENGTH = 16; // 4B magic + 2B layerCount + 10B bbox (w,h,ax,ay,az)
const STACK_LAYER_PREFIX_BYTE_LENGTH = 6; // 2B relativeZ (Int16) + 4B byteLength (Uint32)

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
  anchorZ: number,
  paletteCount: number
): void {
  view.setUint16(0, width, true);
  view.setUint16(2, height, true);
  view.setInt16(4, anchorX, true);
  view.setInt16(6, anchorY, true);
  view.setInt16(8, anchorZ, true);
  view.setUint8(10, paletteCount);
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
    anchorZ: number,
    rawGrid: Uint32Array
  ): ArrayBuffer {
    assertIntInRange('width', width, 0, MAX_UINT16);
    assertIntInRange('height', height, 0, MAX_UINT16);
    assertIntInRange('anchorX', anchorX, MIN_INT16, MAX_INT16);
    assertIntInRange('anchorY', anchorY, MIN_INT16, MAX_INT16);
    assertIntInRange('anchorZ', anchorZ, MIN_INT16, MAX_INT16);

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
      writeHeaderPrefix(emptyView, width, height, anchorX, anchorY, anchorZ, 0);
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

      writeHeaderPrefix(view, width, height, anchorX, anchorY, anchorZ, paletteCount);

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
    const anchorZ = view.getInt16(8, true);
    const paletteCount = view.getUint8(10);

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
        anchorZ,
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
      anchorZ,
      grid,
    };
  }

  /**
   * Instantiates an inflated PrefabData grid as PixiJS Sprites inside a target Container
   * (or container resolved dynamically by effective worldZ = anchorZ + relativeZ).
   */
  public static instantiate(
    prefab: PrefabData,
    worldX: number,
    worldY: number,
    container: PIXI.Container,
    getTexture: (assetId: number) => PIXI.Texture,
    options?: PrefabInstantiateOptions
  ): PIXI.Sprite[] {
    const { width, anchorX, anchorY, anchorZ, grid } = prefab;
    if (!Number.isInteger(width) || width < 0) {
      throw new RangeError(`Invalid prefab width: expected non-negative integer, got ${width}.`);
    }

    const tileSize = options?.tileSize ?? RENDER_TILE_SIZE;
    const scale = options?.scale ?? RENDER_SCALE;
    const emptyAssetId = options?.emptyAssetId;
    const effectiveAnchorZ = options?.anchorZOverride ?? anchorZ;
    const worldZ = effectiveAnchorZ + (options?.relativeZ ?? 0);
    const targetContainer = options?.resolveContainer
      ? options.resolveContainer(worldZ)
      : container;

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
      sprite.zIndex = worldZ;
      sprite.position.set(
        worldX + (localX - anchorX) * tileSize,
        worldY + (localY - anchorY) * tileSize
      );

      targetContainer.addChild(sprite);
      sprites.push(sprite);
    }

    return sprites;
  }
}

/**
 * Multi-layer binary envelope (`SPS\x01`) wrapping relativeZ-ordered PrefabCodec payloads.
 * Single-layer builds at relativeZ=0 encode as plain PrefabCodec buffers carrying anchorZ in the header.
 */
export class StackedPrefabCodec {
  public static isStackedBuffer(buffer: ArrayBuffer): boolean {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < STACK_HEADER_BYTE_LENGTH) {
      return false;
    }
    const bytes = new Uint8Array(buffer, 0, 4);
    return (
      bytes[0] === STACK_MAGIC_0 &&
      bytes[1] === STACK_MAGIC_1 &&
      bytes[2] === STACK_MAGIC_2 &&
      bytes[3] === STACK_MAGIC_3
    );
  }

  public static encodeLayers(
    width: number,
    height: number,
    anchorX: number,
    anchorY: number,
    anchorZ: number,
    layers: ReadonlyArray<StackedLayerInput>
  ): ArrayBuffer {
    assertIntInRange('width', width, 0, MAX_UINT16);
    assertIntInRange('height', height, 0, MAX_UINT16);
    assertIntInRange('anchorX', anchorX, MIN_INT16, MAX_INT16);
    assertIntInRange('anchorY', anchorY, MIN_INT16, MAX_INT16);
    assertIntInRange('anchorZ', anchorZ, MIN_INT16, MAX_INT16);

    if (layers.length === 0 || width === 0 || height === 0) {
      return PrefabCodec.encode(width, height, anchorX, anchorY, anchorZ, new Uint32Array(0));
    }

    const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
    const seenZ = new Set<number>();
    for (const layer of sorted) {
      assertIntInRange('layer.zIndex', layer.zIndex, MIN_INT16, MAX_INT16);
      if (seenZ.has(layer.zIndex)) {
        throw new RangeError(`Duplicate layer relativeZ ${layer.zIndex} in stacked prefab.`);
      }
      seenZ.add(layer.zIndex);
    }

    // Keep single relativeZ=0 layer as a plain PrefabCodec buffer (with anchorZ in its 10B header)
    if (sorted.length === 1 && sorted[0].zIndex === 0) {
      return PrefabCodec.encode(width, height, anchorX, anchorY, anchorZ, sorted[0].grid);
    }

    if (sorted.length > MAX_UINT16) {
      throw new RangeError(`Layer count (${sorted.length}) exceeds Uint16 limit.`);
    }

    const encodedLayers = sorted.map((layer) => ({
      zIndex: layer.zIndex,
      bytes: new Uint8Array(
        PrefabCodec.encode(width, height, anchorX, anchorY, anchorZ, layer.grid)
      ),
    }));

    let totalBytes = STACK_HEADER_BYTE_LENGTH;
    for (const entry of encodedLayers) {
      totalBytes += STACK_LAYER_PREFIX_BYTE_LENGTH + entry.bytes.byteLength;
    }

    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);
    const outBytes = new Uint8Array(buffer);

    outBytes[0] = STACK_MAGIC_0;
    outBytes[1] = STACK_MAGIC_1;
    outBytes[2] = STACK_MAGIC_2;
    outBytes[3] = STACK_MAGIC_3;
    view.setUint16(4, encodedLayers.length, true);
    view.setUint16(6, width, true);
    view.setUint16(8, height, true);
    view.setInt16(10, anchorX, true);
    view.setInt16(12, anchorY, true);
    view.setInt16(14, anchorZ, true);

    let offset = STACK_HEADER_BYTE_LENGTH;
    for (const entry of encodedLayers) {
      view.setInt16(offset, entry.zIndex, true);
      view.setUint32(offset + 2, entry.bytes.byteLength, true);
      offset += STACK_LAYER_PREFIX_BYTE_LENGTH;
      outBytes.set(entry.bytes, offset);
      offset += entry.bytes.byteLength;
    }

    return buffer;
  }

  public static decodeAny(buffer: ArrayBuffer): StackedPrefabData {
    if (!StackedPrefabCodec.isStackedBuffer(buffer)) {
      const single = PrefabCodec.decode(buffer);
      return {
        width: single.width,
        height: single.height,
        anchorX: single.anchorX,
        anchorY: single.anchorY,
        anchorZ: single.anchorZ,
        layers:
          single.width === 0 || single.height === 0 || single.grid.length === 0
            ? []
            : [{ zIndex: 0, prefab: single }],
      };
    }

    const view = new DataView(buffer);
    const layerCount = view.getUint16(4, true);
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    const anchorX = view.getInt16(10, true);
    const anchorY = view.getInt16(12, true);
    const anchorZ = view.getInt16(14, true);

    if (layerCount === 0) {
      throw new RangeError('Invalid stacked prefab buffer: layerCount must be >= 1.');
    }

    const layers: PrefabLayer[] = [];
    const seenZ = new Set<number>();
    let offset = STACK_HEADER_BYTE_LENGTH;

    for (let i = 0; i < layerCount; i++) {
      if (offset + STACK_LAYER_PREFIX_BYTE_LENGTH > buffer.byteLength) {
        throw new RangeError('Invalid stacked prefab buffer: truncated layer header.');
      }

      const zIndex = view.getInt16(offset, true);
      const byteLength = view.getUint32(offset + 2, true);
      offset += STACK_LAYER_PREFIX_BYTE_LENGTH;

      if (offset + byteLength > buffer.byteLength) {
        throw new RangeError('Invalid stacked prefab buffer: truncated layer payload.');
      }
      if (seenZ.has(zIndex)) {
        throw new RangeError(`Invalid stacked prefab buffer: duplicate relativeZ ${zIndex}.`);
      }
      seenZ.add(zIndex);

      const slice = buffer.slice(offset, offset + byteLength);
      const prefab = PrefabCodec.decode(slice);
      if (
        prefab.width !== width ||
        prefab.height !== height ||
        prefab.anchorX !== anchorX ||
        prefab.anchorY !== anchorY ||
        prefab.anchorZ !== anchorZ
      ) {
        throw new RangeError('Invalid stacked prefab buffer: layer metadata mismatch.');
      }

      layers.push({ zIndex, prefab });
      offset += byteLength;
    }

    if (offset !== buffer.byteLength) {
      throw new RangeError('Invalid stacked prefab buffer: trailing unparsed bytes.');
    }

    layers.sort((a, b) => a.zIndex - b.zIndex);
    return {
      width,
      height,
      anchorX,
      anchorY,
      anchorZ,
      layers,
    };
  }

  public static instantiate(
    stacked: StackedPrefabData,
    worldX: number,
    worldY: number,
    container: PIXI.Container,
    getTexture: (assetId: number) => PIXI.Texture,
    options?: Omit<PrefabInstantiateOptions, 'relativeZ'>
  ): PIXI.Sprite[] {
    container.sortableChildren = true;
    const effectiveAnchorZ = options?.anchorZOverride ?? stacked.anchorZ;
    const sorted = [...stacked.layers].sort((a, b) => a.zIndex - b.zIndex);
    const allSprites: PIXI.Sprite[] = [];

    for (const layer of sorted) {
      const layerSprites = PrefabCodec.instantiate(
        layer.prefab,
        worldX,
        worldY,
        container,
        getTexture,
        {
          ...options,
          anchorZOverride: effectiveAnchorZ,
          relativeZ: layer.zIndex,
        }
      );
      for (const sprite of layerSprites) {
        allSprites.push(sprite);
      }
    }

    return allSprites;
  }
}
