import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { voronoi2D } from '../procedural/noise.ts';
import {
  WorldNoise,
  WORLD_BIOMES,
  NOISE_PALETTE,
  getNoiseVisualTile,
  type WorldBiome,
} from '../procedural/worldNoise.ts';

describe('1. Determinism across positive and negative coordinates and different seeds', () => {
  it('guarantees voronoi2D is strictly deterministic across identical coordinates and seeds', () => {
    const coords = [
      [0, 0],
      [12.34, 56.78],
      [-45.67, 89.01],
      [105.2, -304.8],
      [-512.9, -1024.3],
      [10000.5, -20000.5],
    ];

    for (const [x, y] of coords) {
      const r1 = voronoi2D(x, y, 42);
      const r2 = voronoi2D(x, y, 42);
      assert.strictEqual(r1.d1, r2.d1, `voronoi2D d1 must match at (${x}, ${y})`);
      assert.strictEqual(r1.d2, r2.d2, `voronoi2D d2 must match at (${x}, ${y})`);
      assert.strictEqual(r1.cellId, r2.cellId, `voronoi2D cellId must match at (${x}, ${y})`);
      assert.strictEqual(r1.centerCol, r2.centerCol, `voronoi2D centerCol must match at (${x}, ${y})`);
      assert.strictEqual(r1.centerRow, r2.centerRow, `voronoi2D centerRow must match at (${x}, ${y})`);
    }
  });

  it('guarantees WorldNoise channel samplers are strictly deterministic across instances with same seed', () => {
    const seed = 1337;
    const wn1 = new WorldNoise(seed);
    const wn2 = new WorldNoise({ seed });

    assert.strictEqual(wn1.seed, seed);
    assert.strictEqual(wn2.seed, seed);
    assert.deepStrictEqual(wn1.seeds, wn2.seeds, 'Sub-seeds must be identical');

    const testPoints = [
      [0, 0],
      [15, 30],
      [-128, 256],
      [512, -1024],
      [-9999, -8888],
    ];

    for (const [x, y] of testPoints) {
      assert.strictEqual(
        wn1.sampleContinentalness(x, y),
        wn2.sampleContinentalness(x, y),
        `sampleContinentalness mismatch at (${x}, ${y})`
      );
      assert.strictEqual(
        wn1.sampleTemperature(x, y),
        wn2.sampleTemperature(x, y),
        `sampleTemperature mismatch at (${x}, ${y})`
      );
      assert.strictEqual(
        wn1.sampleHumidity(x, y),
        wn2.sampleHumidity(x, y),
        `sampleHumidity mismatch at (${x}, ${y})`
      );
      assert.strictEqual(
        wn1.sampleErosion(x, y),
        wn2.sampleErosion(x, y),
        `sampleErosion mismatch at (${x}, ${y})`
      );
      assert.strictEqual(
        wn1.sampleForestDensity(x, y),
        wn2.sampleForestDensity(x, y),
        `sampleForestDensity mismatch at (${x}, ${y})`
      );

      const v1 = wn1.sampleVillageVoronoi(x, y);
      const v2 = wn2.sampleVillageVoronoi(x, y);
      assert.deepStrictEqual(v1, v2, `sampleVillageVoronoi mismatch at (${x}, ${y})`);

      assert.strictEqual(wn1.isWaterAt(x, y), wn2.isWaterAt(x, y));
      assert.strictEqual(wn1.getBiomeAt(x, y), wn2.getBiomeAt(x, y));
      assert.deepStrictEqual(wn1.getTreeAt(x, y), wn2.getTreeAt(x, y));
      assert.deepStrictEqual(wn1.getVillageAt(x, y), wn2.getVillageAt(x, y));
    }
  });

  it('produces distinct noise distributions for different master seeds', () => {
    const wnA = new WorldNoise(1001);
    const wnB = new WorldNoise(2002);

    let differences = 0;
    const sampleCount = 50;

    for (let i = 0; i < sampleCount; i++) {
      const x = i * 37 - 200;
      const y = i * 53 - 300;

      const cA = wnA.sampleContinentalness(x, y);
      const cB = wnB.sampleContinentalness(x, y);
      if (Math.abs(cA - cB) > 1e-4) {
        differences++;
      }
    }

    assert.ok(
      differences > sampleCount * 0.8,
      `Expected high variance across different seeds, got ${differences}/${sampleCount} differences`
    );
  });

  it('operates smoothly without NaN or infinities across positive, negative, and zero crossings', () => {
    const wn = new WorldNoise(999);

    for (let x = -50; x <= 50; x += 5) {
      for (let y = -50; y <= 50; y += 5) {
        const c = wn.sampleContinentalness(x, y);
        const t = wn.sampleTemperature(x, y);
        const h = wn.sampleHumidity(x, y);
        const e = wn.sampleErosion(x, y);
        const f = wn.sampleForestDensity(x, y);
        const v = wn.sampleVillageVoronoi(x, y);

        assert.ok(Number.isFinite(c), `Continentalness not finite at (${x}, ${y})`);
        assert.ok(Number.isFinite(t), `Temperature not finite at (${x}, ${y})`);
        assert.ok(Number.isFinite(h), `Humidity not finite at (${x}, ${y})`);
        assert.ok(Number.isFinite(e), `Erosion not finite at (${x}, ${y})`);
        assert.ok(Number.isFinite(f), `Forest density not finite at (${x}, ${y})`);
        assert.ok(Number.isFinite(v.d1), `Voronoi d1 not finite at (${x}, ${y})`);
        assert.ok(Number.isFinite(v.d2), `Voronoi d2 not finite at (${x}, ${y})`);
      }
    }
  });
});

describe('2. Value range bounds and mathematical invariants', () => {
  it('strictly bounds all continuous noise channel outputs in [0, 1]', () => {
    const wn = new WorldNoise(12345);

    for (let x = -200; x <= 200; x += 17) {
      for (let y = -200; y <= 200; y += 19) {
        const c = wn.sampleContinentalness(x, y);
        const t = wn.sampleTemperature(x, y);
        const h = wn.sampleHumidity(x, y);
        const e = wn.sampleErosion(x, y);
        const f = wn.sampleForestDensity(x, y);

        assert.ok(c >= 0 && c <= 1, `Continentalness out of bounds [0, 1]: ${c} at (${x}, ${y})`);
        assert.ok(t >= 0 && t <= 1, `Temperature out of bounds [0, 1]: ${t} at (${x}, ${y})`);
        assert.ok(h >= 0 && h <= 1, `Humidity out of bounds [0, 1]: ${h} at (${x}, ${y})`);
        assert.ok(e >= 0 && e <= 1, `Erosion out of bounds [0, 1]: ${e} at (${x}, ${y})`);
        assert.ok(f >= 0 && f <= 1, `Forest density out of bounds [0, 1]: ${f} at (${x}, ${y})`);
      }
    }
  });

  it('guarantees Voronoi invariants: d1 >= 0, d2 >= 0, and d1 <= d2 unconditionally', () => {
    const seeds = [0, 42, 999999, -500];

    for (const seed of seeds) {
      for (let x = -20.5; x <= 20.5; x += 2.1) {
        for (let y = -20.5; y <= 20.5; y += 2.1) {
          const res = voronoi2D(x, y, seed);

          assert.ok(res.d1 >= 0, `d1 must be non-negative: ${res.d1}`);
          assert.ok(res.d2 >= 0, `d2 must be non-negative: ${res.d2}`);
          assert.ok(res.d1 <= res.d2, `d1 (${res.d1}) must be <= d2 (${res.d2}) at (${x}, ${y})`);
          assert.ok(Number.isInteger(res.centerCol), 'centerCol must be an integer');
          assert.ok(Number.isInteger(res.centerRow), 'centerRow must be an integer');
          assert.ok(res.cellId >= 0 && res.cellId <= 0xffffffff, 'cellId must be unsigned 32-bit int');
        }
      }
    }
  });
});

describe('3. Forest clustering and tree placement invariants', () => {
  it('guarantees tree placement invariants: valid variant, density >= threshold, not on water', () => {
    const wn = new WorldNoise(777);
    let treeCount = 0;

    for (let tx = -50; tx <= 50; tx++) {
      for (let ty = -50; ty <= 50; ty++) {
        const tree = wn.getTreeAt(tx, ty);
        if (tree !== null) {
          treeCount++;
          assert.strictEqual(tree.x, tx, 'Tree x must match tile tx');
          assert.strictEqual(tree.y, ty, 'Tree y must match tile ty');
          assert.strictEqual(tree.col, tx, 'Tree col must match tile tx');
          assert.strictEqual(tree.row, ty, 'Tree row must match tile ty');
          assert.ok(
            tree.variant >= 0 && tree.variant <= 2 && Number.isInteger(tree.variant),
            `Tree variant must be an integer in [0, 2], got ${tree.variant}`
          );
          assert.ok(
            tree.density >= wn.config.forestThreshold,
            `Tree placed where density (${tree.density}) < forestThreshold (${wn.config.forestThreshold})`
          );
          assert.strictEqual(
            wn.isWaterAt(tx, ty),
            false,
            `Tree must never spawn in water at (${tx}, ${ty})`
          );
        }
      }
    }

    assert.ok(treeCount > 0, `Expected at least some trees in 100x100 area, found ${treeCount}`);
  });

  it('strictly enforces tree minimum spacing invariant across all placed trees', () => {
    const minSpacing = 3.0;
    const wn = new WorldNoise({
      seed: 8888,
      treeMinSpacing: minSpacing,
    });

    const placedTrees: TreePlacement[] = [];

    // Scan a substantial region
    for (let tx = -60; tx <= 60; tx++) {
      for (let ty = -60; ty <= 60; ty++) {
        const tree = wn.getTreeAt(tx, ty);
        if (tree) {
          placedTrees.push(tree);
        }
      }
    }

    assert.ok(placedTrees.length > 10, `Expected placed trees to test, found ${placedTrees.length}`);

    // Pairwise distance check for all placed trees within distance threshold
    for (let i = 0; i < placedTrees.length; i++) {
      for (let j = i + 1; j < placedTrees.length; j++) {
        const t1 = placedTrees[i];
        const t2 = placedTrees[j];
        const dx = t1.x - t2.x;
        const dy = t1.y - t2.y;
        const dist = Math.hypot(dx, dy);

        assert.ok(
          dist >= minSpacing - 1e-6,
          `Tree spacing violation between (${t1.x}, ${t1.y}) and (${t2.x}, ${t2.y}): dist=${dist} < minSpacing=${minSpacing}`
        );
      }
    }
  });

  it('never places trees when forestDensity is below forestThreshold', () => {
    const wn = new WorldNoise({
      seed: 42,
      forestThreshold: 0.99999, // Extremely high threshold -> effectively no forest
    });

    for (let tx = -30; tx <= 30; tx++) {
      for (let ty = -30; ty <= 30; ty++) {
        const tree = wn.getTreeAt(tx, ty);
        assert.strictEqual(tree, null, `No tree should spawn with high threshold at (${tx}, ${ty})`);
      }
    }
  });
});

describe('4. Water/pond continentalness thresholding', () => {
  it('evaluates isWaterAt in exact alignment with continentalness threshold', () => {
    const threshold = 0.40;
    const wn = new WorldNoise({
      seed: 5555,
      waterThreshold: threshold,
    });

    for (let x = -100; x <= 100; x += 10) {
      for (let y = -100; y <= 100; y += 10) {
        const cont = wn.sampleContinentalness(x, y);
        const isWater = wn.isWaterAt(x, y);

        if (cont < threshold) {
          assert.strictEqual(isWater, true, `Expected water when continentalness (${cont}) < threshold (${threshold})`);
          assert.strictEqual(wn.getBiomeAt(x, y), 'water_pond', 'Water depression must be water_pond biome');
        } else {
          assert.strictEqual(isWater, false, `Expected land when continentalness (${cont}) >= threshold (${threshold})`);
          assert.notStrictEqual(wn.getBiomeAt(x, y), 'water_pond', 'Non-water depression must not be water_pond');
        }
      }
    }
  });

  it('responds correctly to custom waterThreshold configurations', () => {
    const wnDry = new WorldNoise({ seed: 333, waterThreshold: 0.0 });
    const wnWet = new WorldNoise({ seed: 333, waterThreshold: 1.0 });

    for (let x = -20; x <= 20; x += 5) {
      for (let y = -20; y <= 20; y += 5) {
        assert.strictEqual(wnDry.isWaterAt(x, y), false, 'threshold=0 should produce no water');
        // If cont < 1.0 (continuous fbm is in [0, 1]), threshold=1.0 makes virtually everything water
        const cont = wnWet.sampleContinentalness(x, y);
        if (cont < 1.0) {
          assert.strictEqual(wnWet.isWaterAt(x, y), true, 'threshold=1.0 should produce water');
        }
      }
    }
  });
});

describe('5. Village Voronoi cell metrics, center consistency, and radius', () => {
  it('correctly populates VillageInfo geometric and boolean metrics', () => {
    const wn = new WorldNoise({
      seed: 1234,
      villageRarity: 1.0, // Force every cell to have a village
      villageCellSize: 64,
      villageRadius: 20,
    });

    const info = wn.getVillageAt(0, 0);
    assert.ok(info !== null, 'VillageInfo must not be null with villageRarity=1.0');

    assert.strictEqual(info.hasVillage, true);
    assert.strictEqual(info.radius, 20);
    assert.strictEqual(info.plazaCenter.col, info.plazaCenter.x);
    assert.strictEqual(info.plazaCenter.row, info.plazaCenter.y);

    const expectedDist = Math.hypot(0 - info.plazaCenter.x, 0 - info.plazaCenter.y);
    assert.ok(
      Math.abs(info.distanceToCenter - expectedDist) < 1e-6,
      `distanceToCenter ${info.distanceToCenter} must match hypot ${expectedDist}`
    );

    const expectedNormRadius = expectedDist / 20;
    assert.ok(
      Math.abs(info.normalizedRadius - expectedNormRadius) < 1e-6,
      `normalizedRadius ${info.normalizedRadius} must match ${expectedNormRadius}`
    );

    assert.strictEqual(info.isInside, expectedDist <= 20);
    assert.strictEqual(info.isPlaza, expectedDist <= Math.max(2, Math.floor(20 * 0.25)));
  });

  it('guarantees center consistency: tiles querying the plaza center land at distance 0 and isPlaza=true', () => {
    const wn = new WorldNoise({
      seed: 9876,
      villageRarity: 1.0,
      villageCellSize: 50,
      villageRadius: 16,
    });

    const sample = wn.getVillageAt(100, 100);
    assert.ok(sample !== null);

    const plazaX = sample.plazaCenter.x;
    const plazaY = sample.plazaCenter.y;

    const centerInfo = wn.getVillageAt(plazaX, plazaY);
    assert.ok(centerInfo !== null);
    assert.strictEqual(centerInfo.centerCol, sample.centerCol);
    assert.strictEqual(centerInfo.centerRow, sample.centerRow);
    assert.strictEqual(centerInfo.plazaCenter.x, plazaX);
    assert.strictEqual(centerInfo.plazaCenter.y, plazaY);
    assert.strictEqual(centerInfo.distanceToCenter, 0);
    assert.strictEqual(centerInfo.normalizedRadius, 0);
    assert.strictEqual(centerInfo.isPlaza, true);
    assert.strictEqual(centerInfo.isInside, true);
  });

  it('respects villageRarity thresholding: rarity=0 yields no villages', () => {
    const wn = new WorldNoise({
      seed: 42,
      villageRarity: 0.0,
    });

    for (let x = -200; x <= 200; x += 40) {
      for (let y = -200; y <= 200; y += 40) {
        assert.strictEqual(
          wn.getVillageAt(x, y),
          null,
          `Village must be null when villageRarity is 0 at (${x}, ${y})`
        );
      }
    }
  });
});

describe('6. Core 5 biome distribution coverage', () => {
  it('covers all 5 canonical biomes across a macro landscape sampling', () => {
    const wn = new WorldNoise(4242);
    const biomeCounts = new Map<WorldBiome, number>();

    for (const b of WORLD_BIOMES) {
      biomeCounts.set(b, 0);
    }

    // Sample across a wide spatial region (stride to cover macroscopic climate variations)
    for (let x = -500; x <= 500; x += 25) {
      for (let y = -500; y <= 500; y += 25) {
        const biome = wn.getBiomeAt(x, y);
        assert.ok(
          WORLD_BIOMES.includes(biome),
          `Biome ${biome} must be one of the 5 canonical biomes`
        );
        biomeCounts.set(biome, (biomeCounts.get(biome) ?? 0) + 1);
      }
    }

    // Assert that every single one of the 5 biomes was generated
    for (const [biome, count] of biomeCounts.entries()) {
      assert.ok(
        count > 0,
        `Expected biome "${biome}" to appear in sample distribution, but count was ${count}`
      );
    }
  });

  it('matches semantic biome conditions according to multi-noise rules', () => {
    const wn = new WorldNoise(100);

    for (let x = -80; x <= 80; x += 15) {
      for (let y = -80; y <= 80; y += 15) {
        const biome = wn.getBiomeAt(x, y);
        const cont = wn.sampleContinentalness(x, y);
        const temp = wn.sampleTemperature(x, y);
        const hum = wn.sampleHumidity(x, y);
        const eros = wn.sampleErosion(x, y);
        const forst = wn.sampleForestDensity(x, y);

        if (cont < wn.config.waterThreshold) {
          assert.strictEqual(biome, 'water_pond');
        } else if (temp > 0.55 && hum < 0.45) {
          assert.strictEqual(biome, 'desert_arid');
        } else if (eros > 0.62) {
          assert.strictEqual(biome, 'rocky_paver');
        } else if (forst > wn.config.forestThreshold || (hum > 0.58 && temp < 0.60)) {
          assert.strictEqual(biome, 'forest');
        } else {
          assert.strictEqual(biome, 'meadow_plains');
        }
      }
    }
  });

  it('exposes WORLD_BIOMES constant with 5 frozen unique entries', () => {
    assert.strictEqual(WORLD_BIOMES.length, 5);
    assert.ok(Object.isFrozen(WORLD_BIOMES));
    const set = new Set(WORLD_BIOMES);
    assert.strictEqual(set.size, 5);
    assert.ok(set.has('water_pond'));
    assert.ok(set.has('meadow_plains'));
    assert.ok(set.has('forest'));
    assert.ok(set.has('desert_arid'));
    assert.ok(set.has('rocky_paver'));
  });
});

describe('7. Noise Visual Palette and Visual Tile Inspector', () => {
  it('exposes a frozen NOISE_PALETTE with 8 distinct feature color categories', () => {
    assert.strictEqual(NOISE_PALETTE.length, 8);
    assert.ok(Object.isFrozen(NOISE_PALETTE));

    const ids = new Set(NOISE_PALETTE.map((e) => e.id));
    assert.strictEqual(ids.size, 8);
    assert.ok(ids.has('water_pond'));
    assert.ok(ids.has('forest'));
    assert.ok(ids.has('tree'));
    assert.ok(ids.has('meadow_plains'));
    assert.ok(ids.has('desert_arid'));
    assert.ok(ids.has('rocky_paver'));
    assert.ok(ids.has('village'));
    assert.ok(ids.has('plaza'));

    for (const entry of NOISE_PALETTE) {
      assert.ok(entry.color >= 0 && entry.color <= 0xffffff, `Invalid RGB integer: ${entry.color}`);
      assert.match(entry.hexColor, /^#[0-9a-f]{6}$/i, `Invalid hex color: ${entry.hexColor}`);
      assert.ok(entry.label.length > 0);
      assert.ok(entry.description.length > 0);
    }
  });

  it('evaluates getNoiseVisualTile consistently with underlying noise queries', () => {
    const wn = new WorldNoise(4242);

    for (let tx = -50; tx <= 50; tx += 10) {
      for (let ty = -50; ty <= 50; ty += 10) {
        const visual = getNoiseVisualTile(wn, tx, ty);
        assert.ok(visual.color >= 0 && visual.color <= 0xffffff);
        assert.match(visual.hexColor, /^#[0-9a-f]{6}$/i);
        assert.ok(visual.label.length > 0);

        const village = wn.getVillageAt(tx, ty);
        if (village && village.isInside) {
          if (village.isPlaza) {
            assert.strictEqual(visual.category, 'plaza');
            assert.strictEqual(visual.isPlaza, true);
          } else {
            assert.strictEqual(visual.category, 'village');
            assert.strictEqual(visual.isVillage, true);
          }
        } else if (wn.isWaterAt(tx, ty)) {
          assert.strictEqual(visual.category, 'water');
          assert.strictEqual(visual.isWater, true);
        } else if (wn.getTreeAt(tx, ty)) {
          assert.strictEqual(visual.category, 'tree');
          assert.strictEqual(visual.isTree, true);
        } else {
          assert.ok(
            ['forest', 'desert', 'rocky', 'meadow'].includes(visual.category),
            `Unexpected category: ${visual.category}`
          );
        }
      }
    }
  });
});
