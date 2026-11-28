import { beforeAll, describe, expect, it } from "vitest";
import type { LevelDef } from "../level";
import { inZone } from "../level";
import { rng, type Vec3 } from "../math";
import { netStateOf } from "../protocol";
import { ROUNDS } from "../rounds";
import { leaderOf, pickFinalists, planShow, rankBy, splitTeams, starsFor, teamStars, type ShowMsg } from "../show";
import { DT, Sim, initPhysics, type NetState } from "../sim";
import { ShowRunner, type ShowHost } from "../../server/ShowRunner";

beforeAll(async () => {
  await initPhysics();
});

describe("Show Director", () => {
  it("never repeats a category back to back, includes a race, and a team round from 4 players", () => {
    for (let seed = 1; seed < 200; seed++) {
      for (const n of [2, 4, 6, 8]) {
        const plan = planShow(n, rng(seed));
        expect(new Set(plan.map((r) => r.id)).size).toBe(plan.length);
        plan.forEach((r, i) => i && expect(r.category).not.toBe(plan[i - 1].category));
        expect(plan.some((r) => r.category === "race")).toBe(true);
        expect(plan.some((r) => r.category === "team")).toBe(n >= 4);
        expect(plan.every((r) => r.category !== "final")).toBe(true);
      }
    }
  });

  it("6 players play 5 rounds before the Final", () => {
    expect(planShow(6, rng(3))).toHaveLength(5);
  });
});

describe("stars", () => {
  it("rank r of n earns n − r + 1, ties share the better rank", () => {
    const ranks = rankBy(new Map([[1, 10], [2, 30], [3, 30], [4, 5]]));
    expect([...ranks.values()]).toEqual([3, 1, 1, 4]);
    expect(starsFor(1, 6)).toBe(6);
    expect(starsFor(6, 6)).toBe(1);
    expect(teamStars(6, true)).toBe(6);
    expect(teamStars(6, false)).toBe(3);
    expect(teamStars(7, null)).toBe(4);
  });

  it("leader is a unique top score", () => {
    expect(leaderOf(new Map([[1, 3], [2, 5]]))).toBe(2);
    expect(leaderOf(new Map([[1, 5], [2, 5]]))).toBeNull();
    expect(leaderOf(new Map([[1, 0], [2, 0]]))).toBeNull();
  });

  it("finalists: top 3 by stars, ties by best single-round rank", () => {
    const stars = new Map([[1, 10], [2, 12], [3, 10], [4, 3], [5, 10]]);
    const best = new Map([[1, 2], [2, 1], [3, 1], [4, 1], [5, 3]]);
    expect(pickFinalists(stars, best, rng(1))).toEqual([2, 3, 1]);
  });

  it("teams are balanced by a snake draft", () => {
    const stars = new Map([[1, 10], [2, 9], [3, 8], [4, 7], [5, 6], [6, 5]]);
    const t = splitTeams([1, 2, 3, 4, 5, 6], stars);
    const sum = (team: number) => [...t].filter(([, x]) => x === team).reduce((a, [id]) => a + stars.get(id)!, 0);
    expect([...t.values()].filter((x) => x === 0)).toHaveLength(3);
    expect(Math.abs(sum(0) - sum(1))).toBeLessThanOrEqual(5);
  });
});

describe("round levels", () => {
  it.each(ROUNDS.map((r) => [r.id, r] as const))("%s builds deterministically and spawns everyone on solid ground", (_id, round) => {
    const a = round.build(42, 8);
    const b = round.build(42, 8);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const sim = new Sim(a, 1, "offline");
    sim.epoch = 1; // the round starts after a short wait, like intro + countdown
    const spawns = (a.spawns ?? [a.spawn]).slice(0, 8);
    const ws = spawns.map((p) => sim.addWobbler(p, "idle"));
    for (let i = 0; i < 90; i++) sim.step();
    for (const w of ws) expect(w.state, `spawn ${JSON.stringify(w.home)}`).not.toBe("out");
    for (const w of ws) expect(w.grounded, `spawn ${JSON.stringify(w.home)}`).toBe(true);
  });

  it("no start position is unsafe before GO or in the first 2 s after it (Turbo Traps, 16 players)", () => {
    for (const round of ROUNDS) {
      for (let seed = 1; seed <= 8; seed++) {
        const lvl = round.build(seed, 16);
        const sim = new Sim(lvl, 1, "offline");
        sim.epoch = 1;
        sim.setRule("turbo-traps");
        const list = lvl.spawns ?? [lvl.spawn];
        const ws = Array.from({ length: Math.min(16, round.players.max) }, (_, i) => sim.addWobbler(list[i % list.length], "idle"));
        for (let i = 0; i < 180; i++) sim.step();
        for (const w of ws) expect(w.state, `${round.id} seed ${seed} at ${JSON.stringify(w.home)}`).not.toBe("ragdoll");
        for (const w of ws) expect(w.state, `${round.id} seed ${seed} at ${JSON.stringify(w.home)}`).not.toBe("out");
      }
    }
  });

  it("race finish zones and the summit sit on solid ground", () => {
    for (const r of ROUNDS) {
      const lvl = r.build(1, 6);
      const z = lvl.finish ?? lvl.summit;
      if (!z) continue;
      const sim = new Sim({ ...lvl, hazards: [] }, 1, "offline");
      const w = sim.addWobbler({ x: z.pos.x, y: z.pos.y + 1, z: z.pos.z }, "idle");
      for (let i = 0; i < 90; i++) sim.step();
      expect(w.grounded, r.id).toBe(true);
      expect(inZone(z, w.pos), r.id).toBe(true);
    }
  });

  it("Ice Floes: floes carry you and sinking ones drop you in the water (out for the round)", () => {
    const lvl = ROUNDS.find((r) => r.id === "ice-floes")!.build(7, 6);
    const sim = new Sim(lvl, 1, "offline");
    const w = sim.addWobbler(lvl.spawns![0], "idle");
    for (let i = 0; i < 60 * 100; i++) sim.step();
    expect(w.state).toBe("out");
    expect(w.outUntil).toBe(Infinity);
  });
});

// ───────────────────────── Full show on the server runner ─────────────────────────

class FakeHost implements ShowHost {
  sim: Sim;
  msgs: ShowMsg[] = [];
  ids = [100, 101, 102, 103, 104, 105];
  constructor() {
    this.sim = new Sim(ROUNDS[0].build(1, 6), 1, "server");
  }
  playerIds() {
    return this.ids;
  }
  nameOf(id: number) {
    return `P${id}`;
  }
  loadLevel(level: LevelDef, epochTick: number, spawns: Map<number, Vec3>) {
    const tick = this.sim.tick;
    this.sim = new Sim(level, 1, "server");
    this.sim.jumpTo(tick);
    this.sim.epoch = epochTick * DT;
    for (const id of this.ids) {
      const w = this.sim.addWobbler(spawns.get(id)!, "remote", id % 8, id);
      w.net = netStateOf(w, this.sim.time);
    }
  }
  broadcastShow(m: ShowMsg) {
    this.msgs.push(m);
  }
  /** Pretend a player reported this state. */
  report(id: number, patch: Partial<NetState>) {
    const w = this.sim.get(id)!;
    w.net = { ...w.net!, ...patch };
  }
}

type Internals = { plan: typeof ROUNDS; index: number; goalPause: number; nextRound(): void };
const internals = (r: ShowRunner) => r as unknown as Internals;

function runUntil(host: FakeHost, runner: ShowRunner, pred: () => boolean, maxTicks = 60 * 400) {
  for (let i = 0; i < maxTicks && !pred(); i++) {
    host.sim.step();
    runner.tick();
  }
  expect(pred()).toBe(true);
}

describe("ShowRunner", () => {
  it("plays a whole 6-player show: rounds, stars, Final, champion, back to lobby", () => {
    const host = new FakeHost();
    const runner = new ShowRunner(host, rng(9));
    expect(runner.start()).toBe(true);
    const seen: string[] = [];
    let rounds = 0;
    while (!runner.info?.final) {
      seen.push(runner.round!.id);
      runUntil(host, runner, () => runner.phase === "play");
      const r = runner.round!;
      const ids = host.ids;
      if (r.category === "race") ids.forEach((id) => host.report(id, { pos: { ...runner.level.finish!.pos } }));
      if (r.category === "survival") ids.slice(1).forEach((id) => host.report(id, { state: "out" }));
      if (r.category === "team") {
        for (let g = 0; g < 3 && runner.phase === "play"; g++) {
          host.sim.balls[0].setTranslation(runner.level.goals![0].zone.pos, true);
          host.sim.balls[0].setLinvel({ x: 0, y: 0, z: 0 }, true);
          runUntil(host, runner, () => (runner.goals?.[1] ?? 0) > g || runner.phase !== "play", 200);
          runUntil(host, runner, () => internals(runner).goalPause === 0 || runner.phase !== "play", 200);
        }
      }
      runUntil(host, runner, () => runner.phase === "results");
      expect(runner.results).toHaveLength(6);
      if (r.category === "team") expect(runner.goals).toEqual([0, 3]);
      rounds++;
      runUntil(host, runner, () => runner.phase === "intro");
    }
    expect(rounds).toBe(5);
    expect(new Set(seen).size).toBe(5);
    const total = [...runner.stars.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(5 * 6);
    // Final: 3 finalists; first to the summit wins.
    expect(runner.participants).toHaveLength(3);
    runUntil(host, runner, () => runner.phase === "play");
    const winner = runner.participants[2];
    host.report(winner, { pos: { ...runner.level.summit!.pos } });
    runUntil(host, runner, () => runner.phase === "results");
    expect(runner.champion).toBe(winner);
    runUntil(host, runner, () => runner.phase === "podium");
    expect(runner.podium![0]).toBe(winner);
    expect(runner.podium).toHaveLength(6);
    runUntil(host, runner, () => runner.phase === "lobby");
    expect(host.msgs.length).toBeGreaterThan(20);
  });

  it("crown: pick up, score while held, drop when ragdolled, Bounty for knocking the leader off", () => {
    const host = new FakeHost();
    const runner = new ShowRunner(host, rng(4));
    runner.start();
    const { plan } = internals(runner);
    const hunt = ROUNDS.find((r) => r.category === "hunt")!;
    plan.splice(0, plan.length, hunt, ...plan.filter((r) => r !== hunt));
    internals(runner).index = 0;
    runner.stars.set(100, 5); // P100 leads
    internals(runner).nextRound();
    expect(runner.round!.id).toBe("crown-grab");
    runUntil(host, runner, () => runner.phase === "play");
    const crown = runner.level.crown!;
    host.report(100, { pos: { x: crown.x + 0.3, y: crown.y - 0.3, z: crown.z } });
    runUntil(host, runner, () => runner.crown?.holder === 100, 120);
    runUntil(host, runner, () => (runner.points.get(100) ?? 0) > 1, 200);
    runner.onInteraction({ k: "knock", from: 101, target: 100, imp: { x: 0, y: 3, z: 5 }, rag: true });
    host.report(100, { state: "ragdoll" });
    runUntil(host, runner, () => runner.crown?.holder !== 100, 10);
    expect(runner.msg().toasts.some((t) => t.text.includes("Bounty"))).toBe(true);
    // The loose crown lands and rests on the floor.
    runUntil(host, runner, () => runner.crown!.vel.y === 0, 200);
    expect(runner.crown!.pos.y).toBeGreaterThan(0);
    expect(runner.crown!.pos.y).toBeLessThan(1.5);
  });

  it("House Rules: from round 2 the last-place player spins a modifier the sim applies", () => {
    const host = new FakeHost();
    const runner = new ShowRunner(host, rng(11));
    runner.start();
    expect(runner.info!.rule).toBeNull();
    runner.stars = new Map(host.ids.map((id, i) => [id, 10 - i])); // P105 is last
    internals(runner).nextRound();
    expect(runner.info!.index).toBe(2);
    expect(runner.info!.rule).not.toBeNull();
    expect(runner.info!.ruleBy).toBe(105);
    expect(host.sim.rules).not.toEqual({ gravity: 1, hazardSpeed: 1, floor: null });
    expect(runner.msg().toasts.some((t) => t.text.includes("House Rule"))).toBe(true);
  });

  it("Moon Bounce makes jumps higher; Turbo Traps speeds hazards up", () => {
    const peak = (rule: string | null) => {
      const sim = new Sim(ROUNDS[0].build(1, 1), 1, "offline");
      sim.setRule(rule);
      const w = sim.addWobbler({ x: 0, y: 1, z: 4 }, "player");
      for (let i = 0; i < 30; i++) sim.step();
      const y0 = w.pos.y;
      let top = y0;
      sim.step(new Map([[w.id, { mx: 0, mz: 0, jump: true, dive: false, grab: false }]]));
      for (let i = 0; i < 120; i++) {
        sim.step();
        top = Math.max(top, w.pos.y);
      }
      return top - y0;
    };
    expect(peak("moon-bounce")).toBeGreaterThan(peak(null) * 1.6);
    const sim = new Sim(ROUNDS[0].build(1, 1), 1, "offline");
    sim.setRule("turbo-traps");
    sim.jumpTo(600);
    expect(sim.hazardTime()).toBeCloseTo(10 * 1.35);
  });

  it("a Gremlin can start an avalanche in the Final, with a cooldown", () => {
    const host = new FakeHost();
    const runner = new ShowRunner(host, rng(5));
    runner.start();
    internals(runner).index = internals(runner).plan.length;
    internals(runner).nextRound();
    expect(runner.info!.final).toBe(true);
    runUntil(host, runner, () => runner.phase === "play");
    const gremlin = host.ids.find((id) => !runner.participants.includes(id))!;
    expect(runner.gremlin(runner.participants[0])).toBe(false);
    expect(runner.gremlin(gremlin)).toBe(true);
    expect(runner.gremlin(gremlin)).toBe(false);
    expect(runner.extra).toHaveLength(1);
  });
});
