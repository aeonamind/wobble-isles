// Minimal M1 HUD: controls help, debug stats (F3) and the performance-bench report.

import type { Wobbler } from "../../../shared/sim";

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private frames: number[] = [];
  private statsVisible = false;
  private last = 0;

  constructor() {
    addEventListener("keydown", (e) => {
      if (e.code === "F3") {
        e.preventDefault();
        this.statsVisible = !this.statsVisible;
        $("stats").hidden = !this.statsVisible;
      }
      if (e.code === "KeyH") $("help").hidden = !$("help").hidden;
    });
  }

  setLocked(locked: boolean) {
    $("click-to-play").hidden = locked;
  }

  frame(dt: number, me: Wobbler | undefined, info: string) {
    this.frames.push(dt);
    if (this.frames.length > 120) this.frames.shift();
    const now = performance.now();
    if (!this.statsVisible || now - this.last < 250) return;
    this.last = now;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    const speed = me ? Math.hypot(me.vel.x, me.vel.z).toFixed(1) : "-";
    $("stats").textContent =
      `${(1 / avg).toFixed(0)} FPS  ${(avg * 1000).toFixed(1)} ms\n` +
      (me ? `state ${me.state}  ${me.grounded ? "ground" : "air"}  ${me.groundSurface}\nspeed ${speed} m/s  y ${me.pos.y.toFixed(2)}\n` : "") +
      info;
  }

  benchReport(text: string) {
    const el = $("bench");
    el.hidden = false;
    el.textContent = text;
  }
}
