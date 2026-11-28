// Minimal M1 HUD: controls help, debug stats (F3) and the performance-bench report.

import type { RosterEntry } from "../../../shared/protocol";
import type { Wobbler } from "../../../shared/sim";
import { PLAYER_COLORS } from "../render/wobbler";

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private frames: number[] = [];
  private statsVisible = false;
  private last = 0;
  private perfLast = 0;
  private ping: number | null = null;

  constructor() {
    $("perf").hidden = localStorage.getItem("wobble-isles.perf") === "0";
    $("room-copy").onclick = async () => {
      const url = new URL(location.href);
      url.search = new URLSearchParams({ room: $("room-code").textContent ?? "" }).toString();
      await navigator.clipboard?.writeText(url.toString()).catch(() => {});
      $("room-copy").textContent = "Copied!";
      setTimeout(() => ($("room-copy").textContent = "Copy invite link"), 1500);
    };
    addEventListener("keydown", (e) => {
      if (document.activeElement instanceof HTMLInputElement) return;
      if (e.code === "F3") {
        e.preventDefault();
        this.statsVisible = !this.statsVisible;
        $("stats").hidden = !this.statsVisible;
      }
      if (e.code === "KeyH") $("help").hidden = !$("help").hidden;
      if (e.code === "KeyP") {
        $("perf").hidden = !$("perf").hidden;
        localStorage.setItem("wobble-isles.perf", $("perf").hidden ? "0" : "1");
      }
    });
  }

  /** Round-trip time to the server in ms, or null while offline (M1 has no server yet). */
  setPing(ms: number | null) {
    this.ping = ms;
  }

  /** Room code chip + player list (online only). */
  setRoom(code: string, roster: RosterEntry[], me: number) {
    const el = $("room");
    el.hidden = false;
    $("room-code").textContent = code;
    const list = $("room-players");
    list.replaceChildren(
      ...roster.map((p) => {
        const li = document.createElement("li");
        const dot = document.createElement("i");
        dot.style.background = "#" + PLAYER_COLORS[p.color % PLAYER_COLORS.length].toString(16).padStart(6, "0");
        li.append(dot, document.createTextNode(p.name + (p.id === me ? " (you)" : "") + (p.host ? " ★" : "")));
        return li;
      }),
    );
  }

  showDisconnected() {
    $("disconnected").hidden = false;
  }

  setQuality(label: string) {
    const el = $("perf-q");
    if (el.textContent !== label) el.textContent = label;
  }

  setLocked(locked: boolean) {
    $("click-to-play").hidden = locked;
  }

  frame(dt: number, me: Wobbler | undefined, info: string) {
    this.frames.push(dt);
    if (this.frames.length > 120) this.frames.shift();
    const now = performance.now();
    if (now - this.perfLast >= 500) {
      this.perfLast = now;
      const recent = this.frames.slice(-30);
      const fps = recent.length / recent.reduce((a, b) => a + b, 0);
      const fpsEl = $("perf-fps");
      fpsEl.textContent = `${Math.round(fps)} FPS`;
      fpsEl.className = fps >= 55 ? "good" : fps >= 30 ? "ok" : "bad";
      const pingEl = $("perf-ping");
      const p = this.ping;
      pingEl.textContent = p == null ? "ping —" : `ping ${Math.round(p)} ms`;
      pingEl.className = p == null ? "off" : p < 80 ? "good" : p < 150 ? "ok" : "bad";
    }
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
