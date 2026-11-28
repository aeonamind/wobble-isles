// Fail Cam (DESIGN.md §3.5): records the round, remembers the funniest wipe-outs and replays the best
// one in slow motion when the round ends. Purely client-side: each player sees what their own client saw.

import type { WobblerFrame } from "./render/wobbler";

interface Rec {
  /** Sim time (s). */
  t: number;
  /** Hazard time at that moment. */
  ht: number;
  w: Map<number, WobblerFrame>;
}

export interface Moment {
  t: number;
  id: number;
  score: number;
  label: string;
}

const RECORD_EVERY = 2; // ticks (30 Hz)
const MAX_SECONDS = 150;
export const REPLAY_BEFORE = 1.8;
export const REPLAY_AFTER = 1.4;
export const REPLAY_SPEED = 0.6;

export class FailCam {
  private frames: Rec[] = [];
  private moments: Moment[] = [];
  private tick = 0;

  reset() {
    this.frames = [];
    this.moments = [];
  }

  record(t: number, ht: number, frames: Map<number, WobblerFrame>) {
    if (this.tick++ % RECORD_EVERY) return;
    this.frames.push({ t, ht, w: frames });
    while (this.frames.length && this.frames[0].t < t - MAX_SECONDS) this.frames.shift();
  }

  note(m: Moment) {
    this.moments.push(m);
  }

  /** The funniest moment that has enough recording on both sides. */
  best(minScore = 2): Moment | null {
    const last = this.frames[this.frames.length - 1]?.t ?? 0;
    const ok = this.moments.filter((m) => m.score >= minScore && m.t + REPLAY_AFTER <= last + 0.05 && m.t - REPLAY_BEFORE >= (this.frames[0]?.t ?? Infinity));
    ok.sort((a, b) => b.score - a.score || b.t - a.t);
    return ok[0] ?? null;
  }

  /** Recorded state at time t (positions interpolated, discrete fields from the nearer frame). */
  sample(t: number): { ht: number; w: Map<number, WobblerFrame> } | null {
    const f = this.frames;
    if (!f.length) return null;
    let i = f.findIndex((r) => r.t >= t);
    if (i < 0) i = f.length - 1;
    const b = f[i];
    const a = f[Math.max(0, i - 1)];
    const span = b.t - a.t;
    const k = span > 0 ? Math.max(0, Math.min(1, (t - a.t) / span)) : 1;
    const w = new Map<number, WobblerFrame>();
    for (const [id, fb] of b.w) {
      const fa = a.w.get(id) ?? fb;
      const near = k < 0.5 ? fa : fb;
      const jump = Math.hypot(fb.x - fa.x, fb.y - fa.y, fb.z - fa.z) > 4;
      const kk = jump ? 1 : k;
      w.set(id, { ...near, x: fa.x + (fb.x - fa.x) * kk, y: fa.y + (fb.y - fa.y) * kk, z: fa.z + (fb.z - fa.z) * kk });
    }
    return { ht: a.ht + (b.ht - a.ht) * k, w };
  }
}
