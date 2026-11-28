import { Room, ServerError, type Client } from "colyseus";
import { pack } from "msgpackr";
import { SANDBOX, type LevelDef } from "../shared/level";
import type { Vec3 } from "../shared/math";
import type { ShowMsg } from "../shared/show";
import {
  MAX_INTERACT_DIST,
  MAX_PLAYERS,
  SEND_RATE,
  cleanName,
  cleanStyle,
  isNetMsg,
  isSimEvent,
  netStateOf,
  packBall,
  packNet,
  unpackNet,
  type BodyStyle,
  type PingMsg,
  type PongMsg,
  type ProfileMsg,
  type RosterMsg,
  type SnapMsg,
  type StateMsg,
  type WelcomeMsg,
  PROTOCOL_VERSION,
  VERSION_MISMATCH,
} from "../shared/protocol";
import { DT, Sim, TICK_RATE, type NetMsg, type SimEvent, type Wobbler } from "../shared/sim";
import { generateRoomCode, releaseRoomCode } from "./roomCode";
import { ShowRunner, type ShowHost } from "./ShowRunner";

export interface JoinOptions {
  /** Client protocol version (PROTOCOL_VERSION). */
  v?: number;
  name?: string;
  color?: number;
  style?: string;
}

interface Player {
  client: Client;
  wobbler: Wobbler;
  name: string;
  color: number;
  style: BodyStyle;
  joinedAt: number;
}

/** Simple running stats so the load test (and /stats) can report the server budget. */
export class RoomStats {
  ticks = 0;
  tickMsTotal = 0;
  tickMsMax = 0;
  snapshots = 0;
  snapshotBytesTotal = 0;
  snapshotBytesMax = 0;
  messagesIn = 0;
  routed = 0;
  rejected = 0;

  report() {
    return {
      tickMsAvg: this.ticks ? this.tickMsTotal / this.ticks : 0,
      tickMsMax: this.tickMsMax,
      snapshotBytesAvg: this.snapshots ? this.snapshotBytesTotal / this.snapshots : 0,
      snapshotBytesMax: this.snapshotBytesMax,
      messagesIn: this.messagesIn,
      routed: this.routed,
      rejected: this.rejected,
    };
  }
}

const SPAWN_RING = 2.4;

/**
 * One Party room. Each client simulates its own Wobbler and uploads its state; the server
 * runs the shared level (hazards, balls, NPC dummies), referees interactions between
 * Wobblers and broadcasts snapshots. See DESIGN.md §8.
 */
export class PartyRoom extends Room implements ShowHost {
  maxClients = MAX_PLAYERS;
  sim!: Sim;
  readonly stats = new RoomStats();
  private players = new Map<string, Player>();
  private byWobbler = new Map<number, Player>();
  private pendingEvents: SimEvent[] = [];
  private hostId: string | null = null;
  /** Player Wobbler ids are unique for the life of the room (NPC dummies use small ids). */
  private nextPlayerId = 100;
  /** Measure snapshot sizes (msgpack) for stats; cheap enough to keep on. */
  measure = true;
  runner!: ShowRunner;

  onCreate() {
    this.roomId = generateRoomCode();
    this.sim = new Sim(SANDBOX, (Math.random() * 1e9) | 0, "server");
    this.runner = new ShowRunner(this, Math.random, process.env.WOBBLE_PLAN?.split(","));

    this.onMessage("s", (client: Client, msg: StateMsg) => this.onState(client, msg));
    this.onMessage("ping", (client: Client, msg: PingMsg) => {
      if (typeof msg?.c === "number") client.send("pong", { c: msg.c, t: this.sim.tick } satisfies PongMsg);
    });
    this.onMessage("profile", (client: Client, msg: ProfileMsg) => {
      const p = this.players.get(client.sessionId);
      if (!p) return;
      p.name = cleanName(msg?.name, p.name);
      if (msg?.style != null) p.style = cleanStyle(msg.style);
      this.broadcastRoster();
    });

    this.onMessage("start", (client: Client) => {
      if (client.sessionId === this.hostId) this.runner.start();
    });
    this.onMessage("gremlin", (client: Client) => {
      const p = this.players.get(client.sessionId);
      if (p) this.runner.gremlin(p.wobbler.id);
    });

    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  /** One server tick. Public so tests can drive it directly. */
  tick() {
    const start = performance.now();
    this.sim.step();
    // NPC events and interactions the server's own Wobblers caused (dummies, balls).
    this.pendingEvents.push(...this.sim.events);
    this.sim.events = [];
    for (const m of this.sim.outbox) this.route(m, null);
    this.sim.outbox = [];
    this.runner.tick();

    if (this.sim.tick % Math.round(TICK_RATE / SEND_RATE) === 0) this.broadcastSnapshot();
    const ms = performance.now() - start;
    this.stats.ticks++;
    this.stats.tickMsTotal += ms;
    this.stats.tickMsMax = Math.max(this.stats.tickMsMax, ms);
  }

  private broadcastSnapshot() {
    const snap: SnapMsg = {
      t: this.sim.tick,
      w: this.sim.wobblers.map((w) => packNet(w.id, w.net ?? netStateOf(w, this.sim.time))),
      b: this.sim.balls.map((b) => packBall(b.translation(), b.rotation())),
      ev: this.pendingEvents,
      c: this.runner.crownPacked(),
    };
    this.pendingEvents = [];
    this.broadcast("snap", snap);
    if (this.measure) {
      const bytes = pack(snap).length;
      this.stats.snapshots++;
      this.stats.snapshotBytesTotal += bytes;
      this.stats.snapshotBytesMax = Math.max(this.stats.snapshotBytesMax, bytes);
    }
  }

  private onState(client: Client, msg: StateMsg) {
    const p = this.players.get(client.sessionId);
    if (!p || !msg || typeof msg !== "object") return;
    this.stats.messagesIn++;
    const u = unpackNet(msg.w);
    if (u && u.id === p.wobbler.id) p.wobbler.net = u.net;
    if (Array.isArray(msg.ev)) {
      for (const e of msg.ev.slice(0, 32)) {
        if (!isSimEvent(e) || e.id !== p.wobbler.id) continue;
        this.pendingEvents.push(e);
        this.runner.onEvent(e);
      }
    }
    if (Array.isArray(msg.out)) {
      for (const m of msg.out.slice(0, 32)) if (isNetMsg(m) && m.from === p.wobbler.id) this.route(m, p);
    }
  }

  /** Deliver an interaction to whoever owns its target. `sender` is null for the server's own Sim. */
  private route(m: NetMsg, sender: Player | null) {
    const target = this.sim.get(m.target);
    const from = this.sim.get(m.from);
    if (!target) return;
    // Referee: interactions only happen between Wobblers that are actually near each other.
    if (sender && from && m.k !== "release" && m.k !== "drop") {
      const d = Math.hypot(target.pos.x - from.pos.x, target.pos.y - from.pos.y, target.pos.z - from.pos.z);
      if (d > MAX_INTERACT_DIST) {
        this.stats.rejected++;
        if (m.k === "grab") sender.client.send("i", { k: "drop", from: m.target, target: m.from } satisfies NetMsg);
        return;
      }
    }
    this.stats.routed++;
    this.runner.onInteraction(m);
    const owner = this.byWobbler.get(m.target);
    if (owner) {
      owner.client.send("i", m);
      return;
    }
    // Server-owned NPC.
    const ok = this.sim.applyRemote(m);
    if (!ok && m.k === "grab" && sender) sender.client.send("i", { k: "drop", from: m.target, target: m.from } satisfies NetMsg);
    // Make NPC reactions visible to everyone.
    this.pendingEvents.push(...this.sim.events.splice(0));
  }

  onAuth(_client: Client, options: JoinOptions = {}) {
    if (options.v !== PROTOCOL_VERSION) {
      throw new ServerError(VERSION_MISMATCH, `Update needed: server protocol ${PROTOCOL_VERSION}, client ${options.v ?? "unknown"}`);
    }
    return true;
  }

  onJoin(client: Client, options: JoinOptions = {}) {
    const color = this.pickColor(options.color);
    const slot = this.players.size;
    const a = (slot / 8) * Math.PI * 2;
    const ring = SPAWN_RING * (1 + Math.floor(slot / 8) * 0.6);
    const spawn = { x: SANDBOX.spawn.x + Math.cos(a) * ring, y: SANDBOX.spawn.y, z: SANDBOX.spawn.z + Math.sin(a) * ring };
    const wobbler = this.sim.addWobbler(spawn, "remote", color, this.nextPlayerId++);
    wobbler.net = netStateOf(wobbler, this.sim.time);
    const name = cleanName(options.name, `Wobbler ${slot + 1}`);
    const player: Player = { client, wobbler, name, color, style: cleanStyle(options.style), joinedAt: Date.now() };
    this.players.set(client.sessionId, player);
    this.byWobbler.set(wobbler.id, player);
    this.hostId ??= client.sessionId;
    client.send("welcome", { code: this.roomId, you: wobbler.id, color, spawn, tick: this.sim.tick } satisfies WelcomeMsg);
    this.broadcastRoster();
    client.send("show", this.runner.msg());
  }

  onLeave(client: Client) {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    this.players.delete(client.sessionId);
    this.byWobbler.delete(p.wobbler.id);
    this.sim.removeWobbler(p.wobbler.id);
    if (this.hostId === client.sessionId) this.hostId = [...this.players.keys()][0] ?? null;
    this.broadcastRoster();
  }

  onDispose() {
    releaseRoomCode(this.roomId);
  }

  private pickColor(wanted?: number) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    if (typeof wanted === "number" && wanted >= 0 && wanted < 8 && !used.has(wanted)) return wanted;
    for (let c = 0; c < 8; c++) if (!used.has(c)) return c;
    return this.players.size % 8;
  }

  private broadcastRoster() {
    const msg: RosterMsg = {
      players: [...this.players.entries()].map(([sid, p]) => ({ id: p.wobbler.id, name: p.name, color: p.color, style: p.style, host: sid === this.hostId })),
    };
    this.broadcast("roster", msg);
  }

  // ───────── ShowHost ─────────

  playerIds() {
    return [...this.players.values()].map((p) => p.wobbler.id);
  }

  nameOf(id: number) {
    return this.byWobbler.get(id)?.name ?? "Someone";
  }

  broadcastShow(msg: ShowMsg) {
    this.broadcast("show", msg);
  }

  loadLevel(level: LevelDef, epochTick: number, spawns: Map<number, Vec3>) {
    const tick = this.sim.tick;
    const old = this.sim;
    this.sim = new Sim(level, (Math.random() * 1e9) | 0, "server");
    old.world.free();
    this.sim.jumpTo(tick);
    this.sim.epoch = epochTick * DT;
    for (const p of this.players.values()) {
      const spawn = spawns.get(p.wobbler.id) ?? level.spawn;
      const w = this.sim.addWobbler(spawn, "remote", p.color, p.wobbler.id);
      w.net = netStateOf(w, this.sim.time);
      p.wobbler = w;
    }
  }

  /** For tests. */
  playerOf(sessionId: string) {
    return this.players.get(sessionId)?.wobbler;
  }
}
