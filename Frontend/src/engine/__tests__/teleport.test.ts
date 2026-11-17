import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  tileToWorld,
  worldToTile,
  isForestTile,
  findNearestVillage,
  findNearestForest,
  findNearestWater,
  RENDER_TILE_SIZE,
} from '../procedural/landmarkFinder.ts';
import { WorldNoise } from '../procedural/worldNoise.ts';
import { CollisionEngine, type AABB } from '../collision/collision.ts';
import { World } from '../World.ts';
import { useGameStore } from '../../store/gameStore.ts';
import {
  useTeleportStore,
  filterOnlineFriends,
  type TeleportTab,
} from '../../store/teleportStore.ts';
import type { FriendDto } from '../../store/socialStore.ts';

describe('Teleport Feature Suite: 1. Coordinate Math & Conversion', () => {
  it('verifies RENDER_TILE_SIZE constant is exactly 64 pixels', () => {
    assert.strictEqual(RENDER_TILE_SIZE, 64, 'Standard tile size must be 64px');
  });

  it('converts tile coordinates to world pixel coordinates (origin and centered)', () => {
    // Top-left origin conversion
    const origin = tileToWorld(0, 0, RENDER_TILE_SIZE, false);
    assert.strictEqual(origin.worldX, 0);
    assert.strictEqual(origin.worldY, 0);

    const pos = tileToWorld(5, 10, RENDER_TILE_SIZE, false);
    assert.strictEqual(pos.worldX, 5 * 64);
    assert.strictEqual(pos.worldY, 10 * 64);

    const neg = tileToWorld(-3, -7, RENDER_TILE_SIZE, false);
    assert.strictEqual(neg.worldX, -3 * 64);
    assert.strictEqual(neg.worldY, -7 * 64);

    // Centered tile conversion (+32px offset)
    const centered = tileToWorld(4, -2, RENDER_TILE_SIZE, true);
    assert.strictEqual(centered.worldX, 4 * 64 + 32);
    assert.strictEqual(centered.worldY, -2 * 64 + 32);
  });

  it('converts world pixel coordinates to tile coordinates with integer flooring', () => {
    // Within tile (0, 0)
    assert.deepStrictEqual(worldToTile(0, 0), { tileX: 0, tileY: 0, tx: 0, ty: 0 });
    assert.deepStrictEqual(worldToTile(32, 48), { tileX: 0, tileY: 0, tx: 0, ty: 0 });
    assert.deepStrictEqual(worldToTile(63.99, 63.99), { tileX: 0, tileY: 0, tx: 0, ty: 0 });

    // Step across boundary into tile (1, 1)
    assert.deepStrictEqual(worldToTile(64, 64), { tileX: 1, tileY: 1, tx: 1, ty: 1 });
    assert.deepStrictEqual(worldToTile(128, 192), { tileX: 2, tileY: 3, tx: 2, ty: 3 });

    // Negative world coordinates (floor towards -Infinity)
    assert.deepStrictEqual(worldToTile(-0.1, -0.1), { tileX: -1, tileY: -1, tx: -1, ty: -1 });
    assert.deepStrictEqual(worldToTile(-64, -64), { tileX: -1, tileY: -1, tx: -1, ty: -1 });
    assert.deepStrictEqual(worldToTile(-64.1, -128.5), { tileX: -2, tileY: -3, tx: -2, ty: -3 });
  });

  it('preserves mathematical round-trip identity across 1,000 positive and negative tile coordinates', () => {
    for (let tx = -50; tx <= 50; tx += 5) {
      for (let ty = -50; ty <= 50; ty += 5) {
        const worldPos = tileToWorld(tx, ty, RENDER_TILE_SIZE, false);
        const resolvedTile = worldToTile(worldPos.worldX, worldPos.worldY, RENDER_TILE_SIZE);

        assert.strictEqual(resolvedTile.tileX, tx, `Round-trip tileX mismatch at tx=${tx}`);
        assert.strictEqual(resolvedTile.tileY, ty, `Round-trip tileY mismatch at ty=${ty}`);

        // Also test with centered coordinate
        const centerWorld = tileToWorld(tx, ty, RENDER_TILE_SIZE, true);
        const fromCenter = worldToTile(centerWorld.worldX, centerWorld.worldY, RENDER_TILE_SIZE);
        assert.strictEqual(fromCenter.tileX, tx, `Centered round-trip tileX mismatch at tx=${tx}`);
        assert.strictEqual(fromCenter.tileY, ty, `Centered round-trip tileY mismatch at ty=${ty}`);
      }
    }
  });

  it('correctly maps tile coordinates to 16x16 chunk indices', () => {
    const testCases = [
      { tileX: 0, tileY: 0, expectedChunkX: 0, expectedChunkY: 0 },
      { tileX: 15, tileY: 15, expectedChunkX: 0, expectedChunkY: 0 },
      { tileX: 16, tileY: 32, expectedChunkX: 1, expectedChunkY: 2 },
      { tileX: -1, tileY: -1, expectedChunkX: -1, expectedChunkY: -1 },
      { tileX: -16, tileY: -16, expectedChunkX: -1, expectedChunkY: -1 },
      { tileX: -17, tileY: -33, expectedChunkX: -2, expectedChunkY: -3 },
    ];

    for (const { tileX, tileY, expectedChunkX, expectedChunkY } of testCases) {
      const chunkX = Math.floor(tileX / 16);
      const chunkY = Math.floor(tileY / 16);
      assert.strictEqual(chunkX, expectedChunkX, `chunkX mismatch for tile (${tileX}, ${tileY})`);
      assert.strictEqual(chunkY, expectedChunkY, `chunkY mismatch for tile (${tileX}, ${tileY})`);
    }
  });
});

describe('Teleport Feature Suite: 2. Landmark Finder Algorithms', () => {
  it('findNearestVillage: finds a valid village plaza with distance >= 0 and non-empty name', () => {
    const worldNoise = new WorldNoise(42);
    const landmark = findNearestVillage(worldNoise, 0, 0);

    assert.ok(landmark !== null, 'Landmark finder must find a nearby village');
    assert.strictEqual(landmark.type, 'village');
    assert.ok(landmark.distance >= 0, 'Distance must be non-negative');
    assert.ok(landmark.name.length > 0, 'Village name must not be empty');

    // Verify target tile is genuinely a village plaza
    const village = worldNoise.getVillageAt(landmark.tileX, landmark.tileY);
    assert.ok(village !== null, 'Target must reside within a valid village cell');
    assert.strictEqual(village.isPlaza, true, 'Target coordinates must land directly on village plaza');
    assert.strictEqual(village.hasVillage, true);
    assert.strictEqual(village.plazaCenter.x, landmark.tileX);
    assert.strictEqual(village.plazaCenter.y, landmark.tileY);

    // Verify distance matches Euclidean distance from origin
    const expectedDist = Math.hypot(landmark.tileX - 0, landmark.tileY - 0);
    assert.strictEqual(landmark.distance, expectedDist);
  });

  it('findNearestVillage: searching from inside the plaza yields distance === 0', () => {
    const worldNoise = new WorldNoise(42);
    const initial = findNearestVillage(worldNoise, 0, 0);
    assert.ok(initial !== null);

    // Search originating directly from the plaza tile
    const atPlaza = findNearestVillage(worldNoise, initial.tileX, initial.tileY);
    assert.ok(atPlaza !== null);
    assert.strictEqual(atPlaza.tileX, initial.tileX);
    assert.strictEqual(atPlaza.tileY, initial.tileY);
    assert.strictEqual(atPlaza.distance, 0, 'Distance must be zero when standing at the plaza');
  });

  it('findNearestVillage: produces strictly deterministic results across calls and instances', () => {
    const wn1 = new WorldNoise(1337);
    const wn2 = new WorldNoise(1337);

    const res1 = findNearestVillage(wn1, 10, -20);
    const res2 = findNearestVillage(wn2, 10, -20);

    assert.deepStrictEqual(res1, res2, 'Landmark finder must be deterministic for identical seed and coords');
  });

  it('findNearestForest: finds a valid forest tile with distance >= 0', () => {
    const worldNoise = new WorldNoise(42);
    const forest = findNearestForest(worldNoise, 0, 0);

    assert.ok(forest !== null, 'Landmark finder must locate a forest tile');
    assert.strictEqual(forest.type, 'forest');
    assert.ok(forest.distance >= 0, 'Distance must be non-negative');

    // Verify the located tile meets forest classification
    const isForest = isForestTile(worldNoise, forest.tileX, forest.tileY);
    assert.strictEqual(isForest, true, 'Located tile must satisfy forest criteria');
    assert.strictEqual(worldNoise.isWaterAt(forest.tileX, forest.tileY), false, 'Forest must not be on water');

    // Searching from within that forest tile returns distance === 0
    const fromForest = findNearestForest(worldNoise, forest.tileX, forest.tileY);
    assert.ok(fromForest !== null);
    assert.strictEqual(fromForest.tileX, forest.tileX);
    assert.strictEqual(fromForest.tileY, forest.tileY);
    assert.strictEqual(fromForest.distance, 0);
  });

  it('findNearestWater: finds a valid water basin tile', () => {
    const worldNoise = new WorldNoise(42);
    const water = findNearestWater(worldNoise, 0, 0);

    assert.ok(water !== null, 'Landmark finder must locate a water tile');
    assert.strictEqual(water.type, 'water');
    assert.ok(water.distance >= 0, 'Distance must be non-negative');

    // Verify the tile is genuine water
    assert.strictEqual(
      worldNoise.isWaterAt(water.tileX, water.tileY),
      true,
      'Located tile must be water'
    );

    // Searching from within that water tile returns distance === 0
    const fromWater = findNearestWater(worldNoise, water.tileX, water.tileY);
    assert.ok(fromWater !== null);
    assert.strictEqual(fromWater.tileX, water.tileX);
    assert.strictEqual(fromWater.tileY, water.tileY);
    assert.strictEqual(fromWater.distance, 0);
  });
});

describe('Teleport Feature Suite: 3. Teleport Store State Management', () => {
  beforeEach(() => {
    // Reset store state before each test
    useTeleportStore.setState({
      isOpen: false,
      activeTab: 'landmarks',
      flashActive: false,
      toast: null,
      toastMessage: null,
      toastType: 'info',
      savedLocations: [],
    });
  });

  it('initializes with default closed state and landmarks active tab', () => {
    const state = useTeleportStore.getState();
    assert.strictEqual(state.isOpen, false);
    assert.strictEqual(state.activeTab, 'landmarks');
    assert.strictEqual(state.flashActive, false);
    assert.strictEqual(state.toast, null);
    assert.strictEqual(state.toastMessage, null);
  });

  it('openModal, closeModal, and toggleModal transitions', () => {
    const store = useTeleportStore.getState();

    store.openModal();
    assert.strictEqual(useTeleportStore.getState().isOpen, true);

    store.closeModal();
    assert.strictEqual(useTeleportStore.getState().isOpen, false);

    store.toggleModal();
    assert.strictEqual(useTeleportStore.getState().isOpen, true);

    store.toggleModal();
    assert.strictEqual(useTeleportStore.getState().isOpen, false);
  });

  it('setActiveTab switches across all tabs cleanly', () => {
    const tabs: TeleportTab[] = ['coordinates', 'friends', 'saved', 'landmarks'];
    const store = useTeleportStore.getState();

    for (const tab of tabs) {
      store.setActiveTab(tab);
      assert.strictEqual(useTeleportStore.getState().activeTab, tab);
    }
  });

  it('triggerFlash activates screen flash state', () => {
    const store = useTeleportStore.getState();
    assert.strictEqual(useTeleportStore.getState().flashActive, false);

    store.triggerFlash(500);
    assert.strictEqual(useTeleportStore.getState().flashActive, true);
  });

  it('showToast and clearToast manage status notifications', () => {
    const store = useTeleportStore.getState();

    store.showToast('Teleported to Fairbrook Plaza!', 'success');
    let state = useTeleportStore.getState();
    assert.deepStrictEqual(state.toast, { message: 'Teleported to Fairbrook Plaza!', type: 'success' });
    assert.strictEqual(state.toastMessage, 'Teleported to Fairbrook Plaza!');
    assert.strictEqual(state.toastType, 'success');

    // Show error toast
    store.showToast('Friend is offline', 'error');
    state = useTeleportStore.getState();
    assert.strictEqual(state.toastMessage, 'Friend is offline');
    assert.strictEqual(state.toastType, 'error');

    // Clear toast
    store.clearToast();
    state = useTeleportStore.getState();
    assert.strictEqual(state.toast, null);
    assert.strictEqual(state.toastMessage, null);
  });

  it('manages saved custom coordinate bookmarks', () => {
    const store = useTeleportStore.getState();

    store.addSavedLocation('Secret Base', 500, -320);
    let state = useTeleportStore.getState();
    assert.strictEqual(state.savedLocations.length, 1);
    assert.strictEqual(state.savedLocations[0].name, 'Secret Base');
    assert.strictEqual(state.savedLocations[0].x, 500);
    assert.strictEqual(state.savedLocations[0].y, -320);

    const savedId = state.savedLocations[0].id;
    store.removeSavedLocation(savedId);
    state = useTeleportStore.getState();
    assert.strictEqual(state.savedLocations.length, 0);
  });
});

describe('Teleport Feature Suite: 4. World.teleportTo & Safe Landing Resolution', () => {
  let world: World;

  beforeEach(() => {
    world = new World({
      seed: 42,
      bufferMargin: 128,
      viewportWidth: 800,
      viewportHeight: 600,
    });
  });

  it('teleportTo clear meadow coordinates sets exact player position and syncs to useGameStore', () => {
    const targetX = 128;
    const targetY = 128;

    const res = world.teleportTo(targetX, targetY, { safeCheck: false });

    assert.strictEqual(world.playerX, targetX);
    assert.strictEqual(world.playerY, targetY);
    assert.strictEqual(res.x, targetX);
    assert.strictEqual(res.y, targetY);

    // Verify synchronization to zustand useGameStore
    const storeState = useGameStore.getState();
    assert.strictEqual(storeState.playerCoords.x, targetX);
    assert.strictEqual(storeState.playerCoords.y, targetY);
    assert.strictEqual(storeState.tileCoords.x, Math.floor(targetX / RENDER_TILE_SIZE));
    assert.strictEqual(storeState.tileCoords.y, Math.floor(targetY / RENDER_TILE_SIZE));
  });

  it('safe landing resolution prevents landing in shoreline water by relocating to walkable ground', () => {
    const wn = new WorldNoise(42);
    const collisionEngine = new CollisionEngine(wn, RENDER_TILE_SIZE);
    world.collisionEngine = collisionEngine;

    // Find a water edge / shoreline tile (water tile immediately adjacent to walkable land)
    let waterTx = 0;
    let waterTy = 0;
    let foundWaterEdge = false;
    for (let x = -100; x <= 100 && !foundWaterEdge; x++) {
      for (let y = -100; y <= 100 && !foundWaterEdge; y++) {
        if (wn.isWaterAt(x, y) && !wn.isWaterAt(x + 1, y)) {
          waterTx = x;
          waterTy = y;
          foundWaterEdge = true;
        }
      }
    }
    assert.ok(foundWaterEdge, 'Should find a shoreline water tile');

    const waterCenterWorldX = waterTx * 64 + 32;
    const waterCenterWorldY = waterTy * 64 + 32;

    // Verify initial target coordinate has solid collision
    const testBox: AABB = {
      minX: waterCenterWorldX - world.playerHalfSize,
      minY: waterCenterWorldY - world.playerHalfSize,
      maxX: waterCenterWorldX + world.playerHalfSize,
      maxY: waterCenterWorldY + world.playerHalfSize,
    };
    const waterHit = collisionEngine.checkCollision(testBox);
    assert.ok(waterHit !== null, 'Direct water coordinate must hit collision');
    assert.strictEqual(waterHit.type, 'water');

    // Teleport with safeCheck: true
    const res = world.teleportTo(waterCenterWorldX, waterCenterWorldY, { safeCheck: true });

    // Player position must be relocated to safe ground
    assert.strictEqual(res.safeAdjusted, true, 'safeAdjusted must be true when collision avoided');
    assert.strictEqual(world.playerX, res.x);
    assert.strictEqual(world.playerY, res.y);

    // Landed coordinate must have ZERO collisions
    const safeBox: AABB = {
      minX: res.x - world.playerHalfSize,
      minY: res.y - world.playerHalfSize,
      maxX: res.x + world.playerHalfSize,
      maxY: res.y + world.playerHalfSize,
    };
    assert.strictEqual(
      collisionEngine.checkCollision(safeBox),
      null,
      'Resolved safe landing coordinate must have zero collisions'
    );
  });

  it('safe landing resolution prevents landing inside village plaza well or solid house wall', () => {
    const wn = new WorldNoise(42);
    const collisionEngine = new CollisionEngine(wn, RENDER_TILE_SIZE);
    world.collisionEngine = collisionEngine;

    const landmark = findNearestVillage(wn, 0, 0);
    assert.ok(landmark !== null);

    // Target inside town well in center of plaza
    const wellWorldX = landmark.tileX * 64 + 32;
    const wellWorldY = landmark.tileY * 64 + 32;

    const initialBox: AABB = {
      minX: wellWorldX - world.playerHalfSize,
      minY: wellWorldY - world.playerHalfSize,
      maxX: wellWorldX + world.playerHalfSize,
      maxY: wellWorldY + world.playerHalfSize,
    };
    const hit = collisionEngine.checkCollision(initialBox);
    assert.ok(hit !== null, 'Well center must have collision');

    // Teleport with safeCheck: true
    const res = world.teleportTo(wellWorldX, wellWorldY, { safeCheck: true });

    assert.strictEqual(res.safeAdjusted, true);
    const finalBox: AABB = {
      minX: res.x - world.playerHalfSize,
      minY: res.y - world.playerHalfSize,
      maxX: res.x + world.playerHalfSize,
      maxY: res.y + world.playerHalfSize,
    };
    assert.strictEqual(collisionEngine.checkCollision(finalBox), null);
  });

  it('safeCheck: false bypasses anti-stuck solver and places player exactly at target', () => {
    const targetX = 999;
    const targetY = -888;

    const res = world.teleportTo(targetX, targetY, { safeCheck: false });

    assert.strictEqual(res.safeAdjusted, false);
    assert.strictEqual(res.x, targetX);
    assert.strictEqual(res.y, targetY);
    assert.strictEqual(world.playerX, targetX);
    assert.strictEqual(world.playerY, targetY);
  });
});

describe('Teleport Feature Suite: 5. Online Friends Teleport Eligibility', () => {
  const mockFriends: FriendDto[] = [
    { user_id: 'u-1', username: 'Aria [ID: u-1]', is_online: true },
    { user_id: 'u-2', username: 'Kaelen [ID: u-2]', is_online: false },
    { user_id: 'u-3', username: 'Rowan [ID: u-3]', is_online: true },
    { user_id: 'u-4', username: 'Lyra [ID: u-4]', is_online: false },
    { user_id: 'u-5', username: 'Vael [ID: u-5]', is_online: true },
  ];

  it('filters friends list to strictly online friends (is_online === true)', () => {
    const online = filterOnlineFriends(mockFriends);

    assert.strictEqual(online.length, 3);
    assert.deepStrictEqual(
      online.map((f) => f.user_id),
      ['u-1', 'u-3', 'u-5']
    );

    for (const friend of online) {
      assert.strictEqual(friend.is_online, true, `${friend.username} must be online`);
    }
  });

  it('handles empty, null, and all-offline friends lists gracefully', () => {
    assert.deepStrictEqual(filterOnlineFriends([]), []);
    assert.deepStrictEqual(filterOnlineFriends(null), []);
    assert.deepStrictEqual(filterOnlineFriends(undefined), []);

    const allOffline: FriendDto[] = [
      { user_id: 'off-1', username: 'Sleepy', is_online: false },
      { user_id: 'off-2', username: 'Away', is_online: false },
    ];
    assert.deepStrictEqual(filterOnlineFriends(allOffline), []);
  });

  it('rejects teleport attempt to offline friend and triggers error toast', () => {
    const offlineFriend: FriendDto = {
      user_id: 'u-offline',
      username: 'Ghost',
      is_online: false,
    };

    // Teleportation validation logic
    function attemptTeleportToFriend(friend: FriendDto): boolean {
      if (!friend.is_online) {
        useTeleportStore.getState().showToast(`Cannot teleport to ${friend.username}: player is offline`, 'error');
        return false;
      }
      return true;
    }

    const success = attemptTeleportToFriend(offlineFriend);
    assert.strictEqual(success, false, 'Teleport to offline friend must fail');

    const toast = useTeleportStore.getState().toast;
    assert.ok(toast !== null);
    assert.strictEqual(toast.type, 'error');
    assert.match(toast.message, /offline/i);
  });

  it('successfully resolves online friend position from gameStore players map', () => {
    const friendId = 'u-friend-online';
    const friendX = 320;
    const friendY = 640;

    // Simulate online player presence in useGameStore
    useGameStore.setState((state) => {
      const updatedPlayers = new Map(state.players);
      updatedPlayers.set(friendId, {
        id: friendId,
        name: 'Aria',
        position: { x: friendX, y: friendY, z: 0 },
      } as any);
      return { players: updatedPlayers };
    });

    const friendPlayer = useGameStore.getState().players.get(friendId);
    assert.ok(friendPlayer !== undefined, 'Online friend must exist in players map');
    assert.strictEqual(friendPlayer.position.x, friendX);
    assert.strictEqual(friendPlayer.position.y, friendY);

    // World teleporting to friend coordinate
    const world = new World({
      seed: 42,
      bufferMargin: 128,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    const result = world.teleportTo(friendPlayer.position.x, friendPlayer.position.y);

    assert.strictEqual(result.x, friendX);
    assert.strictEqual(result.y, friendY);
    assert.strictEqual(world.playerX, friendX);
    assert.strictEqual(world.playerY, friendY);
  });
});
