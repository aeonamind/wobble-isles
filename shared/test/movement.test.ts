import { beforeAll, describe, expect, it } from "vitest";
import { DT, WOBBLER_CENTER, initPhysics, NO_INPUT } from "../sim";
import { TUNING, jumpVelocity, resetTuning } from "../tuning";
import { floor, hold, run, settle, world } from "./helpers";

beforeAll(async () => {
  await initPhysics();
  resetTuning();
});

describe("ground movement", () => {
  it("lands on the floor and stands at capsule height", () => {
    const sim = world([floor()]);
    const w = sim.addWobbler({ x: 0, y: 2, z: 0 }, "player");
    settle(sim);
    expect(w.grounded).toBe(true);
    expect(w.pos.y).toBeCloseTo(WOBBLER_CENTER, 1);
  });

  it("accelerates to run speed and faces the movement direction", () => {
    const sim = world([floor()]);
    const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    settle(sim);
    run(sim, 30, () => hold(w, { mx: 1 }));
    expect(w.vel.x).toBeCloseTo(TUNING.move.runSpeed, 1);
    expect(w.facing).toBeCloseTo(Math.PI / 2, 1);
  });

  it("is deterministic: same inputs give the same result", () => {
    const play = () => {
      const sim = world([floor()]);
      const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
      run(sim, 240, (i) => hold(w, { mx: Math.sin(i / 20), mz: Math.cos(i / 30), jump: i % 50 === 0, dive: i === 150 }));
      return { ...w.pos };
    };
    expect(play()).toEqual(play());
  });
});

describe("jumping", () => {
  it("reaches the tuned apex height", () => {
    const sim = world([floor()]);
    const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    settle(sim);
    const base = w.pos.y;
    let apex = base;
    run(sim, 60, (i) => {
      apex = Math.max(apex, w.pos.y);
      return hold(w, { jump: i === 0 });
    });
    expect(apex - base).toBeGreaterThan(TUNING.jump.height * 0.9);
    expect(apex - base).toBeLessThan(TUNING.jump.height * 1.1);
  });

  it("allows a jump during coyote time after walking off a ledge, but not later", () => {
    const tryJump = (delayTicks: number) => {
      const sim = world([{ pos: { x: 0, y: -0.5, z: 0 }, size: { x: 4, y: 1, z: 4 } }]);
      const w = sim.addWobbler({ x: 1.4, y: 1, z: 0 }, "player");
      settle(sim);
      // Walk right until we leave the ledge.
      let off = -1;
      for (let i = 0; i < 120 && off < 0; i++) {
        sim.step(hold(w, { mx: 1 }));
        if (!w.grounded) off = i;
      }
      run(sim, delayTicks, () => hold(w, { mx: 1 }));
      sim.step(hold(w, { mx: 1, jump: true }));
      return sim.events.some((e) => e.type === "jump");
    };
    expect(tryJump(2)).toBe(true); // ~33 ms after leaving the ledge
    expect(tryJump(Math.ceil(0.2 / DT))).toBe(false);
  });

  it("buffers a jump pressed just before landing", () => {
    const sim = world([floor()]);
    const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    settle(sim);
    sim.step(hold(w, { jump: true }));
    // Fall back down; press jump again a few ticks before touching the ground.
    let jumps = 0;
    for (let i = 0; i < 90; i++) {
      const nearGround = w.vel.y < 0 && w.pos.y < WOBBLER_CENTER + 0.25;
      sim.step(hold(w, { jump: nearGround && jumps === 0 }));
      if (nearGround && jumps === 0) jumps = 1;
      if (sim.events.some((e) => e.type === "jump")) jumps = 2;
    }
    expect(jumps).toBe(2);
  });
});

describe("surfaces", () => {
  const slide = (surface: "normal" | "ice") => {
    const sim = world([floor(surface)]);
    const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    settle(sim);
    run(sim, 40, () => hold(w, { mx: 1 }));
    const start = w.pos.x;
    run(sim, 120);
    return w.pos.x - start;
  };

  it("ice keeps momentum far longer than normal ground", () => {
    expect(slide("ice")).toBeGreaterThan(slide("normal") * 3);
  });

  it("conveyors carry an idle Wobbler along the belt", () => {
    const sim = world([floor("conveyor", { belt: { x: 3, z: 0 } })]);
    const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    settle(sim, 30);
    const start = w.pos.x;
    run(sim, 60);
    expect(w.pos.x - start).toBeGreaterThan(2.5);
  });

  it("bouncers launch higher than a normal jump", () => {
    const sim = world([floor("bouncer")]);
    const w = sim.addWobbler({ x: 0, y: 2.5, z: 0 }, "player");
    let apex = 0;
    let bounced = false;
    for (let i = 0; i < 120; i++) {
      sim.step();
      if (sim.events.some((e) => e.type === "bounce")) bounced = true;
      if (bounced) apex = Math.max(apex, w.pos.y - WOBBLER_CENTER);
    }
    expect(bounced).toBe(true);
    expect(apex).toBeGreaterThan(TUNING.jump.height * 1.5);
  });

  it("sticky ground slows you down", () => {
    const sim = world([floor("sticky")]);
    const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    settle(sim);
    run(sim, 40, () => hold(w, { mx: 1 }));
    expect(w.vel.x).toBeCloseTo(TUNING.move.runSpeed * TUNING.surface.stickySpeedMul, 1);
  });
});

describe("dive", () => {
  it("lunges forward, slides on landing, then gets back up", () => {
    const sim = world([floor()]);
    const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    settle(sim);
    run(sim, 20, () => hold(w, { mz: 1 }));
    sim.step(hold(w, { mz: 1, dive: true }));
    expect(w.state).toBe("dive");
    expect(w.vel.z).toBeGreaterThanOrEqual(TUNING.dive.speed - 0.1);
    const seen = new Set<string>();
    run(sim, 120, () => {
      seen.add(w.state);
      return hold(w, { mz: 1 });
    });
    expect([...seen]).toEqual(expect.arrayContaining(["dive", "slide", "getup", "normal"]));
    expect(w.state).toBe("normal");
  });

  it("dive-tackling another Wobbler knocks them over", () => {
    const sim = world([floor()]);
    const a = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    const b = sim.addWobbler({ x: 0, y: 1, z: 2.2 }, "idle");
    settle(sim);
    sim.step(hold(a, { mz: 1, dive: true }));
    let tackled = false;
    run(sim, 30, () => {
      if (sim.events.some((e) => e.type === "tackle" && e.target === b.id)) tackled = true;
      return hold(a, { mz: 1 });
    });
    expect(tackled).toBe(true);
    expect(b.state === "ragdoll" || b.state === "getup").toBe(true);
    expect(b.pos.z).toBeGreaterThan(2.4);
  });
});

describe("falling out", () => {
  it("respawns at the last respawn point after the delay", () => {
    const sim = world([{ pos: { x: 0, y: -0.5, z: 0 }, size: { x: 4, y: 1, z: 4 }, respawn: { x: 0, y: 1, z: 0 } }]);
    const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player");
    settle(sim);
    let fell = false;
    for (let i = 0; i < 400 && !fell; i++) {
      sim.step(hold(w, { mx: 1 }));
      fell = sim.events.some((e) => e.type === "fall");
    }
    expect(fell).toBe(true);
    expect(w.state).toBe("out");
    run(sim, Math.ceil(TUNING.respawn.delay / DT) + 1);
    expect(w.state).toBe("normal");
    expect(Math.hypot(w.pos.x, w.pos.z)).toBeLessThan(0.5);
  });
});

describe("tuning", () => {
  it("jump velocity follows the tuned height and gravity", () => {
    expect(jumpVelocity()).toBeCloseTo(Math.sqrt(2 * TUNING.jump.gravity * TUNING.jump.height), 6);
    expect(NO_INPUT.grab).toBe(false);
  });
});
