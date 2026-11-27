import { beforeAll, describe, expect, it } from "vitest";
import { hazardPose, pressExtension } from "../hazards";
import { SANDBOX } from "../level";
import { DT, Sim, initPhysics, pointVelocity } from "../sim";
import { TUNING, resetTuning } from "../tuning";
import { floor, hold, run, settle, world } from "./helpers";

beforeAll(async () => {
  await initPhysics();
  resetTuning();
});

describe("grab and throw", () => {
  const pair = () => {
    const sim = world([floor()]);
    const a = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    const b = sim.addWobbler({ x: 0, y: 1, z: 1.2 }, "player");
    settle(sim);
    return { sim, a, b };
  };

  it("grabs the Wobbler in front and carries them", () => {
    const { sim, a, b } = pair();
    run(sim, 5, () => hold(a, { grab: true }));
    expect(a.holding).toBe(b.id);
    expect(b.state).toBe("held");
    run(sim, 30, () => hold(a, { grab: true, mx: 1 }));
    expect(Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z)).toBeLessThan(1.2);
  });

  it("does not grab someone behind you", () => {
    const sim = world([floor()]);
    const a = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    sim.addWobbler({ x: 0, y: 1, z: -1.2 }, "player");
    settle(sim);
    run(sim, 5, () => hold(a, { grab: true }));
    expect(a.holding).toBeNull();
  });

  it("releasing the button throws them into a ragdoll", () => {
    const { sim, a, b } = pair();
    run(sim, 10, () => hold(a, { grab: true }));
    sim.step(hold(a, { grab: false }));
    expect(sim.events.some((e) => e.type === "throw")).toBe(true);
    expect(b.state).toBe("ragdoll");
    const z0 = b.pos.z;
    run(sim, 20);
    expect(b.pos.z - z0).toBeGreaterThan(1.5);
  });

  it("auto-releases after the max hold time and blocks an instant re-grab", () => {
    const { sim, a, b } = pair();
    run(sim, Math.ceil(TUNING.grab.maxHold / DT) + 2, () => hold(a, { grab: true }));
    expect(a.holding).toBeNull();
    expect(b.state).toBe("normal");
    run(sim, 5, () => hold(a, { grab: true }));
    expect(a.holding).toBeNull();
  });

  it("mashing jump wriggles free sooner", () => {
    const { sim, a, b } = pair();
    run(sim, 2, () => hold(a, { grab: true }));
    let freedAt = -1;
    for (let i = 0; i < 400 && freedAt < 0; i++) {
      const inputs = hold(a, { grab: true });
      inputs.set(b.id, { mx: 0, mz: 0, jump: i % 6 === 0, dive: false, grab: false });
      sim.step(inputs);
      if (a.holding == null) freedAt = i;
    }
    expect(freedAt).toBeGreaterThan(0);
    expect(freedAt * DT).toBeLessThan(TUNING.grab.maxHold * 0.6);
  });
});

describe("hazards", () => {
  it("are pure functions of time", () => {
    for (const h of SANDBOX.hazards) expect(hazardPose(h, 1.234)).toEqual(hazardPose(h, 1.234));
  });

  it("press cycle: up, slam, down, rise", () => {
    expect(pressExtension(0.2)).toBe(0);
    expect(pressExtension(0.6)).toBe(1);
    expect(pressExtension(0.53)).toBeGreaterThan(0);
    expect(pressExtension(0.53)).toBeLessThan(1);
    expect(pressExtension(0.9)).toBeGreaterThan(0);
    expect(pressExtension(1.2)).toBe(0);
  });

  it("point velocity of a sweeper tip matches ω × r", () => {
    const sweeper = SANDBOX.hazards.find((h) => h.kind === "sweeper")!;
    if (sweeper.kind !== "sweeper") throw new Error();
    const t = 0.5;
    const pose = hazardPose(sweeper, t);
    const r = 5;
    // A point on the bar at distance r from the centre, at time t.
    const angle = sweeper.speed * t;
    const p = { x: pose.pos.x + Math.cos(angle) * r, y: sweeper.height, z: pose.pos.z - Math.sin(angle) * r };
    const v = pointVelocity(sweeper, p, t - DT, t);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(Math.abs(sweeper.speed) * r, 0);
  });

  it("a sweeper knocks a standing Wobbler over and away", () => {
    const sim = world([floor()], [{ kind: "sweeper", pos: { x: 0, y: 0, z: 0 }, armLength: 12, height: 0.55, speed: 2 }]);
    const w = sim.addWobbler({ x: 0, y: 1, z: -4 }, "idle");
    let hit = false;
    run(sim, 240, () => {
      if (sim.events.some((e) => e.type === "hazardHit")) hit = true;
      return new Map();
    });
    expect(hit).toBe(true);
    expect(Math.hypot(w.pos.x, w.pos.z - -4)).toBeGreaterThan(1);
  });

  it("respawn invulnerability ignores hazards briefly", () => {
    const sim = world([floor()], [{ kind: "sweeper", pos: { x: 0, y: 0, z: 0 }, armLength: 12, height: 0.55, speed: 2 }]);
    const w = sim.addWobbler({ x: 0, y: 1, z: -4 }, "idle");
    w.invulnUntil = 999;
    run(sim, 240);
    expect(sim.events.some((e) => e.type === "hazardHit")).toBe(false);
  });
});

describe("sandbox level", () => {
  it("builds and runs with dummies for 10 seconds without anyone stuck in the void", () => {
    const sim = new Sim(SANDBOX);
    const player = sim.addWobbler(SANDBOX.spawn, "player");
    run(sim, 600, (i) => hold(player, { mx: Math.sin(i / 60), mz: Math.cos(i / 90), jump: i % 70 === 0 }));
    for (const w of sim.wobblers) {
      expect(Number.isFinite(w.pos.x) && Number.isFinite(w.pos.y)).toBe(true);
      expect(w.state === "out" || w.pos.y > SANDBOX.killY).toBe(true);
    }
  });

  it("wander bots keep moving around the hub", () => {
    const sim = new Sim(SANDBOX, 7);
    const bots = Array.from({ length: 8 }, (_, i) => sim.addWobbler({ x: (i % 4) * 2 - 3, y: 1, z: Math.floor(i / 4) * 2 - 1 }, "wander"));
    const start = bots.map((b) => ({ ...b.pos }));
    run(sim, 300);
    const moved = bots.filter((b, i) => Math.hypot(b.pos.x - start[i].x, b.pos.z - start[i].z) > 1).length;
    expect(moved).toBeGreaterThanOrEqual(6);
  });
});

describe("stability", () => {
  it("two Wobblers overlapping never launch each other", () => {
    const sim = world([floor()]);
    const a = sim.addWobbler({ x: 0, y: 1, z: 0 }, "pace");
    const b = sim.addWobbler({ x: 0.05, y: 1, z: 0.05 }, "pace");
    let maxSpeed = 0;
    run(sim, 600, () => {
      maxSpeed = Math.max(maxSpeed, Math.hypot(a.vel.x, a.vel.z), Math.hypot(b.vel.x, b.vel.z));
      return new Map();
    });
    expect(maxSpeed).toBeLessThan(TUNING.move.runSpeed + 2);
  });

  it("respawns beside, not inside, someone standing on the respawn point", () => {
    const sim = world([floor()]);
    const a = sim.addWobbler({ x: 0, y: 1, z: 0 }, "idle");
    const b = sim.addWobbler({ x: 5, y: 1, z: 0 }, "idle");
    settle(sim);
    b.respawnPoint = { x: 0, y: 1, z: 0 };
    sim.forceRespawn(b);
    run(sim, 2);
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(0.7);
  });

  it("the sandbox stays sane for 60 s of dummies and bots", () => {
    const sim = new Sim(SANDBOX, 3);
    for (let i = 0; i < 8; i++) sim.addWobbler({ x: i - 4, y: 1, z: 2 }, "wander");
    let worst = 0;
    run(sim, 3600, () => {
      for (const w of sim.wobblers) worst = Math.max(worst, Math.hypot(w.vel.x, w.vel.z), w.pos.y);
      return new Map();
    });
    expect(worst).toBeLessThanOrEqual(25.01);
  });
});
