import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RemotePlayerInterpolator } from '../net/RemotePlayerInterpolator.ts';

describe('RemotePlayerInterpolator', () => {
  it('interpolates smoothly between bracketing 10fps snapshots at 60fps renderTime', () => {
    const interp = new RemotePlayerInterpolator({
      interpolationDelayMs: 110,
      maxExtrapolationMs: 150,
    });

    interp.pushSnapshot(7, {
      serverTick: 1,
      timestampMs: 1000,
      posX: 0,
      posY: 100,
      velX: 240,
      velY: 0,
    });
    interp.pushSnapshot(7, {
      serverTick: 2,
      timestampMs: 1100,
      posX: 24,
      posY: 100,
      velX: 240,
      velY: 0,
    });

    // nowMs = 1160 -> renderTime = 1050 (halfway between 1000 and 1100)
    const sample = interp.sample(7, 1160);
    assert.ok(sample !== null);
    assert.ok(Math.abs(sample.posX - 12) < 1e-6);
    assert.ok(Math.abs(sample.posY - 100) < 1e-6);
    assert.strictEqual(sample.mode, 'interpolate');
  });

  it('maintains ordered buffer when snapshots arrive out of order', () => {
    const interp = new RemotePlayerInterpolator({ interpolationDelayMs: 100 });

    interp.pushSnapshot(1, {
      serverTick: 2,
      timestampMs: 1100,
      posX: 100,
      posY: 0,
      velX: 1000,
      velY: 0,
    });
    interp.pushSnapshot(1, {
      serverTick: 1,
      timestampMs: 1000,
      posX: 0,
      posY: 0,
      velX: 1000,
      velY: 0,
    });

    // nowMs = 1125 -> renderTime = 1025 (25% between 1000 and 1100)
    const sample = interp.sample(1, 1125);
    assert.ok(sample !== null);
    assert.ok(Math.abs(sample.posX - 25) < 1e-6);
  });

  it('extrapolates up to maxExtrapolationMs when renderTime exceeds latest snapshot', () => {
    const interp = new RemotePlayerInterpolator({
      interpolationDelayMs: 110,
      maxExtrapolationMs: 150,
    });

    interp.pushSnapshot(5, {
      serverTick: 10,
      timestampMs: 1000,
      posX: 100,
      posY: 200,
      velX: 200,
      velY: -100,
    });

    // nowMs = 1160 -> renderTime = 1050 (50ms ahead of 1000)
    const s1 = interp.sample(5, 1160);
    assert.ok(s1 !== null);
    assert.strictEqual(s1.mode, 'extrapolate');
    assert.ok(Math.abs(s1.posX - 110) < 1e-6); // 100 + 200 * 0.05
    assert.ok(Math.abs(s1.posY - 195) < 1e-6); // 200 - 100 * 0.05

    // nowMs = 1500 -> renderTime = 1390 (390ms ahead, clamped to 150ms = 0.15s)
    const s2 = interp.sample(5, 1500);
    assert.ok(s2 !== null);
    assert.strictEqual(s2.mode, 'extrapolate');
    assert.ok(Math.abs(s2.posX - 130) < 1e-6); // 100 + 200 * 0.15
    assert.ok(Math.abs(s2.posY - 185) < 1e-6); // 200 - 100 * 0.15
  });

  it('holds earliest snapshot when renderTime precedes all buffered snapshots', () => {
    const interp = new RemotePlayerInterpolator({ interpolationDelayMs: 110 });

    interp.pushSnapshot(3, {
      serverTick: 1,
      timestampMs: 1000,
      posX: 50,
      posY: 75,
      velX: 100,
      velY: 0,
    });

    // nowMs = 1050 -> renderTime = 940 < 1000
    const sample = interp.sample(3, 1050);
    assert.ok(sample !== null);
    assert.strictEqual(sample.posX, 50);
    assert.strictEqual(sample.posY, 75);
    assert.strictEqual(sample.mode, 'hold');
  });

  it('tracks and removes players cleanly', () => {
    const interp = new RemotePlayerInterpolator();
    interp.pushSnapshot(10, {
      serverTick: 1,
      timestampMs: 1000,
      posX: 0,
      posY: 0,
      velX: 0,
      velY: 0,
    });
    interp.pushSnapshot(20, {
      serverTick: 1,
      timestampMs: 1000,
      posX: 10,
      posY: 10,
      velX: 0,
      velY: 0,
    });

    assert.deepStrictEqual(interp.getPlayerIds().sort((a, b) => a - b), [10, 20]);

    interp.removePlayer(10);
    assert.deepStrictEqual(interp.getPlayerIds(), [20]);
    assert.strictEqual(interp.sample(10, 1110), null);
  });
});
