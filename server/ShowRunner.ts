// Runs a Party show on the server: phases, the Show Director, per-round referees,
// stars and catch-up rules (DESIGN.md §2.1). Driven once per server tick.

import RAPIER from "@dimforge/rapier3d-compat";
import { SANDBOX, inZone, type LevelDef } from "../shared/level";
import type { HazardDef } from "../shared/hazards";
import type { Vec3 } from "../shared/math";
import { SUMMIT_LANES, roundById, type RoundDef } from "../shared/rounds";
import {
  BOUNTY_WINDOW,
  HOUSE_RULES,
  HOUSE_RULES_FROM,
  houseRule,
  GREMLIN_COOLDOWN,
  PHASE_TIME,
  leaderOf,
  pickAwards,
  type Award,
  type StatKey,
  pickFinal,
  pickFinalists,
  planShow,
  rankBy,
  splitTeams,
  starsFor,
  teamStars,
  type Phase,
  type ResultRow,
  type RoundInfo,
  type ShowMsg,
} from "../shared/show";
import { DT, TICK_RATE, type NetMsg, type NetState, type Sim } from "../shared/sim";

export interface ShowHost {
  readonly sim: Sim;
  playerIds(): number[];
  nameOf(id: number): string;
  /** Replace the level; every connected player gets a Wobbler at their spawn. */
  loadLevel(level: LevelDef, epochTick: number, spawns: Map<number, Vec3>): void;
  broadcastShow(msg: ShowMsg): void;
}

interface Crown {
  holder: number | null;
  pos: Vec3;
  vel: Vec3;
  /** id → tick until which they can't pick it up again. */
  cooldown: Map<number, number>;
  lastDropBy: { from: number; tick: number } | null;
}

const secs = (s: number) => Math.round(s * TICK_RATE);

export class ShowRunner {
  phase: Phase = "lobby";
  endsAt: number | null = null;
  stars = new Map<number, number>();
  private bestRank = new Map<number, number>();
  private plan: RoundDef[] = [];
  private final: RoundDef | null = null;
  private index = 0; // rounds started so far
  round: RoundDef | null = null;
  info: RoundInfo | null = null;
  level: LevelDef = SANDBOX;
  participants: number[] = [];
  private spawnIndex = new Map<number, number>();
  teams: Map<number, number> | null = null;
  finished: number[] = [];
  out: number[] = [];
  private progress = new Map<number, number>();
  points = new Map<number, number>();
  goals: number[] | null = null;
  private goalPause = 0;
  crown: Crown | null = null;
  champion: number | null = null;
  podium: number[] | null = null;
  awards: Award[] | null = null;
  private statsById = new Map<number, Partial<Record<StatKey, number>>>();
  results: ResultRow[] | null = null;
  private leaderAtStart: number | null = null;
  private bonus = new Map<number, number>();
  private lastHit = new Map<number, { by: number; tick: number }>();
  private wasOut = new Set<number>();
  private gremlinReady = new Map<number, number>();
  extra: HazardDef[] = [];
  private toasts: { seq: number; text: string }[] = [];
  private seq = 0;
  private dirty = true;
  private lastSent = 0;

  constructor(
    private host: ShowHost,
    private random: () => number = Math.random,
    /** Testing only: fixed round ids before the Final (WOBBLE_PLAN env var on the server). */
    private forcedPlan?: string[],
  ) {}

  private get now() {
    return this.host.sim.tick;
  }

  toast(text: string) {
    this.toasts.push({ seq: ++this.seq, text });
    if (this.toasts.length > 5) this.toasts.shift();
    this.dirty = true;
  }

  // ───────────────────────── Flow ─────────────────────────

  /** Host pressed Start. */
  start(): boolean {
    if (this.phase !== "lobby") return false;
    const ids = this.host.playerIds();
    if (!ids.length) return false;
    this.stars = new Map(ids.map((id) => [id, 0]));
    this.bestRank.clear();
    const forced = this.forcedPlan?.map((id) => roundById(id)).filter((r): r is RoundDef => !!r && r.category !== "final");
    this.plan = forced?.length ? forced : planShow(ids.length, this.random);
    this.final = pickFinal(Math.min(ids.length, 3), this.random);
    this.index = 0;
    this.champion = null;
    this.podium = null;
    this.awards = null;
    this.statsById.clear();
    this.nextRound();
    return true;
  }

  private totalRounds() {
    return this.plan.length + 1;
  }

  private nextRound() {
    const ids = this.host.playerIds();
    for (const id of ids) if (!this.stars.has(id)) this.stars.set(id, 0);
    let round: RoundDef;
    let isFinal = false;
    if (this.index < this.plan.length) {
      round = this.plan[this.index];
      this.participants = [...ids];
    } else {
      round = this.final!;
      isFinal = true;
      const present = new Map([...this.stars].filter(([id]) => ids.includes(id)));
      this.participants = pickFinalists(present, this.bestRank, this.random);
    }
    this.index++;
    this.round = round;
    const seed = Math.floor(this.random() * 2 ** 31);
    this.level = round.build(seed, this.participants.length);
    const epochTick = this.now + secs(PHASE_TIME.intro + PHASE_TIME.countdown);
    this.info = {
      index: this.index,
      total: this.totalRounds(),
      id: round.id,
      seed,
      epochTick,
      double: !isFinal && this.index === this.plan.length && this.plan.length > 1,
      final: isFinal,
      rule: null,
      ruleBy: null,
    };
    // Spawns: shuffled; team rounds use spawn parity as the team.
    this.teams = round.category === "team" ? splitTeams(this.participants, this.stars) : null;
    this.spawnIndex.clear();
    const order = [...this.participants].sort(() => this.random() - 0.5);
    const perTeam = [0, 0];
    order.forEach((id, i) => {
      if (this.teams) {
        const t = this.teams.get(id)!;
        this.spawnIndex.set(id, perTeam[t]++ * 2 + t);
      } else this.spawnIndex.set(id, i);
    });
    const spawns = new Map<number, Vec3>();
    const list = this.level.spawns ?? [this.level.spawn];
    for (const id of ids) {
      const i = this.spawnIndex.get(id);
      spawns.set(id, i == null ? { ...this.level.spawn, y: this.level.spawn.y + 30 } : list[i % list.length]);
    }
    // Reset per-round state
    this.finished = [];
    this.out = [];
    this.progress.clear();
    this.points = new Map(this.participants.map((id) => [id, 0]));
    this.goals = round.category === "team" ? [0, 0] : null;
    this.goalPause = 0;
    this.crown = this.level.crown && round.category === "hunt" ? { holder: null, pos: { ...this.level.crown }, vel: { x: 0, y: 0, z: 0 }, cooldown: new Map(), lastDropBy: null } : null;
    this.results = null;
    this.bonus.clear();
    this.lastHit.clear();
    this.wasOut.clear();
    this.extra = [];
    this.gremlinReady.clear();
    this.leaderAtStart = isFinal ? null : leaderOf(this.stars);
    // House Rule: the player in last place spins one modifier for everybody.
    if (!isFinal && this.index >= HOUSE_RULES_FROM) {
      const fits = HOUSE_RULES.filter((r) => r.fits(this.level));
      const present = this.participants;
      const low = Math.min(...present.map((id) => this.stars.get(id) ?? 0));
      const last = present.filter((id) => (this.stars.get(id) ?? 0) === low);
      if (fits.length && last.length) {
        this.info.rule = fits[Math.floor(this.random() * fits.length)].id;
        this.info.ruleBy = last[Math.floor(this.random() * last.length)];
      }
    }
    this.host.loadLevel(this.level, epochTick, spawns);
    this.host.sim.setRule(this.info.rule);
    const rule = houseRule(this.info.rule);
    if (rule && this.info.ruleBy != null) this.toast(`${this.host.nameOf(this.info.ruleBy)} spun a House Rule: ${rule.name}!`);
    this.setPhase("intro", secs(PHASE_TIME.intro));
    if (this.info.double) this.toast("Double Down! This round is worth double stars.");
    if (isFinal) this.toast(`Final: ${this.participants.map((id) => this.host.nameOf(id)).join(", ")}`);
  }

  private setPhase(p: Phase, duration: number | null) {
    this.phase = p;
    this.endsAt = duration == null ? null : this.now + duration;
    this.dirty = true;
  }

  private backToLobby() {
    this.round = null;
    this.info = null;
    this.level = SANDBOX;
    this.participants = [];
    this.teams = null;
    this.crown = null;
    this.goals = null;
    this.extra = [];
    const spawns = new Map<number, Vec3>();
    this.host.playerIds().forEach((id, i) => {
      const a = (i / 8) * Math.PI * 2;
      spawns.set(id, { x: Math.cos(a) * 2.4, y: 1, z: Math.sin(a) * 2.4 });
    });
    this.host.loadLevel(SANDBOX, this.now, spawns);
    this.setPhase("lobby", null);
  }

  /** Once per server tick, after the sim stepped. */
  tick() {
    const due = this.endsAt != null && this.now >= this.endsAt;
    switch (this.phase) {
      case "intro":
        if (due) this.setPhase("countdown", secs(PHASE_TIME.countdown));
        break;
      case "countdown":
        if (due) this.setPhase("play", secs(this.round!.duration));
        break;
      case "play":
        this.referee();
        if (this.phase === "play" && (due || this.roundOver())) this.endRound();
        break;
      case "results":
        if (due) {
          if (this.info?.final) this.finishShow();
          else this.nextRound();
        }
        break;
      case "podium":
        if (due) this.backToLobby();
        break;
    }
    const interval = this.phase === "play" ? secs(0.25) : secs(1);
    if (this.dirty || this.now - this.lastSent >= interval) {
      this.dirty = false;
      this.lastSent = this.now;
      this.host.broadcastShow(this.msg());
    }
  }

  // ───────────────────────── Referee ─────────────────────────

  private net(id: number): NetState | null {
    return this.host.sim.get(id)?.net ?? null;
  }

  private active() {
    const ids = new Set(this.host.playerIds());
    return this.participants.filter((id) => ids.has(id));
  }

  private referee() {
    const r = this.round!;
    const lvl = this.level;
    for (const id of this.active()) {
      const n = this.net(id);
      if (!n) continue;
      // Bounty Crown: the leader fell soon after someone hit them.
      if (id === this.leaderAtStart && n.state === "out" && !this.wasOut.has(id)) {
        const hit = this.lastHit.get(id);
        if (hit && this.now - hit.tick <= secs(BOUNTY_WINDOW) && hit.by !== id) this.awardBounty(hit.by);
      }
      if (n.state === "out") this.wasOut.add(id);
      else this.wasOut.delete(id);

      switch (r.category) {
        case "race":
          if (!this.finished.includes(id)) {
            this.progress.set(id, Math.max(this.progress.get(id) ?? -Infinity, n.pos.z));
            if (lvl.finish && n.state !== "out" && inZone(lvl.finish, n.pos)) {
              this.finished.push(id);
              this.dirty = true;
              if (this.finished.length === 1) this.toast(`${this.host.nameOf(id)} finished first!`);
            }
          }
          break;
        case "survival":
          if (n.state === "out" && !this.out.includes(id)) {
            this.out.push(id);
            this.dirty = true;
          }
          break;
        case "final":
          this.progress.set(id, Math.max(this.progress.get(id) ?? -Infinity, n.pos.y + n.pos.z * 0.01));
          if (this.champion == null && lvl.summit && n.state !== "out" && inZone(lvl.summit, n.pos)) {
            this.champion = id;
            this.toast(`${this.host.nameOf(id)} reached the summit!`);
          }
          break;
      }
    }
    if (r.category === "hunt") this.refereeCrown();
    if (r.category === "team") this.refereeGoals();
  }

  private roundOver(): boolean {
    const act = this.active();
    if (!act.length) return true;
    switch (this.round!.category) {
      case "race":
        return act.every((id) => this.finished.includes(id));
      case "survival": {
        const alive = act.filter((id) => !this.out.includes(id));
        return act.length > 1 ? alive.length <= 1 : alive.length === 0;
      }
      case "team":
        return (this.goals ?? []).some((g) => g >= 3);
      case "final":
        return this.champion != null;
      default:
        return false;
    }
  }

  private refereeCrown() {
    const c = this.crown!;
    const lvl = this.level;
    if (c.holder != null) {
      const n = this.net(c.holder);
      const gone = !this.host.playerIds().includes(c.holder);
      if (gone || !n || n.state === "ragdoll" || n.state === "held" || n.state === "out") {
        const dropper = c.holder;
        c.holder = null;
        c.pos = n ? { x: n.pos.x, y: n.pos.y + 1.2, z: n.pos.z } : { ...lvl.crown! };
        const a = this.random() * Math.PI * 2;
        c.vel = { x: Math.cos(a) * 3, y: 5, z: Math.sin(a) * 3 };
        c.cooldown.set(dropper, this.now + secs(1));
        // Knocking the crown off the leader also counts as a Bounty.
        const hit = this.lastHit.get(dropper);
        if (dropper === this.leaderAtStart && hit && this.now - hit.tick <= secs(1)) this.awardBounty(hit.by);
        this.dirty = true;
      } else {
        this.points.set(c.holder, (this.points.get(c.holder) ?? 0) + DT);
        this.bump(c.holder, "crownTime", DT);
        c.pos = { x: n.pos.x, y: n.pos.y + 1.15, z: n.pos.z };
        return;
      }
    }
    // Loose crown: simple ballistic fall that comes to rest 0.35 m above the ground.
    c.vel.y -= 20 * DT;
    const next = { x: c.pos.x + c.vel.x * DT, y: c.pos.y + c.vel.y * DT, z: c.pos.z + c.vel.z * DT };
    const ray = new RAPIER.Ray(c.pos, { x: 0, y: -1, z: 0 });
    const hit = c.vel.y < 0 ? this.host.sim.world.castRay(ray, -c.vel.y * DT + 0.35, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC) : null;
    if (hit) {
      c.pos = { x: next.x, y: c.pos.y - hit.timeOfImpact + 0.35, z: next.z };
      c.vel = { x: 0, y: 0, z: 0 };
    } else c.pos = next;
    if (c.pos.y < lvl.killY) {
      c.pos = { ...lvl.crown! };
      c.vel = { x: 0, y: 0, z: 0 };
      this.toast("The crown is back in the middle!");
    }
    // Pick up
    let best: number | null = null;
    let bestD = Infinity;
    for (const id of this.active()) {
      const n = this.net(id);
      if (!n || n.state === "out" || n.state === "held" || n.state === "ragdoll") continue;
      if ((c.cooldown.get(id) ?? 0) > this.now) continue;
      const d = Math.hypot(n.pos.x - c.pos.x, n.pos.z - c.pos.z);
      if (d < 1.2 && Math.abs(n.pos.y - c.pos.y) < 1.6 && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    if (best != null) {
      c.holder = best;
      this.dirty = true;
    }
  }

  private refereeGoals() {
    const ball = this.host.sim.balls[0];
    if (!ball || !this.goals) return;
    if (this.goalPause > 0) {
      this.goalPause--;
      if (this.goalPause === 0) {
        ball.setTranslation({ x: 0, y: 3, z: 0 }, true);
        ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      return;
    }
    const p = ball.translation();
    for (const g of this.level.goals ?? []) {
      if (inZone(g.zone, p)) {
        const scorer = 1 - g.team;
        this.goals[scorer]++;
        this.goalPause = secs(1.5);
        this.toast(`GOAL! ${scorer === 0 ? "Coral" : "Teal"} team ${this.goals[0]}–${this.goals[1]}`);
      }
    }
  }

  private bump(id: number, k: StatKey, by = 1) {
    if (this.phase === "lobby") return;
    const st = this.statsById.get(id) ?? {};
    st[k] = (st[k] ?? 0) + by;
    this.statsById.set(id, st);
  }

  /** A player's own sim event (uploaded and validated by the room). Feeds the awards. */
  onEvent(e: { type: string; id: number }) {
    if (this.phase !== "play") return;
    const map: Record<string, StatKey> = { tackle: "tackles", stomp: "stomps", fall: "falls", throw: "throws", hazardHit: "hazardHits", grab: "grabs" };
    const k = map[e.type];
    if (k) this.bump(e.id, k);
  }

  /** A routed interaction (from the room). Used for the Bounty Crown. */
  onInteraction(m: NetMsg) {
    if (this.phase !== "play" || m.target !== this.leaderAtStart) return;
    if (m.k === "knock" || m.k === "grab" || m.k === "squash") this.lastHit.set(m.target, { by: m.from, tick: this.now });
  }

  private awardBounty(by: number) {
    if (!this.host.playerIds().includes(by) || this.bonus.has(by)) return;
    this.bonus.set(by, 1);
    this.bump(by, "bounties");
    this.lastHit.clear();
    this.toast(`${this.host.nameOf(by)} took down the leader! Bounty +1★`);
  }

  /** A non-finalist triggers an avalanche in the Final. */
  gremlin(id: number): boolean {
    if (this.phase !== "play" || !this.info?.final || this.participants.includes(id)) return false;
    if ((this.gremlinReady.get(id) ?? 0) > this.now) return false;
    this.gremlinReady.set(id, this.now + secs(GREMLIN_COOLDOWN));
    const lane = SUMMIT_LANES[Math.floor(this.random() * SUMMIT_LANES.length)];
    const t = this.host.sim.hazardTime() + 0.4;
    const def: HazardDef = { kind: "roller", from: lane.from, to: lane.to, radius: 1.2, speed: 8, period: 1, start: t };
    this.extra.push(def);
    this.host.sim.addHazard(def);
    this.toast(`${this.host.nameOf(id)} started an avalanche!`);
    return true;
  }

  // ───────────────────────── Scoring ─────────────────────────

  private endRound() {
    const r = this.round!;
    const act = this.active();
    const n = act.length;
    const score = new Map<number, number>();
    switch (r.category) {
      case "race": {
        const fin = this.finished.filter((id) => act.includes(id));
        for (const id of act) {
          const i = fin.indexOf(id);
          score.set(id, i >= 0 ? 1e6 - i : this.progress.get(id) ?? -1e6);
        }
        break;
      }
      case "survival": {
        const outOrder = this.out.filter((id) => act.includes(id));
        for (const id of act) {
          const i = outOrder.indexOf(id);
          score.set(id, i < 0 ? 1e6 : i);
        }
        break;
      }
      case "hunt":
        for (const id of act) score.set(id, this.points.get(id) ?? 0);
        break;
      case "team": {
        const [a, b] = this.goals ?? [0, 0];
        const winner = a === b ? null : a > b ? 0 : 1;
        for (const id of act) score.set(id, winner == null ? 0 : this.teams!.get(id) === winner ? 1 : 0);
        break;
      }
      case "final":
        for (const id of act) score.set(id, id === this.champion ? 1e6 : this.progress.get(id) ?? 0);
        if (this.champion == null && act.length) {
          this.champion = [...score.entries()].sort((x, y) => y[1] - x[1])[0][0];
          this.toast(`Time! ${this.host.nameOf(this.champion)} climbed the highest.`);
        }
        break;
    }
    const ranks = rankBy(score);
    const mul = this.info?.double ? 2 : 1;
    const rows: ResultRow[] = [];
    for (const id of act) {
      const rank = ranks.get(id)!;
      let gained = 0;
      if (r.category === "team") {
        const [a, b] = this.goals ?? [0, 0];
        gained = teamStars(n, a === b ? null : this.teams!.get(id) === (a > b ? 0 : 1));
      } else if (r.category !== "final") gained = starsFor(rank, n);
      gained *= mul;
      const bonus = this.bonus.get(id) ?? 0;
      const total = (this.stars.get(id) ?? 0) + gained + bonus;
      if (r.category !== "final") {
        this.stars.set(id, total);
        this.bestRank.set(id, Math.min(this.bestRank.get(id) ?? 99, rank));
      }
      rows.push({ id, rank, gained, bonus, total: this.stars.get(id) ?? total });
    }
    // Bounty hunters who weren't in the round (can't happen today) still get their star.
    rows.sort((x, y) => x.rank - y.rank || y.total - x.total);
    this.results = rows;
    this.setPhase("results", secs(PHASE_TIME.results));
  }

  private finishShow() {
    const finalists = this.results?.map((r) => r.id) ?? [];
    const rest = [...this.stars.keys()]
      .filter((id) => !finalists.includes(id) && this.host.playerIds().includes(id))
      .sort((a, b) => this.stars.get(b)! - this.stars.get(a)!);
    this.podium = [...finalists, ...rest];
    const present = new Map([...this.statsById].filter(([id]) => this.host.playerIds().includes(id)));
    this.awards = pickAwards(present);
    if (this.champion != null) this.toast(`${this.host.nameOf(this.champion)} is the Show Champion!`);
    this.setPhase("podium", secs(PHASE_TIME.podium));
  }

  // ───────────────────────── Wire ─────────────────────────

  crownPacked(): number[] | undefined {
    const c = this.crown;
    if (!c || this.phase === "lobby") return undefined;
    return [c.holder ?? 0, Math.round(c.pos.x * 100), Math.round(c.pos.y * 100), Math.round(c.pos.z * 100)];
  }

  msg(): ShowMsg {
    const rec = <V>(m: Map<number, V> | null) => (m ? Object.fromEntries(m) : null);
    return {
      phase: this.phase,
      endsAt: this.endsAt,
      round: this.info,
      spawns: Object.fromEntries(this.spawnIndex),
      participants: this.participants,
      teams: rec(this.teams),
      stars: Object.fromEntries(this.stars),
      leader: this.phase === "lobby" ? null : leaderOf(this.stars),
      finished: this.finished,
      out: this.out,
      points: Object.fromEntries([...this.points].map(([id, p]) => [id, Math.round(p * 10) / 10])),
      goals: this.goals,
      results: this.results,
      champion: this.champion,
      podium: this.podium,
      awards: this.phase === "podium" ? this.awards : null,
      extra: this.extra,
      toasts: this.toasts,
    };
  }
}
