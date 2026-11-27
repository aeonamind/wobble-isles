// Minimal vector helpers so the simulation does not depend on a rendering library.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lenXZ = (v: { x: number; z: number }) => Math.hypot(v.x, v.z);

/** Move (x, z) toward (tx, tz) by at most `maxDelta`. */
export function moveTowardXZ(v: Vec3, tx: number, tz: number, maxDelta: number) {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d === 0) {
    v.x = tx;
    v.z = tz;
  } else {
    v.x += (dx / d) * maxDelta;
    v.z += (dz / d) * maxDelta;
  }
}

/** Shortest signed angle from a to b (radians). */
export function angleDelta(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const quatFromAxisAngle = (ax: number, ay: number, az: number, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) };
};

export const quatIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = q * v * q^-1 (optimised form)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export const conj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** Small deterministic PRNG (mulberry32) for seeded behaviour. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
