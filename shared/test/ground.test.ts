// Regression: standing still used to let the capsule creep into the floor until the character
// controller refused to move at all ("stuck at spawn").
import { beforeAll, expect, it } from "vitest";
import { NO_INPUT, Sim, WOBBLER_CENTER, initPhysics } from "../sim";
import { resetTuning } from "../tuning";
import { floor, level } from "./helpers";

beforeAll(async () => {
  await initPhysics();
  resetTuning();
});

it("a Wobbler that stood still for 20 s can still run off", () => {
  const sim = new Sim(level([floor()]), 1, "offline");
  const w = sim.addWobbler({ x: 0, y: 1, z: 0 }, "player", 0);
  for (let i = 0; i < 1200; i++) sim.step();
  expect(w.pos.y).toBeGreaterThanOrEqual(WOBBLER_CENTER - 0.005);
  for (let i = 0; i < 60; i++) sim.step(new Map([[w.id, { ...NO_INPUT, mz: 1 }]]));
  expect(w.pos.z).toBeGreaterThan(4);
});
