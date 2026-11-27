// In-game tuning panel (lil-gui). Edits TUNING live, persists to localStorage, and can copy JSON
// so good values can be committed back into shared/tuning.ts.

import GUI from "lil-gui";
import { TUNING, applyTuning, resetTuning } from "../../../shared/tuning";

const KEY = "wobble-isles.tuning";

export interface DebugOptions {
  timeScale: number;
  showColliders: boolean;
  reduceMotion: boolean;
}

export function createTuningPanel(debug: DebugOptions, actions: { respawn: () => void }) {
  try {
    applyTuning(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    /* ignore corrupt storage */
  }
  const save = () => localStorage.setItem(KEY, JSON.stringify(TUNING));

  const gui = new GUI({ title: "Tuning (` to toggle)", width: 300 });
  gui.close();

  const ranges: Record<string, [number, number, number]> = {
    runSpeed: [2, 12, 0.1],
    groundAccel: [5, 120, 1],
    groundDecel: [5, 120, 1],
    airControl: [0, 1, 0.01],
    turnRate: [2, 40, 0.5],
    height: [0.3, 5, 0.05],
    gravity: [5, 60, 0.5],
    fallGravityMul: [1, 3, 0.05],
    maxFallSpeed: [5, 60, 1],
    coyoteTime: [0, 0.3, 0.01],
    bufferTime: [0, 0.3, 0.01],
    speed: [1, 20, 0.1],
    hop: [0, 10, 0.1],
    slideFriction: [0, 30, 0.5],
    slideTime: [0, 2, 0.05],
    getUpTime: [0, 1, 0.05],
    cooldown: [0, 2, 0.05],
    range: [0.3, 3, 0.05],
    coneDeg: [10, 180, 1],
    holdSlowdown: [0.2, 1, 0.01],
    maxHold: [0.5, 8, 0.1],
    regrabCooldown: [0, 3, 0.1],
    mashBreak: [0, 1.5, 0.05],
    throwSpeed: [0, 20, 0.5],
    throwUp: [0, 12, 0.25],
    minTime: [0.2, 3, 0.05],
    maxTime: [0.2, 4, 0.05],
    friction: [0, 30, 0.5],
    hardLandingSpeed: [5, 40, 0.5],
    knockbackThreshold: [1, 20, 0.25],
    boostHeight: [0.5, 6, 0.1],
    squashTime: [0, 2, 0.05],
    squashSlow: [0.1, 1, 0.05],
    slideOff: [0, 6, 0.1],
    minNormalY: [0.2, 0.95, 0.05],
    shove: [0, 6, 0.1],
    tackleMul: [0, 2, 0.05],
    tackleUp: [0, 10, 0.25],
    knockbackMul: [0, 3, 0.05],
    minKnockback: [0, 20, 0.25],
    upKick: [0, 10, 0.25],
    iceAccelMul: [0.02, 1, 0.01],
    iceDecelMul: [0.01, 1, 0.01],
    stickySpeedMul: [0.1, 1, 0.01],
    bounceMul: [0.5, 5, 0.05],
    killY: [-50, 0, 1],
    delay: [0, 5, 0.1],
    invulnerable: [0, 5, 0.1],
  };

  const controllers: { updateDisplay(): void }[] = [];
  for (const [group, values] of Object.entries(TUNING)) {
    const f = gui.addFolder(group);
    f.close();
    for (const key of Object.keys(values)) {
      const [min, max, step] = ranges[key] ?? [0, 100, 0.1];
      controllers.push(f.add(values as Record<string, number>, key, min, max, step).onChange(save));
    }
  }

  const dbg = gui.addFolder("debug");
  dbg.add(debug, "timeScale", 0.1, 1, 0.05).name("slow motion");
  dbg.add(debug, "showColliders").name("show colliders");
  dbg.add(debug, "reduceMotion").name("reduce motion");

  gui
    .add(
      {
        reset() {
          resetTuning();
          localStorage.removeItem(KEY);
          controllers.forEach((c) => c.updateDisplay());
        },
      },
      "reset",
    )
    .name("Reset to defaults");
  gui
    .add(
      {
        async copy() {
          await navigator.clipboard.writeText(JSON.stringify(TUNING, null, 2));
        },
      },
      "copy",
    )
    .name("Copy tuning JSON");
  gui.add(actions, "respawn").name("Respawn me (R)");

  let shown = true;
  addEventListener("keydown", (e) => {
    if (e.code !== "Backquote") return;
    shown = !shown;
    if (shown) gui.show();
    else gui.hide();
  });
  return gui;
}
