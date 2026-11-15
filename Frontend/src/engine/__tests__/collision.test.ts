import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aabbIntersects,
  pointInAABB,
  CollisionEngine,
  type AABB,
} from '../collision/collision.ts';
import { WorldNoise } from '../procedural/worldNoise.ts';
import { RENDER_TILE_SIZE } from '../procedural/worldGen.ts';

describe('CollisionEngine: 1. AABB Mathematical Primitives', () => {
  it('accurately identifies intersecting and disjoint AABB boundaries', () => {
    const box1: AABB = { minX: 10, minY: 10, maxX: 50, maxY: 50 };
    const box2: AABB = { minX: 30, minY: 30, maxX: 70, maxY: 70 };
    const box3: AABB = { minX: 60, minY: 60, maxX: 90, maxY: 90 };
    const touchingBox: AABB = { minX: 50, minY: 10, maxX: 80, maxY: 50 }; // touches box1 at X=50

    // Overlapping boxes
    assert.strictEqual(aabbIntersects(box1, box2), true, 'box1 and box2 overlap');
    assert.strictEqual(aabbIntersects(box2, box1), true, 'Commutative overlap');

    // Disjoint boxes
    assert.strictEqual(aabbIntersects(box1, box3), false, 'box1 and box3 are disjoint');

    // Edge-touching boxes must NOT register as collision (no phantom collision on tile boundaries)
    assert.strictEqual(aabbIntersects(box1, touchingBox), false, 'Touching edges must not collide');
  });

  it('correctly evaluates point containment in AABB', () => {
    const box: AABB = { minX: 0, minY: 0, maxX: 64, maxY: 64 };
    assert.strictEqual(pointInAABB(32, 32, box), true, 'Center point inside');
    assert.strictEqual(pointInAABB(0, 0, box), true, 'Corner point inside');
    assert.strictEqual(pointInAABB(-1, 32, box), false, 'Outside left');
    assert.strictEqual(pointInAABB(32, 65, box), false, 'Outside bottom');
  });
});

describe('CollisionEngine: 2. Water Bodies Collision', () => {
  it('generates full 64x64 solid colliders for water tiles and blocks player entry', () => {
    const wn = new WorldNoise({
      seed: 42,
      waterThreshold: 0.8, // Force water basins
    });
    const engine = new CollisionEngine(wn, RENDER_TILE_SIZE);

    // Find a water tile
    let waterTx = 0;
    let waterTy = 0;
    let foundWater = false;
    for (let x = -20; x <= 20 && !foundWater; x++) {
      for (let y = -20; y <= 20 && !foundWater; y++) {
        if (wn.isWaterAt(x, y)) {
          waterTx = x;
          waterTy = y;
          foundWater = true;
        }
      }
    }

    assert.ok(foundWater, 'Must find a water tile for testing');

    const waterBox: AABB = {
      minX: waterTx * 64,
      minY: waterTy * 64,
      maxX: (waterTx + 1) * 64,
      maxY: (waterTy + 1) * 64,
    };

    const colliders = engine.getCollidersInArea(waterBox);
    const waterCollider = colliders.find((c) => c.type === 'water');
    assert.ok(waterCollider !== undefined, 'Water collider must exist');
    assert.strictEqual(waterCollider.tx, waterTx);
    assert.strictEqual(waterCollider.ty, waterTy);
    assert.strictEqual(waterCollider.aabb.minX, waterTx * 64);
    assert.strictEqual(waterCollider.aabb.maxX, (waterTx + 1) * 64);

    // Player stepping into center of water tile must collide
    const playerInWater: AABB = {
      minX: waterTx * 64 + 20,
      minY: waterTy * 64 + 20,
      maxX: waterTx * 64 + 44,
      maxY: waterTy * 64 + 44,
    };
    const hit = engine.checkCollision(playerInWater);
    assert.ok(hit !== null, 'Player inside water must register collision');
    assert.strictEqual(hit.type, 'water');
  });
});

describe('CollisionEngine: 3. Tree Trunk Solid Base & Canopy Walkability', () => {
  it('blocks player from entering the 32x32 center tree trunk anchor', () => {
    const wn = new WorldNoise({
      seed: 12345,
      forestThreshold: 0.1, // Dense forest to guarantee trees
    });
    const engine = new CollisionEngine(wn, RENDER_TILE_SIZE);

    // Find a tree with canopyRadius >= 1
    let treeTx = 0;
    let treeTy = 0;
    let foundTree = false;
    for (let x = -30; x <= 30 && !foundTree; x++) {
      for (let y = -30; y <= 30 && !foundTree; y++) {
        const tree = wn.getTreeAt(x, y);
        if (tree && (tree.canopyRadius ?? 0) >= 1) {
          treeTx = x;
          treeTy = y;
          foundTree = true;
        }
      }
    }

    assert.ok(foundTree, 'Must find a tree to test');

    // 1. Center of the trunk tile (32x32 box) MUST collide
    const trunkBox: AABB = {
      minX: treeTx * 64 + 18,
      minY: treeTy * 64 + 18,
      maxX: treeTx * 64 + 46,
      maxY: treeTy * 64 + 46,
    };
    const trunkHit = engine.checkCollision(trunkBox);
    assert.ok(trunkHit !== null, 'Trunk center must collide');
    assert.strictEqual(trunkHit.type, 'tree_trunk');

    // 2. Corner of the same tile (outside the 32x32 center trunk box) MUST be walkable
    // e.g. tile top-left margin [2, 2, 14, 14]
    const cornerTileBox: AABB = {
      minX: treeTx * 64 + 2,
      minY: treeTy * 64 + 2,
      maxX: treeTx * 64 + 12,
      maxY: treeTy * 64 + 12,
    };
    // If adjacent tile is clear, corner is clear
    const colliders = engine.getCollidersInArea(cornerTileBox);
    const cornerHit = colliders.find((c) => aabbIntersects(cornerTileBox, c.aabb));
    assert.strictEqual(cornerHit, undefined, 'Trunk corner outside center box must not collide with trunk');

    // 3. Overhead canopy in adjacent tile MUST be walkable (player walks under tree branches)
    const adjacentCanopyX = treeTx + 1;
    const adjacentCanopyY = treeTy;
    // Ensure adjacent tile does not have its own trunk or water
    if (!wn.getTreeAt(adjacentCanopyX, adjacentCanopyY) && !wn.isWaterAt(adjacentCanopyX, adjacentCanopyY)) {
      const underCanopyBox: AABB = {
        minX: adjacentCanopyX * 64 + 20,
        minY: adjacentCanopyY * 64 + 20,
        maxX: adjacentCanopyX * 64 + 44,
        maxY: adjacentCanopyY * 64 + 44,
      };
      const canopyHit = engine.checkCollision(underCanopyBox);
      assert.strictEqual(canopyHit, null, 'Under overhead canopy must be walkable (no trunk)');
    }
  });
});

describe('CollisionEngine: 4. Village House Walls vs Walkable Doors & Interior', () => {
  it('blocks exterior walls and roofs while allowing entrance through front doors', () => {
    const wn = new WorldNoise({
      seed: 7777,
      villageRarity: 1.0, // Force village
      villageRadius: 24,
    });
    const engine = new CollisionEngine(wn, RENDER_TILE_SIZE);

    const sample = wn.getVillageAt(0, 0);
    assert.ok(sample !== null, 'Village sample must exist');

    const village = wn.getVillageAt(sample.plazaCenter.x, sample.plazaCenter.y);
    assert.ok(village !== null && village.isInside);

    const layout = wn.villageGen.getVillageLayout(
      village.cellId,
      village.centerCol,
      village.centerRow,
      village.plazaCenter.x,
      village.plazaCenter.y
    );

    assert.ok(layout.houses.length > 0, 'Village must have houses');
    const house = layout.houses[0];

    // 1. Exterior wall tile must be SOLID
    // Find wall tile
    let wallTx = -1;
    let wallTy = -1;
    for (let hx = 0; hx < house.width; hx++) {
      for (let hy = 0; hy < house.height; hy++) {
        const tx = house.x + hx;
        const ty = house.y + hy;
        const key = `${tx},${ty}`;
        const entry = layout.houseTileMap.get(key);
        if (entry?.part === 'wall') {
          wallTx = tx;
          wallTy = ty;
          break;
        }
      }
      if (wallTx !== -1) break;
    }

    assert.ok(wallTx !== -1, 'Must find a wall tile');
    const wallBox: AABB = {
      minX: wallTx * 64 + 20,
      minY: wallTy * 64 + 20,
      maxX: wallTx * 64 + 44,
      maxY: wallTy * 64 + 44,
    };
    const wallHit = engine.checkCollision(wallBox);
    assert.ok(wallHit !== null, 'House wall must be solid');
    assert.strictEqual(wallHit.type, 'house_wall');

    // 2. Door tile must be WALKABLE (player can enter the house!)
    const doorTx = house.door.x;
    const doorTy = house.door.y;
    const doorBox: AABB = {
      minX: doorTx * 64 + 20,
      minY: doorTy * 64 + 20,
      maxX: doorTx * 64 + 44,
      maxY: doorTy * 64 + 44,
    };
    const doorHit = engine.checkCollision(doorBox);
    assert.strictEqual(doorHit, null, 'Front entrance door must be walkable (no collision)');
  });
});

describe('CollisionEngine: 5. Village Props Obstacles', () => {
  it('blocks player from walking through the central plaza Town Well and street props', () => {
    const wn = new WorldNoise({
      seed: 9999,
      villageRarity: 1.0,
    });
    const engine = new CollisionEngine(wn, RENDER_TILE_SIZE);

    const sample = wn.getVillageAt(0, 0);
    assert.ok(sample !== null);
    const village = wn.getVillageAt(sample.plazaCenter.x, sample.plazaCenter.y);
    assert.ok(village !== null && village.isInside);

    // Plaza Center has the Town Well
    const wellX = village.plazaCenter.x;
    const wellY = village.plazaCenter.y;

    const wellPlayerBox: AABB = {
      minX: wellX * 64 + 20,
      minY: wellY * 64 + 20,
      maxX: wellX * 64 + 44,
      maxY: wellY * 64 + 44,
    };
    const hit = engine.checkCollision(wellPlayerBox);
    assert.ok(hit !== null, 'Town Well at plaza center must be solid');
    assert.strictEqual(hit.type, 'prop_well');
  });
});

describe('CollisionEngine: 6. Axis-Separated Wall Sliding', () => {
  it('slides smoothly along the Y axis when moving diagonally against a vertical wall', () => {
    const wn = new WorldNoise({
      seed: 1111,
      villageRarity: 1.0,
    });
    const engine = new CollisionEngine(wn, RENDER_TILE_SIZE);

    const sample = wn.getVillageAt(0, 0);
    assert.ok(sample !== null);
    const village = wn.getVillageAt(sample.plazaCenter.x, sample.plazaCenter.y);
    assert.ok(village !== null);
    const layout = wn.villageGen.getVillageLayout(
      village.cellId,
      village.centerCol,
      village.centerRow,
      village.plazaCenter.x,
      village.plazaCenter.y
    );
    const house = layout.houses[0];

    // Position player just to the left of the house's left wall
    // Left edge of house is house.x * 64
    const startX = house.x * 64 - 15; // 1 pixel away from collision with 14px half-width
    const startY = house.y * 64 + 32;

    // Move diagonally right-down: dx = 1, dy = 1
    const dt = 0.016;
    const speed = 200;

    const res = engine.resolveMovement(
      startX,
      startY,
      1,
      1,
      speed,
      dt,
      14,
      14
    );

    // X movement should be blocked by the wall
    assert.strictEqual(res.xBlocked, true, 'X should be blocked by the wall');
    assert.strictEqual(res.newX, startX, 'X position retained (no penetration)');

    // Y movement along the wall should advance freely
    assert.strictEqual(res.yBlocked, false, 'Y should slide freely along the wall');
    assert.ok(res.newY > startY, `Y position should increase: ${res.newY} > ${startY}`);
  });
});

describe('CollisionEngine: 7. Safe Spawn Anti-Stuck Solver', () => {
  it('relocates player out of solid obstacles to the nearest walkable tile', () => {
    const wn = new WorldNoise({
      seed: 8888,
      villageRarity: 1.0,
    });
    const engine = new CollisionEngine(wn, RENDER_TILE_SIZE);

    const sample = wn.getVillageAt(0, 0);
    assert.ok(sample !== null);
    const village = wn.getVillageAt(sample.plazaCenter.x, sample.plazaCenter.y);
    assert.ok(village !== null);

    // Initial position inside town well
    const wellX = village.plazaCenter.x * 64 + 32;
    const wellY = village.plazaCenter.y * 64 + 32;

    const safe = engine.findSafeSpawn(wellX, wellY, 14, 14);

    // Safe position must NOT be inside the well
    const safeBox: AABB = {
      minX: safe.x - 14,
      minY: safe.y - 14,
      maxX: safe.x + 14,
      maxY: safe.y + 14,
    };
    assert.strictEqual(
      engine.checkCollision(safeBox),
      null,
      'Resolved spawn position must have zero collisions'
    );
  });
});
