/**
 * Asset Registry & Browser Texture/Thumbnail Loader.
 * Maps the 6 texture atlases to deterministic 32-bit Global Asset IDs,
 * filters out empty transparent cells and Grass alignment marker tiles,
 * and generates sliced PixiJS Textures + 32x32 PNG data URLs for the editor UI.
 */

import { Assets, Rectangle, Texture } from 'pixi.js';

export const EMPTY_ASSET_ID = 0;
export const TILE_PIXEL_SIZE = 32;

export interface AssetSetDefinition {
  readonly sheetId: number;
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly excludedIndices?: readonly number[];
}

export interface LoadedAssetTile {
  assetId: number;
  sheetId: number;
  tileIndex: number;
  col: number;
  row: number;
  texture: Texture;
  previewDataUrl: string;
}

export const ASSET_SETS: readonly AssetSetDefinition[] = Object.freeze([
  Object.freeze({
    sheetId: 1,
    id: 'grass',
    label: 'Grass',
    path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Grass.png',
    width: 256,
    height: 256,
    cols: 8,
    rows: 8,
    tileSize: TILE_PIXEL_SIZE,
    excludedIndices: Object.freeze([62, 63]),
  }),
  Object.freeze({
    sheetId: 2,
    id: 'stone_ground',
    label: 'Stone Ground',
    path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Stone Ground.png',
    width: 256,
    height: 256,
    cols: 8,
    rows: 8,
    tileSize: TILE_PIXEL_SIZE,
  }),
  Object.freeze({
    sheetId: 3,
    id: 'wall',
    label: 'Walls',
    path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Wall.png',
    width: 512,
    height: 512,
    cols: 16,
    rows: 16,
    tileSize: TILE_PIXEL_SIZE,
  }),
  Object.freeze({
    sheetId: 4,
    id: 'struct',
    label: 'Structures',
    path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Struct.png',
    width: 512,
    height: 512,
    cols: 16,
    rows: 16,
    tileSize: TILE_PIXEL_SIZE,
  }),
  Object.freeze({
    sheetId: 5,
    id: 'props',
    label: 'Props',
    path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Props.png',
    width: 512,
    height: 512,
    cols: 16,
    rows: 16,
    tileSize: TILE_PIXEL_SIZE,
  }),
  Object.freeze({
    sheetId: 6,
    id: 'plant',
    label: 'Plants',
    path: '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Plant.png',
    width: 512,
    height: 512,
    cols: 16,
    rows: 16,
    tileSize: TILE_PIXEL_SIZE,
  }),
]);

/**
 * Packs (sheetId, tileIndex) into an unsigned 32-bit Global Asset ID:
 * bits 16..23 = sheetId (1..255), bits 0..15 = tileIndex (0..65535).
 */
export function encodeAssetId(sheetId: number, tileIndex: number): number {
  if (!Number.isInteger(sheetId) || sheetId < 1 || sheetId > 255) {
    throw new RangeError(`Invalid sheetId: expected integer in [1, 255], got ${sheetId}.`);
  }
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex > 65535) {
    throw new RangeError(`Invalid tileIndex: expected integer in [0, 65535], got ${tileIndex}.`);
  }
  return (((sheetId & 0xff) << 16) | (tileIndex & 0xffff)) >>> 0;
}

/**
 * Decodes a 32-bit Global Asset ID back into { sheetId, tileIndex },
 * or returns null for EMPTY_ASSET_ID (0).
 */
export function decodeAssetId(assetId: number): { sheetId: number; tileIndex: number } | null {
  if (assetId === EMPTY_ASSET_ID) {
    return null;
  }
  const sheetId = (assetId >>> 16) & 0xff;
  if (sheetId === 0) {
    return null;
  }
  const tileIndex = assetId & 0xffff;
  return { sheetId, tileIndex };
}

/**
 * Finds an AssetSetDefinition by its 1-based sheetId.
 */
export function getAssetSetBySheetId(sheetId: number): AssetSetDefinition | undefined {
  return ASSET_SETS.find((set) => set.sheetId === sheetId);
}

/**
 * Returns true if any pixel within the (col, row) tile cell has alpha > 0.
 */
export function hasOpaquePixels(
  rgba: Uint8ClampedArray,
  imageWidth: number,
  col: number,
  row: number,
  tileSize: number = TILE_PIXEL_SIZE
): boolean {
  const startX = col * tileSize;
  const startY = row * tileSize;

  for (let dy = 0; dy < tileSize; dy++) {
    const y = startY + dy;
    for (let dx = 0; dx < tileSize; dx++) {
      const x = startX + dx;
      const alphaOffset = (y * imageWidth + x) * 4 + 3;
      if (rgba[alphaOffset] > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Scans an RGBA image buffer for a tileset and returns row-major linear indices
 * of all cells containing opaque pixels, excluding any configured excludedIndices.
 */
export function extractNonEmptyTileIndices(
  rgba: Uint8ClampedArray,
  set: AssetSetDefinition
): number[] {
  const excluded = new Set(set.excludedIndices ?? []);
  const indices: number[] = [];

  for (let row = 0; row < set.rows; row++) {
    for (let col = 0; col < set.cols; col++) {
      const tileIndex = row * set.cols + col;
      if (excluded.has(tileIndex)) {
        continue;
      }
      if (hasOpaquePixels(rgba, set.width, col, row, set.tileSize)) {
        indices.push(tileIndex);
      }
    }
  }

  return indices;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load asset image: ${src}`));
    img.src = src;
  });
}

/**
 * Browser-runtime loader for all registered tileset sheets.
 * Slices non-empty 32x32 PixiJS Textures and generates crisp PNG thumbnails.
 */
export class AssetLibraryLoader {
  private readonly tilesByAssetId = new Map<number, LoadedAssetTile>();
  private readonly tilesBySheetId = new Map<number, LoadedAssetTile[]>();
  private isLoaded = false;
  private isDestroyed = false;
  private loadPromise: Promise<void> | null = null;

  public async load(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.isDestroyed = false;
    this.loadPromise = this.performLoad();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async performLoad(): Promise<void> {
    const tileCanvas =
      typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const tileCtx = tileCanvas ? tileCanvas.getContext('2d') : null;
    if (tileCtx) {
      tileCtx.imageSmoothingEnabled = false;
    }

    for (const set of ASSET_SETS) {
      const encodedPath = encodeURI(set.path);
      const baseTexture = await Assets.load<Texture>(encodedPath);
      if (this.isDestroyed) {
        return;
      }

      baseTexture.source.scaleMode = 'nearest';

      let nonEmptyIndices: number[];
      let sheetCanvas: HTMLCanvasElement | null = null;

      if (typeof document !== 'undefined') {
        sheetCanvas = document.createElement('canvas');
        sheetCanvas.width = set.width;
        sheetCanvas.height = set.height;
        const sheetCtx = sheetCanvas.getContext('2d', { willReadFrequently: true });
        if (!sheetCtx) {
          throw new Error(`Unable to create 2D context for asset set "${set.id}".`);
        }
        sheetCtx.imageSmoothingEnabled = false;

        const resource = baseTexture.source.resource as CanvasImageSource | undefined;
        if (resource) {
          sheetCtx.drawImage(resource, 0, 0, set.width, set.height);
        } else {
          const fallbackImg = await loadHtmlImage(encodedPath);
          if (this.isDestroyed) {
            return;
          }
          sheetCtx.drawImage(fallbackImg, 0, 0, set.width, set.height);
        }

        const imageData = sheetCtx.getImageData(0, 0, set.width, set.height);
        nonEmptyIndices = extractNonEmptyTileIndices(imageData.data, set);
      } else {
        const excluded = new Set(set.excludedIndices ?? []);
        nonEmptyIndices = [];
        const total = set.cols * set.rows;
        for (let i = 0; i < total; i++) {
          if (!excluded.has(i)) {
            nonEmptyIndices.push(i);
          }
        }
      }

      const sheetTiles: LoadedAssetTile[] = [];

      for (const tileIndex of nonEmptyIndices) {
        const col = tileIndex % set.cols;
        const row = Math.floor(tileIndex / set.cols);
        const assetId = encodeAssetId(set.sheetId, tileIndex);

        const frame = new Rectangle(
          col * set.tileSize,
          row * set.tileSize,
          set.tileSize,
          set.tileSize
        );
        const subTexture = new Texture({
          source: baseTexture.source,
          frame,
        });

        let previewDataUrl = '';
        if (sheetCanvas && tileCanvas && tileCtx) {
          tileCanvas.width = set.tileSize;
          tileCanvas.height = set.tileSize;
          tileCtx.clearRect(0, 0, set.tileSize, set.tileSize);
          tileCtx.imageSmoothingEnabled = false;
          tileCtx.drawImage(
            sheetCanvas,
            col * set.tileSize,
            row * set.tileSize,
            set.tileSize,
            set.tileSize,
            0,
            0,
            set.tileSize,
            set.tileSize
          );
          previewDataUrl = tileCanvas.toDataURL('image/png');
        }

        const loadedTile: LoadedAssetTile = {
          assetId,
          sheetId: set.sheetId,
          tileIndex,
          col,
          row,
          texture: subTexture,
          previewDataUrl,
        };

        this.tilesByAssetId.set(assetId, loadedTile);
        sheetTiles.push(loadedTile);
      }

      this.tilesBySheetId.set(set.sheetId, sheetTiles);
    }

    if (!this.isDestroyed) {
      this.isLoaded = true;
    }
  }

  public hasLoaded(): boolean {
    return this.isLoaded;
  }

  public getTexture(assetId: number): Texture {
    if (!this.isLoaded) {
      throw new Error('AssetLibraryLoader has not loaded textures yet.');
    }
    if (assetId === EMPTY_ASSET_ID) {
      return Texture.EMPTY;
    }
    return this.tilesByAssetId.get(assetId)?.texture ?? Texture.EMPTY;
  }

  public getPreviewUrl(assetId: number): string | undefined {
    return this.tilesByAssetId.get(assetId)?.previewDataUrl;
  }

  public getTilesForSet(sheetId: number): LoadedAssetTile[] {
    return this.tilesBySheetId.get(sheetId) ?? [];
  }

  public destroy(): void {
    this.isDestroyed = true;
    for (const tile of this.tilesByAssetId.values()) {
      tile.texture.destroy(false);
    }
    this.tilesByAssetId.clear();
    this.tilesBySheetId.clear();
    this.isLoaded = false;
    this.loadPromise = null;
  }
}
