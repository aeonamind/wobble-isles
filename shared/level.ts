// Level data. Rounds are data-driven (DESIGN.md §4): geometry, surfaces, hazards and spawns are plain
// objects so they can later come from files or a level editor.

import type { HazardDef } from "./hazards";
import type { Vec3 } from "./math";

export type Surface = "normal" | "ice" | "bouncer" | "conveyor" | "sticky";

export interface SolidDef {
  /** Centre of the box. */
  pos: Vec3;
  /** Full extents. */
  size: Vec3;
  /** Rotation around Y, then a tilt around the box's local X (both radians). */
  yaw?: number;
  tilt?: number;
  surface?: Surface;
  /** Conveyor belt velocity (m/s, world space). */
  belt?: { x: number; z: number };
  /** Landing here makes this the respawn point after falling out. */
  respawn?: Vec3;
  /** Purely visual hint for the renderer. */
  color?: number;
}

export type Island = "frost" | "candy" | "toy" | "splash" | "jungle" | "neon";

/** Axis-aligned box: centre + full extents. */
export interface Zone {
  pos: Vec3;
  size: Vec3;
}

export const inZone = (z: Zone, p: Vec3) =>
  Math.abs(p.x - z.pos.x) <= z.size.x / 2 && Math.abs(p.y - z.pos.y) <= z.size.y / 2 && Math.abs(p.z - z.pos.z) <= z.size.z / 2;

export interface LevelDef {
  id: string;
  name: string;
  island: Island;
  spawn: Vec3;
  solids: SolidDef[];
  hazards: HazardDef[];
  balls: { pos: Vec3; radius: number; bouncy?: boolean }[];
  dummies: { pos: Vec3; behaviour: "idle" | "pace" }[];
  killY: number;
  /** "respawn" (default): back to the last checkpoint. "out": falling eliminates you from the round. */
  failRule?: "respawn" | "out";
  /** Start positions, one per player (wraps if there are more players). */
  spawns?: Vec3[];
  /** Race: crossing this zone finishes. */
  finish?: Zone;
  /** Final: touching this zone wins. */
  summit?: Zone;
  /** Hunt: where the crown appears. */
  crown?: Vec3;
  /** Team: ball entering a team's zone scores for the other team. */
  goals?: { team: number; zone: Zone }[];
  /** Visual water surface height (survival on water). */
  water?: number;
  /** Small text shown during the round, e.g. "Reach the finish!". */
  objective?: string;
}

/** M1 feel sandbox: one hub with a zone per mechanic. */
export const SANDBOX: LevelDef = {
  id: "sandbox",
  name: "Feel Sandbox",
  island: "candy",
  spawn: { x: 0, y: 1, z: 0 },
  killY: -15,
  solids: [
    // Hub
    { pos: { x: 0, y: -0.5, z: 0 }, size: { x: 18, y: 1, z: 18 }, respawn: { x: 0, y: 1, z: 0 } },

    // North: ice rink with a ramp and a narrow ice bridge
    { pos: { x: 0, y: -0.5, z: -21 }, size: { x: 16, y: 1, z: 22 }, surface: "ice", respawn: { x: 0, y: 1, z: -11 } },
    { pos: { x: -4, y: 0.6, z: -24 }, size: { x: 5, y: 0.4, z: 8 }, surface: "ice", tilt: -0.28 },
    { pos: { x: 0, y: -0.5, z: -40 }, size: { x: 2.2, y: 1, z: 16 }, surface: "ice" },
    { pos: { x: 0, y: -0.5, z: -52 }, size: { x: 10, y: 1, z: 8 }, respawn: { x: 0, y: 1, z: -52 } },

    // East: bouncers up to a high ledge
    { pos: { x: 21, y: -0.5, z: 0 }, size: { x: 12, y: 1, z: 14 }, respawn: { x: 17, y: 1, z: 0 } },
    { pos: { x: 19, y: 0.2, z: 3 }, size: { x: 2.6, y: 0.4, z: 2.6 }, surface: "bouncer" },
    { pos: { x: 23, y: 0.2, z: -1 }, size: { x: 2.6, y: 0.4, z: 2.6 }, surface: "bouncer" },
    { pos: { x: 23, y: 4.5, z: -9 }, size: { x: 8, y: 1, z: 5 }, respawn: { x: 23, y: 6, z: -9 } },

    // West: opposing conveyor belts
    { pos: { x: -20, y: -0.5, z: -2.2 }, size: { x: 20, y: 1, z: 4 }, surface: "conveyor", belt: { x: -3.5, z: 0 } },
    { pos: { x: -20, y: -0.5, z: 2.2 }, size: { x: 20, y: 1, z: 4 }, surface: "conveyor", belt: { x: 3.5, z: 0 } },
    { pos: { x: -33, y: -0.5, z: 0 }, size: { x: 6, y: 1, z: 10 }, respawn: { x: -33, y: 1, z: 0 } },

    // South: sweeper arena → hammer bridge → press corridor
    { pos: { x: 0, y: -0.5, z: 22 }, size: { x: 18, y: 1, z: 18 }, respawn: { x: 0, y: 1, z: 14 } },
    { pos: { x: 0, y: -0.5, z: 39 }, size: { x: 3.2, y: 1, z: 16 } },
    { pos: { x: 0, y: -0.5, z: 51 }, size: { x: 8, y: 1, z: 8 }, respawn: { x: 0, y: 1, z: 51 } },
    { pos: { x: 0, y: -0.5, z: 64 }, size: { x: 4.4, y: 1, z: 18 }, surface: "sticky" },
    { pos: { x: 0, y: -0.5, z: 77 }, size: { x: 10, y: 1, z: 8 }, respawn: { x: 0, y: 1, z: 77 } },
  ],
  hazards: [
    { kind: "sweeper", pos: { x: 0, y: 0, z: 22 }, armLength: 15, height: 0.55, speed: 1.6 },
    { kind: "hammer", pivot: { x: 0, y: 6.2, z: 35 }, length: 5.2, axis: "z", amplitude: 1.1, period: 2.6, head: { x: 0.7, y: 0.7, z: 1.1 } },
    { kind: "hammer", pivot: { x: 0, y: 6.2, z: 42 }, length: 5.2, axis: "z", amplitude: 1.1, period: 2.6, phase: 0.5, head: { x: 0.7, y: 0.7, z: 1.1 } },
    { kind: "press", pos: { x: 0, y: 3.2, z: 59 }, half: { x: 2.2, y: 0.9, z: 1.4 }, stroke: 2.15, period: 2.4 },
    { kind: "press", pos: { x: 0, y: 3.2, z: 64 }, half: { x: 2.2, y: 0.9, z: 1.4 }, stroke: 2.15, period: 2.4, phase: 0.33 },
    { kind: "press", pos: { x: 0, y: 3.2, z: 69 }, half: { x: 2.2, y: 0.9, z: 1.4 }, stroke: 2.15, period: 2.4, phase: 0.66 },
  ],
  balls: [{ pos: { x: 5, y: 2, z: 4 }, radius: 1.3 }],
  dummies: [
    { pos: { x: -3, y: 1, z: -4 }, behaviour: "idle" },
    { pos: { x: 3, y: 1, z: -5 }, behaviour: "idle" },
    { pos: { x: 6, y: 1, z: -2 }, behaviour: "pace" },
    { pos: { x: -4, y: 1, z: 20 }, behaviour: "pace" },
    { pos: { x: 4, y: 1, z: 25 }, behaviour: "idle" },
  ],
};
