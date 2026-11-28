// Connection to the Party server: room create/join, clock sync, snapshot buffer,
// interaction inbox. `?lag=150` adds artificial round-trip latency for testing.

import { Client, type Room } from "@colyseus/sdk";
import {
  INTERP_DELAY,
  ROOM_NAME,
  normalizeRoomCode,
  unpackBall,
  unpackNet,
  type PongMsg,
  type RosterEntry,
  type RosterMsg,
  type SnapMsg,
  type StateMsg,
  type WelcomeMsg,
} from "../../shared/protocol";
import type { Quat, Vec3 } from "../../shared/math";
import type { ShowMsg } from "../../shared/show";
import { DT, type NetMsg, type NetState, type SimEvent } from "../../shared/sim";

function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // Vite dev server → game server on the same machine, port 2567 (works over LAN too).
  if (location.port === "5180") return `${proto}://${location.hostname}:2567`;
  return `${proto}://${location.host}`;
}

interface Snapshot {
  time: number; // server time (s)
  wobblers: Map<number, NetState>;
  balls: { pos: Vec3; rot: Quat }[];
}

export class NetClient {
  readonly code: string;
  readonly you: number;
  readonly color: number;
  readonly spawn: Vec3;
  roster: RosterEntry[] = [];
  /** Round-trip time in ms (smoothed), null until the first pong. */
  rtt: number | null = null;
  connected = true;
  onRoster: (r: RosterEntry[]) => void = () => {};
  onDisconnect: () => void = () => {};
  /** Latest Party show state from the server. */
  show: ShowMsg | null = null;
  onShow: (m: ShowMsg) => void = () => {};
  /** Hunt crown from the newest snapshot: holder id (0 = loose) and position. */
  crown: { holder: number; x: number; y: number; z: number } | null = null;

  private snaps: Snapshot[] = [];
  private inbox: NetMsg[] = [];
  private remoteEvents: SimEvent[] = [];
  /** serverTime ≈ performance.now()/1000 + offset */
  private offset: number;
  private offsetSamples: number[] = [];
  private pingTimer: ReturnType<typeof setInterval>;
  private readonly halfLag: number;

  private constructor(
    private room: Room,
    welcome: WelcomeMsg,
    lagMs: number,
  ) {
    this.code = welcome.code;
    this.you = welcome.you;
    this.color = welcome.color;
    this.spawn = welcome.spawn;
    this.halfLag = lagMs / 2;
    this.offset = welcome.tick * DT - performance.now() / 1000;

    this.recv<SnapMsg>("snap", (m) => this.onSnap(m));
    this.recv<NetMsg>("i", (m) => this.inbox.push(m));
    this.recv<ShowMsg>("show", (m) => {
      this.show = m;
      this.onShow(m);
    });
    this.recv<RosterMsg>("roster", (m) => {
      this.roster = m.players;
      this.onRoster(m.players);
    });
    this.recv<PongMsg>("pong", (m) => {
      const sample = performance.now() - m.c;
      this.rtt = this.rtt == null ? sample : this.rtt * 0.8 + sample * 0.2;
    });
    room.onLeave(() => {
      this.connected = false;
      clearInterval(this.pingTimer);
      this.onDisconnect();
    });
    this.pingTimer = setInterval(() => this.send("ping", { c: performance.now() }), 1000);
    this.send("ping", { c: performance.now() });
  }

  static async connect(how: { create: true } | { code: string }, profile: { name: string; color?: number }, lagMs = 0): Promise<NetClient> {
    const client = new Client(serverUrl());
    const room = "create" in how ? await client.create(ROOM_NAME, profile) : await client.joinById(normalizeRoomCode(how.code), profile);
    const welcome = await new Promise<WelcomeMsg>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Server did not answer")), 8000);
      room.onMessage("welcome", (w: WelcomeMsg) => {
        clearTimeout(t);
        resolve(w);
      });
    });
    const net = new NetClient(room, welcome, lagMs);
    // Roster usually arrives right after welcome; catch the first one.
    return net;
  }

  /** Receive with optional simulated latency. */
  private recv<T>(type: string, fn: (m: T) => void) {
    this.room.onMessage(type, (m: T) => (this.halfLag ? setTimeout(() => fn(m), this.halfLag) : fn(m)));
  }

  private send(type: string, msg: unknown) {
    if (!this.connected) return;
    if (this.halfLag) setTimeout(() => this.connected && this.room.send(type, msg), this.halfLag);
    else this.room.send(type, msg);
  }

  sendState(msg: StateMsg) {
    this.send("s", msg);
  }

  /** Host only: start the show from the lobby. */
  startShow() {
    this.send("start", {});
  }

  /** Final, non-finalists: trigger an avalanche. */
  gremlin() {
    this.send("gremlin", {});
  }

  setName(name: string) {
    this.send("profile", { name });
  }

  leave() {
    clearInterval(this.pingTimer);
    void this.room.leave();
  }

  // ───────── Clock ─────────

  /** Best estimate of the server's sim time right now (seconds). */
  serverTime() {
    return performance.now() / 1000 + this.offset;
  }

  private onSnap(m: SnapMsg) {
    const now = performance.now() / 1000;
    // The snapshot left the server half a round trip ago. Network jitter only ever makes
    // samples late, so the max of recent samples is the least-delayed estimate.
    const sample = m.t * DT + (this.rtt ?? 0) / 2000 - now;
    this.offsetSamples.push(sample);
    if (this.offsetSamples.length > 45) this.offsetSamples.shift();
    const best = Math.max(...this.offsetSamples);
    // Ease toward the estimate instead of snapping, unless we're far off.
    this.offset = Math.abs(best - this.offset) > 0.25 ? best : this.offset + (best - this.offset) * 0.1;

    const wobblers = new Map<number, NetState>();
    for (const p of m.w) {
      const u = unpackNet(p);
      if (u) wobblers.set(u.id, u.net);
    }
    this.snaps.push({ time: m.t * DT, wobblers, balls: m.b.map(unpackBall) });
    if (this.snaps.length > 60) this.snaps.shift();
    for (const e of m.ev) if (e.id !== this.you) this.remoteEvents.push(e);
    this.crown = m.c && m.c.length === 4 ? { holder: m.c[0], x: m.c[1] / 100, y: m.c[2] / 100, z: m.c[3] / 100 } : null;
  }

  // ───────── Per-tick access ─────────

  takeInbox() {
    return this.inbox.splice(0);
  }

  takeEvents() {
    return this.remoteEvents.splice(0);
  }

  /** Latest set of Wobbler ids the server knows about. */
  latestIds(): number[] {
    const s = this.snaps[this.snaps.length - 1];
    return s ? [...s.wobblers.keys()] : [];
  }

  /**
   * Remote state at `serverTime - INTERP_DELAY`: positions blended between the two
   * snapshots around that time; discrete fields from the newer one.
   */
  sample(serverTime: number): { wobblers: Map<number, NetState>; balls: { pos: Vec3; rot: Quat }[] } | null {
    if (!this.snaps.length) return null;
    const t = serverTime - INTERP_DELAY;
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i - 1].time >= t) i--;
    const b = this.snaps[i];
    const a = this.snaps[i - 1] ?? b;
    const span = b.time - a.time;
    let k = span > 0 ? (t - a.time) / span : 1;
    // Past the newest snapshot: hold (with a tiny extrapolation) rather than freeze hard.
    const extra = Math.min(0.1, Math.max(0, t - b.time));
    k = Math.max(0, Math.min(1, k));
    const latest = this.snaps[this.snaps.length - 1];

    const wobblers = new Map<number, NetState>();
    for (const [id, nb] of b.wobblers) {
      const na = a.wobblers.get(id) ?? nb;
      const teleport = Math.hypot(nb.pos.x - na.pos.x, nb.pos.y - na.pos.y, nb.pos.z - na.pos.z) > 4;
      const kk = teleport ? 1 : k;
      const newest = latest.wobblers.get(id) ?? nb;
      wobblers.set(id, {
        ...nb,
        pos: {
          x: na.pos.x + (nb.pos.x - na.pos.x) * kk + nb.vel.x * extra,
          y: na.pos.y + (nb.pos.y - na.pos.y) * kk + nb.vel.y * extra,
          z: na.pos.z + (nb.pos.z - na.pos.z) * kk + nb.vel.z * extra,
        },
        facing: na.facing + Math.atan2(Math.sin(nb.facing - na.facing), Math.cos(nb.facing - na.facing)) * kk,
        // Who holds whom must not lag behind the grab messages.
        holding: newest.holding,
        heldBy: newest.heldBy,
      });
    }
    const balls = b.balls.map((bb, j) => {
      const ba = a.balls[j] ?? bb;
      return {
        pos: { x: ba.pos.x + (bb.pos.x - ba.pos.x) * k, y: ba.pos.y + (bb.pos.y - ba.pos.y) * k, z: ba.pos.z + (bb.pos.z - ba.pos.z) * k },
        rot: k < 0.5 ? ba.rot : bb.rot,
      };
    });
    return { wobblers, balls };
  }
}
