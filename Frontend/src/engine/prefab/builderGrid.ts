/**
 * Builder Grid Operations, Tight Bounding-Box Trimming, Stamping,
 * Free-Drag / Snap Coordinate Helpers, and Base64 ArrayBuffer Serialization.
 */

import {
  PrefabCodec,
  StackedPrefabCodec,
  type PrefabData,
  type StackedPrefabData,
} from './PrefabCodec.ts';
import { EMPTY_ASSET_ID } from './assetRegistry.ts';

export interface TrimmedPrefabResult {
  prefab: PrefabData;
  buffer: ArrayBuffer;
  rawByteLength: number;
  compressedByteLength: number;
  compressionRatio: number;
}

export interface StackedTrimmedPrefabResult {
  stacked: StackedPrefabData;
  buffer: ArrayBuffer;
  rawByteLength: number;
  compressedByteLength: number;
  compressionRatio: number;
  layerCount: number;
}

export interface LayerGrid {
  zIndex: number;
  grid: Uint32Array;
}

export interface CellStackEntry {
  zIndex: number;
  assetId: number;
}

export interface StampPreviewCell {
  x: number;
  y: number;
  assetId: number;
}

export interface StackedStampPreviewCell {
  x: number;
  y: number;
  zIndex: number;
  assetId: number;
}

export interface FreePlacedTile {
  id: string;
  assetId: number;
  pixelX: number;
  pixelY: number;
  zIndex?: number;
}

/**
 * Allocates a zero-filled Uint32Array grid of dimensions width * height.
 */
export function createEmptyGrid(width: number, height: number): Uint32Array {
  if (width <= 0 || height <= 0) {
    return new Uint32Array(0);
  }
  return new Uint32Array(width * height);
}

/**
 * Returns a new resized Uint32Array preserving top-left overlap,
 * zero-padding expanded cells and cropping truncated cells.
 */
export function resizeGrid(
  grid: Uint32Array,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number
): Uint32Array {
  if (newW <= 0 || newH <= 0) {
    return new Uint32Array(0);
  }

  const next = new Uint32Array(newW * newH);
  const copyW = Math.min(Math.max(0, oldW), newW);
  const copyH = Math.min(Math.max(0, oldH), newH);

  for (let y = 0; y < copyH; y++) {
    const srcRowStart = y * oldW;
    const dstRowStart = y * newW;
    for (let x = 0; x < copyW; x++) {
      next[dstRowStart + x] = grid[srcRowStart + x] ?? 0;
    }
  }

  return next;
}

/**
 * Crops the grid to the tightest bounding box of non-empty tiles,
 * normalizes the anchor (or defaults to bottom-center if outside bounds),
 * and encodes the result using PrefabCodec.
 */
export function trimAndEncodePrefab(
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
  grid: Uint32Array,
  emptyAssetId: number = EMPTY_ASSET_ID,
  anchorZ: number = 0
): TrimmedPrefabResult {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      if (grid[rowOffset + x] !== emptyAssetId) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const rawByteLength = grid.byteLength;

  if (maxX < minX || maxY < minY) {
    const emptyPrefab: PrefabData = {
      width: 0,
      height: 0,
      anchorX: 0,
      anchorY: 0,
      anchorZ,
      grid: new Uint32Array(0),
    };
    const buffer = PrefabCodec.encode(0, 0, 0, 0, anchorZ, emptyPrefab.grid);
    const compressedByteLength = buffer.byteLength;
    return {
      prefab: emptyPrefab,
      buffer,
      rawByteLength,
      compressedByteLength,
      compressionRatio: compressedByteLength > 0 ? rawByteLength / compressedByteLength : 0,
    };
  }

  const trimmedW = maxX - minX + 1;
  const trimmedH = maxY - minY + 1;
  const trimmedGrid = new Uint32Array(trimmedW * trimmedH);

  for (let y = 0; y < trimmedH; y++) {
    const srcRowStart = (minY + y) * width + minX;
    const dstRowStart = y * trimmedW;
    for (let x = 0; x < trimmedW; x++) {
      trimmedGrid[dstRowStart + x] = grid[srcRowStart + x];
    }
  }

  const anchorInside =
    anchorX >= minX && anchorX <= maxX && anchorY >= minY && anchorY <= maxY;
  const trimmedAnchorX = anchorInside ? anchorX - minX : Math.floor(trimmedW / 2);
  const trimmedAnchorY = anchorInside ? anchorY - minY : trimmedH - 1;

  const prefab: PrefabData = {
    width: trimmedW,
    height: trimmedH,
    anchorX: trimmedAnchorX,
    anchorY: trimmedAnchorY,
    anchorZ,
    grid: trimmedGrid,
  };

  const buffer = PrefabCodec.encode(
    trimmedW,
    trimmedH,
    trimmedAnchorX,
    trimmedAnchorY,
    anchorZ,
    trimmedGrid
  );
  const compressedByteLength = buffer.byteLength;

  return {
    prefab,
    buffer,
    rawByteLength,
    compressedByteLength,
    compressionRatio: compressedByteLength > 0 ? rawByteLength / compressedByteLength : 0,
  };
}

/**
 * Stamps a prefab onto a cloned target grid with its anchor aligned to (dropX, dropY).
 * Skips emptyAssetId cells so existing tiles underneath remain intact, and clips at boundaries.
 */
export function stampPrefabOntoGrid(
  targetGrid: Uint32Array,
  targetW: number,
  targetH: number,
  prefab: PrefabData,
  dropX: number,
  dropY: number,
  emptyAssetId: number = EMPTY_ASSET_ID
): Uint32Array {
  const result = new Uint32Array(targetGrid);
  if (prefab.width <= 0 || prefab.height <= 0 || prefab.grid.length === 0) {
    return result;
  }

  const originX = dropX - prefab.anchorX;
  const originY = dropY - prefab.anchorY;

  for (let py = 0; py < prefab.height; py++) {
    const ty = originY + py;
    if (ty < 0 || ty >= targetH) continue;

    const srcRowOffset = py * prefab.width;
    const dstRowOffset = ty * targetW;

    for (let px = 0; px < prefab.width; px++) {
      const assetId = prefab.grid[srcRowOffset + px];
      if (assetId === emptyAssetId) continue;

      const tx = originX + px;
      if (tx < 0 || tx >= targetW) continue;

      result[dstRowOffset + tx] = assetId;
    }
  }

  return result;
}

/**
 * Computes the clipped list of non-empty cells that would be stamped
 * if a prefab were placed at (hoverX, hoverY).
 */
export function computeStampPreviewCells(
  targetW: number,
  targetH: number,
  prefab: PrefabData,
  hoverX: number,
  hoverY: number,
  emptyAssetId: number = EMPTY_ASSET_ID
): StampPreviewCell[] {
  if (prefab.width <= 0 || prefab.height <= 0 || prefab.grid.length === 0) {
    return [];
  }

  const cells: StampPreviewCell[] = [];
  const originX = hoverX - prefab.anchorX;
  const originY = hoverY - prefab.anchorY;

  for (let py = 0; py < prefab.height; py++) {
    const y = originY + py;
    if (y < 0 || y >= targetH) continue;

    const srcRowOffset = py * prefab.width;

    for (let px = 0; px < prefab.width; px++) {
      const assetId = prefab.grid[srcRowOffset + px];
      if (assetId === emptyAssetId) continue;

      const x = originX + px;
      if (x < 0 || x >= targetW) continue;

      cells.push({ x, y, assetId });
    }
  }

  return cells;
}

/**
 * Clamps a free-placed tile's top-left pixel coordinates inside the grid canvas bounds.
 */
export function clampFreePixelPosition(
  pixelX: number,
  pixelY: number,
  gridW: number,
  gridH: number,
  cellSize: number
): { pixelX: number; pixelY: number } {
  const maxX = Math.max(0, (gridW - 1) * cellSize);
  const maxY = Math.max(0, (gridH - 1) * cellSize);
  return {
    pixelX: Math.max(0, Math.min(maxX, pixelX)),
    pixelY: Math.max(0, Math.min(maxY, pixelY)),
  };
}

/**
 * Snaps a free pixel position to the nearest valid integer grid cell (col, row).
 */
export function snapPixelToGridCell(
  pixelX: number,
  pixelY: number,
  gridW: number,
  gridH: number,
  cellSize: number
): { col: number; row: number } {
  if (gridW <= 0 || gridH <= 0 || cellSize <= 0) {
    return { col: 0, row: 0 };
  }
  const col = Math.max(0, Math.min(gridW - 1, Math.round(pixelX / cellSize)));
  const row = Math.max(0, Math.min(gridH - 1, Math.round(pixelY / cellSize)));
  return { col, row };
}

/**
 * Commits floating tiles into a cloned grid by snapping each tile to its nearest cell.
 */
export function commitFloatingTilesToGrid(
  grid: Uint32Array,
  gridW: number,
  gridH: number,
  cellSize: number,
  floatingTiles: ReadonlyArray<FreePlacedTile>
): Uint32Array {
  const next = new Uint32Array(grid);
  if (gridW <= 0 || gridH <= 0) {
    return next;
  }

  for (const tile of floatingTiles) {
    if (tile.assetId === EMPTY_ASSET_ID) continue;
    const { col, row } = snapPixelToGridCell(
      tile.pixelX,
      tile.pixelY,
      gridW,
      gridH,
      cellSize
    );
    next[row * gridW + col] = tile.assetId;
  }

  return next;
}

/**
 * Encodes an ArrayBuffer into a Base64 string (works in Browser and Node without Node-only APIs).
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    return '';
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string back into an ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (!base64) {
    return new ArrayBuffer(0);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const MIN_Z_INDEX = -32768;
const MAX_Z_INDEX = 32767;

function clampZIndex(zIndex: number): number {
  const rounded = Math.trunc(Number.isFinite(zIndex) ? zIndex : 0);
  return Math.max(MIN_Z_INDEX, Math.min(MAX_Z_INDEX, rounded));
}

function cloneAndSortLayers(layers: ReadonlyArray<LayerGrid>): LayerGrid[] {
  return [...layers]
    .map((layer) => ({ zIndex: layer.zIndex, grid: new Uint32Array(layer.grid) }))
    .sort((a, b) => a.zIndex - b.zIndex);
}

function pruneEmptyLayers(
  layers: LayerGrid[],
  width: number,
  height: number,
  emptyAssetId: number = EMPTY_ASSET_ID
): LayerGrid[] {
  const nonEmpty = layers.filter((layer) => {
    for (let i = 0; i < layer.grid.length; i++) {
      if (layer.grid[i] !== emptyAssetId) return true;
    }
    return false;
  });

  if (nonEmpty.length === 0) {
    return [{ zIndex: 0, grid: createEmptyGrid(width, height) }];
  }
  return nonEmpty.sort((a, b) => a.zIndex - b.zIndex);
}

function getOrCreateLayer(
  layers: LayerGrid[],
  zIndex: number,
  width: number,
  height: number
): LayerGrid {
  const existing = layers.find((layer) => layer.zIndex === zIndex);
  if (existing) {
    return existing;
  }
  const created: LayerGrid = { zIndex, grid: createEmptyGrid(width, height) };
  layers.push(created);
  layers.sort((a, b) => a.zIndex - b.zIndex);
  return created;
}

/**
 * Creates a default single-layer (zIndex=0) grid stack.
 */
export function createLayerStack(width: number, height: number): LayerGrid[] {
  return [{ zIndex: 0, grid: createEmptyGrid(width, height) }];
}

/**
 * Resizes every layer in a stack while preserving top-left overlap.
 */
export function resizeLayerStack(
  layers: ReadonlyArray<LayerGrid>,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number
): LayerGrid[] {
  if (layers.length === 0) {
    return createLayerStack(newW, newH);
  }
  const resized = layers.map((layer) => ({
    zIndex: layer.zIndex,
    grid: resizeGrid(layer.grid, oldW, oldH, newW, newH),
  }));
  return pruneEmptyLayers(resized, newW, newH);
}

/**
 * Returns all non-empty tiles stacked at (col, row) sorted ascending by zIndex.
 */
export function getCellStack(
  layers: ReadonlyArray<LayerGrid>,
  width: number,
  col: number,
  row: number,
  emptyAssetId: number = EMPTY_ASSET_ID
): CellStackEntry[] {
  if (width <= 0 || col < 0 || row < 0 || col >= width) {
    return [];
  }
  const idx = row * width + col;
  const entries: CellStackEntry[] = [];
  for (const layer of layers) {
    if (idx >= layer.grid.length) continue;
    const assetId = layer.grid[idx];
    if (assetId !== emptyAssetId) {
      entries.push({ zIndex: layer.zIndex, assetId });
    }
  }
  entries.sort((a, b) => a.zIndex - b.zIndex);
  return entries;
}

/**
 * Places an assetId at (col, row). When stackOnTop=true and the cell already has tiles,
 * automatically stacks above the highest existing tile (max(zIndex, maxExistingZ + 1)).
 * When stackOnTop=false, replaces only the tile at the exact zIndex while keeping other layers intact.
 */
export function setCellInLayerStack(
  layers: ReadonlyArray<LayerGrid>,
  width: number,
  height: number,
  col: number,
  row: number,
  assetId: number,
  zIndex: number,
  stackOnTop: boolean,
  emptyAssetId: number = EMPTY_ASSET_ID
): { layers: LayerGrid[]; placedZIndex: number } {
  const baseZ = clampZIndex(zIndex);
  if (col < 0 || row < 0 || col >= width || row >= height) {
    return { layers: cloneAndSortLayers(layers), placedZIndex: baseZ };
  }

  if (assetId === emptyAssetId) {
    return {
      layers: eraseCellFromLayerStack(layers, width, col, row, baseZ, emptyAssetId),
      placedZIndex: baseZ,
    };
  }

  const next = cloneAndSortLayers(layers);
  const idx = row * width + col;
  let maxExistingZ: number | null = null;

  for (const layer of next) {
    if (idx < layer.grid.length && layer.grid[idx] !== emptyAssetId) {
      if (maxExistingZ === null || layer.zIndex > maxExistingZ) {
        maxExistingZ = layer.zIndex;
      }
    }
  }

  const targetZ =
    stackOnTop && maxExistingZ !== null
      ? clampZIndex(Math.max(baseZ, maxExistingZ + 1))
      : baseZ;

  const targetLayer = getOrCreateLayer(next, targetZ, width, height);
  targetLayer.grid[idx] = assetId;
  return { layers: next, placedZIndex: targetZ };
}

/**
 * Erases a tile from (col, row). If zIndex is omitted, erases the topmost non-empty tile at that cell.
 */
export function eraseCellFromLayerStack(
  layers: ReadonlyArray<LayerGrid>,
  width: number,
  col: number,
  row: number,
  zIndex?: number,
  emptyAssetId: number = EMPTY_ASSET_ID
): LayerGrid[] {
  const height = width > 0 && layers[0] ? Math.floor(layers[0].grid.length / width) : 0;
  const next = cloneAndSortLayers(layers);
  if (width <= 0 || height <= 0 || col < 0 || row < 0 || col >= width || row >= height) {
    return next.length > 0 ? next : createLayerStack(width, height);
  }

  const idx = row * width + col;

  if (zIndex !== undefined) {
    const target = next.find((layer) => layer.zIndex === zIndex);
    if (target) {
      target.grid[idx] = emptyAssetId;
    }
    return pruneEmptyLayers(next, width, height, emptyAssetId);
  }

  // Erase topmost non-empty tile
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].grid[idx] !== emptyAssetId) {
      next[i].grid[idx] = emptyAssetId;
      break;
    }
  }

  return pruneEmptyLayers(next, width, height, emptyAssetId);
}

/**
 * Moves a tile at (col, row, fromZ) to toZ. If (col, row, toZ) already holds a tile, swaps them cleanly.
 */
export function updateCellTileZIndex(
  layers: ReadonlyArray<LayerGrid>,
  width: number,
  height: number,
  col: number,
  row: number,
  fromZ: number,
  toZ: number,
  emptyAssetId: number = EMPTY_ASSET_ID
): LayerGrid[] {
  const clampedToZ = clampZIndex(toZ);
  const next = cloneAndSortLayers(layers);
  if (
    fromZ === clampedToZ ||
    col < 0 ||
    row < 0 ||
    col >= width ||
    row >= height
  ) {
    return next;
  }

  const idx = row * width + col;
  const sourceLayer = next.find((layer) => layer.zIndex === fromZ);
  if (!sourceLayer || sourceLayer.grid[idx] === emptyAssetId) {
    return next;
  }

  const movingAssetId = sourceLayer.grid[idx];
  const destLayer = getOrCreateLayer(next, clampedToZ, width, height);
  const displacedAssetId = destLayer.grid[idx];

  destLayer.grid[idx] = movingAssetId;
  sourceLayer.grid[idx] = displacedAssetId;

  return pruneEmptyLayers(next, width, height, emptyAssetId);
}

/**
 * Computes the tightest union bounding box across all non-empty layers and encodes
 * them using StackedPrefabCodec (emitting plain PrefabCodec when single z=0 layer).
 */
export function trimAndEncodeLayerStack(
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
  layers: ReadonlyArray<LayerGrid>,
  emptyAssetId: number = EMPTY_ASSET_ID,
  anchorZ: number = 0
): StackedTrimmedPrefabResult {
  const clampedAnchorZ = clampZIndex(anchorZ);
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  const occupiedLayers: LayerGrid[] = [];

  for (const layer of layers) {
    let layerHasTile = false;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        if (layer.grid[rowOffset + x] !== emptyAssetId) {
          layerHasTile = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (layerHasTile) {
      occupiedLayers.push(layer);
    }
  }

  if (occupiedLayers.length === 0 || maxX < minX || maxY < minY) {
    const emptyRawBytes = width * height * 4;
    const emptyBuffer = PrefabCodec.encode(0, 0, 0, 0, clampedAnchorZ, new Uint32Array(0));
    return {
      stacked: { width: 0, height: 0, anchorX: 0, anchorY: 0, anchorZ: clampedAnchorZ, layers: [] },
      buffer: emptyBuffer,
      rawByteLength: emptyRawBytes,
      compressedByteLength: emptyBuffer.byteLength,
      compressionRatio: emptyBuffer.byteLength > 0 ? emptyRawBytes / emptyBuffer.byteLength : 0,
      layerCount: 0,
    };
  }

  occupiedLayers.sort((a, b) => a.zIndex - b.zIndex);

  const trimmedW = maxX - minX + 1;
  const trimmedH = maxY - minY + 1;
  const anchorInside =
    anchorX >= minX && anchorX <= maxX && anchorY >= minY && anchorY <= maxY;
  const trimmedAnchorX = anchorInside ? anchorX - minX : Math.floor(trimmedW / 2);
  const trimmedAnchorY = anchorInside ? anchorY - minY : trimmedH - 1;

  const croppedInputs = occupiedLayers.map((layer) => {
    const croppedGrid = new Uint32Array(trimmedW * trimmedH);
    for (let y = 0; y < trimmedH; y++) {
      const srcRowStart = (minY + y) * width + minX;
      const dstRowStart = y * trimmedW;
      for (let x = 0; x < trimmedW; x++) {
        croppedGrid[dstRowStart + x] = layer.grid[srcRowStart + x];
      }
    }
    return { zIndex: layer.zIndex, grid: croppedGrid };
  });

  const buffer = StackedPrefabCodec.encodeLayers(
    trimmedW,
    trimmedH,
    trimmedAnchorX,
    trimmedAnchorY,
    clampedAnchorZ,
    croppedInputs
  );

  const stacked: StackedPrefabData = {
    width: trimmedW,
    height: trimmedH,
    anchorX: trimmedAnchorX,
    anchorY: trimmedAnchorY,
    anchorZ: clampedAnchorZ,
    layers: croppedInputs.map((entry) => ({
      zIndex: entry.zIndex,
      prefab: {
        width: trimmedW,
        height: trimmedH,
        anchorX: trimmedAnchorX,
        anchorY: trimmedAnchorY,
        anchorZ: clampedAnchorZ,
        grid: entry.grid,
      },
    })),
  };

  const rawByteLength = width * height * 4 * croppedInputs.length;
  const compressedByteLength = buffer.byteLength;

  return {
    stacked,
    buffer,
    rawByteLength,
    compressedByteLength,
    compressionRatio: compressedByteLength > 0 ? rawByteLength / compressedByteLength : 0,
    layerCount: croppedInputs.length,
  };
}

/**
 * Stamps all layers of a decoded StackedPrefabData onto targetLayers,
 * offsetting each layer's relative zIndex by (stacked.anchorZ + baseZOffset).
 */
export function stampPrefabOntoLayerStack(
  targetLayers: ReadonlyArray<LayerGrid>,
  targetW: number,
  targetH: number,
  stacked: StackedPrefabData,
  dropX: number,
  dropY: number,
  baseZOffset: number = 0,
  emptyAssetId: number = EMPTY_ASSET_ID
): LayerGrid[] {
  const next = cloneAndSortLayers(targetLayers);
  if (stacked.width <= 0 || stacked.height <= 0 || stacked.layers.length === 0) {
    return next;
  }

  for (const srcLayer of stacked.layers) {
    const destZ = clampZIndex(stacked.anchorZ + srcLayer.zIndex + baseZOffset);
    const destLayer = getOrCreateLayer(next, destZ, targetW, targetH);
    destLayer.grid = stampPrefabOntoGrid(
      destLayer.grid,
      targetW,
      targetH,
      srcLayer.prefab,
      dropX,
      dropY,
      emptyAssetId
    );
  }

  return pruneEmptyLayers(next, targetW, targetH, emptyAssetId);
}

/**
 * Computes clipped preview cells across all layers of a StackedPrefabData sorted by zIndex.
 */
export function computeStackedStampPreviewCells(
  targetW: number,
  targetH: number,
  stacked: StackedPrefabData,
  hoverX: number,
  hoverY: number,
  baseZOffset: number = 0,
  emptyAssetId: number = EMPTY_ASSET_ID
): StackedStampPreviewCell[] {
  const cells: StackedStampPreviewCell[] = [];
  const sorted = [...stacked.layers].sort((a, b) => a.zIndex - b.zIndex);

  for (const layer of sorted) {
    const zIndex = clampZIndex(stacked.anchorZ + layer.zIndex + baseZOffset);
    const layerCells = computeStampPreviewCells(
      targetW,
      targetH,
      layer.prefab,
      hoverX,
      hoverY,
      emptyAssetId
    );
    for (const cell of layerCells) {
      cells.push({ x: cell.x, y: cell.y, zIndex, assetId: cell.assetId });
    }
  }

  return cells;
}

/**
 * Commits floating tiles into their snapped grid cells at each tile's zIndex.
 */
export function commitFloatingTilesToLayerStack(
  layers: ReadonlyArray<LayerGrid>,
  gridW: number,
  gridH: number,
  cellSize: number,
  floatingTiles: ReadonlyArray<FreePlacedTile>,
  stackOnTop: boolean = false
): LayerGrid[] {
  let next = cloneAndSortLayers(layers);
  if (gridW <= 0 || gridH <= 0) {
    return next;
  }

  const ordered = [...floatingTiles].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  for (const tile of ordered) {
    if (tile.assetId === EMPTY_ASSET_ID) continue;
    const { col, row } = snapPixelToGridCell(
      tile.pixelX,
      tile.pixelY,
      gridW,
      gridH,
      cellSize
    );
    next = setCellInLayerStack(
      next,
      gridW,
      gridH,
      col,
      row,
      tile.assetId,
      tile.zIndex ?? 0,
      stackOnTop
    ).layers;
  }

  return next;
}
