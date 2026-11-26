import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PredictionController } from '../net/PredictionController.ts';
import { CollisionEngine } from '../collision/collision.ts';
import { WorldNoise } from '../procedural/worldNoise.ts';

function createFreeSpaceResolver() {
  return (
    x: number,
    y: number,
    dx: number,
    dy: number,
    speed: number,
    dt: number,
    _halfW: number,
    _halfH: number
  ) => ({
    newX: x + dx * speed * dt,
    newY: y + dy * speed * dt,
    xBlocked: false,
    yBlocked: false,
  });
}

describe('PredictionController', () => {
  it('optimistically steps cardinal and normalized diagonal movement with incrementing seq', () => {
    const controller = new PredictionController({
      resolveMovement: createFreeSpaceResolver(),
      initialX: 0,
      initialY: 0,
      baseSpeed: 240,
      sprintSpeed: 480,
    });

    // Cardinal right for 0.5s at baseSpeed=240 -> +120px
    const s1 = controller.stepInput(1, 0, false, 0.5);
    assert.strictEqual(s1.seq, 1);
    assert.ok(Math.abs(s1.simX - 120) < 1e-6);
    assert.strictEqual(s1.simY, 0);
    assert.strictEqual(s1.renderX, s1.simX);
    assert.strictEqual(s1.renderY, s1.simY);

    // Diagonal (+1, +1) sprinting for 1.0s at sprintSpeed=480 -> +480 * SQRT1_2 on each axis
    const s2 = controller.stepInput(1, 1, true, 1.0);
    assert.strictEqual(s2.seq, 2);
    const expectedDelta = 480 * Math.SQRT1_2;
    assert.ok(Math.abs(s2.simX - (120 + expectedDelta)) < 1e-6);
    assert.ok(Math.abs(s2.simY - expectedDelta) < 1e-6);
    assert.strictEqual(controller.getPendingInputCount(), 2);
  });

  it('ignores reconciliation correction when error <= 0.5px', () => {
    const controller = new PredictionController({
      resolveMovement: createFreeSpaceResolver(),
      initialX: 0,
      initialY: 0,
      baseSpeed: 240,
    });

    controller.stepInput(1, 0, false, 0.5); // simX = 120, seq = 1
    controller.stepInput(1, 0, false, 0.5); // simX = 240, seq = 2

    // Server acks seq=1 at 120.2 (0.2px drift <= 0.5px)
    const result = controller.reconcile({ lastProcessedSeq: 1, posX: 120.2, posY: 0 });
    assert.strictEqual(result.mode, 'none');
    assert.strictEqual(controller.getPendingInputCount(), 1);
    assert.strictEqual(controller.simX, 240);
    assert.strictEqual(controller.visualErrorX, 0);
  });

  it('smoothly blends visual error when 0.5px < error <= 64px', () => {
    const controller = new PredictionController({
      resolveMovement: createFreeSpaceResolver(),
      initialX: 0,
      initialY: 0,
      baseSpeed: 240,
    });

    controller.stepInput(1, 0, false, 0.5); // simX = 120, seq = 1
    controller.stepInput(1, 0, false, 0.5); // simX = 240, seq = 2

    // Server acks seq=1 at 100 (20px behind -> replayed = 100 + 120 = 220; error = 20px)
    const result = controller.reconcile({ lastProcessedSeq: 1, posX: 100, posY: 0 });
    assert.strictEqual(result.mode, 'smooth');
    assert.strictEqual(controller.simX, 220);
    assert.strictEqual(controller.visualErrorX, 20);
    // Render position stays continuous at oldRenderX (240) immediately after reconcile
    assert.strictEqual(controller.renderX, 240);

    // Subsequent idle frames decay visualErrorX toward 0
    const before = controller.visualErrorX;
    controller.stepInput(0, 0, false, 0.05);
    assert.ok(controller.visualErrorX < before);
    assert.ok(controller.visualErrorX > 0);

    for (let i = 0; i < 60; i++) {
      controller.stepInput(0, 0, false, 1 / 60);
    }
    assert.ok(Math.abs(controller.visualErrorX) < 0.05);
  });

  it('hard snaps when error > 64px', () => {
    const controller = new PredictionController({
      resolveMovement: createFreeSpaceResolver(),
      initialX: 0,
      initialY: 0,
      baseSpeed: 240,
    });

    controller.stepInput(1, 0, false, 0.5); // simX = 120, seq = 1

    // Server acks seq=1 at 0 -> error = 120px > 64px
    const result = controller.reconcile({ lastProcessedSeq: 1, posX: 0, posY: 0 });
    assert.strictEqual(result.mode, 'snap');
    assert.strictEqual(controller.simX, 0);
    assert.strictEqual(controller.visualErrorX, 0);
    assert.strictEqual(controller.renderX, 0);
  });

  it('works with CollisionEngine for deterministic wall sliding and reconciliation', () => {
    const worldNoise = new WorldNoise(42);
    const collisionEngine = new CollisionEngine(worldNoise, 64);
    const safe = collisionEngine.findSafeSpawn(0, 0, 14, 14);

    const controller = new PredictionController({
      collisionEngine,
      initialX: safe.x,
      initialY: safe.y,
    });

    const step = controller.stepInput(1, 0, false, 1 / 60);
    assert.strictEqual(step.seq, 1);
    assert.ok(Number.isFinite(step.simX));
    assert.ok(Number.isFinite(step.simY));
  });

  it('resetPosition clears pending inputs and visual error', () => {
    const controller = new PredictionController({
      resolveMovement: createFreeSpaceResolver(),
      initialX: 0,
      initialY: 0,
    });

    controller.stepInput(1, 0, false, 0.5);
    controller.reconcile({ lastProcessedSeq: 1, posX: 110, posY: 0 });
    assert.ok(controller.getPendingInputCount() === 0);
    assert.strictEqual(controller.visualErrorX, 10);

    controller.resetPosition(500, -300);
    assert.strictEqual(controller.simX, 500);
    assert.strictEqual(controller.simY, -300);
    assert.strictEqual(controller.visualErrorX, 0);
    assert.strictEqual(controller.visualErrorY, 0);
    assert.strictEqual(controller.getPendingInputCount(), 0);
  });
});
