/**
 * Tileset Slicing and Texture Management for TX Tileset Grass.png.
 * Slices 256x256 image into an 8x8 grid of 32x32 tiles with nearest-neighbor scaling.
 */

import { Assets, Texture, Rectangle } from 'pixi.js';
import { ATLAS_COLS, ATLAS_ROWS, TILE_SOURCE_SIZE, isMarkerTile } from '../procedural/worldGen.ts';

export const DEFAULT_TILESET_PATH = '/Pixel Art Top Down - Basic v1.2.3/Texture/TX Tileset Grass.png';

export class TilesetManager {
  private tileTextures: Texture[][] = [];
  private isLoaded = false;

  /**
   * Loads the tileset texture and slices it into an 8x8 grid of sub-textures.
   */
  public async load(path: string = DEFAULT_TILESET_PATH): Promise<void> {
    if (this.isLoaded) return;

    const texture = await Assets.load<Texture>(encodeURI(path));

    // Enforce nearest-neighbor point sampling on source
    texture.source.scaleMode = 'nearest';

    this.tileTextures = [];
    for (let row = 0; row < ATLAS_ROWS; row++) {
      this.tileTextures[row] = [];
      for (let col = 0; col < ATLAS_COLS; col++) {
        const frame = new Rectangle(
          col * TILE_SOURCE_SIZE,
          row * TILE_SOURCE_SIZE,
          TILE_SOURCE_SIZE,
          TILE_SOURCE_SIZE
        );
        const subTexture = new Texture({
          source: texture.source,
          frame,
        });
        this.tileTextures[row][col] = subTexture;
      }
    }

    this.isLoaded = true;
  }

  /**
   * Retrieves the sliced texture for atlas coordinate (col, row).
   * Asserts that alignment marker tiles (6,7) and (7,7) are never accessed.
   */
  public getTexture(col: number, row: number): Texture {
    if (!this.isLoaded) {
      throw new Error('TilesetManager has not loaded textures yet.');
    }
    if (isMarkerTile(col, row)) {
      throw new Error(`Forbidden: Attempted to get texture for excluded marker tile (${col}, ${row}).`);
    }
    const texRow = this.tileTextures[row];
    if (!texRow || !texRow[col]) {
      throw new Error(`Invalid tile coordinates (${col}, ${row}).`);
    }
    return texRow[col];
  }

  /**
   * Disposes sliced sub-textures while keeping Assets-cached base source valid for remounts.
   */
  public destroy(): void {
    for (const row of this.tileTextures) {
      for (const tex of row) {
        tex.destroy(false);
      }
    }
    this.tileTextures = [];
    this.isLoaded = false;
  }
}
