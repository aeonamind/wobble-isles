// The round library (DESIGN.md §4–5). Each round is a definition plus a level builder.
// Builders are pure functions of (seed, player count) so server and clients build identical levels.

import { hazardPose, type HazardDef } from "./hazards";
import type { Island, LevelDef, SolidDef, Surface, Zone } from "./level";
import { rng, type Vec3 } from "./math";

export type Category = "race" | "survival" | "hunt" | "team" | "final";

export interface RoundDef {
  id: string;
  name: string;
  category: Category;
  island: Island;
  /** One sentence shown on the intro card. */
  blurb: string;
  players: { min: number; max: number };
  /** Hard time limit (s). */
  duration: number;
  build(seed: number, players: number): LevelDef;
}

// ───────────────────────── Builders ─────────────────────────

/** A box given by its TOP surface height (easier to lay out walkable levels). */
function box(x: number, top: number, z: number, sx: number, sz: number, extra: Partial<SolidDef> = {}, sy = 1): SolidDef {
  return { pos: { x, y: top - sy / 2, z }, size: { x: sx, y: sy, z: sz }, ...extra };
}

/** A ramp from (z0, y0) to (z1, y1) along +Z, `width` wide. Top surface passes through both ends. */
function ramp(x: number, z0: number, y0: number, z1: number, y1: number, width: number, surface?: Surface): SolidDef {
  const dz = z1 - z0;
  const dy = y1 - y0;
  const len = Math.hypot(dz, dy);
  const tilt = Math.atan2(-dy, dz); // positive tilt lowers the +Z end
  const t = 0.6;
  // Centre sits half a thickness below the midpoint of the top surface, along the surface normal.
  const nx = Math.sin(tilt); // normal of the tilted top, in (z, y)
  const ny = Math.cos(tilt);
  return {
    pos: { x, y: (y0 + y1) / 2 - (t / 2) * ny, z: (z0 + z1) / 2 - (t / 2) * nx },
    size: { x: width, y: t, z: len },
    tilt,
    surface,
  };
}

const cp = (x: number, y: number, z: number): Vec3 => ({ x, y: y + 1, z });

/** Start grid: rows of `perRow` spaced 1.6 m, centred on x, starting at z, top surface y. */
function grid(cx: number, y: number, z: number, count: number, perRow = 6): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    out.push({ x: cx + (col - (perRow - 1) / 2) * 1.6, y: y + 1, z: z - row * 1.6 });
  }
  return out;
}

const zone = (x: number, y: number, z: number, sx: number, sy: number, sz: number): Zone => ({ pos: { x, y, z }, size: { x: sx, y: sy, z: sz } });

// ───────────────────────── Frostbite Run (race, frost) ─────────────────────────

function frostbiteRun(seed: number): LevelDef {
  const r = rng(seed);
  const solids: SolidDef[] = [];
  const hazards: HazardDef[] = [];
  // Start plaza
  solids.push(box(0, 0, 4, 16, 12, { respawn: cp(0, 0, 4) }));
  // Icy downhill
  solids.push(ramp(0, 10, 0, 30, -4, 12, "ice"));
  // Checkpoint 1
  solids.push(box(0, -4, 34, 14, 8, { respawn: cp(0, -4, 34) }));
  // Sliding ice blocks on an ice field
  solids.push(box(0, -4, 48, 14, 20, { surface: "ice" }));
  for (let i = 0; i < 4; i++) {
    hazards.push({ kind: "slider", pos: { x: 0, y: -3.2, z: 41 + i * 4.5 }, half: { x: 1.3, y: 0.8, z: 1 }, axis: "x", amplitude: 5, period: 2.6 + r() * 1.4, phase: r() });
  }
  // Checkpoint 2
  solids.push(box(0, -4, 61, 16, 6, { respawn: cp(0, -4, 61) }));
  // Split: narrow ice bridge (fast, risky) or a winding snow path (sticky, safe)
  solids.push(box(-4.5, -4, 74, 1.8, 20, { surface: "ice" }));
  solids.push(box(4.5, -4, 68, 5, 8, { surface: "sticky" }));
  solids.push(box(7.5, -4, 74, 5, 6, { surface: "sticky" }));
  solids.push(box(4.5, -4, 80, 5, 8, { surface: "sticky" }));
  // Checkpoint 3
  solids.push(box(0, -4, 88, 16, 8, { respawn: cp(0, -4, 88) }));
  // Snowball gauntlet: snowballs roll across the path
  solids.push(box(0, -4, 104, 14, 24));
  for (let i = 0; i < 4; i++) {
    const z = 96 + i * 5.5;
    const fromLeft = i % 2 === 0;
    hazards.push({
      kind: "roller",
      from: { x: fromLeft ? -11 : 11, y: -3.1, z },
      to: { x: fromLeft ? 11 : -11, y: -3.1, z },
      radius: 0.9,
      speed: 6 + r() * 2,
      period: 3.2 + r() * 1.2,
      phase: r(),
    });
  }
  // Finish
  solids.push(box(0, -4, 122, 16, 12));
  return {
    id: "frostbite-run",
    name: "Frostbite Run",
    island: "frost",
    spawn: cp(0, 0, 4),
    spawns: grid(0, 0, 7, 32),
    solids,
    hazards,
    balls: [],
    dummies: [],
    killY: -18,
    finish: zone(0, -2.5, 124, 16, 4, 4),
    objective: "Reach the finish!",
  };
}

// ───────────────────────── Gearworks Dash (race, toy) ─────────────────────────

function gearworksDash(seed: number): LevelDef {
  const r = rng(seed);
  const solids: SolidDef[] = [];
  const hazards: HazardDef[] = [];
  solids.push(box(0, 0, 4, 16, 12, { respawn: cp(0, 0, 4) }));
  // Conveyor hall: lanes alternate direction
  for (let i = 0; i < 4; i++) {
    const x = -5.25 + i * 3.5;
    solids.push(box(x, 0, 20, 3.5, 20, { surface: "conveyor", belt: { x: 0, z: i % 2 === 0 ? -3.2 : 2.6 } }));
  }
  solids.push(box(0, 0, 33, 14, 6, { respawn: cp(0, 0, 33) }));
  // Press corridor (three presses on offset rhythms)
  solids.push(box(0, 0, 45, 7, 18));
  [39, 45, 51].forEach((z, i) => hazards.push({ kind: "press", pos: { x: 0, y: 3.2, z }, half: { x: 3.4, y: 1, z: 1.4 }, stroke: 2.15, period: 2.2, phase: i * 0.3 + r() * 0.05 }));
  solids.push(box(0, 0, 57, 14, 6, { respawn: cp(0, 0, 57) }));
  // Robot-arm sweepers
  solids.push(box(0, 0, 71, 18, 22));
  hazards.push({ kind: "sweeper", pos: { x: 0, y: 0, z: 66 }, armLength: 17, height: 0.55, speed: 1.5 });
  hazards.push({ kind: "sweeper", pos: { x: 0, y: 0, z: 76 }, armLength: 17, height: 1.5, speed: -1.1, phase: Math.PI / 2 });
  solids.push(box(0, 0, 85, 14, 6, { respawn: cp(0, 0, 85) }));
  // Bouncer hops over the void to the raised finish
  [91, 96.5].forEach((z, i) => solids.push(box(i % 2 === 0 ? -2 : 2, 0.2, z, 3, 3, { surface: "bouncer" })));
  hazards.push({ kind: "hammer", pivot: { x: 0, y: 7, z: 93.7 }, length: 5, axis: "z", amplitude: 1.2, period: 2.4, head: { x: 0.8, y: 0.6, z: 0.6 } });
  solids.push(box(0, 2, 106, 14, 12));
  return {
    id: "gearworks-dash",
    name: "Gearworks Dash",
    island: "toy",
    spawn: cp(0, 0, 4),
    spawns: grid(0, 0, 7, 32),
    solids,
    hazards,
    balls: [],
    dummies: [],
    killY: -14,
    finish: zone(0, 3.5, 106, 14, 4, 6),
    objective: "Reach the finish!",
  };
}

// ───────────────────────── Ice Floes (survival, frost) ─────────────────────────

const ICE_FLOES_DURATION = 80;

function iceFloes(seed: number, players: number): LevelDef {
  const r = rng(seed);
  // The sweeper bar holds still until GO, so nobody may start on its line.
  // A Y rotation by phase points the bar along angle -phase (and -phase + pi).
  const sweeperPhase = r() * Math.PI;
  const onSweeperLine = (p: Vec3) => {
    const d = Math.abs((((Math.atan2(p.z, p.x) + sweeperPhase) % Math.PI) + Math.PI) % Math.PI);
    return Math.min(d, Math.PI - d) < 0.45;
  };
  const hazards: HazardDef[] = [];
  const spawns: Vec3[] = [];
  const rings = [
    { radius: 0, count: 1 },
    { radius: 5.5, count: 6 },
    { radius: 11, count: 10 },
    { radius: 16, count: 12 },
  ];
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.count; i++) {
      const a = (i / ring.count) * Math.PI * 2 + r() * 0.3;
      const size = ri === 0 ? 2.6 : 1.5 + r() * 0.7;
      // Outer floes sink first; the centre lasts the longest (but not forever).
      const sinkAt = ri === 0 ? 70 + r() * 6 : 12 + (3 - ri) * 16 + r() * 18;
      const anchor = { x: Math.cos(a) * ring.radius, y: -0.25, z: Math.sin(a) * ring.radius };
      const floe: HazardDef = { kind: "floe", anchor, half: { x: size, y: 0.25, z: size }, orbit: ri === 0 ? 0 : 0.6 + r() * 0.8, speed: (r() - 0.5) * 0.25, phase: r() * 6, sinkAt };
      hazards.push(floe);
      // Start on the floe where it sits when the round begins (hazards hold still until then).
      const at = hazardPose(floe, 0).pos;
      if ((ri === 2 || (ri === 1 && players > 8)) && !onSweeperLine(at)) spawns.push({ x: at.x, y: 1.2, z: at.z });
    }
  });
  // A slow, low sweeper in the middle keeps everyone moving.
  hazards.push({ kind: "sweeper", pos: { x: 0, y: 0, z: 0 }, armLength: 26, height: 0.7, speed: 0.45, phase: sweeperPhase, delay: 4 });
  return {
    id: "ice-floes",
    name: "Ice Floes",
    island: "frost",
    spawn: spawns[0],
    spawns,
    solids: [],
    hazards,
    balls: [],
    dummies: [],
    killY: -4,
    water: -0.6,
    failRule: "out",
    objective: "Stay on the ice!",
  };
}

// ───────────────────────── Crown Grab (hunt, candy) ─────────────────────────

function crownGrab(): LevelDef {
  const solids: SolidDef[] = [box(0, 0, 0, 26, 26, { respawn: cp(0, 0, 0) })];
  // Pillars to juke around
  for (const [x, z] of [
    [-6, -6],
    [6, -6],
    [-6, 6],
    [6, 6],
  ])
    solids.push(box(x, 2.5, z, 2, 2, { color: 0xffd6e8 }, 2.5));
  // Bouncers in the corners, caramel patches on the sides
  for (const [x, z] of [
    [-10.5, -10.5],
    [10.5, -10.5],
    [-10.5, 10.5],
    [10.5, 10.5],
  ])
    solids.push(box(x, 0.2, z, 3, 3, { surface: "bouncer" }));
  for (const [x, z] of [
    [0, -10.5],
    [0, 10.5],
    [-10.5, 0],
    [10.5, 0],
  ])
    solids.push(box(x, 0.05, z, x === 0 ? 6 : 3, x === 0 ? 3 : 6, { surface: "sticky" }, 0.2));
  // Crown pedestal
  solids.push(box(0, 0.4, 0, 2, 2, { color: 0xffe156 }, 0.4));
  const spawns: Vec3[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / Math.min(32, 12)) * Math.PI * 2;
    const ring = 9 + Math.floor(i / 12) * 1.6;
    spawns.push({ x: Math.cos(a) * ring, y: 1, z: Math.sin(a) * ring });
  }
  return {
    id: "crown-grab",
    name: "Crown Grab",
    island: "candy",
    spawn: { x: 0, y: 1, z: 8 },
    spawns,
    solids,
    hazards: [],
    balls: [],
    dummies: [],
    killY: -12,
    crown: { x: 0, y: 1.1, z: 0 },
    objective: "Hold the crown!",
  };
}

// ───────────────────────── Gumball Goal (team, candy) ─────────────────────────

function gumballGoal(): LevelDef {
  const W = 24;
  const L = 36;
  const G = 4; // goal depth
  const solids: SolidDef[] = [box(0, 0, 0, W, L, { respawn: cp(0, 0, 0) })];
  const wall = { color: 0xffffff };
  // Side walls
  solids.push(box(-W / 2 - 0.4, 1.4, 0, 0.8, L, wall, 1.4));
  solids.push(box(W / 2 + 0.4, 1.4, 0, 0.8, L, wall, 1.4));
  for (const s of [-1, 1]) {
    // End walls either side of an 8 m goal mouth
    solids.push(box(-8.2, 1.4, s * (L / 2 + 0.4), 7.6, 0.8, wall, 1.4));
    solids.push(box(8.2, 1.4, s * (L / 2 + 0.4), 7.6, 0.8, wall, 1.4));
    // Goal box: floor, sides and back
    solids.push(box(0, 0, s * (L / 2 + G / 2), 8, G, { color: s < 0 ? 0xff9aa8 : 0x9ae6f0 }));
    solids.push(box(-4.4, 1.4, s * (L / 2 + G / 2), 0.8, G + 0.8, wall, 1.4));
    solids.push(box(4.4, 1.4, s * (L / 2 + G / 2), 0.8, G + 0.8, wall, 1.4));
    solids.push(box(0, 1.4, s * (L / 2 + G + 0.4), 9.6, 0.8, wall, 1.4));
  }
  const spawns: Vec3[] = [];
  for (let i = 0; i < 32; i++) {
    const team = i % 2;
    const k = Math.floor(i / 2);
    spawns.push({ x: ((k % 6) - 2.5) * 2.4, y: 1, z: (team === 0 ? -1 : 1) * (8 + Math.floor(k / 6) * 1.8) });
  }
  return {
    id: "gumball-goal",
    name: "Gumball Goal",
    island: "candy",
    spawn: spawns[0],
    spawns, // index parity = team
    solids,
    hazards: [],
    balls: [{ pos: { x: 0, y: 2.2, z: 0 }, radius: 1.5, bouncy: true }],
    dummies: [],
    killY: -12,
    goals: [
      { team: 0, zone: zone(0, 1.5, -(L / 2 + G / 2 + 0.3), 8, 3.4, G - 0.6) },
      { team: 1, zone: zone(0, 1.5, L / 2 + G / 2 + 0.3, 8, 3.4, G - 0.6) },
    ],
    objective: "Push the gumball into their goal!",
  };
}

// ───────────────────────── Summit Scramble (final, frost) ─────────────────────────

/** Snowball lanes down the ramps; Gremlins trigger extra one-shot ones. */
export const SUMMIT_LANES = [
  { from: { x: -2.5, y: 5.9, z: 26 }, to: { x: -2.5, y: 0.9, z: 10 } },
  { from: { x: 2.5, y: 5.9, z: 26 }, to: { x: 2.5, y: 0.9, z: 10 } },
  { from: { x: -1.5, y: 10.9, z: 46 }, to: { x: -1.5, y: 5.9, z: 30 } },
  { from: { x: 1.5, y: 10.9, z: 46 }, to: { x: 1.5, y: 5.9, z: 30 } },
  { from: { x: 0, y: 14.9, z: 74 }, to: { x: 0, y: 10.9, z: 62 } },
];

function summitScramble(seed: number): LevelDef {
  const r = rng(seed);
  const solids: SolidDef[] = [
    box(0, 0, 4, 14, 12, { respawn: cp(0, 0, 4) }),
    ramp(0, 10, 0, 26, 5, 9),
    box(0, 5, 29, 12, 6, { respawn: cp(0, 5, 29) }),
    ramp(0, 32, 5, 46, 10, 7),
    box(0, 10, 49, 10, 6, { respawn: cp(0, 10, 49) }),
    box(0, 10, 58, 2.6, 12, { surface: "ice" }),
    ramp(0, 64, 10, 74, 14, 6),
    box(0, 14, 78, 10, 8),
    box(0, 14.5, 79, 2, 2, { color: 0xffe156 }, 0.5),
  ];
  const hazards: HazardDef[] = SUMMIT_LANES.map((lane) => ({
    kind: "roller",
    from: lane.from,
    to: lane.to,
    radius: 0.9,
    speed: 7,
    period: 3.4 + r() * 1.6,
    phase: r(),
  }));
  return {
    id: "summit-scramble",
    name: "Summit Scramble",
    island: "frost",
    spawn: cp(0, 0, 4),
    spawns: grid(0, 0, 5, 8, 4),
    solids,
    hazards,
    balls: [],
    dummies: [],
    killY: -14,
    summit: zone(0, 15.6, 79, 2.6, 2.4, 2.6),
    crown: { x: 0, y: 15.7, z: 79 },
    objective: "First to the summit crown wins the show!",
  };
}

// ───────────────────────── Library ─────────────────────────

export const ROUNDS: RoundDef[] = [
  {
    id: "frostbite-run",
    name: "Frostbite Run",
    category: "race",
    island: "frost",
    blurb: "Slide down the icy course and reach the finish first.",
    players: { min: 1, max: 32 },
    duration: 110,
    build: (seed) => frostbiteRun(seed),
  },
  {
    id: "gearworks-dash",
    name: "Gearworks Dash",
    category: "race",
    island: "toy",
    blurb: "Beat the belts, presses and robot arms to the finish.",
    players: { min: 1, max: 32 },
    duration: 100,
    build: (seed) => gearworksDash(seed),
  },
  {
    id: "ice-floes",
    name: "Ice Floes",
    category: "survival",
    island: "frost",
    blurb: "The floes are melting. Fall in and you're out!",
    players: { min: 1, max: 32 },
    duration: ICE_FLOES_DURATION,
    build: (seed, n) => iceFloes(seed, n),
  },
  {
    id: "crown-grab",
    name: "Crown Grab",
    category: "hunt",
    island: "candy",
    blurb: "Grab the crown and hold it as long as you can.",
    players: { min: 2, max: 32 },
    duration: 75,
    build: () => crownGrab(),
  },
  {
    id: "gumball-goal",
    name: "Gumball Goal",
    category: "team",
    island: "candy",
    blurb: "Teams: push the giant gumball into the other goal.",
    players: { min: 4, max: 32 },
    duration: 100,
    build: () => gumballGoal(),
  },
  {
    id: "summit-scramble",
    name: "Summit Scramble",
    category: "final",
    island: "frost",
    blurb: "First to touch the crown on the summit wins the show!",
    players: { min: 1, max: 8 },
    duration: 120,
    build: (seed) => summitScramble(seed),
  },
];

export const roundById = (id: string) => ROUNDS.find((r) => r.id === id);
