// The shared simulation: Rapier world + Wobbler character controller + scripted hazards.
// Runs identically in the browser and on the server.
//
// Networking model (DESIGN.md §8): every client simulates its OWN Wobbler locally ("player"),
// everyone else is a "remote" proxy driven by network state. Interactions with a remote
// Wobbler (knock, squash, grab, ...) are not applied locally: they go to `outbox`, the server
// routes them to the Sim that owns that Wobbler, which applies them with `applyRemote`.
// Fixed time step, no rendering, no wall-clock time, no Math.random (seeded RNG only).

import RAPIER from "@dimforge/rapier3d-compat";
import { hazardPose, hazardShapes, isPlatform, type HazardDef } from "./hazards";
import type { LevelDef, SolidDef, Surface } from "./level";
import { angleDelta, clamp, conj, lenXZ, moveTowardXZ, quatFromAxisAngle, quatMul, rng, rotate, v3, type Quat, type Vec3 } from "./math";
import { TUNING, jumpVelocity } from "./tuning";

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Capsule: total height 1.0 m (2 × (HALF + RADIUS)). Body position = capsule centre. */
export const WOBBLER_RADIUS = 0.38;
export const WOBBLER_HALF = 0.245;
export const WOBBLER_CENTER = WOBBLER_HALF + WOBBLER_RADIUS; // centre height above the feet
/** Full height of a Wobbler, feet to the top of the head. */
export const WOBBLER_HEIGHT = WOBBLER_CENTER * 2;
/** Hard cap on horizontal speed (m/s). */
export const MAX_SPEED = 25;
/** Hard cap on upward speed from knockback (m/s). */
export const MAX_UP_SPEED = 18;

let ready: Promise<void> | null = null;
/** Rapier is WASM: call once before creating a Sim. */
export const initPhysics = () => (ready ??= RAPIER.init());

// ───────────────────────────── Types ─────────────────────────────

export interface InputFrame {
  /** Desired move direction in world XZ, length ≤ 1 (already camera-relative). */
  mx: number;
  mz: number;
  /** Edge-triggered: true only on the tick the button went down. */
  jump: boolean;
  dive: boolean;
  /** Level-triggered: true while the grab button is held. */
  grab: boolean;
}

export const NO_INPUT: InputFrame = { mx: 0, mz: 0, jump: false, dive: false, grab: false };

export type WobblerState = "normal" | "dive" | "slide" | "getup" | "ragdoll" | "held" | "out";
export type Behaviour = "player" | "idle" | "pace" | "wander" | "remote";

/** offline: single-player sandbox. client: own Wobbler local, balls are server-driven proxies. server: authoritative balls and dummies. */
export type SimRole = "offline" | "client" | "server";

/** Network-driven state of a remote Wobbler. */
export interface NetState {
  pos: Vec3;
  vel: Vec3;
  facing: number;
  state: WobblerState;
  grounded: boolean;
  grabbing: boolean;
  squashed: boolean;
  invulnerable: boolean;
  holding: number | null;
  heldBy: number | null;
  /** Stuck in a Jelly Clump. */
  clumped: boolean;
}

/** Interaction aimed at a Wobbler this Sim does not own. `from` is the Wobbler that caused it. */
export type NetMsg =
  | { k: "knock"; from: number; target: number; imp: Vec3; rag: boolean }
  | { k: "squash"; from: number; target: number }
  | { k: "grab"; from: number; target: number }
  | { k: "release"; from: number; target: number }
  | { k: "mash"; from: number; target: number }
  | { k: "drop"; from: number; target: number }
  | { k: "clump"; from: number; target: number };

export interface Wobbler {
  id: number;
  behaviour: Behaviour;
  color: number; // index into the player palette
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;

  pos: Vec3;
  vel: Vec3;
  facing: number; // yaw, radians; 0 = facing +Z
  state: WobblerState;
  stateTime: number;
  ragdollFor: number;

  grounded: boolean;
  groundSurface: Surface;
  belt: { x: number; z: number } | null;
  lastGroundedAt: number;
  jumpPressedAt: number;
  jumpedSinceGround: boolean;
  diveReadyAt: number;
  /** Jelly Clump partner, until when, jump presses so far, and when the next clump may start. */
  clumpWith: number | null;
  clumpUntil: number;
  clumpMash: number;
  clumpReadyAt: number;

  grabbing: boolean; // grab button held (hands out)
  holding: number | null;
  heldBy: number | null;
  holdTime: number;
  regrabAt: Map<number, number>;

  respawnPoint: Vec3;
  outUntil: number;
  invulnUntil: number;
  squashedUntil: number;
  hazardCooldown: Map<number, number>;
  aiTime: number;
  home: Vec3;
  /** Velocity of the moving platform we stand on (floes), applied on top of our own. */
  platformVel: Vec3 | null;
  /** Run speed multiplier set by round rules (e.g. carrying the crown). */
  speedMul: number;
  /** Remote Wobblers only: latest network state. */
  net: NetState | null;
}

export type SimEvent =
  | { type: "jump"; id: number }
  | { type: "land"; id: number; speed: number }
  | { type: "bounce"; id: number }
  | { type: "dive"; id: number }
  | { type: "ragdoll"; id: number; force: number }
  | { type: "grab"; id: number; target: number }
  | { type: "throw"; id: number; target: number }
  | { type: "release"; id: number; target: number }
  | { type: "tackle"; id: number; target: number }
  | { type: "stomp"; id: number; target: number; boosted: boolean }
  | { type: "hazardHit"; id: number; hazard: number; force: number }
  | { type: "ballHit"; id: number; force: number }
  | { type: "fall"; id: number }
  | { type: "respawn"; id: number }
  | { type: "clump"; id: number; target: number };

interface HazardRuntime {
  def: HazardDef;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
}

// ───────────────────────────── Sim ─────────────────────────────

export class Sim {
  readonly world: RAPIER.World;
  readonly level: LevelDef;
  time = 0;
  tick = 0;
  readonly wobblers: Wobbler[] = [];
  readonly hazards: HazardRuntime[] = [];
  readonly balls: RAPIER.RigidBody[] = [];
  events: SimEvent[] = [];
  /** Interactions with remote Wobblers produced this tick (see header). Cleared by the owner after sending. */
  outbox: NetMsg[] = [];
  readonly role: SimRole;
  /** Round start time (s). Hazards are evaluated at `time - epoch` and hold still before it. */
  epoch = 0;

  /** Seconds into the round for hazards (0 until the round starts). */
  hazardTime(t = this.time) {
    return Math.max(0, t - this.epoch) * this.rules.hazardSpeed;
  }

  /** House Rule modifiers (Party mode). */
  rules = { gravity: 1, hazardSpeed: 1, floor: null as "ice" | "sticky" | null };

  setRule(id: string | null) {
    this.rules = {
      gravity: id === "moon-bounce" ? 0.5 : 1,
      hazardSpeed: id === "turbo-traps" ? 1.35 : 1,
      floor: id === "ice-age" ? "ice" : id === "caramel-floors" ? "sticky" : null,
    };
  }

  private solidByCollider = new Map<number, SolidDef>();
  private wobblerByCollider = new Map<number, Wobbler>();
  private hazardByCollider = new Map<number, HazardRuntime>();
  private ballColliders = new Set<number>();
  private nextId = 1;
  private random: () => number;
  private lastShove = new Map<string, number>();

  constructor(level: LevelDef, seed = 1, role: SimRole = "offline") {
    this.level = level;
    this.role = role;
    this.random = rng(seed);
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = DT;

    for (const s of level.solids) {
      const rot = solidRotation(s);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(s.pos.x, s.pos.y, s.pos.z).setRotation(rot));
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(s.size.x / 2, s.size.y / 2, s.size.z / 2).setFriction(s.surface === "ice" ? 0.02 : 0.8),
        body,
      );
      this.solidByCollider.set(c.handle, s);
    }

    for (const def of level.hazards) this.addHazard(def);

    for (const b of level.balls) {
      // On clients balls are proxies that follow the server.
      const desc = role === "client" ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic();
      const body = this.world.createRigidBody(
        desc.setTranslation(b.pos.x, b.pos.y, b.pos.z).setLinearDamping(0.3).setAngularDamping(0.4).setCcdEnabled(role !== "client"),
      );
      const c = this.world.createCollider(RAPIER.ColliderDesc.ball(b.radius).setRestitution(b.bouncy ? 0.9 : 0.7).setDensity(b.bouncy ? 0.12 : 0.25).setFriction(0.6), body);
      this.ballColliders.add(c.handle);
      this.balls.push(body);
    }

    // Dummies are server-owned NPCs; clients see them as remotes.
    if (role !== "client") for (const d of level.dummies) this.addWobbler(d.pos, d.behaviour);
  }

  /** Add a scripted hazard (level load, or mid-round, e.g. a Gremlin avalanche). */
  addHazard(def: HazardDef) {
    const pose = hazardPose(def, this.hazardTime());
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pose.pos.x, pose.pos.y, pose.pos.z).setRotation(pose.rot),
    );
    const colliders = hazardShapes(def).map((s) =>
      this.world.createCollider(
        (s.radius ? RAPIER.ColliderDesc.ball(s.radius) : RAPIER.ColliderDesc.cuboid(s.half.x, s.half.y, s.half.z))
          .setTranslation(s.offset.x, s.offset.y, s.offset.z)
          .setFriction(def.kind === "floe" ? 0.05 : 0.5),
        body,
      ),
    );
    const h = { def, body, colliders };
    this.hazards.push(h);
    for (const c of colliders) this.hazardByCollider.set(c.handle, h);
    return h;
  }

  addWobbler(pos: Vec3, behaviour: Behaviour, color = this.nextId % 8, id = this.nextId): Wobbler {
    this.nextId = Math.max(this.nextId, id + 1);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(WOBBLER_HALF, WOBBLER_RADIUS).setFriction(0), body);
    const controller = this.world.createCharacterController(0.02);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    controller.enableAutostep(0.3, 0.2, false);
    controller.enableSnapToGround(0.25);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(4);

    const w: Wobbler = {
      id,
      behaviour,
      color,
      body,
      collider,
      controller,
      pos: { ...pos },
      vel: v3(),
      facing: 0,
      state: "normal",
      stateTime: 0,
      ragdollFor: 0,
      grounded: false,
      groundSurface: "normal",
      belt: null,
      lastGroundedAt: -Infinity,
      jumpPressedAt: -Infinity,
      jumpedSinceGround: false,
      diveReadyAt: 0,
      clumpWith: null,
      clumpUntil: 0,
      clumpMash: 0,
      clumpReadyAt: 0,
      grabbing: false,
      holding: null,
      heldBy: null,
      holdTime: 0,
      regrabAt: new Map(),
      respawnPoint: { ...pos },
      outUntil: 0,
      invulnUntil: 0,
      squashedUntil: 0,
      hazardCooldown: new Map(),
      aiTime: this.random() * 10,
      home: { ...pos },
      platformVel: null,
      speedMul: 1,
      net: null,
    };
    this.wobblers.push(w);
    this.wobblerByCollider.set(collider.handle, w);
    return w;
  }

  removeWobbler(id: number) {
    const w = this.get(id);
    if (!w) return;
    for (const o of this.wobblers) {
      if (o.holding === id) {
        o.holding = null;
        o.holdTime = 0;
      }
      if (o.heldBy === id) {
        o.heldBy = null;
        if (o.state === "held") this.setState(o, "normal");
      }
    }
    this.wobblerByCollider.delete(w.collider.handle);
    this.world.removeCharacterController(w.controller);
    this.world.removeRigidBody(w.body);
    this.wobblers.splice(this.wobblers.indexOf(w), 1);
  }

  /** Clients: jump the clock to the server's tick (hazards are functions of time). */
  jumpTo(tick: number) {
    this.tick = tick;
    this.time = tick * DT;
  }

  /** Clients: place a ball proxy from server state (applied on the next step). */
  setBall(i: number, pos: Vec3, rot: Quat) {
    const b = this.balls[i];
    if (!b) return;
    b.setNextKinematicTranslation(pos);
    b.setNextKinematicRotation(rot);
  }

  get(id: number | null | undefined) {
    return id == null ? undefined : this.wobblers.find((w) => w.id === id);
  }

  /** Advance one fixed tick. `inputs` maps wobbler id → input; AI wobblers generate their own. */
  step(inputs: ReadonlyMap<number, InputFrame> = new Map()) {
    this.events = [];
    this.tick++;
    const prevT = this.time;
    this.time = this.tick * DT;

    for (const h of this.hazards) {
      const p = hazardPose(h.def, this.hazardTime());
      h.body.setNextKinematicTranslation(p.pos);
      h.body.setNextKinematicRotation(p.rot);
    }

    for (const w of this.wobblers) {
      if (w.behaviour === "remote") {
        this.updateRemote(w);
        continue;
      }
      const input = w.behaviour === "player" ? (inputs.get(w.id) ?? NO_INPUT) : this.aiInput(w);
      this.updateWobbler(w, input, prevT);
    }

    this.world.step();

    for (const w of this.wobblers) {
      const t = w.body.translation();
      w.pos.x = t.x;
      w.pos.y = t.y;
      w.pos.z = t.z;
      if (w.behaviour !== "remote" && w.state !== "out" && w.pos.y < this.level.killY) this.fallOut(w);
    }
    for (const b of this.balls) {
      if (this.role !== "client" && b.translation().y < this.level.killY) {
        const start = this.level.balls[this.balls.indexOf(b)].pos;
        b.setTranslation(start, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  // ───────────────────────── Remote Wobblers ─────────────────────────

  isRemote(w: Wobbler) {
    return w.behaviour === "remote";
  }

  private updateRemote(w: Wobbler) {
    const holder = this.get(w.heldBy);
    // We are carrying them: place them locally so it feels instant.
    if (holder && !this.isRemote(holder) && holder.holding === w.id) {
      this.followHolder(w, NO_INPUT);
      return;
    }
    const n = w.net;
    if (!n) return;
    if (n.state === "out") {
      if (w.state !== "out") w.collider.setEnabled(false);
      w.state = "out";
      return;
    }
    if (w.state === "out") {
      w.collider.setEnabled(true);
      w.body.setTranslation(n.pos, true);
    }
    if (w.state !== n.state) this.setState(w, n.state);
    else w.stateTime += DT;
    w.vel = { ...n.vel };
    w.facing = n.facing;
    w.grounded = n.grounded;
    w.grabbing = n.grabbing;
    w.squashedUntil = n.squashed ? this.time + 0.1 : 0;
    w.invulnUntil = n.invulnerable ? this.time + 0.1 : 0;
    w.holding = n.holding;
    w.heldBy = n.heldBy;
    w.body.setNextKinematicTranslation(n.pos);
    // The server referees ball hits for everyone (balls are proxies on clients).
    if (this.role === "server") this.checkBalls(w);
  }

  /** Apply an interaction routed from another Sim. Returns false if it was refused. */
  applyRemote(m: NetMsg): boolean {
    const target = this.get(m.target);
    const from = this.get(m.from);
    if (!target || this.isRemote(target)) return false;
    switch (m.k) {
      case "knock":
        if (target.state === "out") return false;
        this.knock(target, m.imp, m.rag);
        return true;
      case "squash":
        if (target.state === "out" || target.state === "held") return false;
        target.squashedUntil = this.time + TUNING.stomp.squashTime;
        if (!target.grounded) target.vel.y = Math.min(target.vel.y, -3);
        return true;
      case "grab":
        if (target.state === "out" || target.state === "held" || target.heldBy != null) return false;
        this.release(target, false);
        target.heldBy = m.from;
        this.setState(target, "held");
        target.vel = v3();
        if (from) from.holding = target.id;
        return true;
      case "release":
        if (target.heldBy !== m.from) return false;
        target.heldBy = null;
        if (target.state === "held") this.setState(target, "normal");
        if (from && from.holding === target.id) from.holding = null;
        return true;
      case "mash":
        if (target.holding !== m.from) return false;
        target.holdTime += TUNING.grab.mashBreak;
        return true;
      case "clump":
        if (!from || !this.canClump(target)) return false;
        this.startClump(target, m.from);
        return true;
      case "drop":
        if (target.holding !== m.from) return false;
        target.holding = null;
        target.holdTime = 0;
        target.regrabAt.set(m.from, this.time + TUNING.grab.regrabCooldown);
        if (from && from.heldBy === target.id) from.heldBy = null;
        return true;
    }
  }

  // ───────────────────────── Wobbler update ─────────────────────────

  private updateWobbler(w: Wobbler, input: InputFrame, prevT: number) {
    const t = this.time;
    const T = TUNING;
    w.stateTime += DT;

    if (w.state === "out") {
      if (t >= w.outUntil) this.respawn(w);
      return;
    }
    if (w.state === "held") {
      this.followHolder(w, input);
      return;
    }

    this.checkHazards(w, prevT);
    if (this.role !== "client") this.checkBalls(w);

    const free = w.state === "normal";
    w.grabbing = free && input.grab;

    // ── Horizontal velocity
    const len = Math.hypot(input.mx, input.mz);
    const dirX = free && len > 0.01 ? input.mx / Math.max(1, len) : 0;
    const dirZ = free && len > 0.01 ? input.mz / Math.max(1, len) : 0;
    const hasInput = dirX !== 0 || dirZ !== 0;

    if (w.state === "normal") {
      const surface = w.grounded ? w.groundSurface : "normal";
      let speed = T.move.runSpeed;
      if (surface === "sticky") speed *= T.surface.stickySpeedMul;
      if (w.holding != null) speed *= T.grab.holdSlowdown;
      if (t < w.squashedUntil) speed *= T.stomp.squashSlow;
      speed *= w.speedMul;
      if (w.clumpWith != null) speed *= T.clump.control;
      let accel: number;
      if (w.grounded) {
        accel = hasInput ? T.move.groundAccel : T.move.groundDecel;
        if (surface === "ice") accel *= hasInput ? T.surface.iceAccelMul : T.surface.iceDecelMul;
      } else {
        accel = hasInput ? T.move.groundAccel * T.move.airControl : 0;
      }
      moveTowardXZ(w.vel, dirX * speed, dirZ * speed, accel * DT);
      if (hasInput) {
        const want = Math.atan2(dirX, dirZ);
        const d = angleDelta(w.facing, want);
        w.facing += clamp(d, -T.move.turnRate * DT, T.move.turnRate * DT);
      }
    } else if (w.state === "slide" || w.state === "getup" || (w.state === "ragdoll" && w.grounded)) {
      const friction = w.state === "ragdoll" ? T.ragdoll.friction : T.dive.slideFriction;
      const iceMul = w.grounded && w.groundSurface === "ice" ? T.surface.iceDecelMul : 1;
      moveTowardXZ(w.vel, 0, 0, friction * iceMul * DT);
    }

    if (w.clumpWith != null) this.updateClump(w, input);

    // ── Jump (buffer + coyote time)
    if (input.jump && w.clumpWith == null) w.jumpPressedAt = t;
    if (w.state === "normal" && w.clumpWith == null) {
      const canJump = !w.jumpedSinceGround && (w.grounded || t - w.lastGroundedAt <= T.jump.coyoteTime);
      if (canJump && t - w.jumpPressedAt <= T.jump.bufferTime) {
        w.vel.y = jumpVelocity();
        w.jumpPressedAt = -Infinity;
        w.jumpedSinceGround = true;
        w.grounded = false;
        this.events.push({ type: "jump", id: w.id });
      }
    }

    // ── Dive
    if (input.dive && w.state === "normal" && t >= w.diveReadyAt && w.clumpWith == null) {
      this.release(w, false);
      const fx = Math.sin(w.facing);
      const fz = Math.cos(w.facing);
      const along = Math.max(T.dive.speed, w.vel.x * fx + w.vel.z * fz);
      w.vel.x = fx * along;
      w.vel.z = fz * along;
      w.vel.y = Math.max(w.vel.y, T.dive.hop);
      this.setState(w, "dive");
      w.grounded = false;
      this.events.push({ type: "dive", id: w.id });
    }

    // ── State timers
    if (w.state === "slide" && w.stateTime >= T.dive.slideTime) this.setState(w, "getup");
    else if (w.state === "ragdoll" && w.grounded && w.stateTime >= w.ragdollFor) this.setState(w, "getup");
    else if (w.state === "getup" && w.stateTime >= T.dive.getUpTime) {
      this.setState(w, "normal");
      w.diveReadyAt = t + T.dive.cooldown;
    }

    // ── Gravity
    const g = T.jump.gravity * this.rules.gravity * (w.vel.y < 0 ? T.jump.fallGravityMul : 1);
    w.vel.y = Math.max(-T.jump.maxFallSpeed, w.vel.y - g * DT);

    // ── Grab / hold
    this.updateGrab(w, input);

    // Safety net: no gameplay system should ever exceed this.
    const h = lenXZ(w.vel);
    if (h > MAX_SPEED) {
      w.vel.x *= MAX_SPEED / h;
      w.vel.z *= MAX_SPEED / h;
    }

    // ── Move with the character controller
    const belt = w.grounded && w.belt ? w.belt : null;
    const plat = w.grounded ? w.platformVel : null;
    const desired = {
      x: (w.vel.x + (belt?.x ?? 0) + (plat?.x ?? 0)) * DT,
      y: (w.vel.y + Math.min(0, plat?.y ?? 0)) * DT,
      z: (w.vel.z + (belt?.z ?? 0) + (plat?.z ?? 0)) * DT,
    };
    if (w.vel.y > 0) w.controller.disableSnapToGround();
    else w.controller.enableSnapToGround(0.25);

    const partner = w.holding ?? w.heldBy;
    w.controller.computeColliderMovement(w.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (c) => {
      const other = this.wobblerByCollider.get(c.handle);
      return !other || (other.id !== partner && other.state !== "out" && other.state !== "held");
    });
    const mv = w.controller.computedMovement();
    const wasGrounded = w.grounded;
    const fallSpeed = -w.vel.y;
    // Moving upward (jump, dive hop, bounce) never counts as grounded, even while still touching the floor.
    w.grounded = w.controller.computedGrounded() && w.vel.y <= 0;

    // The controller can report the same contact several times per tick: bump each Wobbler once.
    const bumped = new Set<Wobbler>();
    for (let i = 0; i < w.controller.numComputedCollisions(); i++) {
      const c = w.controller.computedCollision(i);
      if (!c?.collider) continue;
      const n = c.normal1;
      const other = this.wobblerByCollider.get(c.collider.handle);
      if (other && !bumped.has(other)) {
        bumped.add(other);
        // Coming down on someone's head: their jelly dome is a trampoline. Nobody can stand on a head.
        if (n.y >= TUNING.stomp.minNormalY && w.vel.y <= 0) {
          this.stomp(w, other, t);
          continue;
        }
        this.bump(w, other);
      }
      // Cancel velocity into walls and ceilings (normal1 points from the obstacle toward us).
      const into = w.vel.x * n.x + w.vel.y * n.y + w.vel.z * n.z;
      if (into < 0 && n.y < 0.7) {
        w.vel.x -= n.x * into;
        w.vel.y -= n.y * into;
        w.vel.z -= n.z * into;
      }
    }

    const next = { x: w.pos.x + mv.x, y: w.pos.y + mv.y, z: w.pos.z + mv.z };
    // Standing still, the controller lets the capsule creep into the floor a few mm per second; once it
    // overlaps, Rapier refuses every move. Lift it back to rest height (plus the controller offset).
    if (w.grounded) {
      const down = this.world.castRay(new RAPIER.Ray(next, { x: 0, y: -1, z: 0 }), WOBBLER_CENTER + 0.05, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, w.collider);
      if (down && down.timeOfImpact < WOBBLER_CENTER + 0.01) next.y += WOBBLER_CENTER + 0.015 - down.timeOfImpact;
    }
    w.body.setNextKinematicTranslation(next);

    // ── Ground info & landing
    if (w.grounded) {
      this.readGround(w, next);
      w.lastGroundedAt = t;
      w.jumpedSinceGround = w.vel.y > 0 && w.jumpedSinceGround;
      if (!wasGrounded) this.land(w, fallSpeed);
      if (w.grounded && w.vel.y < 0) w.vel.y = 0;
    }
  }

  private land(w: Wobbler, speed: number) {
    const T = TUNING;
    this.events.push({ type: "land", id: w.id, speed });
    if (w.groundSurface === "bouncer" && w.state !== "held") {
      w.vel.y = Math.sqrt(2 * T.jump.gravity * T.jump.height * T.surface.bounceMul);
      w.grounded = false;
      w.jumpedSinceGround = true;
      this.events.push({ type: "bounce", id: w.id });
      return;
    }
    if (w.state === "dive") this.setState(w, "slide");
    else if (w.state === "normal" && speed >= T.ragdoll.hardLandingSpeed) this.ragdoll(w, T.ragdoll.minTime);
  }

  private readGround(w: Wobbler, at: Vec3) {
    const ray = new RAPIER.Ray({ x: at.x, y: at.y, z: at.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, WOBBLER_CENTER + 0.35, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, w.collider);
    const solid = hit ? this.solidByCollider.get(hit.collider.handle) : undefined;
    const platform = hit ? this.hazardByCollider.get(hit.collider.handle) : undefined;
    w.platformVel = null;
    if (hit && platform && isPlatform(platform.def)) {
      const p = { x: at.x, y: at.y - hit.timeOfImpact, z: at.z };
      w.platformVel = pointVelocity(platform.def, p, this.hazardTime(this.time - DT), this.hazardTime());
      w.groundSurface = "ice"; // floes are slippery
      w.belt = null;
      return;
    }
    w.groundSurface = solid?.surface ?? "normal";
    if (this.rules.floor && w.groundSurface === "normal") w.groundSurface = this.rules.floor;
    w.belt = solid?.surface === "conveyor" ? (solid.belt ?? null) : null;
    if (solid?.respawn) w.respawnPoint = solid.respawn;
  }

  private setState(w: Wobbler, s: WobblerState) {
    w.state = s;
    w.stateTime = 0;
  }

  // ───────────────────────── Interactions ─────────────────────────

  /** Add an impulse (m/s). Big impulses knock the Wobbler over. */
  knock(w: Wobbler, imp: Vec3, forceRagdoll = false, from = 0) {
    if (w.state === "out") return;
    if (this.isRemote(w)) {
      this.outbox.push({ k: "knock", from, target: w.id, imp: { ...imp }, rag: forceRagdoll });
      return;
    }
    if (w.state === "held") this.releaseFromHolder(w);
    w.vel.x += imp.x;
    // Upward kicks don't stack: being hit twice in a row shouldn't send anyone into orbit.
    w.vel.y = imp.y > 0 ? Math.min(MAX_UP_SPEED, Math.max(w.vel.y, 0) + imp.y) : w.vel.y + imp.y;
    w.vel.z += imp.z;
    if (imp.y > 0) w.grounded = false;
    const force = Math.hypot(imp.x, imp.y, imp.z);
    if (forceRagdoll || force >= TUNING.ragdoll.knockbackThreshold) {
      this.ragdoll(w, clamp(TUNING.ragdoll.minTime + force * 0.04, TUNING.ragdoll.minTime, TUNING.ragdoll.maxTime));
      this.events.push({ type: "ragdoll", id: w.id, force });
    }
  }

  private ragdoll(w: Wobbler, duration: number) {
    this.release(w, false);
    this.setState(w, "ragdoll");
    w.ragdollFor = duration;
  }

  private checkHazards(w: Wobbler, prevT: number) {
    if (this.time < w.invulnUntil) return;
    this.hazards.forEach((h, hi) => {
      if (isPlatform(h.def)) return;
      if ((w.hazardCooldown.get(hi) ?? -1) > this.time) return;
      for (const c of h.colliders) {
        const contact = c.contactCollider(w.collider, 0.04);
        if (!contact || contact.distance > 0.04) continue;
        const v = pointVelocity(h.def, contact.point1, this.hazardTime(prevT), this.hazardTime());
        let dx = v.x;
        let dz = v.z;
        let mag = Math.hypot(dx, dz);
        if (mag < 0.5) {
          // Barely moving part (or a press slamming down): push out along the contact normal.
          dx = contact.normal1.x;
          dz = contact.normal1.z;
          mag = Math.hypot(dx, dz);
          if (mag < 0.1) {
            dx = w.pos.x - h.body.translation().x;
            dz = w.pos.z - h.body.translation().z;
            mag = Math.hypot(dx, dz) || 1;
          }
        }
        const speed = Math.max(TUNING.hazard.minKnockback, Math.hypot(v.x, v.y, v.z) * TUNING.hazard.knockbackMul);
        const imp = { x: (dx / mag) * speed, y: TUNING.hazard.upKick, z: (dz / mag) * speed };
        w.hazardCooldown.set(hi, this.time + 0.35);
        this.events.push({ type: "hazardHit", id: w.id, hazard: hi, force: speed });
        this.knock(w, imp, true, w.id);
        return;
      }
    });
  }

  private checkBalls(w: Wobbler) {
    for (const b of this.balls) {
      const c = b.collider(0);
      const contact = c.contactCollider(w.collider, 0.05);
      if (!contact || contact.distance > 0.05) continue;
      const lv = b.linvel();
      const rel = Math.hypot(lv.x - w.vel.x, lv.z - w.vel.z);
      if (rel < 4) continue;
      const imp = { x: lv.x * 0.6, y: 2.5, z: lv.z * 0.6 };
      this.events.push({ type: "ballHit", id: w.id, force: rel });
      this.knock(w, imp, false, w.id);
    }
  }

  /** Head bounce (DESIGN.md §3.6): the stomper springs up, the stomped one is squashed flat for a moment. */
  private stomp(w: Wobbler, other: Wobbler, t: number) {
    const T = TUNING.stomp;
    const boosted = t - w.jumpPressedAt <= TUNING.jump.bufferTime;
    if (boosted) w.jumpPressedAt = -Infinity;
    w.vel.y = Math.sqrt(2 * TUNING.jump.gravity * (boosted ? T.boostHeight : T.height));
    w.grounded = false;
    w.jumpedSinceGround = true;
    // Slide off the dome: away from their centre, or forward if perfectly centred.
    let dx = w.pos.x - other.pos.x;
    let dz = w.pos.z - other.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      dx = Math.sin(w.facing);
      dz = Math.cos(w.facing);
    } else {
      dx /= d;
      dz /= d;
    }
    const along = w.vel.x * dx + w.vel.z * dz;
    if (along < T.slideOff) {
      w.vel.x += dx * (T.slideOff - along);
      w.vel.z += dz * (T.slideOff - along);
    }
    if (this.isRemote(other)) this.outbox.push({ k: "squash", from: w.id, target: other.id });
    else if (other.state !== "out" && other.state !== "held") {
      other.squashedUntil = t + T.squashTime;
      if (!other.grounded) other.vel.y = Math.min(other.vel.y, -3);
    }
    this.events.push({ type: "stomp", id: w.id, target: other.id, boosted });
  }

  private canClump(w: Wobbler) {
    return (w.state === "normal" || w.state === "dive" || w.state === "slide") && w.clumpWith == null && w.heldBy == null && w.holding == null && this.time >= w.clumpReadyAt && this.time >= w.invulnUntil;
  }

  private startClump(w: Wobbler, partner: number) {
    w.clumpWith = partner;
    w.clumpUntil = this.time + TUNING.clump.time;
    w.clumpMash = 0;
    if (w.state !== "normal") this.setState(w, "normal");
  }

  /** Two jelly Wobblers hitting hard stick together (DESIGN.md §3.6 Jelly Clump). */
  private tryClump(w: Wobbler, other: Wobbler): boolean {
    const C = TUNING.clump;
    const otherFree = this.isRemote(other)
      ? !!other.net && !other.net.clumped && !other.net.invulnerable && ["normal", "dive", "slide"].includes(other.net.state) && other.heldBy == null
      : this.canClump(other);
    if (!this.canClump(w) || !otherFree) return false;
    const dx = other.pos.x - w.pos.x;
    const dz = other.pos.z - w.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const closing = ((w.vel.x - other.vel.x) * dx + (w.vel.z - other.vel.z) * dz) / d;
    const bothDiving = w.state === "dive" && (this.isRemote(other) ? other.net!.state : other.state) === "dive";
    if (!bothDiving && closing < C.minClosing) return false;
    this.startClump(w, other.id);
    if (this.isRemote(other)) this.outbox.push({ k: "clump", from: w.id, target: other.id });
    else this.startClump(other, w.id);
    this.events.push({ type: "clump", id: w.id, target: other.id });
    return true;
  }

  private endClump(w: Wobbler, pop: boolean) {
    const partner = this.get(w.clumpWith);
    w.clumpWith = null;
    w.clumpReadyAt = this.time + TUNING.clump.cooldown;
    if (pop && partner) {
      const dx = w.pos.x - partner.pos.x;
      const dz = w.pos.z - partner.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      w.vel.x += (dx / d) * TUNING.clump.pop;
      w.vel.z += (dz / d) * TUNING.clump.pop;
      w.vel.y = Math.max(w.vel.y, 3.5);
      w.grounded = false;
    }
  }

  /** Stuck together: share velocity, hold a fixed gap, wriggle free with jump presses. */
  private updateClump(w: Wobbler, input: InputFrame) {
    const C = TUNING.clump;
    const p = this.get(w.clumpWith);
    const t = this.time;
    const partnerStuck = p && (this.isRemote(p) ? (p.net?.clumped ?? false) || t < w.clumpUntil - C.time + 0.4 : p.clumpWith === w.id);
    const gone = !p || !partnerStuck || p.state === "out" || p.state === "held" || w.state !== "normal";
    if (input.jump) w.clumpMash++;
    if (gone || t >= w.clumpUntil || w.clumpMash >= C.mashCount || Math.hypot(p.pos.x - w.pos.x, p.pos.z - w.pos.z) > 3) {
      this.endClump(w, !gone);
      return;
    }
    const pv = p.vel;
    const k = 0.25;
    w.vel.x += ((w.vel.x + pv.x) / 2 - w.vel.x) * k;
    w.vel.z += ((w.vel.z + pv.z) / 2 - w.vel.z) * k;
    const dx = p.pos.x - w.pos.x;
    const dz = p.pos.z - w.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const gap = WOBBLER_RADIUS * 2 - 0.08;
    const spring = clamp((d - gap) * 6, -4, 4);
    w.vel.x += (dx / d) * spring * DT * 10;
    w.vel.z += (dz / d) * spring * DT * 10;
    // Roll around each other a little: the blob spins.
    w.facing += DT * 5;
  }

  private bump(w: Wobbler, other: Wobbler) {
    if (other.state === "out" || other.state === "held") return;
    if (w.clumpWith === other.id) return;
    if (this.tryClump(w, other)) return;
    // Diving, or still belly-sliding fast, into someone is a tackle.
    if (w.state === "dive" || (w.state === "slide" && lenXZ(w.vel) > 3)) {
      const T = TUNING.bump;
      this.knock(other, { x: w.vel.x * T.tackleMul, y: T.tackleUp, z: w.vel.z * T.tackleMul }, true, w.id);
      w.vel.x *= 0.5;
      w.vel.z *= 0.5;
      this.events.push({ type: "tackle", id: w.id, target: other.id });
      return;
    }
    const speed = lenXZ(w.vel);
    if (speed < 2 || other.state === "ragdoll") return;
    const dx = other.pos.x - w.pos.x;
    const dz = other.pos.z - w.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    // Nudge them up to a target push speed. Never additive, so two Wobblers pressed together
    // can't feed each other ever-growing velocities.
    const push = (TUNING.bump.shove * speed) / TUNING.move.runSpeed;
    const along = other.vel.x * (dx / d) + other.vel.z * (dz / d);
    const add = Math.max(0, push - along);
    if (this.isRemote(other)) {
      // Pushing someone across the network: a small, rate-limited nudge.
      const key = `${w.id}>${other.id}`;
      if (add < 0.3 || (this.lastShove.get(key) ?? -1) > this.time) return;
      this.lastShove.set(key, this.time + 0.2);
      this.knock(other, { x: (dx / d) * add, y: 0, z: (dz / d) * add }, false, w.id);
      return;
    }
    other.vel.x += (dx / d) * add;
    other.vel.z += (dz / d) * add;
  }

  // ───────────────────────── Grab & throw ─────────────────────────

  private updateGrab(w: Wobbler, input: InputFrame) {
    const G = TUNING.grab;
    if (w.holding != null) {
      const target = this.get(w.holding);
      // A remote target's state lags; what matters is that we still have them.
      if (!target || (this.isRemote(target) ? target.heldBy !== w.id : target.state !== "held")) {
        w.holding = null;
        return;
      }
      w.holdTime += DT;
      if (!input.grab) this.release(w, true);
      else if (w.holdTime >= G.maxHold) this.release(w, false);
      return;
    }
    if (!w.grabbing) return;

    const fx = Math.sin(w.facing);
    const fz = Math.cos(w.facing);
    const cosCone = Math.cos(((G.coneDeg / 2) * Math.PI) / 180);
    let best: Wobbler | null = null;
    let bestD = Infinity;
    for (const o of this.wobblers) {
      if (o === w || o.state === "out" || o.state === "held" || o.heldBy != null) continue;
      if ((w.regrabAt.get(o.id) ?? -1) > this.time) continue;
      const dx = o.pos.x - w.pos.x;
      const dz = o.pos.z - w.pos.z;
      if (Math.abs(o.pos.y - w.pos.y) > 1) continue;
      const d = Math.hypot(dx, dz);
      if (d > G.range + WOBBLER_RADIUS * 2 || d < 1e-4) continue;
      if ((dx * fx + dz * fz) / d < cosCone) continue;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return;
    w.holding = best.id;
    w.holdTime = 0;
    best.heldBy = w.id;
    this.events.push({ type: "grab", id: w.id, target: best.id });
    if (this.isRemote(best)) {
      // Their owner confirms (or refuses with a "drop"); carry them locally meanwhile.
      this.outbox.push({ k: "grab", from: w.id, target: best.id });
      return;
    }
    this.release(best, false);
    this.setState(best, "held");
    best.vel = v3();
  }

  /** Let go of whoever `w` is holding. `toss` = throw them (ragdoll) instead of dropping. */
  private release(w: Wobbler, toss: boolean) {
    if (w.holding == null) return;
    const target = this.get(w.holding);
    w.holding = null;
    w.holdTime = 0;
    if (!target) return;
    target.heldBy = null;
    w.regrabAt.set(target.id, this.time + TUNING.grab.regrabCooldown);
    if (this.isRemote(target)) this.outbox.push({ k: "release", from: w.id, target: target.id });
    else if (target.state !== "held") return;
    else this.setState(target, "normal");
    if (toss) {
      const G = TUNING.grab;
      const fx = Math.sin(w.facing);
      const fz = Math.cos(w.facing);
      this.events.push({ type: "throw", id: w.id, target: target.id });
      this.knock(target, { x: fx * G.throwSpeed + w.vel.x * 0.5, y: G.throwUp, z: fz * G.throwSpeed + w.vel.z * 0.5 }, true, w.id);
    } else {
      this.events.push({ type: "release", id: w.id, target: target.id });
    }
  }

  private releaseFromHolder(w: Wobbler) {
    const holder = this.get(w.heldBy);
    if (holder && this.isRemote(holder)) {
      // Knocked out of a remote player's hands: tell them to let go.
      this.outbox.push({ k: "drop", from: w.id, target: holder.id });
      holder.holding = null;
      w.heldBy = null;
      this.setState(w, "normal");
    } else if (holder) this.release(holder, false);
    else {
      w.heldBy = null;
      this.setState(w, "normal");
    }
  }

  private followHolder(w: Wobbler, input: InputFrame) {
    const holder = this.get(w.heldBy);
    const remoteHolder = holder != null && this.isRemote(holder);
    // A remote holder's "holding" lags behind the grab message: trust heldBy, with a safety timeout.
    const lost = !holder || (!remoteHolder && holder.holding !== w.id) || (remoteHolder && w.stateTime > TUNING.grab.maxHold + 1.5);
    if (lost) {
      if (holder && remoteHolder) this.outbox.push({ k: "drop", from: w.id, target: holder.id });
      w.heldBy = null;
      this.setState(w, "normal");
      return;
    }
    // Mash jump to wriggle free sooner.
    if (input.jump) {
      if (remoteHolder) this.outbox.push({ k: "mash", from: w.id, target: holder.id });
      else holder.holdTime += TUNING.grab.mashBreak;
    }
    const fx = Math.sin(holder.facing);
    const fz = Math.cos(holder.facing);
    const reach = WOBBLER_RADIUS * 2 + 0.1;
    w.facing = holder.facing + Math.PI;
    w.vel = { ...holder.vel };
    w.body.setNextKinematicTranslation({ x: holder.pos.x + fx * reach, y: holder.pos.y + 0.25, z: holder.pos.z + fz * reach });
  }

  // ───────────────────────── Falling out & respawn ─────────────────────────

  /** Debug helper: send a Wobbler straight back to its respawn point. */
  forceRespawn(w: Wobbler) {
    if (w.state !== "out") this.fallOut(w);
    w.outUntil = this.time;
  }

  /** Take a Wobbler out of play without a fall (finished a race, became a spectator). */
  retire(w: Wobbler) {
    this.release(w, false);
    if (w.heldBy != null) this.releaseFromHolder(w);
    this.setState(w, "out");
    w.outUntil = Infinity;
    w.vel = v3();
    w.collider.setEnabled(false);
  }

  private fallOut(w: Wobbler) {
    this.release(w, false);
    if (w.heldBy != null) this.releaseFromHolder(w);
    this.setState(w, "out");
    w.outUntil = this.level.failRule === "out" ? Infinity : this.time + TUNING.respawn.delay;
    w.vel = v3();
    w.collider.setEnabled(false);
    this.events.push({ type: "fall", id: w.id });
  }

  private respawn(w: Wobbler) {
    const p = this.freeSpotNear(w.respawnPoint, w);
    w.body.setTranslation(p, true);
    w.body.setNextKinematicTranslation(p);
    w.pos = { ...p };
    w.vel = v3();
    w.collider.setEnabled(true);
    w.grounded = false;
    w.invulnUntil = this.time + TUNING.respawn.invulnerable;
    this.setState(w, "normal");
    this.events.push({ type: "respawn", id: w.id });
  }

  /** First spot on a small ring around `p` not occupied by another Wobbler. */
  private freeSpotNear(p: Vec3, self: Wobbler): Vec3 {
    const minGap = WOBBLER_RADIUS * 2 + 0.1;
    const taken = (q: Vec3) => this.wobblers.some((o) => o !== self && o.state !== "out" && Math.hypot(o.pos.x - q.x, o.pos.z - q.z) < minGap && Math.abs(o.pos.y - q.y) < 1.5);
    if (!taken(p)) return { ...p };
    for (let ring = 1; ring <= 3; ring++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const q = { x: p.x + Math.cos(a) * minGap * ring, y: p.y, z: p.z + Math.sin(a) * minGap * ring };
        if (!taken(q)) return q;
      }
    }
    return { x: p.x, y: p.y + 1.2, z: p.z };
  }

  // ───────────────────────── Simple AI for dummies / bench bots ─────────────────────────

  private aiInput(w: Wobbler): InputFrame {
    w.aiTime += DT;
    switch (w.behaviour) {
      case "pace": {
        // Stroll 3 m either side of home, at a gentle pace.
        const tx = w.home.x + (Math.floor(w.aiTime / 3) % 2 === 0 ? 3 : -3);
        return { mx: clamp((tx - w.pos.x) / 2, -0.5, 0.5), mz: clamp((w.home.z - w.pos.z) / 2, -0.5, 0.5), jump: false, dive: false, grab: false };
      }
      case "wander": {
        // Steer toward a slowly moving target on the hub; hop and dive now and then.
        const a = w.id * 1.7 + w.aiTime * 0.35;
        const tx = Math.sin(a) * 6 - w.pos.x;
        const tz = Math.cos(a * 1.3) * 6 - w.pos.z;
        const d = Math.hypot(tx, tz) || 1;
        return {
          mx: tx / d,
          mz: tz / d,
          jump: this.random() < 0.012,
          dive: this.random() < 0.003,
          grab: false,
        };
      }
      default:
        return NO_INPUT;
    }
  }
}

// ───────────────────────────── Helpers ─────────────────────────────

function solidRotation(s: SolidDef): Quat {
  const yaw = quatFromAxisAngle(0, 1, 0, s.yaw ?? 0);
  const tilt = quatFromAxisAngle(1, 0, 0, s.tilt ?? 0);
  return quatMul(yaw, tilt);
}

/** Velocity of a world-space point attached to a hazard, between times t0 and t1. */
export function pointVelocity(def: HazardDef, p: Vec3, t0: number, t1: number): Vec3 {
  const a = hazardPose(def, t0);
  const b = hazardPose(def, t1);
  // Express p in the hazard's frame at t1, then find where that local point was at t0.
  const local = rotate(conj(b.rot), { x: p.x - b.pos.x, y: p.y - b.pos.y, z: p.z - b.pos.z });
  const was = rotate(a.rot, local);
  const dt = t1 - t0 || DT;
  return {
    x: (p.x - (a.pos.x + was.x)) / dt,
    y: (p.y - (a.pos.y + was.y)) / dt,
    z: (p.z - (a.pos.z + was.z)) / dt,
  };
}
