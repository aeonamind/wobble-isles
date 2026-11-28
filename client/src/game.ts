// The game client: fixed-step simulation, interpolated rendering, input, networking and the Party show.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { SANDBOX, type LevelDef } from "../../shared/level";
import type { Vec3 } from "../../shared/math";
import { SEND_RATE, netStateOf, packNet, type BodyStyle } from "../../shared/protocol";
import { roundById } from "../../shared/rounds";
import { DT, NO_INPUT, Sim, TICK_RATE, WOBBLER_CENTER, WOBBLER_HEIGHT, type InputFrame, type NetMsg, type SimEvent, type Wobbler } from "../../shared/sim";
import { makeCrown } from "./render/crown";
import type { NetClient } from "./net";
import { CameraRig } from "./camera";
import { Input } from "./input";
import { Fx } from "./render/fx";
import { LevelView, TEAM_COLORS } from "./render/level";
import { PLAYER_COLORS, WobblerView } from "./render/wobbler";
import { Hud } from "./ui/hud";
import { ShowUi } from "./ui/show";
import { createTuningPanel, type DebugOptions } from "./ui/tuning-panel";
import { SettingsPanel, type Settings } from "./ui/settings";
import { AudioEngine, type Sfx } from "./audio";
import { TouchControls, isTouchDevice } from "./ui/touch";
import { FailCam, REPLAY_AFTER, REPLAY_BEFORE, REPLAY_SPEED, type Moment } from "./failcam";
import type { WobblerFrame } from "./render/wobbler";
import { roundById as roundDef } from "../../shared/rounds";

export type Quality = "auto" | "low" | "medium" | "high";
export const QUALITY_ORDER: Quality[] = ["auto", "low", "medium", "high"];

export interface GameOptions {
  quality: Quality;
  bench: boolean;
  /** Online: connected Party room. Offline sandbox when absent. */
  net?: NetClient;
  /** Offline only: practise one round (?solo&round=frostbite-run). */
  round?: string;
  /** Our look (offline colour; online the server may give another colour if taken). */
  color?: number;
  style?: BodyStyle;
}

/** Hunt crown holders run a little slower (DESIGN.md §5). */
const CROWN_SPEED = 0.85;

/**
 * Render presets. Fill rate is the bottleneck on integrated GPUs, so the big levers are
 * resolution scale, MSAA and shadow-map filtering. "auto" starts at medium and lets the
 * dynamic-resolution scaler trade sharpness for frame rate.
 */
const QUALITY: Record<Quality, { scale: number; minScale: number; shadows: number; softShadows: boolean; antialias: boolean }> = {
  auto: { scale: 1, minScale: 0.6, shadows: 1024, softShadows: false, antialias: false },
  low: { scale: 0.75, minScale: 0.75, shadows: 0, softShadows: false, antialias: false },
  medium: { scale: 1, minScale: 1, shadows: 1024, softShadows: false, antialias: false },
  high: { scale: 2, minScale: 2, shadows: 2048, softShadows: true, antialias: true },
};

interface Prev {
  x: number;
  y: number;
  z: number;
}

export class Game {
  sim: Sim;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  private input: Input;
  private hud = new Hud();
  private fx: Fx;
  private level: LevelView;
  private sun = new THREE.DirectionalLight(0xffffff, 1.9);
  private views = new Map<number, WobblerView>();
  private prev = new Map<number, Prev>();
  private prevBalls: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  private player: Wobbler;
  private acc = 0;
  private last = performance.now();
  private renderTime = 0;
  private debug: DebugOptions = { timeScale: 1, showColliders: false, reduceMotion: false };
  private debugLines: THREE.LineSegments | null = null;
  private bench: { start: number; frames: number[]; done: boolean } | null = null;
  private scale = 1;
  private maxScale = 1;
  private scaler = { time: 0, frames: 0, good: 0 };
  readonly gpu: string;
  private net: NetClient | null;
  private pendingEvents: SimEvent[] = [];
  private pendingOut: NetMsg[] = [];
  private levelDef: LevelDef = SANDBOX;
  private roundKey = "lobby";
  private appliedExtra = 0;
  private showUi = new ShowUi();
  private huntCrown = makeCrown(1.35);
  private bountyCrown = makeCrown(0.75);
  /** Who the camera follows while we are out of the round. */
  private spectating: number | null = null;
  readonly audio = new AudioEngine();
  private settingsPanel: SettingsPanel;
  private wasSpectating = false;
  private lastHolder: number | null = null;
  private failCam = new FailCam();
  private bridges: THREE.Mesh[] = [];
  private replay: { m: Moment; t: number } | null = null;
  private lastPhase = "lobby";

  constructor(
    private container: HTMLElement,
    private opts: GameOptions,
  ) {
    const q = QUALITY[opts.quality];
    this.renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: "high-performance" });
    this.maxScale = opts.quality === "auto" ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, q.scale);
    this.scale = opts.quality === "auto" ? Math.min(1, this.maxScale) : this.maxScale;
    this.renderer.setPixelRatio(this.scale);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.gpu = gpuName(this.renderer);
    container.appendChild(this.renderer.domElement);

    this.net = opts.net ?? null;
    if (this.net) {
      this.sim = new Sim(SANDBOX, 1, "client");
      this.sim.jumpTo(Math.floor(this.net.serverTime() / DT));
      this.player = this.sim.addWobbler(this.net.spawn, "player", this.net.color, this.net.you);
      this.net.onRoster = () => this.updateNames();
    } else {
      this.sim = new Sim(SANDBOX, 1);
      this.player = this.sim.addWobbler(SANDBOX.spawn, "player", opts.color ?? 0);
    }
    if (opts.bench) {
      for (let i = 0; i < 8; i++) this.sim.addWobbler({ x: (i % 4) * 2.5 - 3.75, y: 1, z: Math.floor(i / 4) * 2.5 - 1 }, "wander", (i + 1) % 8);
      this.bench = { start: performance.now() + 3000, frames: [], done: false };
    }

    this.rig = new CameraRig(this.sim.world);
    this.input = new Input(this.renderer.domElement);
    this.input.onKey = (code) => {
      if (code === "KeyR" && !this.isSpectating() && this.sim.level.failRule !== "out") this.sim.forceRespawn(this.player);
      if (code === "KeyF") this.net?.gremlin();
      if ((code === "Enter" || code === "NumpadEnter") && this.net?.show?.phase === "lobby" && this.isHost()) this.net?.startShow();
    };
    this.fx = new Fx(this.scene);
    this.level = new LevelView(SANDBOX, this.scene);
    this.huntCrown.visible = this.bountyCrown.visible = false;
    this.scene.add(this.huntCrown, this.bountyCrown);
    this.showUi.onStart = () => this.net?.startShow();

    this.scene.add(new THREE.HemisphereLight(0xfff4fb, 0xb9a0d0, 1.15));
    this.sun.position.set(12, 30, 10);
    this.sun.castShadow = q.shadows > 0;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      Object.assign(this.sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.03;
    }
    this.scene.add(this.sun, this.sun.target);

    for (const w of this.sim.wobblers) this.addView(w);
    this.snapshotPrev();
    this.updateNames();
    if (!this.net && opts.round) {
      const def = roundById(opts.round);
      if (def) {
        const lvl = def.build(1, 1);
        this.loadLevel(lvl, 0, (lvl.spawns ?? [lvl.spawn])[0], true);
      }
    }

    if (import.meta.env.DEV || new URLSearchParams(location.search).has("tune")) createTuningPanel(this.debug, { respawn: () => this.sim.forceRespawn(this.player) });
    this.settingsPanel = new SettingsPanel(opts.quality);
    this.settingsPanel.onChange = (st) => this.applySettings(st);
    this.settingsPanel.onQuality = (q) => {
      localStorage.setItem("wobble-isles.quality", q);
      const p = new URLSearchParams(location.search);
      p.delete("q");
      location.search = p.toString();
    };
    this.settingsPanel.onLeave = () => {
      this.net?.leave();
      location.href = location.pathname;
    };
    this.applySettings(this.settingsPanel.settings);
    this.showUi.onCue = (cue) => {
      if (cue === "fanfare" || cue === "champion") this.audio.duck(cue === "champion" ? 3 : 1.6);
      this.audio.play(cue);
    };
    const touch = isTouchDevice() && !opts.bench;
    if (touch) {
      this.input.touch = new TouchControls();
      this.input.touch.onAction = (a) => {
        if (a === "gremlin") this.net?.gremlin();
      };
    }
    document.addEventListener("pointerlockchange", () => this.hud.setLocked(this.input.pointerLocked || opts.bench || touch));
    this.hud.setLocked(opts.bench || touch);

    addEventListener("resize", () => this.resize());
    this.resize();
    if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug")) (window as unknown as { __game: Game }).__game = this;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Connection lost: freeze input and show the reconnect card. */
  disconnected() {
    document.exitPointerLock?.();
    this.hud.showDisconnected();
  }

  // ───────────────────────── Party show ─────────────────────────

  private applySettings(st: Settings) {
    this.audio.setVolumes({ master: st.master, music: st.music, sfx: st.sfx });
    this.input.sensitivity = 0.0025 * st.sensitivity;
    this.invertY = st.invertY;
    this.debug.reduceMotion = st.reduceMotion;
    document.getElementById("perf")!.hidden = !st.showPerf;
  }

  private invertY = false;

  /** Music mood from the show phase. */
  private updateMood() {
    const m = this.net?.show;
    this.input.touch?.setGremlin(!!m && m.phase === "play" && !!m.round?.final && !m.participants.includes(this.player.id));
    if (!m || m.phase === "lobby" || m.phase === "podium") this.audio.setMood("lobby");
    else this.audio.setMood(m.round?.final ? "final" : "round");
    // Our own moments: knocked out of a round, picking up the crown.
    const spec = this.isSpectating() && m?.phase === "play" && !!m.participants.includes(this.player.id);
    if (spec && !this.wasSpectating) this.audio.play("out");
    this.wasSpectating = spec;
    const holder = this.net?.crown?.holder || null;
    if (holder !== this.lastHolder && holder != null && m?.round && roundDef(m.round.id)?.category === "hunt") {
      const w = this.sim.get(holder);
      this.audio.play("crown", { vol: holder === this.player.id ? 1 : 0.7, pos: holder === this.player.id ? undefined : w?.pos });
    }
    this.lastHolder = holder;
  }

  private sfx(name: Sfx, w: Wobbler, vol = 1, pitch?: number) {
    this.audio.play(name, { vol, pitch, pos: w === this.player ? undefined : w.pos });
  }

  private nameOf(id: number) {
    return this.net?.roster.find((r) => r.id === id)?.name ?? "Someone";
  }

  /** Remember wipe-outs worth a replay (only while a round is being played). */
  private noteMoment(e: SimEvent) {
    if (this.net?.show?.phase !== "play") return;
    const t = this.sim.time;
    switch (e.type) {
      case "fall":
        this.failCam.note({ t, id: e.id, score: 3, label: `${this.nameOf(e.id)} took the plunge` });
        break;
      case "hazardHit":
        this.failCam.note({ t, id: e.id, score: 1.2 + e.force / 5, label: `${this.nameOf(e.id)} vs. the hazard` });
        break;
      case "ragdoll":
        this.failCam.note({ t, id: e.id, score: e.force / 7, label: `${this.nameOf(e.id)} went flying` });
        break;
      case "stomp":
        this.failCam.note({ t, id: e.target, score: e.boosted ? 2.6 : 2.2, label: `${this.nameOf(e.target)} got stomped by ${this.nameOf(e.id)}` });
        break;
      case "tackle":
        this.failCam.note({ t, id: e.target, score: 2.5, label: `${this.nameOf(e.id)} bulldozed ${this.nameOf(e.target)}` });
        break;
      case "clump":
        this.failCam.note({ t, id: e.id, score: 2.3, label: `${this.nameOf(e.id)} and ${this.nameOf(e.target)} got stuck together` });
        break;
      case "throw":
        this.failCam.note({ t, id: e.target, score: 2.4, label: `${this.nameOf(e.id)} yeeted ${this.nameOf(e.target)}` });
        break;
    }
  }

  private frameOf(w: Wobbler, x: number, y: number, z: number): WobblerFrame {
    return {
      x,
      y,
      z,
      vx: w.vel.x,
      vy: w.vel.y,
      vz: w.vel.z,
      facing: w.facing,
      state: w.state,
      stateTime: w.stateTime,
      grounded: w.grounded,
      grabbing: w.grabbing,
      holding: w.holding != null,
      invulnerable: this.sim.time < w.invulnUntil,
      squashed: this.sim.time < w.squashedUntil,
    };
  }

  /** Jelly Clump: a wobbly jelly bridge between stuck pairs. */
  private updateBridges(t: number) {
    const clumped = (w: Wobbler) => (this.sim.isRemote(w) ? !!w.net?.clumped : w.clumpWith != null);
    const pairs: [number, number][] = [];
    const used = new Set<number>();
    for (const w of this.sim.wobblers) {
      if (used.has(w.id) || !clumped(w) || w.state === "out") continue;
      let partner = w.clumpWith != null ? this.sim.get(w.clumpWith) : undefined;
      if (!partner) {
        let best = 1.6;
        for (const o of this.sim.wobblers) {
          if (o === w || used.has(o.id) || !clumped(o)) continue;
          const d = Math.hypot(o.pos.x - w.pos.x, o.pos.y - w.pos.y, o.pos.z - w.pos.z);
          if (d < best) {
            best = d;
            partner = o;
          }
        }
      }
      if (!partner || used.has(partner.id)) continue;
      used.add(w.id).add(partner.id);
      pairs.push([w.id, partner.id]);
    }
    while (this.bridges.length < pairs.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12), new THREE.MeshToonMaterial({ color: 0xff7eb6, transparent: true, opacity: 0.82 }));
      this.scene.add(m);
      this.bridges.push(m);
    }
    this.bridges.forEach((m, i) => {
      const pair = pairs[i];
      const a = pair && this.views.get(pair[0]);
      const b = pair && this.views.get(pair[1]);
      m.visible = !!a && !!b && a.root.visible && b.root.visible;
      if (!m.visible || !a || !b) return;
      const pa = a.root.position;
      const pb = b.root.position;
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      mid.y += WOBBLER_CENTER;
      const dir = pb.clone().sub(pa);
      const len = Math.max(0.3, dir.length());
      m.position.copy(mid);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
      const wob = 1 + Math.sin(t * 18) * 0.08;
      m.scale.set(len / 0.68, 1.05 * wob, 1.05 / wob);
      (m.material as THREE.MeshToonMaterial).color.setHex(PLAYER_COLORS[(this.sim.get(pair[0])?.color ?? 0) % PLAYER_COLORS.length]);
    });
  }

  /** Round over: start the Fail Cam if there was a good wipe-out; new round: clear the tape. */
  private updateFailCam() {
    const phase = this.net?.show?.phase ?? "lobby";
    if (phase !== this.lastPhase) {
      if (phase === "results" && this.settingsPanel.settings.failCam) {
        const m = this.failCam.best();
        if (m) {
          this.replay = { m, t: m.t - REPLAY_BEFORE };
          document.getElementById("failcam-label")!.textContent = m.label;
          document.getElementById("failcam")!.hidden = false;
          this.audio.play("toast");
        }
      }
      if (phase === "intro" || phase === "lobby") this.failCam.reset();
      this.lastPhase = phase;
    }
    if (this.replay && (phase !== "results" || this.replay.t > this.replay.m.t + REPLAY_AFTER)) {
      this.replay = null;
      document.getElementById("failcam")!.hidden = true;
    }
  }

  private isHost() {
    return !!this.net?.roster.find((r) => r.id === this.player.id)?.host;
  }

  /** Out of the round for good (fell in survival, a Gremlin, joined mid-round). */
  private isSpectating() {
    return this.player.state === "out" && this.player.outUntil === Infinity;
  }

  /** Switch to another level: new Sim (same clock), new scene, our Wobbler at spawn. */
  private loadLevel(level: LevelDef, epochTick: number, spawn: Vec3, playing: boolean) {
    const tick = this.sim.tick;
    const { id, color } = this.player;
    this.level.dispose();
    for (const [wid, v] of [...this.views]) {
      if (wid === id) continue;
      this.scene.remove(v.root, v.blob);
      this.views.delete(wid);
    }
    const old = this.sim;
    this.sim = new Sim(level, 1, this.net ? "client" : "offline");
    old.world.free();
    this.sim.jumpTo(tick);
    this.sim.epoch = epochTick * DT;
    this.player = this.sim.addWobbler(spawn, "player", color, id);
    if (!playing) this.sim.retire(this.player);
    this.rig.world = this.sim.world;
    this.rig.yaw = Math.PI;
    this.level = new LevelView(level, this.scene);
    this.levelDef = level;
    this.appliedExtra = 0;
    this.spectating = null;
    this.pendingOut = [];
    this.prev.clear();
    this.snapshotPrev();
    this.updateNames();
  }

  /** Follow the server show: load the round level when it changes, add Gremlin hazards. */
  private syncShow() {
    const m = this.net?.show;
    if (!m) return;
    const key = m.phase === "lobby" || !m.round ? "lobby" : m.round.id + ":" + m.round.seed;
    if (key !== this.roundKey) {
      this.roundKey = key;
      if (key === "lobby") {
        const i = Math.max(0, this.net!.roster.findIndex((r) => r.id === this.player.id));
        const a = (i / 8) * Math.PI * 2;
        this.loadLevel(SANDBOX, 0, { x: Math.cos(a) * 2.4, y: 1, z: Math.sin(a) * 2.4 }, true);
      } else {
        const def = roundById(m.round!.id);
        if (def) {
          const level = def.build(m.round!.seed, m.participants.length);
          const idx = m.spawns[this.player.id];
          const list = level.spawns ?? [level.spawn];
          const playing = idx != null;
          // Spectators park far below the level: hidden and out of the way.
          const spawn = playing ? list[idx % list.length] : { x: level.spawn.x, y: level.killY - 30, z: level.spawn.z };
          this.loadLevel(level, m.round!.epochTick, spawn, playing);
          this.sim.setRule(m.round!.rule);
        }
      }
    }
    while (this.appliedExtra < m.extra.length) {
      const h = m.extra[this.appliedExtra++];
      this.sim.addHazard(h);
      this.level.addHazard(h);
    }
    const showing = m.phase !== "lobby";
    this.hud.setRoom(this.net!.code, this.net!.roster, this.player.id, showing ? m.stars : null, showing ? m.leader : null);
  }

  /** Pick someone still in the round to watch; next cycles to the following one. */
  private updateSpectate(next: boolean) {
    if (!this.isSpectating()) {
      this.spectating = null;
      return;
    }
    const m = this.net?.show;
    const candidates = this.sim.wobblers
      .filter((w) => w !== this.player && w.state !== "out" && (!m || m.participants.includes(w.id)))
      .map((w) => w.id)
      .sort((a, b) => a - b);
    if (!candidates.length) {
      this.spectating = null;
      return;
    }
    const i = this.spectating == null ? -1 : candidates.indexOf(this.spectating);
    if (i < 0) this.spectating = candidates[0];
    else if (next) this.spectating = candidates[(i + 1) % candidates.length];
  }

  /** Hunt crown, the Final summit crown and the Bounty Crown on the star leader. */
  private updateCrowns(t: number) {
    const m = this.net?.show;
    const round = m?.round ? roundById(m.round.id) : undefined;
    const active = !!m && m.phase !== "lobby" && m.phase !== "podium";
    const c = this.net?.crown;
    let holder: number | null = null;
    const hunt = this.huntCrown;
    hunt.visible = false;
    if (active && round?.category === "hunt" && c) {
      hunt.visible = true;
      holder = c.holder || null;
      const hv = holder != null ? this.views.get(holder) : undefined;
      if (hv && hv.root.visible) {
        hunt.position.copy(hv.root.position).add(new THREE.Vector3(0, WOBBLER_HEIGHT - 0.04, 0));
        hunt.rotation.set(0, t * 1.5, 0);
      } else {
        const goal = new THREE.Vector3(c.x, c.y + Math.sin(t * 3) * 0.08, c.z);
        if (hunt.position.distanceTo(goal) > 3) hunt.position.copy(goal);
        else hunt.position.lerp(goal, 0.3);
        hunt.rotation.set(0.2, t * 2.5, 0);
      }
    } else if (active && round?.category === "final" && this.levelDef.crown) {
      hunt.visible = true;
      const p = this.levelDef.crown;
      hunt.position.set(p.x, p.y + 0.2 + Math.sin(t * 2) * 0.12, p.z);
      hunt.rotation.set(0, t * 1.2, 0);
    }
    this.player.speedMul = active && round?.category === "hunt" && holder === this.player.id ? CROWN_SPEED : 1;
    const leader = active && !m!.round?.final ? m!.leader : null;
    const lv = leader != null && leader !== holder ? this.views.get(leader) : undefined;
    this.bountyCrown.visible = !!lv && lv.root.visible;
    if (lv) {
      this.bountyCrown.position.copy(lv.root.position).add(new THREE.Vector3(0, WOBBLER_HEIGHT - 0.06, 0));
      this.bountyCrown.rotation.set(0.12, t * 1.2, 0);
    }
  }

  private styleOf(id: number): BodyStyle {
    if (id === this.player?.id) return this.opts.style ?? "bean";
    return this.net?.roster.find((r) => r.id === id)?.style ?? "bean";
  }

  private addView(w: Wobbler) {
    const old = this.views.get(w.id);
    if (old) this.scene.remove(old.root, old.blob);
    const v = new WobblerView(PLAYER_COLORS[w.color % PLAYER_COLORS.length], this.styleOf(w.id));
    this.views.set(w.id, v);
    this.scene.add(v.root, v.blob);
  }

  private resize() {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  private snapshotPrev() {
    for (const w of this.sim.wobblers) this.prev.set(w.id, { ...w.pos });
    this.prevBalls = this.sim.balls.map((b) => {
      const t = b.translation();
      const r = b.rotation();
      return { p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
    });
  }

  // ───────────────────────── Simulation tick ─────────────────────────

  private tick() {
    const i = this.input.consume();
    const f = this.rig.forward();
    // right = forward × up
    const rx = -f.z;
    const rz = f.x;
    const phase = this.net?.show?.phase;
    const frozen = phase === "intro" || phase === "countdown";
    let frame: InputFrame = {
      mx: f.x * i.moveY + rx * i.moveX,
      mz: f.z * i.moveY + rz * i.moveX,
      jump: i.jump,
      dive: i.dive,
      grab: i.grab,
    };
    if (frozen || this.replay) frame = NO_INPUT;
    this.updateSpectate(i.jump);
    this.snapshotPrev();
    if (this.net) this.syncRemotes();
    this.sim.step(new Map([[this.player.id, frame]]));
    for (const e of this.sim.events) this.onEvent(e);
    if (this.net) this.upload();
    if (this.net?.show?.phase === "play") {
      const frames = new Map<number, WobblerFrame>();
      for (const w of this.sim.wobblers) if (w.state !== "out") frames.set(w.id, this.frameOf(w, w.pos.x, w.pos.y, w.pos.z));
      this.failCam.record(this.sim.time, this.sim.hazardTime(), frames);
    }
  }

  // ───────────────────────── Networking ─────────────────────────

  /** Bring remote proxies, balls and routed interactions up to date before a tick. */
  private syncRemotes() {
    const net = this.net!;
    const sample = net.sample(this.sim.time);
    if (sample) {
      for (const [id, state] of sample.wobblers) {
        if (id === this.player.id) continue;
        let w = this.sim.get(id);
        if (!w) {
          const color = net.roster.find((r) => r.id === id)?.color ?? id % 8;
          w = this.sim.addWobbler(state.pos, "remote", color, id);
          this.addView(w);
          this.prev.set(id, { ...state.pos });
          this.updateNames();
        }
        w.net = state;
      }
      sample.balls.forEach((b, i) => this.sim.setBall(i, b.pos, b.rot));
    }
    // Remove Wobblers the server no longer has (players who left).
    const alive = new Set(net.latestIds());
    if (alive.size) {
      for (const w of [...this.sim.wobblers]) {
        if (w.id === this.player.id || alive.has(w.id)) continue;
        this.sim.removeWobbler(w.id);
        const v = this.views.get(w.id);
        if (v) {
          this.scene.remove(v.root, v.blob);
          this.views.delete(w.id);
        }
      }
    }
    for (const m of net.takeInbox()) {
      const ok = this.sim.applyRemote(m);
      // Can't be grabbed right now (fell out, already held): tell the grabber to let go.
      if (!ok && m.k === "grab") this.sim.outbox.push({ k: "drop", from: m.target, target: m.from });
    }
    for (const e of net.takeEvents()) this.onEvent(e);
  }

  /** Upload our own Wobbler at SEND_RATE, with events and interactions since the last upload. */
  private upload() {
    const net = this.net!;
    this.pendingEvents.push(...this.sim.events.filter((e) => e.id === this.player.id));
    this.pendingOut.push(...this.sim.outbox.splice(0));
    if (this.sim.tick % Math.round(TICK_RATE / SEND_RATE) !== 0) return;
    net.sendState({
      t: this.sim.tick,
      w: packNet(this.player.id, netStateOf(this.player, this.sim.time)),
      ev: this.pendingEvents.splice(0),
      out: this.pendingOut.splice(0),
    });
  }

  private updateNames() {
    if (!this.net) return;
    const teams = this.net.show?.phase !== "lobby" ? this.net.show?.teams : null;
    // Someone changed their look: rebuild their view.
    for (const [id, view] of [...this.views]) {
      const w = this.sim.get(id);
      if (w && view.style !== this.styleOf(id)) this.addView(w);
    }
    for (const [id, view] of this.views) {
      const r = this.net.roster.find((p) => p.id === id);
      const team = teams?.[id];
      view.setName(r && id !== this.player.id ? r.name : null, team != null ? TEAM_COLORS[team] : undefined);
    }
    const m = this.net.show;
    const showing = !!m && m.phase !== "lobby";
    this.hud.setRoom(this.net.code, this.net.roster, this.player.id, showing ? m.stars : null, showing ? m.leader : null);
  }

  private onEvent(e: SimEvent) {
    const w = this.sim.get(e.id);
    const view = this.views.get(e.id);
    if (!w || !view) return;
    const feet = new THREE.Vector3(w.pos.x, w.pos.y - WOBBLER_CENTER + 0.05, w.pos.z);
    const body = new THREE.Vector3(w.pos.x, w.pos.y + 0.2, w.pos.z);
    const isMe = w === this.player;
    const rp = 0.92 + ((e.id * 37) % 17) / 100; // each Wobbler has its own voice pitch
    this.noteMoment(e);
    switch (e.type) {
      case "jump":
        this.sfx("jump", w, 0.8, rp);
        view.impact("jump");
        this.fx.burst(feet, [0xffffff, 0xfff1c9], 6, 1.6, { up: 1, gravity: 3, life: 0.35 });
        break;
      case "land":
        if (e.speed > 5) this.sfx("land", w, Math.min(1, e.speed / 18));
        view.impact("land", e.speed);
        if (e.speed > 6) {
          this.fx.burst(feet, [0xffffff, 0xfff1c9], 10, 2.4, { up: 1.2, gravity: 4, life: 0.4 });
          this.fx.ring(feet, 0xffffff, 0.9 + e.speed * 0.04, 0.3);
        }
        if (isMe && e.speed > 14) this.rig.kick(0.6);
        break;
      case "bounce":
        this.sfx("bounce", w);
        view.impact("bounce");
        this.fx.ring(feet, 0x57d9b7, 1.8, 0.35);
        this.fx.burst(feet, [0x57d9b7, 0xffffff], 12, 3, { up: 4 });
        break;
      case "stomp": {
        this.sfx("stomp", w, 1, e.boosted ? 1.2 : 1);
        view.impact("bounce");
        const victim = this.sim.get(e.target);
        this.views.get(e.target)?.impact("stomped");
        if (victim) {
          const head = new THREE.Vector3(victim.pos.x, victim.pos.y + 0.55, victim.pos.z);
          this.fx.ring(head, e.boosted ? 0xffe156 : 0xffffff, e.boosted ? 1.6 : 1.1, 0.3);
          this.fx.burst(head, e.boosted ? [0xffe156, 0xff7eb6, 0xffffff] : [0xffffff, 0xff7eb6], e.boosted ? 16 : 10, 3, { up: 2.5 });
        }
        if (isMe || e.target === this.player.id) this.rig.kick(e.boosted ? 0.35 : 0.2);
        break;
      }
      case "dive":
        this.sfx("dive", w, 0.7);
        this.fx.burst(feet, [0xffffff], 6, 1.2, { up: 0.8, gravity: 2, life: 0.3 });
        break;
      case "ragdoll":
      case "hazardHit":
      case "ballHit":
      case "tackle": {
        const strength = "force" in e ? Math.min(2, e.force / 8) : 1;
        this.sfx(e.type === "hazardHit" ? "clang" : e.type === "ballHit" ? "ball" : "hit", w, Math.min(1, 0.5 + strength * 0.4), rp);
        view.impact("hit", strength);
        this.fx.burst(body, [0xffe156, 0xffffff, 0xff7eb6], 14, 4, { up: 3 });
        if (e.type === "tackle") this.views.get(e.target)?.impact("hit", 1.2);
        if (isMe || (e.type === "tackle" && e.target === this.player.id)) this.rig.kick(0.5);
        break;
      }
      case "grab":
        this.sfx("grab", w, 0.8);
        this.fx.burst(body, [0xffffff], 5, 1.5, { gravity: 2, life: 0.25 });
        break;
      case "throw":
        this.sfx("throw", w);
        this.fx.burst(body, [0xffffff, 0xffe156], 10, 3);
        break;
      case "respawn":
        this.sfx("respawn", w, 0.6);
        this.fx.ring(feet, 0xffc93c, 1.6, 0.5);
        this.fx.burst(body, [0xffc93c, 0xffffff], 16, 2.5, { up: 3, gravity: 2 });
        break;
      case "fall":
        this.sfx("fall", w, isMe ? 0.8 : 0.5, rp);
        break;
      case "clump": {
        this.sfx("clump", w, 1, rp);
        const o = this.sim.get(e.target);
        const mid = o ? new THREE.Vector3((w.pos.x + o.pos.x) / 2, (w.pos.y + o.pos.y) / 2 + 0.2, (w.pos.z + o.pos.z) / 2) : body;
        this.fx.burst(mid, [0xff7eb6, 0xffffff, 0x9b6bff], 18, 3.5, { up: 2.5 });
        this.fx.ring(mid, 0xff7eb6, 1.6, 0.35);
        view.impact("hit", 1);
        this.views.get(e.target)?.impact("hit", 1);
        if (isMe || e.target === this.player.id) this.rig.kick(0.35);
        break;
      }
      default:
        break;
    }
  }

  // ───────────────────────── Render frame ─────────────────────────

  private frame() {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const dt = realDt * this.debug.timeScale;

    const look = this.input.readLook(realDt);
    if (!this.settingsPanel.isOpen) this.rig.addLook(look.x, this.invertY ? -look.y : look.y);
    this.updateMood();
    if (this.opts.bench) this.rig.yaw += realDt * 0.25;

    this.syncShow();
    let alpha: number;
    if (this.net) {
      // Online: follow the server clock so hazards line up for everyone.
      const target = this.net.serverTime() / DT;
      if (Math.abs(target - this.sim.tick) > 15) this.sim.jumpTo(Math.floor(target) - 1);
      let steps = 0;
      while (this.sim.tick + 1 <= target && steps < 5) {
        this.tick();
        steps++;
      }
      alpha = Math.max(0, Math.min(1, target - this.sim.tick));
      this.hud.setPing(this.net.rtt);
    } else {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 5) {
        this.acc -= DT;
        this.tick();
        steps++;
      }
      if (steps === 5) this.acc = 0; // tab was asleep; don't spiral
      alpha = this.acc / DT;
    }
    this.renderTime = this.sim.time - DT + alpha * DT;

    this.updateFailCam();
    const replay = this.replay ? this.failCam.sample((this.replay.t += realDt * REPLAY_SPEED)) : null;

    // Wobblers (live, or from the Fail Cam tape)
    if (replay) {
      for (const [id, view] of this.views) {
        const fr = replay.w.get(id);
        if (!fr) {
          view.root.visible = false;
          view.blob.visible = false;
          continue;
        }
        view.update(fr, dt * REPLAY_SPEED, this.groundAt(fr.x, fr.y, fr.z), this.renderTime);
      }
    } else {
      for (const w of this.sim.wobblers) {
        const view = this.views.get(w.id);
        if (!view) continue;
        const p = this.prev.get(w.id) ?? w.pos;
        const x = p.x + (w.pos.x - p.x) * alpha;
        const y = p.y + (w.pos.y - p.y) * alpha;
        const z = p.z + (w.pos.z - p.z) * alpha;
        view.update(this.frameOf(w, x, y, z), dt, w.state === "out" ? null : this.groundAt(x, y, z), this.renderTime);
      }
    }

    // Balls
    this.sim.balls.forEach((b, i) => {
      const obj = this.level.balls[i];
      const prev = this.prevBalls[i];
      const t = b.translation();
      const r = b.rotation();
      obj.position.lerpVectors(prev.p, new THREE.Vector3(t.x, t.y, t.z), alpha);
      obj.quaternion.slerpQuaternions(prev.q, new THREE.Quaternion(r.x, r.y, r.z, r.w), alpha);
    });

    this.level.update(replay ? replay.ht : this.sim.hazardTime(this.renderTime));
    this.updateCrowns(this.renderTime);
    if (!replay) this.updateBridges(this.renderTime);
    else this.bridges.forEach((m) => (m.visible = false));
    this.fx.update(dt);
    if (this.net) {
      this.showUi.update(this.net.show, {
        me: this.player.id,
        roster: this.net.roster,
        tick: this.net.serverTime() / DT,
        host: this.isHost(),
        spectating: this.isSpectating() ? this.spectating : null,
        replaying: !!this.replay,
      });
    }

    // Camera follows the player, whoever we spectate, or orbits the hub during the bench.
    const star = replay && this.replay ? this.views.get(this.replay.m.id) : undefined;
    const watched = star ?? (this.spectating != null ? this.views.get(this.spectating) : undefined);
    const pp = (watched ?? this.views.get(this.player.id)!).root.position;
    if (star) this.rig.yaw += realDt * 0.35;
    const follow = this.opts.bench ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(pp.x, pp.y + WOBBLER_CENTER, pp.z);
    this.rig.distance = this.opts.bench ? 16 : star ? 5 : 7;
    this.rig.update(follow, realDt, this.debug.reduceMotion);
    const cam = this.rig.camera;
    const fwd = this.rig.forward();
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, -fwd.z, fwd.x);
    this.sun.target.position.copy(follow);
    this.sun.position.copy(follow).add(new THREE.Vector3(12, 30, 10));

    this.updateDebugLines();
    this.renderer.render(this.scene, this.rig.camera);
    this.hud.frame(
      realDt,
      this.player,
      `wobblers ${this.sim.wobblers.length}  calls ${this.renderer.info.render.calls}  tris ${this.renderer.info.render.triangles}
` +
        `quality ${this.opts.quality}  scale ${this.scale.toFixed(2)}x  shadows ${this.renderer.shadowMap.enabled ? "on" : "off"}
${this.gpu}`,
    );
    this.hud.setQuality(this.opts.quality === "auto" ? `Auto ${Math.round(this.scale * 100)}%` : this.opts.quality[0].toUpperCase() + this.opts.quality.slice(1));
    this.updateScaler(realDt);
    this.updateBench(realDt);
  }

  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private groundAt(x: number, y: number, z: number): number | null {
    this.ray.origin = { x, y, z };
    const hit = this.sim.world.castRay(this.ray, 30, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    return hit ? y - hit.timeOfImpact : null;
  }

  private updateDebugLines() {
    if (!this.debug.showColliders) {
      if (this.debugLines) this.debugLines.visible = false;
      return;
    }
    const { vertices, colors } = this.sim.world.debugRender();
    if (!this.debugLines) {
      this.debugLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
      this.debugLines.renderOrder = 999;
      this.scene.add(this.debugLines);
    }
    this.debugLines.visible = true;
    this.debugLines.geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    this.debugLines.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  }

  /**
   * Dynamic resolution (auto quality only): drop render scale when under 50 FPS,
   * creep back up after 3 good seconds; as a last resort turn shadows off.
   */
  private updateScaler(dt: number) {
    if (this.opts.quality !== "auto" || this.opts.bench) return;
    const s = this.scaler;
    s.time += dt;
    s.frames++;
    if (s.time < 1) return;
    const fps = s.frames / s.time;
    s.time = 0;
    s.frames = 0;
    const min = QUALITY.auto.minScale;
    if (fps < 50) {
      s.good = 0;
      if (this.scale > min + 0.001) this.setScale(Math.max(min, this.scale - (fps < 35 ? 0.2 : 0.1)));
      else if (this.renderer.shadowMap.enabled && fps < 40) this.setShadows(false);
    } else if (fps > 57 && ++s.good >= 3 && this.scale < this.maxScale - 0.001) {
      s.good = 0;
      this.setScale(Math.min(this.maxScale, this.scale + 0.1));
    }
  }

  private setScale(scale: number) {
    this.scale = scale;
    this.renderer.setPixelRatio(scale);
    this.resize();
  }

  private setShadows(on: boolean) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mat) => (mat.needsUpdate = true));
    });
  }

  /** Mobile performance spike (DESIGN.md §8): 3 s warm-up, then 30 s of frame times. */
  private updateBench(dt: number) {
    const b = this.bench;
    if (!b || b.done || performance.now() < b.start) return;
    b.frames.push(dt);
    const elapsed = (performance.now() - b.start) / 1000;
    if (elapsed < 30) {
      if (b.frames.length % 30 === 0) this.hud.benchReport(`Benchmark… ${Math.ceil(30 - elapsed)} s`);
      return;
    }
    b.done = true;
    const sorted = [...b.frames].sort((a, c) => a - c);
    const avg = b.frames.reduce((a, c) => a + c, 0) / b.frames.length;
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    const result = {
      quality: this.opts.quality,
      avgFps: +(1 / avg).toFixed(1),
      low1Fps: +(1 / p(0.99)).toFixed(1),
      p95Ms: +(p(0.95) * 1000).toFixed(1),
      wobblers: this.sim.wobblers.length,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pixelRatio: this.renderer.getPixelRatio(),
      viewport: `${innerWidth}x${innerHeight}`,
      gpu: this.gpu,
    };
    console.log("BENCH", JSON.stringify(result));
    this.hud.benchReport(
      `Benchmark (${result.quality})\n` +
        `avg ${result.avgFps} FPS · 1% low ${result.low1Fps} FPS · p95 ${result.p95Ms} ms\n` +
        `${result.wobblers} Wobblers · ${result.drawCalls} draw calls · ${result.triangles} tris\n` +
        `${result.viewport} @${result.pixelRatio}x · ${result.gpu}\n` +
        `Gate: ≥ 50 FPS → ${result.avgFps >= 50 && result.low1Fps >= 40 ? "PASS ✅" : "FAIL ❌"}`,
    );
  }
}

function gpuName(r: THREE.WebGLRenderer) {
  const gl = r.getContext();
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown GPU";
}
