// Networked interactions without sockets: two client Sims and a server Sim exchanging
// state and outbox messages in memory, with an optional delay in ticks.

import { beforeAll, describe, expect, it } from "vitest";
import { netStateOf, packNet, unpackNet } from "../protocol";
import type { Vec3 } from "../math";
import { NO_INPUT, Sim, initPhysics, type InputFrame, type NetMsg } from "../sim";
import { resetTuning } from "../tuning";
import { floor, level } from "./helpers";

beforeAll(async () => {
  await initPhysics();
  resetTuning();
});

const A = 1;
const B = 2;

class Harness {
  server = new Sim(level([floor()]), 1, "server");
  a = new Sim(level([floor()]), 1, "client");
  b = new Sim(level([floor()]), 1, "client");
  private queue: { at: number; run: () => void }[] = [];
  tick = 0;

  constructor(
    aPos: Vec3,
    bPos: Vec3,
    private delay = 0,
  ) {
    this.server.addWobbler(aPos, "remote", 0, A);
    this.server.addWobbler(bPos, "remote", 1, B);
    this.a.addWobbler(aPos, "player", 0, A);
    this.a.addWobbler(bPos, "remote", 1, B);
    this.b.addWobbler(aPos, "remote", 0, A);
    this.b.addWobbler(bPos, "player", 1, B);
    for (const [sim, id] of [
      [this.a, B],
      [this.b, A],
      [this.server, A],
      [this.server, B],
    ] as const) {
      const w = sim.get(id)!;
      w.net = netStateOf(w, 0);
    }
    this.run(60);
  }

  get aw() {
    return this.a.get(A)!;
  }
  get bw() {
    return this.b.get(B)!;
  }
  /** B as seen by A (remote proxy). */
  get bOnA() {
    return this.a.get(B)!;
  }

  private later(fn: () => void) {
    this.queue.push({ at: this.tick + this.delay, run: fn });
  }

  /** Owner of a Wobbler id. */
  private sim(id: number) {
    return id === A ? this.a : this.b;
  }

  run(ticks: number, inputA: Partial<InputFrame> | ((i: number) => Partial<InputFrame>) = {}, inputB: Partial<InputFrame> | ((i: number) => Partial<InputFrame>) = {}) {
    for (let i = 0; i < ticks; i++) {
      this.tick++;
      const ia = typeof inputA === "function" ? inputA(i) : inputA;
      const ib = typeof inputB === "function" ? inputB(i) : inputB;
      this.a.step(new Map([[A, { ...NO_INPUT, ...ia }]]));
      this.b.step(new Map([[B, { ...NO_INPUT, ...ib }]]));
      this.server.step();
      // Uploads: own state (packed, like the real wire) + outbox.
      for (const [sim, id] of [
        [this.a, A],
        [this.b, B],
      ] as const) {
        const packed = packNet(id, netStateOf(sim.get(id)!, sim.time));
        const out = sim.outbox.splice(0);
        this.later(() => {
          const n = unpackNet(packed)!.net;
          this.server.get(id)!.net = n;
          // Server → other client (snapshot)
          const other = id === A ? this.b : this.a;
          const proxy = other.get(id);
          if (proxy) proxy.net = n;
          for (const m of out) this.deliver(m);
        });
      }
      this.server.outbox.splice(0).forEach((m) => this.deliver(m));
      const due = this.queue.filter((q) => q.at <= this.tick);
      this.queue = this.queue.filter((q) => q.at > this.tick);
      due.forEach((q) => q.run());
    }
  }

  private deliver(m: NetMsg) {
    this.later(() => {
      const owner = this.sim(m.target);
      const ok = owner.applyRemote(m);
      if (!ok && m.k === "grab") this.sim(m.from).applyRemote({ k: "drop", from: m.target, target: m.from });
      owner.outbox.splice(0).forEach((x) => this.deliver(x));
    });
  }
}

describe.each([0, 5])("networked interactions (delay %i ticks)", (delay) => {
  it("a dive tackle on a remote Wobbler ragdolls them on their own machine", () => {
    const h = new Harness({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 2.2 }, delay);
    h.run(1, { dive: true });
    let ragdolled = false;
    h.run(60, {}, () => {
      if (h.bw.state === "ragdoll") ragdolled = true;
      return {};
    });
    expect(ragdolled).toBe(true);
    expect(h.bw.pos.z).toBeGreaterThan(2.5);
  });

  it("grab → carry → throw across machines", () => {
    const h = new Harness({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1.2 }, delay);
    h.run(10 + delay, { grab: true });
    expect(h.aw.holding).toBe(B);
    expect(h.bw.state).toBe("held");
    expect(h.bw.heldBy).toBe(A);
    // Carry forward: B follows A on B's own machine.
    h.run(40, { grab: true, mz: 1 });
    expect(h.bw.state).toBe("held");
    expect(Math.hypot(h.bw.pos.x - h.aw.pos.x, h.bw.pos.z - h.aw.pos.z)).toBeLessThan(2.5);
    // Release = throw.
    const z0 = h.bw.pos.z;
    let thrown = false;
    h.run(40 + delay, {}, () => {
      if (h.bw.state === "ragdoll") thrown = true;
      return {};
    });
    expect(thrown).toBe(true);
    expect(h.aw.holding).toBeNull();
    expect(h.bw.pos.z - z0).toBeGreaterThan(1);
  });

  it("mashing jump on your own machine breaks a remote player's hold", () => {
    const h = new Harness({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1.2 }, delay);
    h.run(10 + delay, { grab: true });
    expect(h.bw.state).toBe("held");
    let freedAt = -1;
    h.run(
      150,
      { grab: true },
      (i) => {
        if (freedAt < 0 && h.aw.holding == null) freedAt = i;
        return { jump: i % 6 === 0 };
      },
    );
    expect(freedAt).toBeGreaterThan(0);
    expect(freedAt).toBeLessThan(110); // well under the 3 s max hold
  });

  it("stomping a remote head squashes them on their machine", () => {
    const h = new Harness({ x: 0.05, y: 3.2, z: 0 }, { x: 0, y: 1, z: 0 }, delay);
    let squashed = false;
    h.run(40, {}, () => {
      if (h.b.time < h.bw.squashedUntil) squashed = true;
      return {};
    });
    expect(squashed).toBe(true);
  });

  it("a remote grab on someone who already fell out is refused and the holder lets go", () => {
    const h = new Harness({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1.2 }, delay);
    // B falls out on their own machine, but A still sees the stale proxy.
    h.b.forceRespawn(h.bw);
    h.bw.outUntil = 1e9;
    h.bOnA.net = { ...h.bOnA.net!, state: "normal" };
    h.a.step(new Map([[A, { ...NO_INPUT, grab: true }]]));
    expect(h.aw.holding).toBe(B);
    h.run(10 + delay * 2, { grab: true });
    expect(h.aw.holding).toBeNull();
  });
});

describe("server-owned dummies", () => {
  it("a client tackle is applied to a server NPC", () => {
    const server = new Sim(level([floor()], { dummies: [{ pos: { x: 0, y: 1, z: 3 }, behaviour: "idle" }] }), 1, "server");
    const dummy = server.wobblers[0];
    for (let i = 0; i < 60; i++) server.step();
    expect(server.applyRemote({ k: "knock", from: 99, target: dummy.id, imp: { x: 0, y: 3, z: 6 }, rag: true })).toBe(true);
    expect(dummy.state).toBe("ragdoll");
  });

  it("clients don't create dummies or simulate balls themselves", () => {
    const lvl = level([floor()], { dummies: [{ pos: { x: 0, y: 1, z: 3 }, behaviour: "idle" }], balls: [{ pos: { x: 3, y: 2, z: 0 }, radius: 1 }] });
    const client = new Sim(lvl, 1, "client");
    expect(client.wobblers).toHaveLength(0);
    const y0 = client.balls[0].translation().y;
    for (let i = 0; i < 30; i++) client.step();
    expect(client.balls[0].translation().y).toBeCloseTo(y0, 3); // proxy: gravity doesn't apply
  });
});

describe("wire format", () => {
  it("packs and unpacks a Wobbler state within a centimetre", () => {
    const n = {
      pos: { x: 1.234, y: -5.678, z: 90.12 },
      vel: { x: -3.21, y: 4.5, z: 0 },
      facing: 2.5,
      state: "ragdoll" as const,
      grounded: true,
      grabbing: false,
      squashed: true,
      invulnerable: false,
      holding: 7,
      heldBy: null,
    };
    const u = unpackNet(packNet(42, n))!;
    expect(u.id).toBe(42);
    expect(u.net.pos.x).toBeCloseTo(1.234, 2);
    expect(u.net.pos.z).toBeCloseTo(90.12, 2);
    expect(u.net.facing).toBeCloseTo(2.5, 2);
    expect(u.net).toMatchObject({ state: "ragdoll", grounded: true, squashed: true, holding: 7, heldBy: null });
  });

  it("rejects malformed packets", () => {
    expect(unpackNet([1, 2, 3] as number[])).toBeNull();
    expect(unpackNet([1, 0, 0, 0, 0, 0, 0, 0, 99, 0, 0, 0])).toBeNull();
    expect(unpackNet([1, 0, 0, NaN, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});
