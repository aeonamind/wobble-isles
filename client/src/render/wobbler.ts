// The Wobbler contestant (ART.md §2): a tall gummy-jelly body with short rubbery arms and legs,
// a head swirl and a glowing candy heart,
// animated procedurally on top of the simulation state.

import * as THREE from "three";
import type { BodyStyle } from "../../../shared/protocol";
import { WOBBLER_CENTER, WOBBLER_HEIGHT, type WobblerState } from "../../../shared/sim";
import { faceTexture, heartTexture, type Expression } from "./face";
import { addOutline, toon } from "./toon";

const UP = new THREE.Vector3(0, 1, 0);

export const PLAYER_COLORS = [0xff7eb6, 0xff9f45, 0xffe156, 0x4fd6a5, 0x4db8ff, 0x9b6bff, 0xa0705a, 0xf4f1ea];

const H = WOBBLER_HEIGHT;

/**
 * Body silhouettes (ART.md §2): radius at a fraction of the height. The body sits on short
 * legs (LEG_TOP) and ends below the head swirl. All share the same collider, so the choice
 * is purely cosmetic. `face` is where the face strip starts, `swirl` where the curl sits.
 */
export const LEG_TOP = 0.15;
const PROFILES: Record<BodyStyle, { profile: [number, number][]; face: number }> = {
  // Tall rounded gummy: straight sides, soft dome. The default.
  bean: {
    profile: [
      [0.15, 0.3],
      [0.16, 0.34],
      [0.19, 0.37],
      [0.25, 0.385],
      [0.4, 0.38],
      [0.55, 0.37],
      [0.7, 0.355],
      [0.8, 0.33],
      [0.87, 0.29],
      [0.92, 0.22],
      [0.95, 0.13],
      [0.96, 0.0],
    ],
    face: 0.68,
  },
  // Wide hips tapering to a lower dome.
  gumdrop: {
    profile: [
      [0.15, 0.33],
      [0.17, 0.39],
      [0.22, 0.415],
      [0.3, 0.41],
      [0.45, 0.385],
      [0.6, 0.35],
      [0.72, 0.31],
      [0.82, 0.26],
      [0.89, 0.2],
      [0.93, 0.12],
      [0.95, 0.0],
    ],
    face: 0.64,
  },
  // Pear: round belly, narrow top.
  drop: {
    profile: [
      [0.15, 0.32],
      [0.17, 0.38],
      [0.22, 0.41],
      [0.3, 0.405],
      [0.42, 0.37],
      [0.55, 0.31],
      [0.66, 0.26],
      [0.76, 0.21],
      [0.84, 0.16],
      [0.9, 0.1],
      [0.94, 0.0],
    ],
    face: 0.58,
  },
};

/** Where the face strip starts (fraction of the height). */
export const faceAt = (style: BodyStyle) => PROFILES[style].face;

/** Top of the body (fraction of the height), where the head swirl sits. */
export const bodyTop = (style: BodyStyle) => PROFILES[style].profile.at(-1)![0];

export function bodyRadiusAt(y: number, style: BodyStyle = "bean") {
  const p = PROFILES[style].profile;
  const k = y / H;
  if (k < p[0][0]) return 0;
  for (let i = 1; i < p.length; i++) {
    const [y1, r1] = p[i];
    const [y0, r0] = p[i - 1];
    if (k <= y1) return r0 + ((k - y0) / (y1 - y0)) * (r1 - r0);
  }
  return 0;
}

/** A patch of the body surface (front-centred), lifted slightly off it, for face and belly decals. */
function bodyPatch(style: BodyStyle, centerY: number, height: number, width: number) {
  const pts: THREE.Vector2[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const y = centerY - height / 2 + (height * i) / n;
    pts.push(new THREE.Vector2(bodyRadiusAt(y, style) + 0.006, y));
  }
  return new THREE.LatheGeometry(pts, 20, -width / 2, width);
}

const bodyGeos = new Map<BodyStyle, THREE.LatheGeometry>();
function getBodyGeometry(style: BodyStyle) {
  let g = bodyGeos.get(style);
  if (g) return g;
  const pts = PROFILES[style].profile.map(([y, r]) => new THREE.Vector2(Math.max(0.001, r), y * H));
  g = new THREE.LatheGeometry(pts, 40);
  g.computeVertexNormals();
  bodyGeos.set(style, g);
  return g;
}

export interface WobblerFrame {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  facing: number;
  state: WobblerState;
  stateTime: number;
  grounded: boolean;
  grabbing: boolean;
  holding: boolean;
  invulnerable: boolean;
  squashed: boolean;
}

/** A critically-damped-ish spring for procedural squash & wobble. */
class Spring {
  value = 0;
  vel = 0;
  constructor(
    public stiffness: number,
    public damping: number,
  ) {}
  update(target: number, dt: number) {
    const a = (target - this.value) * this.stiffness - this.vel * this.damping;
    this.vel += a * dt;
    this.value += this.vel * dt;
    return this.value;
  }
  kick(v: number) {
    this.vel += v;
  }
}

export class WobblerView {
  readonly root = new THREE.Group(); // world position & yaw
  private tilt = new THREE.Group(); // pitch/roll around the body centre
  private squash = new THREE.Group(); // scale anchored at the feet
  private bodyMat: THREE.MeshToonMaterial;
  private face: THREE.Mesh;
  private faceMat: THREE.MeshBasicMaterial;
  private jellyMats: THREE.MeshToonMaterial[] = [];
  private arms: THREE.Group[] = []; // shoulder pivots
  private legs: THREE.Group[] = []; // hip pivots
  private shadowBlob: THREE.Mesh;

  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private tumble = new THREE.Quaternion();
  private squashSpring = new Spring(260, 14);
  private wobbleX = new Spring(180, 7);
  private wobbleZ = new Spring(180, 7);
  private handsOut = new Spring(320, 18);
  private gait = 0;
  private blinkAt = 2 + Math.random() * 3;
  private expr: Expression = "neutral";
  private exprHold = 0;

  constructor(
    color: number,
    readonly style: BodyStyle = "bean",
  ) {
    this.bodyMat = toon(color);
    const body = new THREE.Mesh(getBodyGeometry(style), this.bodyMat);
    body.castShadow = true;
    addOutline(body, 0.035);

    const dark = new THREE.Color(color).multiplyScalar(0.72);
    const limbMat = toon(color);
    const footMat = toon(dark);
    this.jellyMats = [this.bodyMat, limbMat, footMat];
    const top = H * bodyTop(style);

    // Glossy jelly highlights
    const glossMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const gloss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), glossMat);
    gloss.scale.set(0.6, 1.5, 0.4);
    const gy = top - 0.24;
    gloss.position.set(-0.19, gy, bodyRadiusAt(gy, style) * 0.75);
    gloss.rotation.z = 0.35;
    const gloss2 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 6), glossMat);
    gloss2.position.set(-0.24, H * 0.32, bodyRadiusAt(H * 0.32, style) * 0.7);

    // Face: a patch that hugs the body
    const faceY = H * PROFILES[style].face;
    this.faceMat = new THREE.MeshBasicMaterial({ map: faceTexture("neutral"), transparent: true, depthWrite: false });
    this.face = new THREE.Mesh(bodyPatch(style, faceY, 0.42, 2.1), this.faceMat);

    // Glowing candy heart on the belly
    const heart = new THREE.Mesh(
      bodyPatch(style, H * 0.37, 0.26, 0.8),
      new THREE.MeshBasicMaterial({ map: heartTexture(), transparent: true, depthWrite: false }),
    );

    // Head swirl: a soft-serve curl of shrinking jelly balls
    const swirl = new THREE.Group();
    // A rising spiral that tips over: radius shrinks from 0.11 to 0.03 along it
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const a = t * Math.PI * 1.6;
      const r = 0.11 - t * 0.08;
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), this.bodyMat);
      b.position.set(Math.sin(a) * 0.05 * t, 0.17 * Math.sin(t * Math.PI * 0.62), -Math.cos(a) * 0.05 * t + 0.02 * t);
      b.castShadow = true;
      if (i === 0 || i === 10) addOutline(b, 0.018);
      swirl.add(b);
    }
    swirl.position.y = top - 0.07;

    // Short rubbery arms with mitten hands, hinged at the shoulder
    const shoulderY = H * 0.55;
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * (bodyRadiusAt(shoulderY, style) - 0.05), shoulderY, 0.02);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.14, 4, 10), limbMat);
      arm.position.y = -0.11;
      arm.castShadow = true;
      addOutline(arm, 0.02);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), limbMat);
      hand.scale.set(1, 1.1, 0.8);
      hand.position.y = -0.25;
      hand.castShadow = true;
      addOutline(hand, 0.02);
      const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), limbMat);
      thumb.position.set(-s * 0.075, -0.2, 0.05);
      addOutline(thumb, 0.015);
      pivot.add(arm, hand, thumb);
      this.arms.push(pivot);
    }

    // Short stubby legs with chunky feet, hinged at the hip
    const hipY = H * LEG_TOP + 0.05;
    const legGeo = new THREE.CapsuleGeometry(0.1, 0.06, 4, 10);
    const footGeo = new THREE.SphereGeometry(0.12, 14, 10);
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.15, hipY, 0);
      const leg = new THREE.Mesh(legGeo, footMat);
      leg.position.y = -0.09;
      leg.castShadow = true;
      addOutline(leg, 0.022);
      const foot = new THREE.Mesh(footGeo, footMat);
      foot.scale.set(1, 0.6, 1.3);
      foot.position.set(0, -hipY + 0.06, 0.05);
      foot.castShadow = true;
      addOutline(foot, 0.022);
      pivot.add(leg, foot);
      this.legs.push(pivot);
    }

    this.squash.add(body, gloss, gloss2, this.face, heart, swirl, ...this.arms, ...this.legs);
    this.squash.position.y = -WOBBLER_CENTER;
    this.tilt.position.y = WOBBLER_CENTER;
    this.tilt.add(this.squash);
    this.root.add(this.tilt);

    // Cheap contact shadow so players can judge jumps even with shadows off.
    this.shadowBlob = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.renderOrder = -1;
  }

  get blob() {
    return this.shadowBlob;
  }

  private nameplate: THREE.Sprite | null = null;
  private nameText: string | null = null;

  /** Floating name tag above the head (null hides it). `bg` tints the tag (team colour). */
  setName(name: string | null, bg?: number) {
    const key = name == null ? null : name + "|" + (bg ?? "");
    if (key === this.nameText) return;
    this.nameText = key;
    if (this.nameplate) {
      this.root.remove(this.nameplate);
      (this.nameplate.material as THREE.SpriteMaterial).map?.dispose();
      this.nameplate.material.dispose();
      this.nameplate = null;
    }
    if (!name) return;
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    const font = "800 44px 'Trebuchet MS', system-ui, sans-serif";
    g.font = font;
    const w = Math.ceil(g.measureText(name).width) + 40;
    c.width = w;
    c.height = 72;
    g.font = font;
    g.fillStyle = bg == null ? "rgba(58, 36, 80, 0.78)" : "#" + bg.toString(16).padStart(6, "0");
    g.beginPath();
    g.roundRect(0, 6, w, 60, 30);
    g.fill();
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(name, w / 2, 38);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const h = 0.32;
    sprite.scale.set((h * w) / c.height, h, 1);
    sprite.position.y = H + 0.42;
    sprite.renderOrder = 10;
    this.root.add(sprite);
    this.nameplate = sprite;
  }

  /** Visual reactions to simulation events. */
  impact(kind: "land" | "hit" | "bounce" | "jump" | "stomped", strength = 1) {
    if (kind === "stomped") {
      this.squashSpring.kick(-12);
      this.setExpression("dizzy", 0.7);
    }
    if (kind === "land") this.squashSpring.kick(-Math.min(6, 1.5 + strength * 0.35));
    if (kind === "jump") this.squashSpring.kick(4);
    if (kind === "bounce") this.squashSpring.kick(-7);
    if (kind === "hit") {
      this.wobbleX.kick((Math.random() - 0.5) * 10 * strength);
      this.wobbleZ.kick((Math.random() - 0.5) * 10 * strength);
      this.setExpression("shocked", 0.8);
    }
  }

  setExpression(e: Expression, hold = 0) {
    this.expr = e;
    this.exprHold = hold;
  }

  update(f: WobblerFrame, dt: number, groundY: number | null, time: number) {
    const visible = f.state !== "out";
    this.root.visible = visible;
    this.shadowBlob.visible = visible && groundY !== null;
    if (!visible) return;

    this.root.position.set(f.x, f.y - WOBBLER_CENTER, f.z);
    const hSpeed = Math.hypot(f.vx, f.vz);

    // Yaw follows facing (snappy, but smoothed so it never pops)
    const dYaw = Math.atan2(Math.sin(f.facing - this.yaw), Math.cos(f.facing - this.yaw));
    this.yaw += dYaw * Math.min(1, dt * 18);
    this.root.rotation.y = this.yaw;

    // Pose targets per state
    let pitch = 0;
    let roll = 0;
    let squashTarget = 0;
    let handsTarget = f.grabbing || f.holding ? 1 : 0;
    let expr: Expression = "neutral";
    let tumbling = false;

    switch (f.state) {
      case "normal":
        pitch = Math.min(0.22, hSpeed * 0.035); // lean into the run
        if (!f.grounded) {
          squashTarget = f.vy > 0 ? 0.12 : -0.04;
          expr = f.vy < -9 ? "shocked" : "determined";
        } else if (hSpeed > 0.5) {
          expr = "determined";
        }
        if (f.holding) expr = "strain";
        break;
      case "dive":
        pitch = Math.PI / 2 - 0.25;
        handsTarget = 1;
        expr = "determined";
        break;
      case "slide":
        pitch = Math.PI / 2 - 0.1;
        handsTarget = 1;
        expr = "happy";
        break;
      case "getup":
        pitch = (Math.PI / 2) * Math.max(0, 1 - f.stateTime / 0.25);
        break;
      case "ragdoll":
        tumbling = !f.grounded;
        pitch = f.grounded ? Math.PI / 2 : 0;
        handsTarget = 0;
        expr = "dizzy";
        break;
      case "held":
        pitch = -0.5;
        roll = Math.sin(time * 14) * 0.25;
        handsTarget = 0;
        expr = "shocked";
        break;
    }

    // Tumble while flying in a ragdoll; otherwise ease to the pose
    if (tumbling) {
      // Roll head-over-heels around the axis perpendicular to travel (in the root's local frame).
      const axis = new THREE.Vector3(f.vz, 0, -f.vx);
      if (axis.lengthSq() < 0.01) axis.set(1, 0, 0);
      axis.normalize().applyAxisAngle(UP, -this.yaw);
      this.tumble.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dt * (6 + hSpeed * 1.2)));
      this.tilt.quaternion.copy(this.tumble);
      this.pitch = pitch;
    } else {
      this.tumble.slerp(new THREE.Quaternion(), Math.min(1, dt * 10));
      const k = Math.min(1, dt * 14);
      this.pitch += (pitch - this.pitch) * k;
      this.roll += (roll - this.roll) * k;
      const wob = new THREE.Euler(this.pitch + this.wobbleX.update(0, dt) * 0.12, 0, this.roll + this.wobbleZ.update(0, dt) * 0.12);
      this.tilt.quaternion.setFromEuler(wob).premultiply(this.tumble);
    }

    // Flattened like a pancake after being stomped
    if (f.squashed) squashTarget = -0.45;

    // Run gait: hop + squash, alternating feet
    const running = f.state === "normal" && f.grounded && hSpeed > 0.6;
    this.gait += dt * (running ? 6 + hSpeed * 1.6 : 0);
    const hop = running ? Math.abs(Math.sin(this.gait)) * 0.09 : 0;
    if (running) squashTarget += Math.cos(this.gait * 2) * 0.05;
    else if (f.state === "normal" && f.grounded) squashTarget += Math.sin(time * 2.4) * 0.018; // breathing
    this.squash.position.y = -WOBBLER_CENTER + hop;
    const sq = this.squashSpring.update(squashTarget, dt);
    const sy = 1 + sq;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    this.squash.scale.set(sxz, sy, sxz);

    // Legs swing from the hip; held Wobblers kick
    this.legs.forEach((leg, i) => {
      const phase = this.gait + i * Math.PI;
      let swing = running ? Math.sin(phase) * 0.7 : 0;
      if (f.state === "held") swing = Math.sin(time * 18 + i * Math.PI) * 0.6;
      else if (f.state === "dive" || f.state === "slide") swing = -0.3;
      leg.rotation.x = -swing;
    });

    // Arms: hang at the sides, pump against the legs when running, reach forward to grab,
    // stretch ahead in a dive, flail when thrown or tumbling
    const reach = Math.max(0, this.handsOut.update(handsTarget, dt));
    this.arms.forEach((arm, i) => {
      const s = i ? 1 : -1;
      let ax = running ? Math.sin(this.gait + i * Math.PI) * 0.8 : Math.sin(time * 2.4 + i) * 0.05;
      let az = s * (0.6 + (f.grounded ? 0 : 0.5));
      if (f.state === "ragdoll" || f.state === "held") {
        ax = Math.sin(time * 16 + i * 2) * 1.2;
        az = s * (1.2 + Math.sin(time * 13 + i) * 0.4);
      }
      // Reaching blends toward arms straight ahead (-π/2 is forward; a dive points them along the body)
      const fwd = f.state === "dive" || f.state === "slide" ? -Math.PI + 0.2 : -1.45;
      arm.rotation.x = ax + (fwd - ax) * Math.min(1, reach);
      arm.rotation.z = az + (s * 0.15 - az) * Math.min(1, reach);
    });

    // Face
    if (this.exprHold > 0) this.exprHold -= dt;
    else this.expr = expr;
    this.blinkAt -= dt;
    const blink = this.blinkAt < 0.12;
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 4;
    const tex = faceTexture(this.expr, blink);
    if (this.faceMat.map !== tex) {
      this.faceMat.map = tex;
      this.faceMat.needsUpdate = true;
    }

    // Respawn invulnerability: soft flicker
    for (const m of this.jellyMats) {
      m.opacity = f.invulnerable ? 0.55 + Math.sin(time * 30) * 0.25 : 1;
      m.transparent = f.invulnerable;
    }

    if (groundY !== null) {
      const height = Math.max(0, f.y - WOBBLER_CENTER - groundY);
      this.shadowBlob.position.set(f.x, groundY + 0.015, f.z);
      const s = Math.max(0.35, 1 - height * 0.12);
      this.shadowBlob.scale.setScalar(s);
      (this.shadowBlob.material as THREE.MeshBasicMaterial).opacity = 0.25 * s;
    }
  }
}
