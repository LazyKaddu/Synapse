import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ForestSpreadGenerator,
  DEFAULT_FOREST_SPREAD_CONFIG,
  type ForestZoneType,
  type TreeMaturity,
  type ForestTreeInfo,
} from '../procedural/forestGen.ts';

describe('ForestSpreadGenerator: 1. Determinism across coordinates and seeds', () => {
  it('guarantees identical sampling outputs across duplicate calls with the same seed', () => {
    const seed = 998877;
    const gen1 = new ForestSpreadGenerator(seed);
    const gen2 = new ForestSpreadGenerator({ seed });

    assert.strictEqual(gen1.masterSeed, seed);
    assert.strictEqual(gen2.masterSeed, seed);

    const testCoords = [
      [0, 0],
      [15, -27],
      [-42, 88],
      [128, -256],
      [-1024, -2048],
      [5555, 6666],
    ];

    for (const [x, y] of testCoords) {
      assert.strictEqual(
        gen1.sampleMacroDensity(x, y),
        gen2.sampleMacroDensity(x, y),
        `Macro density mismatch at (${x}, ${y})`
      );
      assert.strictEqual(
        gen1.sampleGroveDensity(x, y),
        gen2.sampleGroveDensity(x, y),
        `Grove density mismatch at (${x}, ${y})`
      );
      assert.strictEqual(
        gen1.sampleGladeFactor(x, y),
        gen2.sampleGladeFactor(x, y),
        `Glade factor mismatch at (${x}, ${y})`
      );
      assert.strictEqual(
        gen1.getEffectiveDensity(x, y),
        gen2.getEffectiveDensity(x, y),
        `Effective density mismatch at (${x}, ${y})`
      );
      assert.strictEqual(
        gen1.getZoneAt(x, y),
        gen2.getZoneAt(x, y),
        `Forest zone mismatch at (${x}, ${y})`
      );
      assert.strictEqual(
        gen1.isCanopyAt(x, y),
        gen2.isCanopyAt(x, y),
        `Canopy flag mismatch at (${x}, ${y})`
      );

      const tree1 = gen1.getTreeAt(x, y);
      const tree2 = gen2.getTreeAt(x, y);
      assert.deepStrictEqual(tree1, tree2, `Tree mismatch at (${x}, ${y})`);

      const forest1 = gen1.getForestAt(x, y);
      const forest2 = gen2.getForestAt(x, y);
      assert.deepStrictEqual(forest1, forest2, `Forest info mismatch at (${x}, ${y})`);
    }
  });

  it('produces distinct distributions for different master seeds', () => {
    const genA = new ForestSpreadGenerator(1111);
    const genB = new ForestSpreadGenerator(9999);

    let differences = 0;
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        if (genA.getEffectiveDensity(x, y) !== genB.getEffectiveDensity(x, y)) {
          differences++;
        }
      }
    }
    assert.ok(differences > 350, `Expected widespread variation between seeds, got ${differences}`);
  });
});

describe('ForestSpreadGenerator: 2. Ecological Zone Transitions', () => {
  it('strictly bounds all continuous density outputs in [0, 1]', () => {
    const gen = new ForestSpreadGenerator(42);

    for (let x = -30; x <= 30; x += 5) {
      for (let y = -30; y <= 30; y += 5) {
        const macro = gen.sampleMacroDensity(x, y);
        const grove = gen.sampleGroveDensity(x, y);
        const glade = gen.sampleGladeFactor(x, y);
        const effective = gen.getEffectiveDensity(x, y);

        assert.ok(macro >= 0 && macro <= 1, `Macro ${macro} out of bounds at (${x}, ${y})`);
        assert.ok(grove >= 0 && grove <= 1, `Grove ${grove} out of bounds at (${x}, ${y})`);
        assert.ok(glade >= 0 && glade <= 1, `Glade ${glade} out of bounds at (${x}, ${y})`);
        assert.ok(effective >= 0 && effective <= 1, `Effective ${effective} out of bounds at (${x}, ${y})`);
      }
    }
  });

  it('classifies zones strictly into core, interior, clearing, edge, or none', () => {
    const gen = new ForestSpreadGenerator(777);
    const validZones = new Set<ForestZoneType>(['core', 'interior', 'clearing', 'edge', 'none']);
    const observedZones = new Set<ForestZoneType>();

    for (let x = -40; x <= 40; x += 2) {
      for (let y = -40; y <= 40; y += 2) {
        const zone = gen.getZoneAt(x, y);
        assert.ok(validZones.has(zone), `Invalid zone type: ${zone}`);
        observedZones.add(zone);
      }
    }

    assert.ok(observedZones.has('none'), 'Expected non-forest zone');
    assert.ok(observedZones.has('edge'), 'Expected edge ecotone zone');
    assert.ok(observedZones.has('interior'), 'Expected interior woods zone');
    assert.ok(observedZones.has('core'), 'Expected core old-growth zone');
  });

  it('evaluates zone as none when density is below edgeThreshold', () => {
    const gen = new ForestSpreadGenerator({
      seed: 1234,
      edgeThreshold: 0.60,
    });

    for (let x = -20; x <= 20; x++) {
      for (let y = -20; y <= 20; y++) {
        const density = gen.getEffectiveDensity(x, y);
        const zone = gen.getZoneAt(x, y);
        if (density < 0.60) {
          assert.strictEqual(zone, 'none', `Zone must be none when density ${density} < 0.60`);
        }
      }
    }
  });
});

describe('ForestSpreadGenerator: 3. Glade Clearings & Tree Suppression Invariants', () => {
  it('strictly spawns ZERO tree trunks on clearing and none zones', () => {
    const gen = new ForestSpreadGenerator(54321);

    let checkedClearings = 0;
    let checkedNones = 0;

    for (let x = -60; x <= 60; x++) {
      for (let y = -60; y <= 60; y++) {
        const zone = gen.getZoneAt(x, y);
        if (zone === 'clearing') {
          checkedClearings++;
          const tree = gen.getTreeAt(x, y);
          assert.strictEqual(tree, null, `Clearing at (${x}, ${y}) must not have a tree trunk`);
        } else if (zone === 'none') {
          checkedNones++;
          const tree = gen.getTreeAt(x, y);
          assert.strictEqual(tree, null, `Non-forest at (${x}, ${y}) must not have a tree trunk`);
        }
      }
    }

    assert.ok(checkedNones > 100, `Expected non-forest tiles, found ${checkedNones}`);
  });

  it('ensures every placed tree has valid variant and density >= edgeThreshold', () => {
    const gen = new ForestSpreadGenerator(102030);

    let treeCount = 0;
    for (let x = -40; x <= 40; x++) {
      for (let y = -40; y <= 40; y++) {
        const tree = gen.getTreeAt(x, y);
        if (tree) {
          treeCount++;
          assert.ok(
            tree.variant >= 0 && tree.variant <= 2 && Number.isInteger(tree.variant),
            `Invalid tree variant: ${tree.variant}`
          );
          assert.ok(
            tree.density >= DEFAULT_FOREST_SPREAD_CONFIG.edgeThreshold,
            `Tree density ${tree.density} < edgeThreshold`
          );
        }
      }
    }

    assert.ok(treeCount > 20, `Expected multiple trees placed, found ${treeCount}`);
  });
});

describe('ForestSpreadGenerator: 4. Tree Maturity Hierarchy & Canopy Sizing', () => {
  it('correctly maps tree maturity to canopy radius', () => {
    const gen = new ForestSpreadGenerator(888);

    for (let x = -50; x <= 50; x++) {
      for (let y = -50; y <= 50; y++) {
        const tree = gen.getTreeAt(x, y);
        if (tree) {
          switch (tree.maturity) {
            case 'large':
              assert.strictEqual(tree.canopyRadius, 2, 'Large tree must have canopyRadius=2');
              break;
            case 'medium':
              assert.strictEqual(tree.canopyRadius, 1, 'Medium tree must have canopyRadius=1');
              break;
            case 'small':
            case 'bush':
              assert.strictEqual(tree.canopyRadius, 0, 'Small/bush must have canopyRadius=0');
              break;
            default:
              assert.fail(`Unknown tree maturity: ${(tree as any).maturity}`);
          }
        }
      }
    }
  });

  it('guarantees core old-growth zone trees are strictly large or medium maturity', () => {
    const gen = new ForestSpreadGenerator({
      seed: 334455,
      coreThreshold: 0.66,
    });

    let coreTreeCount = 0;
    for (let x = -80; x <= 80; x++) {
      for (let y = -80; y <= 80; y++) {
        const zone = gen.getZoneAt(x, y);
        if (zone === 'core') {
          const tree = gen.getTreeAt(x, y);
          if (tree) {
            coreTreeCount++;
            assert.ok(
              tree.maturity === 'large' || tree.maturity === 'medium',
              `Core zone tree at (${x}, ${y}) had unexpected maturity: ${tree.maturity}`
            );
          }
        }
      }
    }

    assert.ok(coreTreeCount > 5, `Expected core trees, found ${coreTreeCount}`);
  });
});

describe('ForestSpreadGenerator: 5. Mathematical Minimum Spacing Invariant', () => {
  it('strictly enforces tree minimum spacing invariant across all placed trees (spacing=2.0)', () => {
    const minSpacing = 2.0;
    const gen = new ForestSpreadGenerator({
      seed: 12345,
      treeMinSpacing: minSpacing,
    });

    const placedTrees: ForestTreeInfo[] = [];

    for (let x = -50; x <= 50; x++) {
      for (let y = -50; y <= 50; y++) {
        const tree = gen.getTreeAt(x, y);
        if (tree) {
          placedTrees.push(tree);
        }
      }
    }

    assert.ok(placedTrees.length > 30, `Expected trees to test, found ${placedTrees.length}`);

    for (let i = 0; i < placedTrees.length; i++) {
      for (let j = i + 1; j < placedTrees.length; j++) {
        const t1 = placedTrees[i];
        const t2 = placedTrees[j];
        const dist = Math.hypot(t1.x - t2.x, t1.y - t2.y);
        assert.ok(
          dist >= minSpacing - 1e-6,
          `Spacing violation between (${t1.x}, ${t1.y}) and (${t2.x}, ${t2.y}): dist=${dist} < minSpacing=${minSpacing}`
        );
      }
    }
  });

  it('strictly enforces tree minimum spacing invariant with custom minSpacing=3.5', () => {
    const minSpacing = 3.5;
    const gen = new ForestSpreadGenerator({
      seed: 77777,
      treeMinSpacing: minSpacing,
    });

    const placedTrees: ForestTreeInfo[] = [];

    for (let x = -50; x <= 50; x++) {
      for (let y = -50; y <= 50; y++) {
        const tree = gen.getTreeAt(x, y);
        if (tree) {
          placedTrees.push(tree);
        }
      }
    }

    assert.ok(placedTrees.length > 10, `Expected trees to test, found ${placedTrees.length}`);

    for (let i = 0; i < placedTrees.length; i++) {
      for (let j = i + 1; j < placedTrees.length; j++) {
        const t1 = placedTrees[i];
        const t2 = placedTrees[j];
        const dist = Math.hypot(t1.x - t2.x, t1.y - t2.y);
        assert.ok(
          dist >= minSpacing - 1e-6,
          `Spacing violation between (${t1.x}, ${t1.y}) and (${t2.x}, ${t2.y}): dist=${dist} < minSpacing=${minSpacing}`
        );
      }
    }
  });
});

describe('ForestSpreadGenerator: 6. Overhead Canopy Coverage Footprint', () => {
  it('covers tiles within tree canopy radius with isCanopy=true', () => {
    const gen = new ForestSpreadGenerator(9999);

    // Find a tree with canopyRadius > 0
    let foundCanopyTree: ForestTreeInfo | null = null;
    for (let x = -30; x <= 30 && !foundCanopyTree; x++) {
      for (let y = -30; y <= 30 && !foundCanopyTree; y++) {
        const tree = gen.getTreeAt(x, y);
        if (tree && tree.canopyRadius >= 1) {
          foundCanopyTree = tree;
        }
      }
    }

    assert.ok(foundCanopyTree, 'Must find a tree with canopy coverage');

    // Trunk center must have canopy coverage
    assert.strictEqual(
      gen.isCanopyAt(foundCanopyTree.x, foundCanopyTree.y),
      true,
      'Trunk center must be covered by canopy'
    );

    // Cardinal neighbors within radius must be covered
    for (let r = 1; r <= foundCanopyTree.canopyRadius; r++) {
      assert.strictEqual(
        gen.isCanopyAt(foundCanopyTree.x + r, foundCanopyTree.y),
        true,
        `East tile offset +${r} must be under canopy`
      );
      assert.strictEqual(
        gen.isCanopyAt(foundCanopyTree.x - r, foundCanopyTree.y),
        true,
        `West tile offset -${r} must be under canopy`
      );
      assert.strictEqual(
        gen.isCanopyAt(foundCanopyTree.x, foundCanopyTree.y + r),
        true,
        `South tile offset +${r} must be under canopy`
      );
      assert.strictEqual(
        gen.isCanopyAt(foundCanopyTree.x, foundCanopyTree.y - r),
        true,
        `North tile offset -${r} must be under canopy`
      );
    }
  });

  it('guarantees open sky (isCanopy=false) in non-forest territory', () => {
    const gen = new ForestSpreadGenerator(42);

    for (let x = -40; x <= 40; x++) {
      for (let y = -40; y <= 40; y++) {
        const forest = gen.getForestAt(x, y);
        if (forest.zone === 'none' && forest.canopyDistance > 4) {
          assert.strictEqual(
            forest.isCanopy,
            false,
            `Open meadow at (${x}, ${y}) must have open sky (isCanopy=false)`
          );
        }
      }
    }
  });
});

describe('ForestSpreadGenerator: 7. Full Tile Ecological Metadata', () => {
  it('populates valid undergrowth foliage matching the ecological zone', () => {
    const gen = new ForestSpreadGenerator(2024);

    const validUndergrowth = new Set(['moss_soil', 'dense_foliage', 'glade_flower', 'meadow_grass']);

    for (let x = -30; x <= 30; x += 3) {
      for (let y = -30; y <= 30; y += 3) {
        const forest = gen.getForestAt(x, y);
        assert.ok(
          validUndergrowth.has(forest.undergrowth),
          `Invalid undergrowth type: ${forest.undergrowth}`
        );

        if (forest.zone === 'clearing') {
          assert.strictEqual(
            forest.undergrowth,
            'glade_flower',
            'Clearing undergrowth must be glade_flower'
          );
        }
      }
    }
  });
});
