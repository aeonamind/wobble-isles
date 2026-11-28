// Client ⇄ server messages. Wobbler state is packed into small integer arrays
// (centimetres, cm/s, milliradians) so a 32-player snapshot stays around 1 KB.

import type { NetMsg, NetState, SimEvent, Wobbler, WobblerState } from "./sim";
import type { Quat, Vec3 } from "./math";

export const ROOM_NAME = "party";
/**
 * Bump whenever client ⇄ server messages or the shared simulation change in a way old clients can't
 * follow. The desktop app can be older than the server; a client with a different value is turned
 * away with VERSION_MISMATCH and asked to update (docs/RELEASING.md).
 */
export const PROTOCOL_VERSION = 4;
/** Join error code: client and server speak different protocol versions. */
export const VERSION_MISMATCH = 4426;
/** Hard cap per room (Party mode UI targets 2–8; Show mode scales to 32). */
export const MAX_PLAYERS = 32;
/** Client state uploads and server snapshots per second. */
export const SEND_RATE = 30;
/** Remote Wobblers are drawn this far in the past so there are always two snapshots to blend. */
export const INTERP_DELAY = 0.1;
/** Interactions between Wobblers further apart than this (m) are rejected by the server. */
export const MAX_INTERACT_DIST = 5;

const STATES: WobblerState[] = ["normal", "dive", "slide", "getup", "ragdoll", "held", "out"];

const F_GROUNDED = 1;
const F_GRABBING = 2;
const F_SQUASHED = 4;
const F_INVULN = 8;
const F_CLUMP = 16;

/** [id, x, y, z, vx, vy, vz, facing, state, flags, holding, heldBy] — all integers. */
export type PackedWobbler = number[];
/** [x, y, z, qx, qy, qz, qw] — integers. */
export type PackedBall = number[];

const cm = (v: number) => Math.round(v * 100);
const mrad = (a: number) => Math.round(a * 1000);

export function packNet(id: number, n: NetState): PackedWobbler {
  const flags = (n.grounded ? F_GROUNDED : 0) | (n.grabbing ? F_GRABBING : 0) | (n.squashed ? F_SQUASHED : 0) | (n.invulnerable ? F_INVULN : 0) | (n.clumped ? F_CLUMP : 0);
  return [
    id,
    cm(n.pos.x),
    cm(n.pos.y),
    cm(n.pos.z),
    cm(n.vel.x),
    cm(n.vel.y),
    cm(n.vel.z),
    mrad(wrapAngle(n.facing)),
    Math.max(0, STATES.indexOf(n.state)),
    flags,
    n.holding ?? 0,
    n.heldBy ?? 0,
  ];
}

export function unpackNet(p: PackedWobbler): { id: number; net: NetState } | null {
  if (!Array.isArray(p) || p.length < 12 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const state = STATES[p[8]];
  if (!state) return null;
  return {
    id: p[0],
    net: {
      pos: { x: p[1] / 100, y: p[2] / 100, z: p[3] / 100 },
      vel: { x: p[4] / 100, y: p[5] / 100, z: p[6] / 100 },
      facing: p[7] / 1000,
      state,
      grounded: (p[9] & F_GROUNDED) !== 0,
      grabbing: (p[9] & F_GRABBING) !== 0,
      squashed: (p[9] & F_SQUASHED) !== 0,
      invulnerable: (p[9] & F_INVULN) !== 0,
      clumped: (p[9] & F_CLUMP) !== 0,
      holding: p[10] || null,
      heldBy: p[11] || null,
    },
  };
}

/** Network view of a Wobbler simulated by this process. */
export function netStateOf(w: Wobbler, time: number): NetState {
  return {
    pos: { ...w.pos },
    vel: { ...w.vel },
    facing: w.facing,
    state: w.state,
    grounded: w.grounded,
    grabbing: w.grabbing,
    squashed: time < w.squashedUntil,
    invulnerable: time < w.invulnUntil,
    holding: w.holding,
    heldBy: w.heldBy,
    clumped: w.clumpWith != null,
  };
}

export function packBall(p: Vec3, q: Quat): PackedBall {
  return [cm(p.x), cm(p.y), cm(p.z), Math.round(q.x * 10000), Math.round(q.y * 10000), Math.round(q.z * 10000), Math.round(q.w * 10000)];
}

export function unpackBall(b: PackedBall): { pos: Vec3; rot: Quat } {
  const q = { x: b[3] / 10000, y: b[4] / 10000, z: b[5] / 10000, w: b[6] / 10000 };
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { pos: { x: b[0] / 100, y: b[1] / 100, z: b[2] / 100 }, rot: { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len } };
}

function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// ───────────────────────── Messages ─────────────────────────

/** Client → server, SEND_RATE times a second. */
export interface StateMsg {
  /** Client's sim tick (for diagnostics). */
  t: number;
  w: PackedWobbler;
  /** Visual events of the sender's own Wobbler since the last upload. */
  ev: SimEvent[];
  /** Interactions with Wobblers the sender does not own. */
  out: NetMsg[];
}

/** Server → everyone, SEND_RATE times a second. */
export interface SnapMsg {
  /** Server sim tick this snapshot was taken at. */
  t: number;
  w: PackedWobbler[];
  b: PackedBall[];
  /** Visual events from other players and server NPCs. Receivers skip their own. */
  ev: SimEvent[];
  /** Hunt rounds: [holder id or 0, x, y, z] in cm. */
  c?: number[];
}

export interface WelcomeMsg {
  code: string;
  /** Your Wobbler id. */
  you: number;
  color: number;
  spawn: Vec3;
  tick: number;
}

export const BODY_STYLES = ["bean", "gumdrop", "drop"] as const;
export type BodyStyle = (typeof BODY_STYLES)[number];
export const cleanStyle = (s: unknown): BodyStyle => (BODY_STYLES.includes(s as BodyStyle) ? (s as BodyStyle) : "bean");

export interface RosterEntry {
  id: number;
  name: string;
  color: number;
  style: BodyStyle;
  host: boolean;
}

export interface RosterMsg {
  players: RosterEntry[];
}

export interface PingMsg {
  c: number;
}

export interface PongMsg {
  c: number;
  t: number;
}

/** Client → server: name / colour choice. */
export interface ProfileMsg {
  name?: string;
  color?: number;
  style?: BodyStyle;
}

export const PLAYER_NAME_MAX = 16;

export function cleanName(name: unknown, fallback: string): string {
  if (typeof name !== "string") return fallback;
  const n = name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, PLAYER_NAME_MAX);
  return n || fallback;
}

/** "  abcd " → "ABCD". */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const NET_KINDS = new Set(["knock", "squash", "grab", "release", "mash", "drop", "clump"]);

/** Validate an untrusted interaction message. */
export function isNetMsg(m: unknown): m is NetMsg {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  if (!NET_KINDS.has(o.k as string) || typeof o.from !== "number" || typeof o.target !== "number") return false;
  if (o.k === "knock") {
    const imp = o.imp as Record<string, unknown> | undefined;
    if (!imp || ![imp.x, imp.y, imp.z].every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 40)) return false;
    if (typeof o.rag !== "boolean") return false;
  }
  return true;
}

const EVENT_TYPES = new Set(["jump", "land", "bounce", "dive", "ragdoll", "grab", "throw", "release", "tackle", "stomp", "hazardHit", "ballHit", "fall", "respawn", "clump"]);

export function isSimEvent(e: unknown): e is SimEvent {
  return !!e && typeof e === "object" && EVENT_TYPES.has((e as { type?: string }).type ?? "") && typeof (e as { id?: unknown }).id === "number";
}
