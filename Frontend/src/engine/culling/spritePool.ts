/**
 * Generic Sprite Pool with Zero Net Allocation Invariant.
 * Recycles sprites when tiles leave the preload buffer margin,
 * eliminating garbage collection pauses during player motion.
 */

import type { TileBounds } from './looseCulling.ts';
import { isTileBuffered } from './looseCulling.ts';
import type { WorldTile } from '../procedural/worldGen.ts';

export interface SpritePoolOptions<T> {
  createItem: () => T;
  onActivate: (item: T, tx: number, ty: number, tile: WorldTile) => void;
  onRecycle: (item: T) => void;
}

export interface CullingTelemetry {
  visibleCount: number;
  loadedCount: number;
  pooledCount: number;
  totalAllocated: number;
}

export class SpritePool<T> {
  public readonly activeTiles = new Map<string, T>();
  public readonly freePool: T[] = [];
  public totalAllocated = 0;

  private readonly createItem: () => T;
  private readonly onActivate: (item: T, tx: number, ty: number, tile: WorldTile) => void;
  private readonly onRecycle: (item: T) => void;

  constructor(options: SpritePoolOptions<T>) {
    this.createItem = options.createItem;
    this.onActivate = options.onActivate;
    this.onRecycle = options.onRecycle;
  }

  /**
   * Updates active tiles according to loose culling bounds.
   * Recycles out-of-bounds tiles into the free pool, then acquires
   * and activates newly entering tiles from the free pool (or creates
   * new instances only if the pool is exhausted during initial expansion).
   */
  public update(
    bounds: TileBounds,
    getTile: (tx: number, ty: number) => WorldTile
  ): { culled: number; acquired: number } {
    let culled = 0;
    let acquired = 0;

    // Step 1: Cull off-margin tiles into freePool
    for (const [key, item] of this.activeTiles.entries()) {
      const commaIdx = key.indexOf(',');
      const tx = parseInt(key.slice(0, commaIdx), 10);
      const ty = parseInt(key.slice(commaIdx + 1), 10);

      if (!isTileBuffered(tx, ty, bounds)) {
        this.onRecycle(item);
        this.activeTiles.delete(key);
        this.freePool.push(item);
        culled++;
      }
    }

    // Step 2: Acquire entering tiles from freePool (zero allocation in steady-state)
    for (let ty = bounds.minBufY; ty <= bounds.maxBufY; ty++) {
      for (let tx = bounds.minBufX; tx <= bounds.maxBufX; tx++) {
        const key = `${tx},${ty}`;
        if (!this.activeTiles.has(key)) {
          let item = this.freePool.pop();
          if (!item) {
            item = this.createItem();
            this.totalAllocated++;
          }
          const tile = getTile(tx, ty);
          this.onActivate(item, tx, ty, tile);
          this.activeTiles.set(key, item);
          acquired++;
        }
      }
    }

    return { culled, acquired };
  }

  /**
   * Returns current telemetry metrics for HUD and debug displays.
   */
  public getTelemetry(bounds: TileBounds): CullingTelemetry {
    return {
      visibleCount: bounds.visibleTileCount,
      loadedCount: this.activeTiles.size,
      pooledCount: this.freePool.length,
      totalAllocated: this.totalAllocated,
    };
  }

  /**
   * Recycles all active tiles and clears the active map.
   */
  public clear(): void {
    for (const item of this.activeTiles.values()) {
      this.onRecycle(item);
      this.freePool.push(item);
    }
    this.activeTiles.clear();
  }
}
