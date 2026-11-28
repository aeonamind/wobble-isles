// Scripted hazards are pure functions of (definition, time). Server and clients evaluate them
// locally, so they never need to be sent over the network and never stutter (DESIGN.md §3.5).

import { quatFromAxisAngle, quatIdentity, type Quat, type Vec3 } from "./math";

export type HazardDef =
  | {
      kind: "sweeper";
      /** Centre of the rotation on the floor. */
      pos: Vec3;
      armLength: number; // full bar length
      height: number; // bar centre height above `pos`
      speed: number; // rad/s (sign = direction)
      phase?: number;
      /** Seconds after the round starts before it begins to turn. */
      delay?: number;
    }
  | {
      kind: "hammer";
      /** Pivot point at the top of the arm. */
      pivot: Vec3;
      length: number; // pivot → head centre
      /** The hammer swings in the plane perpendicular to this horizontal axis. */
      axis: "x" | "z";
      amplitude: number; // radians
      period: number; // seconds per full swing (there and back)
      phase?: number; // 0..1 of a period
      head: Vec3; // head half-extents
    }
  | {
      kind: "press";
      /** Centre of the press block when fully up. */
      pos: Vec3;
      half: Vec3; // block half-extents
      stroke: number; // how far it travels down
      period: number;
      phase?: number; // 0..1 of a period
    }
  | {
      /** Block sliding back and forth along X (or Z). */
      kind: "slider";
      pos: Vec3; // centre of travel
      half: Vec3;
      axis: "x" | "z";
      amplitude: number; // metres either side
      period: number;
      phase?: number;
    }
  | {
      /** A floating platform (ice floe): drifts on a small circle, shakes, then sinks at `sinkAt`. Standing on it carries you. */
      kind: "floe";
      anchor: Vec3; // centre at the waterline (top surface height = anchor.y + half.y)
      half: Vec3;
      orbit: number; // drift radius
      speed: number; // drift rad/s
      phase?: number;
      sinkAt: number; // seconds into the round (Infinity = never)
    }
  | {
      /** A rolling snowball travelling from `from` to `to`, repeating every `period` (or once from `start`). */
      kind: "roller";
      from: Vec3;
      to: Vec3;
      radius: number;
      speed: number;
      period: number;
      phase?: number; // 0..1
      start?: number; // one-shot: seconds into the round
    };

/** Hazards you can stand on (carry you, never knock you back). */
export const isPlatform = (h: HazardDef) => h.kind === "floe";

export interface HazardPose {
  pos: Vec3;
  rot: Quat;
}

/** A collision shape in the hazard's local frame. */
export interface HazardShape {
  half: Vec3; // cuboid half-extents
  offset: Vec3;
  /** If set, the shape is a ball of this radius instead of a cuboid. */
  radius?: number;
}

export function hazardShapes(h: HazardDef): HazardShape[] {
  switch (h.kind) {
    case "sweeper":
      return [
        { half: { x: h.armLength / 2, y: 0.22, z: 0.22 }, offset: { x: 0, y: h.height, z: 0 } },
        { half: { x: 0.45, y: 0.5, z: 0.45 }, offset: { x: 0, y: 0.5, z: 0 } }, // hub
      ];
    case "hammer":
      return [
        { half: { x: 0.08, y: h.length / 2, z: 0.08 }, offset: { x: 0, y: -h.length / 2, z: 0 } },
        { half: h.head, offset: { x: 0, y: -h.length, z: 0 } },
      ];
    case "press":
    case "slider":
    case "floe":
      return [{ half: h.half, offset: { x: 0, y: 0, z: 0 } }];
    case "roller":
      return [{ half: { x: h.radius, y: h.radius, z: h.radius }, offset: { x: 0, y: 0, z: 0 }, radius: h.radius }];
  }
}

const PARKED = -80;

/** Floe sinking: 0 while floating, then sinks below the water. Shakes in the 2 s before. */
export function floeSink(h: { sinkAt: number }, t: number): { drop: number; shaking: boolean } {
  if (t < h.sinkAt - 2) return { drop: 0, shaking: false };
  if (t < h.sinkAt) return { drop: 0, shaking: true };
  const k = t - h.sinkAt;
  return { drop: Math.min(10, k * k * 2.5 + k * 0.6), shaking: false };
}

/** Roller travel parameter: distance travelled along the path, or null while parked. */
function rollerTravel(h: Extract<HazardDef, { kind: "roller" }>, t: number): number | null {
  const len = Math.hypot(h.to.x - h.from.x, h.to.y - h.from.y, h.to.z - h.from.z);
  const travel = len / h.speed;
  let u: number;
  if (h.start != null) u = t - h.start;
  else u = (((t + (h.phase ?? 0) * h.period) % h.period) + h.period) % h.period;
  if (u < 0 || u > travel) return null;
  return u * h.speed;
}

/**
 * Press cycle, as fractions of the period:
 * 0.00–0.40 resting up · 0.40–0.50 telegraph shake · 0.50–0.56 slam · 0.56–0.76 down · 0.76–1.00 rise.
 * Returns 0 (up) … 1 (down).
 */
export function pressExtension(cycle: number): number {
  const c = ((cycle % 1) + 1) % 1;
  if (c < 0.5) return 0;
  if (c < 0.56) {
    const k = (c - 0.5) / 0.06;
    return k * k; // accelerate into the slam
  }
  if (c < 0.76) return 1;
  const k = (c - 0.76) / 0.24;
  return 1 - k * k * (3 - 2 * k); // smoothstep back up
}

/** True while the press is shaking to warn players (render uses this). */
export const pressTelegraph = (cycle: number) => {
  const c = ((cycle % 1) + 1) % 1;
  return c >= 0.4 && c < 0.5;
};

export function hazardPose(h: HazardDef, t: number): HazardPose {
  switch (h.kind) {
    case "sweeper":
      return { pos: h.pos, rot: quatFromAxisAngle(0, 1, 0, (h.phase ?? 0) + h.speed * Math.max(0, t - (h.delay ?? 0))) };
    case "hammer": {
      const angle = h.amplitude * Math.sin(((t / h.period + (h.phase ?? 0)) * Math.PI * 2));
      const rot = h.axis === "x" ? quatFromAxisAngle(1, 0, 0, angle) : quatFromAxisAngle(0, 0, 1, angle);
      return { pos: h.pivot, rot };
    }
    case "press": {
      const ext = pressExtension(t / h.period + (h.phase ?? 0));
      return { pos: { x: h.pos.x, y: h.pos.y - h.stroke * ext, z: h.pos.z }, rot: quatIdentity() };
    }
    case "slider": {
      const d = h.amplitude * Math.sin((t / h.period + (h.phase ?? 0)) * Math.PI * 2);
      return { pos: { x: h.pos.x + (h.axis === "x" ? d : 0), y: h.pos.y, z: h.pos.z + (h.axis === "z" ? d : 0) }, rot: quatIdentity() };
    }
    case "floe": {
      const a = (h.phase ?? 0) + h.speed * t;
      const { drop, shaking } = floeSink(h, t);
      const shake = shaking ? Math.sin(t * 40) * 0.05 : 0;
      return {
        pos: { x: h.anchor.x + Math.cos(a) * h.orbit + shake, y: h.anchor.y - drop + Math.sin(t * 1.3 + (h.phase ?? 0)) * 0.04, z: h.anchor.z + Math.sin(a) * h.orbit },
        rot: quatFromAxisAngle(0, 1, 0, a * 0.25),
      };
    }
    case "roller": {
      const d = rollerTravel(h, t);
      if (d == null) return { pos: { x: h.from.x, y: PARKED, z: h.from.z }, rot: quatIdentity() };
      const len = Math.hypot(h.to.x - h.from.x, h.to.y - h.from.y, h.to.z - h.from.z) || 1;
      const k = d / len;
      const dx = (h.to.x - h.from.x) / len;
      const dz = (h.to.z - h.from.z) / len;
      // Roll around the horizontal axis perpendicular to travel.
      const hl = Math.hypot(dx, dz) || 1;
      const angle = d / h.radius;
      const s = Math.sin(angle / 2);
      return {
        pos: { x: h.from.x + (h.to.x - h.from.x) * k, y: h.from.y + (h.to.y - h.from.y) * k, z: h.from.z + (h.to.z - h.from.z) * k },
        rot: { x: (dz / hl) * s, y: 0, z: (-dx / hl) * s, w: Math.cos(angle / 2) },
      };
    }
  }
}
