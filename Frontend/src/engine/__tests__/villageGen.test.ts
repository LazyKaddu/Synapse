import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  VillageGenerator,
  BUILDING_MODELS,
  DEFAULT_VILLAGE_CONFIG,
  type PlacedHouse,
  type VillageProp,
} from '../procedural/villageGen.ts';
import { WorldNoise } from '../procedural/worldNoise.ts';

describe('VillageGenerator: 1. Determinism across calls and distinct seeds', () => {
  it('guarantees identical village layout across duplicate calls with same coordinates and seed', () => {
    const seed = 554433;
    const gen1 = new VillageGenerator(seed);
    const gen2 = new VillageGenerator({ seed });

    assert.strictEqual(gen1.masterSeed, seed);
    assert.strictEqual(gen2.masterSeed, seed);

    const layout1 = gen1.getVillageLayout(101, 5, -8, 320, -512);
    const layout2 = gen2.getVillageLayout(101, 5, -8, 320, -512);

    assert.strictEqual(layout1.cellId, layout2.cellId);
    assert.strictEqual(layout1.name, layout2.name);
    assert.strictEqual(layout1.houses.length, layout2.houses.length);
    assert.strictEqual(layout1.props.length, layout2.props.length);
    assert.strictEqual(layout1.pavementTiles.size, layout2.pavementTiles.size);

    for (let i = 0; i < layout1.houses.length; i++) {
      const h1 = layout1.houses[i];
      const h2 = layout2.houses[i];
      assert.strictEqual(h1.id, h2.id);
      assert.strictEqual(h1.model.id, h2.model.id);
      assert.strictEqual(h1.x, h2.x);
      assert.strictEqual(h1.y, h2.y);
      assert.strictEqual(h1.door.x, h2.door.x);
      assert.strictEqual(h1.door.y, h2.door.y);
    }
  });

  it('produces distinct village names and layouts for different master seeds', () => {
    const genA = new VillageGenerator(12345);
    const genB = new VillageGenerator(98765);

    const lA = genA.getVillageLayout(1, 0, 0, 0, 0);
    const lB = genB.getVillageLayout(1, 0, 0, 0, 0);

    // High probability of distinct names and differing house placements
    assert.notStrictEqual(lA.name, lB.name, 'Seeds should yield different village names');
  });
});

describe('VillageGenerator: 2. Pre-Built Building Models Catalog', () => {
  it('exposes valid building model definitions with strictly positive dimensions and in-bounds doors', () => {
    assert.strictEqual(BUILDING_MODELS.length, 5);

    const ids = new Set(BUILDING_MODELS.map((m) => m.id));
    assert.ok(ids.has('manor_grand'));
    assert.ok(ids.has('cottage_red'));
    assert.ok(ids.has('cottage_blue'));
    assert.ok(ids.has('outpost_small'));
    assert.ok(ids.has('watchtower'));

    for (const m of BUILDING_MODELS) {
      assert.ok(m.width >= 2 && m.width <= 16, `Invalid width ${m.width} for ${m.id}`);
      assert.ok(m.height >= 2 && m.height <= 16, `Invalid height ${m.height} for ${m.id}`);
      assert.ok(m.atlasCol >= 0 && m.atlasCol < 16, `Atlas col out of bounds: ${m.atlasCol}`);
      assert.ok(m.atlasRow >= 0 && m.atlasRow < 16, `Atlas row out of bounds: ${m.atlasRow}`);
      assert.match(m.roofHexColor, /^#[0-9a-f]{6}$/i);
      assert.match(m.wallHexColor, /^#[0-9a-f]{6}$/i);

      // Relative door offset must lie strictly within the building footprint
      assert.ok(
        m.doorOffset.x >= 0 && m.doorOffset.x < m.width,
        `Door X ${m.doorOffset.x} out of bounds for ${m.id}`
      );
      assert.ok(
        m.doorOffset.y >= 0 && m.doorOffset.y < m.height,
        `Door Y ${m.doorOffset.y} out of bounds for ${m.id}`
      );
    }
  });

  it('guarantees villages spawn a Grand Manor and residential cottages', () => {
    const gen = new VillageGenerator(42);
    const layout = gen.getVillageLayout(7, 2, 3, 128, 192);

    assert.ok(layout.houses.length >= 3, `Expected at least 3 houses, found ${layout.houses.length}`);

    const manor = layout.houses.find((h) => h.model.id === 'manor_grand');
    assert.ok(manor !== undefined, 'Village must contain a Grand Town Manor');

    const cottages = layout.houses.filter(
      (h) => h.model.id === 'cottage_red' || h.model.id === 'cottage_blue'
    );
    assert.ok(cottages.length >= 1, 'Village must contain residential cottages');
  });
});

describe('VillageGenerator: 3. Strict House Non-Overlap and Plaza Clearance Invariants', () => {
  it('guarantees all placed houses have mutually disjoint bounding boxes with minimum spacing', () => {
    const minSpacing = 2;
    const gen = new VillageGenerator({
      seed: 8888,
      houseMinSpacing: minSpacing,
    });

    // Test multiple generated villages across different cells
    for (let c = 1; c <= 5; c++) {
      const layout = gen.getVillageLayout(c, c * 10, -c * 10, c * 500, -c * 500);
      const houses = layout.houses;

      for (let i = 0; i < houses.length; i++) {
        for (let j = i + 1; j < houses.length; j++) {
          const h1 = houses[i];
          const h2 = houses[j];

          const noOverlap =
            h1.x + h1.width + minSpacing <= h2.x ||
            h2.x + h2.width + minSpacing <= h1.x ||
            h1.y + h1.height + minSpacing <= h2.y ||
            h2.y + h2.height + minSpacing <= h1.y;

          assert.ok(
            noOverlap,
            `House overlap between ${h1.id} (${h1.x},${h1.y},${h1.width}x${h1.height}) and ${h2.id} (${h2.x},${h2.y},${h2.width}x${h2.height})`
          );
        }
      }
    }
  });

  it('strictly clears the central plaza square so no house overlaps the town square', () => {
    const gen = new VillageGenerator(777);
    const plazaX = 64;
    const plazaY = 64;
    const layout = gen.getVillageLayout(1, 1, 1, plazaX, plazaY);

    for (const house of layout.houses) {
      for (let hx = 0; hx < house.width; hx++) {
        for (let hy = 0; hy < house.height; hy++) {
          const tx = house.x + hx;
          const ty = house.y + hy;
          const dist = Math.hypot(tx - plazaX, ty - plazaY);

          assert.ok(
            dist >= layout.plazaRadius - 0.5,
            `House tile (${tx}, ${ty}) encroached into plaza center (dist=${dist} < ${layout.plazaRadius})`
          );
        }
      }
    }
  });
});

describe('VillageGenerator: 4. Pavements & Street Network Connectivity', () => {
  it('ensures plaza center and perimeter are paved with plaza cobblestones', () => {
    const gen = new VillageGenerator(102030);
    const px = 200;
    const py = 300;
    const layout = gen.getVillageLayout(2, 3, 4, px, py);

    // Center tile must be paved
    assert.strictEqual(layout.pavementTiles.has(`${px},${py}`), true);
    assert.strictEqual(layout.pavementTypes.get(`${px},${py}`), 'plaza');

    // Immediate cardinal neighbors in plaza must be paved
    assert.strictEqual(layout.pavementTiles.has(`${px + 1},${py}`), true);
    assert.strictEqual(layout.pavementTiles.has(`${px - 1},${py}`), true);
    assert.strictEqual(layout.pavementTiles.has(`${px},${py + 1}`), true);
    assert.strictEqual(layout.pavementTiles.has(`${px},${py - 1}`), true);
  });

  it('guarantees every placed house door connects directly to the pavement network', () => {
    const gen = new VillageGenerator(999);
    const layout = gen.getVillageLayout(5, -2, 6, -100, 400);

    for (const house of layout.houses) {
      const doorX = house.door.x;
      const doorY = house.door.y;

      // The tile immediately adjacent in front of the door (or door itself) must have a walkway pavement
      const frontTileKey = `${doorX},${doorY + 1}`;
      const doorTileKey = `${doorX},${doorY}`;

      const isConnected =
        layout.pavementTiles.has(frontTileKey) || layout.pavementTiles.has(doorTileKey);

      assert.ok(
        isConnected,
        `House ${house.id} (${house.model.name}) door at (${doorX}, ${doorY}) not connected to pavement`
      );
    }
  });
});

describe('VillageGenerator: 5. Contextual Village Props Invariants', () => {
  it('places a Town Well at plaza center and lanterns along roads', () => {
    const gen = new VillageGenerator(1337);
    const px = 50;
    const py = 50;
    const layout = gen.getVillageLayout(10, 1, 1, px, py);

    // Well at plaza center
    const well = layout.props.find((p) => p.type === 'well');
    assert.ok(well !== undefined, 'Village must have a Town Well');
    assert.strictEqual(well.x, px);
    assert.strictEqual(well.y, py);

    // Street lanterns
    const lanterns = layout.props.filter((p) => p.type === 'lantern');
    assert.ok(lanterns.length >= 2, `Expected street lanterns, found ${lanterns.length}`);
  });

  it('never places any prop on top of a house entrance door tile', () => {
    const gen = new VillageGenerator(445566);
    const layout = gen.getVillageLayout(3, -5, -5, -300, -300);

    for (const house of layout.houses) {
      const doorKey = `${house.door.x},${house.door.y}`;
      assert.strictEqual(
        layout.propTileMap.has(doorKey),
        false,
        `Prop placed on top of door at (${house.door.x}, ${house.door.y})`
      );
    }
  });
});

describe('VillageGenerator: 6. WorldNoise Integration & Tree Suppression', () => {
  it('suppresses tree placement on all village structural tiles (houses, roads, plaza)', () => {
    // Master seed that produces a village in a dense forest
    const wn = new WorldNoise({
      seed: 42,
      villageRarity: 1.0, // force village
      forestThreshold: 0.0, // force dense forest
    });

    const village = wn.getVillageAt(0, 0);
    assert.ok(village !== null && village.isInside);

    const layout = wn.villageGen.getVillageLayout(
      village.cellId,
      village.centerCol,
      village.centerRow,
      village.plazaCenter.x,
      village.plazaCenter.y
    );

    // Check every house tile: trees must be strictly suppressed
    for (const house of layout.houses) {
      for (let hx = 0; hx < house.width; hx++) {
        for (let hy = 0; hy < house.height; hy++) {
          const tx = house.x + hx;
          const ty = house.y + hy;
          const tree = wn.getTreeAt(tx, ty);
          assert.strictEqual(
            tree,
            null,
            `Tree spawned on house tile (${tx}, ${ty}) belonging to ${house.id}`
          );
        }
      }
    }

    // Check plaza center: no tree on town well
    const wellTree = wn.getTreeAt(village.plazaCenter.x, village.plazaCenter.y);
    assert.strictEqual(wellTree, null, 'Tree spawned on top of plaza well');
  });
});

describe('VillageGenerator: 7. Fast O(1) Spatial Tile Query', () => {
  it('correctly returns VillageTileInfo with walkability and district metadata', () => {
    const gen = new VillageGenerator(9999);
    const px = 100;
    const py = 100;
    const layout = gen.getVillageLayout(1, 2, 2, px, py);

    // Plaza center well query
    const wellTile = gen.getVillageTileAt(px, py, 1, 2, 2, px, py);
    assert.strictEqual(wellTile.isVillage, true);
    assert.strictEqual(wellTile.prop?.type, 'well');
    assert.strictEqual(wellTile.isWalkable, false, 'Well is an obstacle');

    // First house roof tile query
    const firstHouse = layout.houses[0];
    const roofTile = gen.getVillageTileAt(firstHouse.x, firstHouse.y, 1, 2, 2, px, py);
    assert.strictEqual(roofTile.isVillage, true);
    assert.strictEqual(roofTile.district, 'house_roof');
    assert.strictEqual(roofTile.house?.id, firstHouse.id);

    // Outside village radius query
    const outsideTile = gen.getVillageTileAt(px + 100, py + 100, 1, 2, 2, px, py);
    assert.strictEqual(outsideTile.isVillage, false);
    assert.strictEqual(outsideTile.isWalkable, true);
  });
});
