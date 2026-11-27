import type { HazardDef } from "../hazards";
import type { LevelDef, SolidDef } from "../level";
import { Sim, type InputFrame, NO_INPUT, type Wobbler } from "../sim";

export function level(solids: SolidDef[], extra: Partial<LevelDef> = {}): LevelDef {
  return {
    id: "test",
    name: "Test",
    island: "candy",
    spawn: { x: 0, y: 1, z: 0 },
    killY: -10,
    solids,
    hazards: [],
    balls: [],
    dummies: [],
    ...extra,
  };
}

export const floor = (surface: SolidDef["surface"] = "normal", extra: Partial<SolidDef> = {}): SolidDef => ({
  pos: { x: 0, y: -0.5, z: 0 },
  size: { x: 60, y: 1, z: 60 },
  surface,
  respawn: { x: 0, y: 1, z: 0 },
  ...extra,
});

export function world(solids: SolidDef[], hazards: HazardDef[] = [], extra: Partial<LevelDef> = {}) {
  return new Sim(level(solids, { hazards, ...extra }));
}

/** Run `ticks` steps feeding `input(tick)` to the given players. */
export function run(sim: Sim, ticks: number, input: (tick: number) => Map<number, InputFrame> = () => new Map()) {
  for (let i = 0; i < ticks; i++) sim.step(input(i));
}

export const hold = (w: Wobbler, frame: Partial<InputFrame>) => new Map([[w.id, { ...NO_INPUT, ...frame }]]);

/** Let a freshly spawned Wobbler drop onto the floor. */
export function settle(sim: Sim, ticks = 60) {
  run(sim, ticks);
}
