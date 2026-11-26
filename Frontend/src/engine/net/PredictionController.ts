import type { CollisionEngine, MovementResolution, WorldCollider } from '../collision/collision.ts';

export type MovementResolver = (
  currentX: number,
  currentY: number,
  dx: number,
  dy: number,
  speed: number,
  dt: number,
  halfWidth: number,
  halfHeight: number
) => MovementResolution;

export interface PendingInput {
  readonly seq: number;
  readonly dx: number;
  readonly dy: number;
  readonly sprint: boolean;
  readonly dtSeconds: number;
}

export interface PredictionStepResult {
  readonly seq: number;
  readonly simX: number;
  readonly simY: number;
  readonly renderX: number;
  readonly renderY: number;
  readonly xBlocked: boolean;
  readonly yBlocked: boolean;
  readonly collider?: WorldCollider;
}

export interface StateAck {
  readonly lastProcessedSeq: number;
  readonly posX: number;
  readonly posY: number;
}

export interface ReconcileResult {
  readonly mode: 'none' | 'smooth' | 'snap';
  readonly error: number;
  readonly simX: number;
  readonly simY: number;
}

export interface PredictionControllerOptions {
  readonly collisionEngine?: CollisionEngine;
  readonly resolveMovement?: MovementResolver;
  readonly initialX?: number;
  readonly initialY?: number;
  readonly playerHalfSize?: number;
  readonly baseSpeed?: number;
  readonly sprintSpeed?: number;
  readonly errorDecayRate?: number;
}

const EPSILON_IGNORE_PX = 0.5;
const HARD_SNAP_THRESHOLD_PX = 64;
const VISUAL_ERROR_SNAP_ZERO = 0.01;

/**
 * Pure TypeScript optimistic client-side movement prediction and server reconciliation controller.
 * No PixiJS or DOM dependencies.
 */
export class PredictionController {
  private resolveMovementFn: MovementResolver;
  public readonly playerHalfSize: number;
  public readonly baseSpeed: number;
  public readonly sprintSpeed: number;
  private readonly errorDecayRate: number;

  public simX: number;
  public simY: number;
  public visualErrorX = 0;
  public visualErrorY = 0;

  private nextSeq = 0;
  private pendingInputs: PendingInput[] = [];

  constructor(options: PredictionControllerOptions) {
    if (options.resolveMovement) {
      this.resolveMovementFn = options.resolveMovement;
    } else if (options.collisionEngine) {
      const engine = options.collisionEngine;
      this.resolveMovementFn = (x, y, dx, dy, speed, dt, hw, hh) =>
        engine.resolveMovement(x, y, dx, dy, speed, dt, hw, hh);
    } else {
      throw new Error('PredictionController requires either collisionEngine or resolveMovement');
    }

    this.simX = options.initialX ?? 0;
    this.simY = options.initialY ?? 0;
    this.playerHalfSize = options.playerHalfSize ?? 14;
    this.baseSpeed = options.baseSpeed ?? 240;
    this.sprintSpeed = options.sprintSpeed ?? 480;
    this.errorDecayRate = options.errorDecayRate ?? 15;
  }

  public get renderX(): number {
    return this.simX + this.visualErrorX;
  }

  public get renderY(): number {
    return this.simY + this.visualErrorY;
  }

  public getPendingInputCount(): number {
    return this.pendingInputs.length;
  }

  public setCollisionEngine(engine: CollisionEngine): void {
    this.resolveMovementFn = (x, y, dx, dy, speed, dt, hw, hh) =>
      engine.resolveMovement(x, y, dx, dy, speed, dt, hw, hh);
  }

  public resetPosition(x: number, y: number): void {
    this.simX = x;
    this.simY = y;
    this.visualErrorX = 0;
    this.visualErrorY = 0;
    this.pendingInputs = [];
  }

  /**
   * Normalizes diagonal (dx, dy), assigns an incrementing sequence number when moving,
   * applies optimistic movement, and exponentially decays any active visual error.
   */
  public stepInput(
    dx: number,
    dy: number,
    sprint: boolean,
    dtSeconds: number
  ): PredictionStepResult {
    this.decayVisualError(dtSeconds);

    if (dx === 0 && dy === 0) {
      return {
        seq: this.nextSeq,
        simX: this.simX,
        simY: this.simY,
        renderX: this.renderX,
        renderY: this.renderY,
        xBlocked: false,
        yBlocked: false,
      };
    }

    let normDx = dx;
    let normDy = dy;
    if (normDx !== 0 && normDy !== 0) {
      const invLen = 1 / Math.hypot(normDx, normDy);
      normDx *= invLen;
      normDy *= invLen;
    }

    const seq = ++this.nextSeq;
    const input: PendingInput = {
      seq,
      dx: normDx,
      dy: normDy,
      sprint,
      dtSeconds,
    };
    this.pendingInputs.push(input);

    const speed = sprint ? this.sprintSpeed : this.baseSpeed;
    const resolution = this.resolveMovementFn(
      this.simX,
      this.simY,
      normDx,
      normDy,
      speed,
      dtSeconds,
      this.playerHalfSize,
      this.playerHalfSize
    );

    this.simX = resolution.newX;
    this.simY = resolution.newY;

    return {
      seq,
      simX: this.simX,
      simY: this.simY,
      renderX: this.renderX,
      renderY: this.renderY,
      xBlocked: resolution.xBlocked,
      yBlocked: resolution.yBlocked,
      collider: resolution.collider,
    };
  }

  /**
   * Reconciles local predicted state against an authoritative server state ack.
   * Drops acked inputs, replays unacked inputs, and applies deadband / smooth / hard-snap correction.
   */
  public reconcile(ack: StateAck): ReconcileResult {
    this.pendingInputs = this.pendingInputs.filter(
      (input) => input.seq > ack.lastProcessedSeq
    );

    let replayedX = ack.posX;
    let replayedY = ack.posY;

    for (const input of this.pendingInputs) {
      const speed = input.sprint ? this.sprintSpeed : this.baseSpeed;
      const res = this.resolveMovementFn(
        replayedX,
        replayedY,
        input.dx,
        input.dy,
        speed,
        input.dtSeconds,
        this.playerHalfSize,
        this.playerHalfSize
      );
      replayedX = res.newX;
      replayedY = res.newY;
    }

    const error = Math.hypot(this.simX - replayedX, this.simY - replayedY);

    if (error <= EPSILON_IGNORE_PX) {
      return {
        mode: 'none',
        error,
        simX: this.simX,
        simY: this.simY,
      };
    }

    if (error > HARD_SNAP_THRESHOLD_PX) {
      this.simX = replayedX;
      this.simY = replayedY;
      this.visualErrorX = 0;
      this.visualErrorY = 0;
      return {
        mode: 'snap',
        error,
        simX: this.simX,
        simY: this.simY,
      };
    }

    const oldRenderX = this.renderX;
    const oldRenderY = this.renderY;
    this.simX = replayedX;
    this.simY = replayedY;
    this.visualErrorX = oldRenderX - replayedX;
    this.visualErrorY = oldRenderY - replayedY;

    return {
      mode: 'smooth',
      error,
      simX: this.simX,
      simY: this.simY,
    };
  }

  private decayVisualError(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    if (this.visualErrorX === 0 && this.visualErrorY === 0) return;

    const factor = Math.exp(-this.errorDecayRate * dtSeconds);
    this.visualErrorX *= factor;
    this.visualErrorY *= factor;

    if (Math.abs(this.visualErrorX) < VISUAL_ERROR_SNAP_ZERO) {
      this.visualErrorX = 0;
    }
    if (Math.abs(this.visualErrorY) < VISUAL_ERROR_SNAP_ZERO) {
      this.visualErrorY = 0;
    }
  }
}
