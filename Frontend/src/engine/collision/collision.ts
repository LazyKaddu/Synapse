/**
 * 2D Collision Detection & Axis-Separated Wall Sliding Engine.
 * Provides deterministic AABB collision detection and sliding physics against:
 * 1. Water bodies (ponds, lakes, oceans) where worldNoise.isWaterAt is true.
 * 2. Tree trunks (centered 32x32 trunk base) while leaving overhead tree canopies walkable.
 * 3. Village house walls and roofs, while keeping entrance doors and interior floors walkable.
 * 4. Village props (town well, crates, barrels, lanterns, benches, fences).
 * 5. Smooth axis-separated movement resolution (smooth sliding along obstacle boundaries).
 * 6. Safe spawn solving to prevent players from spawning inside obstacles.
 */

import type { WorldNoise } from '../procedural/worldNoise.ts';
import { RENDER_TILE_SIZE } from '../procedural/worldGen.ts';

export interface AABB {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export type ColliderType =
  | 'water'
  | 'tree_trunk'
  | 'house_wall'
  | 'house_roof'
  | 'prop_well'
  | 'prop_obstacle';

export interface WorldCollider {
  readonly type: ColliderType;
  readonly label: string;
  readonly tx: number;
  readonly ty: number;
  readonly aabb: AABB;
}

export interface MovementResolution {
  readonly newX: number;
  readonly newY: number;
  readonly xBlocked: boolean;
  readonly yBlocked: boolean;
  readonly collider?: WorldCollider;
}

/**
 * Returns true if two Axis-Aligned Bounding Boxes intersect.
 * Uses strict inequality on borders so touching edges do not register false collisions.
 */
export function aabbIntersects(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minY < b.maxY &&
    a.maxY > b.minY
  );
}

/**
 * Returns true if point (x, y) falls inside the AABB.
 */
export function pointInAABB(x: number, y: number, box: AABB): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

/**
 * Collision Engine handling spatial queries against procedural world features.
 */
export class CollisionEngine {
  readonly worldNoise: WorldNoise;
  readonly tileSize: number;

  constructor(worldNoise: WorldNoise, tileSize: number = RENDER_TILE_SIZE) {
    this.worldNoise = worldNoise;
    this.tileSize = tileSize; // default 64px
  }

  /**
   * Retrieves all solid colliders in the integer tile range covering the given area.
   */
  getCollidersInArea(area: AABB): WorldCollider[] {
    const minTx = Math.floor(area.minX / this.tileSize);
    const maxTx = Math.floor(area.maxX / this.tileSize);
    const minTy = Math.floor(area.minY / this.tileSize);
    const maxTy = Math.floor(area.maxY / this.tileSize);

    const colliders: WorldCollider[] = [];

    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        const tileOriginX = tx * this.tileSize;
        const tileOriginY = ty * this.tileSize;

        // 1. Water Body Check (Ponds / Lakes / Oceans)
        if (this.worldNoise.isWaterAt(tx, ty)) {
          colliders.push({
            type: 'water',
            label: 'Water Basin',
            tx,
            ty,
            aabb: {
              minX: tileOriginX,
              minY: tileOriginY,
              maxX: tileOriginX + this.tileSize,
              maxY: tileOriginY + this.tileSize,
            },
          });
          // Water tile is fully solid; skip further sub-tile checks for this tile
          continue;
        }

        // 2. Village Structure Check (House walls, roofs, props)
        const village = this.worldNoise.getVillageAt(tx, ty);
        if (village && village.isInside && village.tileInfo) {
          const info = village.tileInfo;

          // Village House Walls & Roofs (Doors and interior floor are walkable)
          if (info.house) {
            if (info.housePart === 'wall') {
              colliders.push({
                type: 'house_wall',
                label: `House Wall (${info.house.model.name})`,
                tx,
                ty,
                aabb: {
                  minX: tileOriginX,
                  minY: tileOriginY,
                  maxX: tileOriginX + this.tileSize,
                  maxY: tileOriginY + this.tileSize,
                },
              });
              continue;
            } else if (info.housePart === 'roof') {
              colliders.push({
                type: 'house_roof',
                label: `House Roof (${info.house.model.name})`,
                tx,
                ty,
                aabb: {
                  minX: tileOriginX,
                  minY: tileOriginY,
                  maxX: tileOriginX + this.tileSize,
                  maxY: tileOriginY + this.tileSize,
                },
              });
              continue;
            }
            // Doors and interior floor have no collider -> walkable!
          }

          // Village Props (Town well, crates, barrels, lanterns, benches)
          if (info.prop) {
            if (info.prop.type === 'well') {
              colliders.push({
                type: 'prop_well',
                label: 'Town Well',
                tx,
                ty,
                aabb: {
                  minX: tileOriginX + 8,
                  minY: tileOriginY + 8,
                  maxX: tileOriginX + this.tileSize - 8,
                  maxY: tileOriginY + this.tileSize - 8,
                },
              });
              continue;
            } else if (info.prop.type === 'lantern') {
              colliders.push({
                type: 'prop_obstacle',
                label: 'Street Lantern',
                tx,
                ty,
                aabb: {
                  minX: tileOriginX + 20,
                  minY: tileOriginY + 20,
                  maxX: tileOriginX + this.tileSize - 20,
                  maxY: tileOriginY + this.tileSize - 20,
                },
              });
              continue;
            } else {
              // Crates, barrels, benches, fences
              colliders.push({
                type: 'prop_obstacle',
                label: info.prop.label,
                tx,
                ty,
                aabb: {
                  minX: tileOriginX + 12,
                  minY: tileOriginY + 12,
                  maxX: tileOriginX + this.tileSize - 12,
                  maxY: tileOriginY + this.tileSize - 12,
                },
              });
              continue;
            }
          }
        }

        // 3. Tree Trunk Anchor Check
        // Trees have overhead canopy (walkable) but solid trunk base (32x32 center box)
        const tree = this.worldNoise.getTreeAt(tx, ty);
        if (tree) {
          // Center 32x32 trunk collision box in 64px tile
          colliders.push({
            type: 'tree_trunk',
            label: `Tree Trunk [${tree.maturity?.toUpperCase() ?? 'TREE'}]`,
            tx,
            ty,
            aabb: {
              minX: tileOriginX + 16,
              minY: tileOriginY + 16,
              maxX: tileOriginX + this.tileSize - 16,
              maxY: tileOriginY + this.tileSize - 16,
            },
          });
        }
      }
    }

    return colliders;
  }

  /**
   * Tests if the given box intersects any solid world collider.
   * Returns the first intersecting collider, or null if completely free.
   */
  checkCollision(box: AABB): WorldCollider | null {
    const colliders = this.getCollidersInArea(box);
    for (const collider of colliders) {
      if (aabbIntersects(box, collider.aabb)) {
        return collider;
      }
    }
    return null;
  }

  /**
   * Resolves continuous movement using Axis-Separated Sweeps (X-then-Y integration).
   * If moving diagonally against a vertical wall, X is blocked while Y slides smoothly,
   * avoiding sticky or frozen diagonal movement.
   */
  resolveMovement(
    currentX: number,
    currentY: number,
    dx: number,
    dy: number,
    speed: number,
    dt: number,
    halfWidth: number,
    halfHeight: number
  ): MovementResolution {
    if (dx === 0 && dy === 0) {
      return {
        newX: currentX,
        newY: currentY,
        xBlocked: false,
        yBlocked: false,
      };
    }

    let resolvedX = currentX;
    let resolvedY = currentY;
    let xBlocked = false;
    let yBlocked = false;
    let blockingCollider: WorldCollider | undefined;

    // 1. Sweep along X axis
    if (dx !== 0) {
      const stepX = dx * speed * dt;
      const targetX = currentX + stepX;
      const boxX: AABB = {
        minX: targetX - halfWidth,
        minY: currentY - halfHeight,
        maxX: targetX + halfWidth,
        maxY: currentY + halfHeight,
      };

      const hitX = this.checkCollision(boxX);
      if (hitX) {
        xBlocked = true;
        blockingCollider = hitX;
      } else {
        resolvedX = targetX;
      }
    }

    // 2. Sweep along Y axis starting from resolvedX
    if (dy !== 0) {
      const stepY = dy * speed * dt;
      const targetY = currentY + stepY;
      const boxY: AABB = {
        minX: resolvedX - halfWidth,
        minY: targetY - halfHeight,
        maxX: resolvedX + halfWidth,
        maxY: targetY + halfHeight,
      };

      const hitY = this.checkCollision(boxY);
      if (hitY) {
        yBlocked = true;
        if (!blockingCollider) {
          blockingCollider = hitY;
        }
      } else {
        resolvedY = targetY;
      }
    }

    return {
      newX: resolvedX,
      newY: resolvedY,
      xBlocked,
      yBlocked,
      collider: blockingCollider,
    };
  }

  /**
   * Anti-stuck solver: finds the closest collision-free position around preferred (x, y)
   * using an outward spiral radial search.
   */
  findSafeSpawn(
    preferredX: number,
    preferredY: number,
    halfWidth: number = 14,
    halfHeight: number = 14
  ): { x: number; y: number } {
    const initialBox: AABB = {
      minX: preferredX - halfWidth,
      minY: preferredY - halfHeight,
      maxX: preferredX + halfWidth,
      maxY: preferredY + halfHeight,
    };

    if (!this.checkCollision(initialBox)) {
      return { x: preferredX, y: preferredY };
    }

    // Radial spiral search in steps of 32px up to 10 tiles (640px)
    const step = 32;
    for (let r = 1; r <= 20; r++) {
      const dist = r * step;
      // Test 8 directional spokes at distance dist
      const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -(3 * Math.PI) / 4, -Math.PI / 2, -Math.PI / 4];
      for (const angle of angles) {
        const testX = preferredX + Math.cos(angle) * dist;
        const testY = preferredY + Math.sin(angle) * dist;
        const testBox: AABB = {
          minX: testX - halfWidth,
          minY: testY - halfHeight,
          maxX: testX + halfWidth,
          maxY: testY + halfHeight,
        };
        if (!this.checkCollision(testBox)) {
          return { x: testX, y: testY };
        }
      }
    }

    // Fallback
    return { x: preferredX, y: preferredY };
  }
}
