// Player settings (persisted): audio, controls, comfort and graphics. Opened with Esc or the gear.

import type { Quality } from "../game";

const KEY = "wobble-isles.settings";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  /** Mouse look sensitivity multiplier (1 = default). */
  sensitivity: number;
  invertY: boolean;
  /** Less camera shake and screen flashes. */
  reduceMotion: boolean;
  showPerf: boolean;
  /** Replay the funniest fall after each round. */
  failCam: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  music: 0.5,
  sfx: 0.8,
  sensitivity: 1,
  invertY: false,
  reduceMotion: false,
  showPerf: true,
  failCam: true,
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Builds the settings card and keeps `settings` in sync; `onChange` fires after every edit. */
export class SettingsPanel {
  readonly settings = loadSettings();
  onChange: (s: Settings) => void = () => {};
  onQuality: (q: Quality) => void = () => {};
  onLeave: (() => void) | null = null;
  private card = $("settings");

  constructor(quality: Quality) {
    const s = this.settings;
    const slider = (id: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const row = document.createElement("label");
      row.className = "set-row";
      const name = document.createElement("span");
      name.textContent = label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(s[id]);
      const val = document.createElement("b");
      val.textContent = fmt(Number(input.value));
      input.oninput = () => {
        (s[id] as number) = Number(input.value);
        val.textContent = fmt(Number(input.value));
        this.save();
      };
      row.append(name, input, val);
      return row;
    };
    const toggle = (id: keyof Settings, label: string) => {
      const row = document.createElement("label");
      row.className = "set-row check";
      const name = document.createElement("span");
      name.textContent = label;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(s[id]);
      input.onchange = () => {
        (s[id] as boolean) = input.checked;
        this.save();
      };
      row.append(name, input);
      return row;
    };
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const heading = (t: string) => {
      const h = document.createElement("h3");
      h.textContent = t;
      return h;
    };
    const q = document.createElement("label");
    q.className = "set-row";
    const qs = document.createElement("select");
    for (const [v, l] of [
      ["auto", "Auto (recommended)"],
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
    ]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = l;
      qs.append(o);
    }
    qs.value = quality;
    qs.onchange = () => this.onQuality(qs.value as Quality);
    const qn = document.createElement("span");
    qn.textContent = "Graphics";
    q.append(qn, qs);

    $("settings-body").replaceChildren(
      heading("Sound"),
      slider("master", "Master", 0, 1, 0.05, pct),
      slider("music", "Music", 0, 1, 0.05, pct),
      slider("sfx", "Effects", 0, 1, 0.05, pct),
      heading("Controls"),
      slider("sensitivity", "Mouse sensitivity", 0.3, 2.5, 0.05, (v) => `${v.toFixed(2)}×`),
      toggle("invertY", "Invert camera Y"),
      heading("Display"),
      q,
      toggle("reduceMotion", "Reduce motion (less shake)"),
      toggle("failCam", "Fail Cam replays"),
      toggle("showPerf", "Show FPS and ping"),
    );
    $("settings-close").onclick = () => this.close();
    $("settings-open").onclick = () => this.open();
    $("settings-leave").onclick = () => this.onLeave?.();
    addEventListener("keydown", (e) => {
      if (e.code !== "Escape" || document.pointerLockElement) return;
      if (document.activeElement instanceof HTMLInputElement && document.activeElement.type === "text") return;
      if (this.card.hidden) this.open();
      else this.close();
    });
  }

  get isOpen() {
    return !this.card.hidden;
  }

  open() {
    document.exitPointerLock?.();
    this.card.hidden = false;
    ($("settings-leave") as HTMLButtonElement).hidden = !this.onLeave;
  }

  close() {
    this.card.hidden = true;
  }

  private save() {
    localStorage.setItem(KEY, JSON.stringify(this.settings));
    this.onChange(this.settings);
  }
}
