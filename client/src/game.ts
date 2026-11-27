// M1 feel sandbox: fixed-step simulation + interpolated rendering + input + tuning.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { SANDBOX } from "../../shared/level";
import { DT, Sim, WOBBLER_CENTER, type InputFrame, type SimEvent, type Wobbler } from "../../shared/sim";
import { CameraRig } from "./camera";
import { Input } from "./input";
import { Fx } from "./render/fx";
import { LevelView } from "./render/level";
import { PLAYER_COLORS, WobblerView } from "./render/wobbler";
import { Hud } from "./ui/hud";
import { createTuningPanel, type DebugOptions } from "./ui/tuning-panel";

export type Quality = "auto" | "low" | "medium" | "high";
export const QUALITY_ORDER: Quality[] = ["auto", "low", "medium", "high"];

export interface GameOptions {
  quality: Quality;
  bench: boolean;
}

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
  readonly sim: Sim;
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

    this.sim = new Sim(SANDBOX, 1);
    this.player = this.sim.addWobbler(SANDBOX.spawn, "player", 0);
    if (opts.bench) {
      for (let i = 0; i < 8; i++) this.sim.addWobbler({ x: (i % 4) * 2.5 - 3.75, y: 1, z: Math.floor(i / 4) * 2.5 - 1 }, "wander", (i + 1) % 8);
      this.bench = { start: performance.now() + 3000, frames: [], done: false };
    }

    this.rig = new CameraRig(this.sim.world);
    this.input = new Input(this.renderer.domElement);
    this.input.onKey = (code) => {
      if (code === "KeyR") this.sim.forceRespawn(this.player);
    };
    this.fx = new Fx(this.scene);
    this.level = new LevelView(SANDBOX, this.scene);

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

    createTuningPanel(this.debug, { respawn: () => this.sim.forceRespawn(this.player) });
    document.addEventListener("pointerlockchange", () => this.hud.setLocked(this.input.pointerLocked || opts.bench));
    this.hud.setLocked(opts.bench);

    addEventListener("resize", () => this.resize());
    this.resize();
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private addView(w: Wobbler) {
    const v = new WobblerView(PLAYER_COLORS[w.color % PLAYER_COLORS.length]);
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
    const frame: InputFrame = {
      mx: f.x * i.moveY + rx * i.moveX,
      mz: f.z * i.moveY + rz * i.moveX,
      jump: i.jump,
      dive: i.dive,
      grab: i.grab,
    };
    this.snapshotPrev();
    this.sim.step(new Map([[this.player.id, frame]]));
    for (const e of this.sim.events) this.onEvent(e);
  }

  private onEvent(e: SimEvent) {
    const w = this.sim.get(e.id);
    const view = this.views.get(e.id);
    if (!w || !view) return;
    const feet = new THREE.Vector3(w.pos.x, w.pos.y - WOBBLER_CENTER + 0.05, w.pos.z);
    const body = new THREE.Vector3(w.pos.x, w.pos.y + 0.2, w.pos.z);
    const isMe = w === this.player;
    switch (e.type) {
      case "jump":
        view.impact("jump");
        this.fx.burst(feet, [0xffffff, 0xfff1c9], 6, 1.6, { up: 1, gravity: 3, life: 0.35 });
        break;
      case "land":
        view.impact("land", e.speed);
        if (e.speed > 6) {
          this.fx.burst(feet, [0xffffff, 0xfff1c9], 10, 2.4, { up: 1.2, gravity: 4, life: 0.4 });
          this.fx.ring(feet, 0xffffff, 0.9 + e.speed * 0.04, 0.3);
        }
        if (isMe && e.speed > 14) this.rig.kick(0.6);
        break;
      case "bounce":
        view.impact("bounce");
        this.fx.ring(feet, 0x57d9b7, 1.8, 0.35);
        this.fx.burst(feet, [0x57d9b7, 0xffffff], 12, 3, { up: 4 });
        break;
      case "dive":
        this.fx.burst(feet, [0xffffff], 6, 1.2, { up: 0.8, gravity: 2, life: 0.3 });
        break;
      case "ragdoll":
      case "hazardHit":
      case "ballHit":
      case "tackle": {
        const strength = "force" in e ? Math.min(2, e.force / 8) : 1;
        view.impact("hit", strength);
        this.fx.burst(body, [0xffe156, 0xffffff, 0xff7eb6], 14, 4, { up: 3 });
        if (e.type === "tackle") this.views.get(e.target)?.impact("hit", 1.2);
        if (isMe || (e.type === "tackle" && e.target === this.player.id)) this.rig.kick(0.5);
        break;
      }
      case "grab":
        this.fx.burst(body, [0xffffff], 5, 1.5, { gravity: 2, life: 0.25 });
        break;
      case "throw":
        this.fx.burst(body, [0xffffff, 0xffe156], 10, 3);
        break;
      case "respawn":
        this.fx.ring(feet, 0xffc93c, 1.6, 0.5);
        this.fx.burst(body, [0xffc93c, 0xffffff], 16, 2.5, { up: 3, gravity: 2 });
        break;
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
    this.rig.addLook(look.x, look.y);
    if (this.opts.bench) this.rig.yaw += realDt * 0.25;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < 5) {
      this.acc -= DT;
      this.tick();
      steps++;
    }
    if (steps === 5) this.acc = 0; // tab was asleep; don't spiral
    const alpha = this.acc / DT;
    this.renderTime = this.sim.time - DT + alpha * DT;

    // Wobblers
    for (const w of this.sim.wobblers) {
      const view = this.views.get(w.id);
      if (!view) continue;
      const p = this.prev.get(w.id) ?? w.pos;
      const x = p.x + (w.pos.x - p.x) * alpha;
      const y = p.y + (w.pos.y - p.y) * alpha;
      const z = p.z + (w.pos.z - p.z) * alpha;
      view.update(
        {
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
        },
        dt,
        this.groundBelow(w, x, y, z),
        this.renderTime,
      );
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

    this.level.update(this.renderTime);
    this.fx.update(dt);

    // Camera follows the player (or orbits the hub during the bench)
    const pp = this.views.get(this.player.id)!.root.position;
    const follow = this.opts.bench ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(pp.x, pp.y + WOBBLER_CENTER, pp.z);
    this.rig.distance = this.opts.bench ? 16 : 7;
    this.rig.update(follow, realDt, this.debug.reduceMotion);
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
  private groundBelow(w: Wobbler, x: number, y: number, z: number): number | null {
    if (w.state === "out") return null;
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
