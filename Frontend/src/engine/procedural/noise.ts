/**
 * 2D Seeded Deterministic Noise and Coordinate Hashing.
 * Supports infinite positive and negative integer coordinates (Z x Z).
 */

/**
 * 32-bit integer coordinate hash returning a deterministic float in [0, 1).
 * Uses two's complement integer multiplication (Math.imul) and unsigned shifts
 * to guarantee bitwise stability across negative, zero, and positive integers.
 */
export function hash2D(x: number, y: number, seed: number): number {
  // Convert inputs to 32-bit signed integers
  const ix = x | 0;
  const iy = y | 0;
  const iseed = seed | 0;

  // Murmur/xxHash style integer mixer constants
  let h = (iseed ^ Math.imul(ix, 0x165667b1) ^ Math.imul(iy, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x4f4d29a1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;

  // Normalize 32-bit unsigned integer to [0, 1)
  return h / 4294967296;
}

/**
 * 2D Value Noise with C2 quintic Hermite interpolation: 6t^5 - 15t^4 + 10t^3.
 * Guarantees zero derivative at grid boundaries, eliminating sharp seam lines.
 */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const iX = Math.floor(x);
  const iY = Math.floor(y);

  const fX = x - iX;
  const fY = y - iY;

  // Quintic fade curve (C2 continuous)
  const u = fX * fX * fX * (fX * (fX * 6 - 15) + 10);
  const v = fY * fY * fY * (fY * (fY * 6 - 15) + 10);

  // Hash corner samples
  const n00 = hash2D(iX, iY, seed);
  const n10 = hash2D(iX + 1, iY, seed);
  const n01 = hash2D(iX, iY + 1, seed);
  const n11 = hash2D(iX + 1, iY + 1, seed);

  // Bilinear blend with smoothed coordinates
  const nx0 = n00 * (1 - u) + n10 * u;
  const nx1 = n01 * (1 - u) + n11 * u;

  return nx0 * (1 - v) + nx1 * v;
}

/**
 * Multi-octave Fractal Brownian Motion (fBm) using 2D Value Noise.
 * Evaluates octave layers with increasing frequency and decreasing amplitude.
 * Returns a normalized value in [0, 1).
 */
export function fbm2D(
  x: number,
  y: number,
  seed: number,
  octaves = 3,
  lacunarity = 2.0,
  persistence = 0.5
): number {
  let total = 0;
  let frequency = 1.0;
  let amplitude = 1.0;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(x * frequency, y * frequency, seed + i * 1013) * amplitude;
    maxValue += amplitude;
    frequency *= lacunarity;
    amplitude *= persistence;
  }

  return maxValue > 0 ? total / maxValue : 0;
}

/**
 * Result structure returned by Voronoi 2D evaluation.
 */
export interface VoronoiResult {
  readonly d1: number;
  readonly d2: number;
  readonly cellId: number;
  readonly centerCol: number;
  readonly centerRow: number;
}

/**
 * 2D Cellular / Voronoi noise evaluated over 3x3 neighbor grid cells.
 * Uses 32-bit integer grid hashing (hash2D) to place deterministic feature points
 * within each cell and computes Euclidean distances to the 1st (d1) and 2nd (d2) nearest neighbors.
 * Guarantees d1 <= d2, cellId consistency across cell domain, and bitwise stability.
 */
export function voronoi2D(x: number, y: number, seed: number): VoronoiResult {
  const iX = Math.floor(x);
  const iY = Math.floor(y);

  let d1 = Infinity;
  let d2 = Infinity;
  let centerCol = 0;
  let centerRow = 0;

  const iseed = seed | 0;

  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const cx = iX + ox;
      const cy = iY + oy;

      // Deterministic feature point inside cell (cx, cy)
      const px = cx + hash2D(cx, cy, iseed);
      const py = cy + hash2D(cx, cy, (iseed ^ 0x9e3779b9) | 0);

      const dx = x - px;
      const dy = y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < d1) {
        d2 = d1;
        d1 = dist;
        centerCol = cx;
        centerRow = cy;
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }

  // Derive 32-bit unsigned cellId from closest cell's grid coordinates
  let h = (iseed ^ Math.imul(centerCol | 0, 0x165667b1) ^ Math.imul(centerRow | 0, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x4f4d29a1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;

  return {
    d1,
    d2,
    cellId: h,
    centerCol,
    centerRow,
  };
}
