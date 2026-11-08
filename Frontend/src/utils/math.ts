// Pure math functions for distance checks, lerping, and interpolation

export const EPSILON = 1e-6;
export const PI = Math.PI;
export const TWO_PI = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

// Vector2 operations
export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function vec2Zero(): Vec2 {
  return { x: 0, y: 0 };
}

export function vec2One(): Vec2 {
  return { x: 1, y: 1 };
}

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vec2Mul(a: Vec2, scalar: number): Vec2 {
  return { x: a.x * scalar, y: a.y * scalar };
}

export function vec2Div(a: Vec2, scalar: number): Vec2 {
  const inv = 1 / scalar;
  return { x: a.x * inv, y: a.y * inv };
}

export function vec2Length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function vec2LengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function vec2Normalize(v: Vec2): Vec2 {
  const len = vec2Length(v);
  if (len < EPSILON) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function vec2Distance(a: Vec2, b: Vec2): number {
  return vec2Length(vec2Sub(a, b));
}

export function vec2DistanceSq(a: Vec2, b: Vec2): number {
  return vec2LengthSq(vec2Sub(a, b));
}

export function vec2Dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function vec2Lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function vec2Clamp(v: Vec2, min: number, max: number): Vec2 {
  return {
    x: Math.max(min, Math.min(max, v.x)),
    y: Math.max(min, Math.min(max, v.y)),
  };
}

export function vec2Angle(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function vec2FromAngle(angle: number): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function vec2Rotate(v: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos,
  };
}

// Vector3 operations
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function vec3Zero(): Vec3 {
  return { x: 0, y: 0, z: 0 };
}

export function vec3One(): Vec3 {
  return { x: 1, y: 1, z: 1 };
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Mul(a: Vec3, scalar: number): Vec3 {
  return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar };
}

export function vec3Div(a: Vec3, scalar: number): Vec3 {
  const inv = 1 / scalar;
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vec3LengthSq(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  return vec3Length(vec3Sub(a, b));
}

export function vec3DistanceSq(a: Vec3, b: Vec3): number {
  return vec3LengthSq(vec3Sub(a, b));
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function vec3Slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  // Spherical linear interpolation for unit vectors
  const dot = Math.max(-1, Math.min(1, vec3Dot(vec3Normalize(a), vec3Normalize(b))));
  const theta = Math.acos(dot) * t;
  const relative = vec3Normalize(vec3Sub(b, vec3Mul(a, dot)));
  return vec3Add(vec3Mul(a, Math.cos(theta)), vec3Mul(relative, Math.sin(theta)));
}

// Linear interpolation
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return (value - a) / (b - a);
}

export function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function smootherStep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Clamping
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Angle utilities
export function normalizeAngle(angle: number): number {
  let result = angle % TWO_PI;
  if (result < 0) result += TWO_PI;
  return result;
}

export function angleDifference(a: number, b: number): number {
  const diff = normalizeAngle(b - a);
  return diff > PI ? diff - TWO_PI : diff;
}

export function lerpAngle(a: number, b: number, t: number): number {
  const diff = angleDifference(a, b);
  return normalizeAngle(a + diff * t);
}

// Distance checks
export function circleIntersects(
  c1: Vec2,
  r1: number,
  c2: Vec2,
  r2: number
): boolean {
  return vec2DistanceSq(c1, c2) <= (r1 + r2) ** 2;
}

export function pointInCircle(point: Vec2, center: Vec2, radius: number): boolean {
  return vec2DistanceSq(point, center) <= radius * radius;
}

export function pointInRect(point: Vec2, min: Vec2, max: Vec2): boolean {
  return point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y;
}

export function rectIntersects(
  minA: Vec2,
  maxA: Vec2,
  minB: Vec2,
  maxB: Vec2
): boolean {
  return (
    minA.x <= maxB.x &&
    maxA.x >= minB.x &&
    minA.y <= maxB.y &&
    maxA.y >= minB.y
  );
}

// Raycasting
export interface Ray2D {
  origin: Vec2;
  direction: Vec2;
}

export interface RaycastHit2D {
  hit: boolean;
  point: Vec2;
  normal: Vec2;
  distance: number;
}

export function raycastCircle(
  ray: Ray2D,
  center: Vec2,
  radius: number
): RaycastHit2D {
  const oc = vec2Sub(ray.origin, center);
  const a = vec2Dot(ray.direction, ray.direction);
  const b = 2 * vec2Dot(oc, ray.direction);
  const c = vec2Dot(oc, oc) - radius * radius;
  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) {
    return { hit: false, point: vec2Zero(), normal: vec2Zero(), distance: 0 };
  }

  const sqrtD = Math.sqrt(discriminant);
  const t1 = (-b - sqrtD) / (2 * a);
  const t2 = (-b + sqrtD) / (2 * a);

  let t = t1 >= 0 ? t1 : t2 >= 0 ? t2 : -1;

  if (t < 0) {
    return { hit: false, point: vec2Zero(), normal: vec2Zero(), distance: 0 };
  }

  const point = vec2Add(ray.origin, vec2Mul(ray.direction, t));
  const normal = vec2Normalize(vec2Sub(point, center));

  return { hit: true, point, normal, distance: t };
}

// Easing functions
export const Easing = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => --t * t * t + 1,
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeInQuart: (t: number) => t * t * t * t,
  easeOutQuart: (t: number) => 1 - --t * t * t * t,
  easeInOutQuart: (t: number) =>
    t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t,
  easeInQuint: (t: number) => t * t * t * t * t,
  easeOutQuint: (t: number) => 1 + --t * t * t * t * t,
  easeInOutQuint: (t: number) =>
    t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * --t * t * t * t * t,
  easeInSine: (t: number) => 1 - Math.cos((t * PI) / 2),
  easeOutSine: (t: number) => Math.sin((t * PI) / 2),
  easeInOutSine: (t: number) => -(Math.cos(PI * t) - 1) / 2,
  easeInExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t: number) =>
    t === 0
      ? 0
      : t === 1
      ? 1
      : t < 0.5
      ? Math.pow(2, 20 * t - 10) / 2
      : (2 - Math.pow(2, -20 * t + 10)) / 2,
  easeInCirc: (t: number) => 1 - Math.sqrt(1 - t * t),
  easeOutCirc: (t: number) => Math.sqrt(1 - --t * t),
  easeInOutCirc: (t: number) =>
    t < 0.5
      ? (1 - Math.sqrt(1 - 4 * t * t)) / 2
      : (Math.sqrt(1 - 4 * --t * t) + 1) / 2,
  easeInBack: (t: number) => t * t * (2.70158 * t - 1.70158),
  easeOutBack: (t: number) => 1 + --t * t * (2.70158 * t + 1.70158),
  easeInOutBack: (t: number) => {
    const s = 1.70158 * 1.525;
    return t < 0.5
      ? (t * t * ((s + 1) * 2 * t - s)) / 2
      : 0.5 * ((t - 2) * (t - 2) * ((s + 1) * (t - 2) + s) + 2);
  },
  easeInElastic: (t: number) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * PI);
  },
  easeOutElastic: (t: number) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * PI) + 1;
  },
  easeInOutElastic: (t: number) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    t *= 2;
    if (t < 1)
      return -0.5 * Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * PI);
    return 0.5 * Math.pow(2, -10 * (t - 1)) * Math.sin((t - 1.1) * 5 * PI) + 1;
  },
  easeInBounce: (t: number) => 1 - Easing.easeOutBounce(1 - t),
  easeOutBounce: (t: number) => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  },
  easeInOutBounce: (t: number) =>
    t < 0.5
      ? Easing.easeInBounce(t * 2) / 2
      : Easing.easeOutBounce(t * 2 - 1) / 2 + 0.5,
};

// Random utilities
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function randomVec2(min: number, max: number): Vec2 {
  return { x: randomRange(min, max), y: randomRange(min, max) };
}

export function randomVec3(min: number, max: number): Vec3 {
  return {
    x: randomRange(min, max),
    y: randomRange(min, max),
    z: randomRange(min, max),
  };
}

export function randomUnitVec2(): Vec2 {
  const angle = Math.random() * TWO_PI;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function randomUnitVec3(): Vec3 {
  const u = Math.random();
  const v = Math.random();
  const theta = TWO_PI * u;
  const phi = Math.acos(2 * v - 1);
  const sinPhi = Math.sin(phi);
  return {
    x: sinPhi * Math.cos(theta),
    y: sinPhi * Math.sin(theta),
    z: Math.cos(phi),
  };
}