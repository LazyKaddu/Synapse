export interface RemoteSnapshot {
  readonly serverTick: number;
  readonly timestampMs: number;
  readonly posX: number;
  readonly posY: number;
  readonly velX: number;
  readonly velY: number;
}

export interface InterpolatedSample {
  readonly posX: number;
  readonly posY: number;
  readonly velX: number;
  readonly velY: number;
  readonly mode: 'hold' | 'interpolate' | 'extrapolate';
}

export interface RemotePlayerInterpolatorOptions {
  readonly interpolationDelayMs?: number;
  readonly maxExtrapolationMs?: number;
  readonly maxBufferLength?: number;
}

/**
 * Pure TypeScript 10fps -> 60fps remote player state interpolator with bounded extrapolation.
 * No PixiJS or DOM dependencies.
 */
export class RemotePlayerInterpolator {
  public readonly interpolationDelayMs: number;
  public readonly maxExtrapolationMs: number;
  private readonly maxBufferLength: number;

  private readonly buffers = new Map<number, RemoteSnapshot[]>();

  constructor(options: RemotePlayerInterpolatorOptions = {}) {
    this.interpolationDelayMs = options.interpolationDelayMs ?? 110;
    this.maxExtrapolationMs = options.maxExtrapolationMs ?? 150;
    this.maxBufferLength = options.maxBufferLength ?? 32;
  }

  public pushSnapshot(playerId: number, snapshot: RemoteSnapshot): void {
    let buffer = this.buffers.get(playerId);
    if (!buffer) {
      buffer = [snapshot];
      this.buffers.set(playerId, buffer);
      return;
    }

    const existingIdx = buffer.findIndex(
      (s) => s.timestampMs === snapshot.timestampMs && s.serverTick === snapshot.serverTick
    );
    if (existingIdx !== -1) {
      buffer[existingIdx] = snapshot;
      return;
    }

    // Fast path: most snapshots arrive in chronological order
    const last = buffer[buffer.length - 1];
    if (!last || snapshot.timestampMs >= last.timestampMs) {
      buffer.push(snapshot);
    } else {
      buffer.push(snapshot);
      buffer.sort((a, b) => a.timestampMs - b.timestampMs || a.serverTick - b.serverTick);
    }

    if (buffer.length > this.maxBufferLength) {
      buffer.splice(0, buffer.length - this.maxBufferLength);
    }
  }

  public sample(playerId: number, nowMs: number): InterpolatedSample | null {
    const buffer = this.buffers.get(playerId);
    if (!buffer || buffer.length === 0) {
      return null;
    }

    const renderTime = nowMs - this.interpolationDelayMs;
    const first = buffer[0];

    if (renderTime <= first.timestampMs) {
      return {
        posX: first.posX,
        posY: first.posY,
        velX: first.velX,
        velY: first.velY,
        mode: 'hold',
      };
    }

    const latest = buffer[buffer.length - 1];
    if (renderTime >= latest.timestampMs) {
      const dtAheadMs = Math.min(renderTime - latest.timestampMs, this.maxExtrapolationMs);
      const dtAheadSec = dtAheadMs / 1000;
      return {
        posX: latest.posX + latest.velX * dtAheadSec,
        posY: latest.posY + latest.velY * dtAheadSec,
        velX: latest.velX,
        velY: latest.velY,
        mode: dtAheadMs > 0 ? 'extrapolate' : 'interpolate',
      };
    }

    // Find bracketing pair [s0, s1] such that s0.timestampMs <= renderTime <= s1.timestampMs
    for (let i = 0; i < buffer.length - 1; i++) {
      const s0 = buffer[i];
      const s1 = buffer[i + 1];
      if (renderTime >= s0.timestampMs && renderTime <= s1.timestampMs) {
        const span = s1.timestampMs - s0.timestampMs;
        const alpha = span > 0 ? (renderTime - s0.timestampMs) / span : 1;
        return {
          posX: s0.posX + (s1.posX - s0.posX) * alpha,
          posY: s0.posY + (s1.posY - s0.posY) * alpha,
          velX: s0.velX + (s1.velX - s0.velX) * alpha,
          velY: s0.velY + (s1.velY - s0.velY) * alpha,
          mode: 'interpolate',
        };
      }
    }

    return {
      posX: latest.posX,
      posY: latest.posY,
      velX: latest.velX,
      velY: latest.velY,
      mode: 'hold',
    };
  }

  public removePlayer(playerId: number): void {
    this.buffers.delete(playerId);
  }

  public getPlayerIds(): number[] {
    return Array.from(this.buffers.keys());
  }

  public clear(): void {
    this.buffers.clear();
  }
}
