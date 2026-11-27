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
    };

export interface HazardPose {
  pos: Vec3;
  rot: Quat;
}

/** A collision shape in the hazard's local frame. */
export interface HazardShape {
  half: Vec3; // cuboid half-extents
  offset: Vec3;
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
      return [{ half: h.half, offset: { x: 0, y: 0, z: 0 } }];
  }
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
      return { pos: h.pos, rot: quatFromAxisAngle(0, 1, 0, (h.phase ?? 0) + h.speed * t) };
    case "hammer": {
      const angle = h.amplitude * Math.sin(((t / h.period + (h.phase ?? 0)) * Math.PI * 2));
      const rot = h.axis === "x" ? quatFromAxisAngle(1, 0, 0, angle) : quatFromAxisAngle(0, 0, 1, angle);
      return { pos: h.pivot, rot };
    }
    case "press": {
      const ext = pressExtension(t / h.period + (h.phase ?? 0));
      return { pos: { x: h.pos.x, y: h.pos.y - h.stroke * ext, z: h.pos.z }, rot: quatIdentity() };
    }
  }
}
