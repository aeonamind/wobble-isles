// The Wobbler contestant (ART.md §2): armless jelly gumdrop with pop-out nub hands,
// animated procedurally on top of the simulation state.

import * as THREE from "three";
import { WOBBLER_CENTER, type WobblerState } from "../../../shared/sim";
import { faceTexture, type Expression } from "./face";
import { addOutline, toon } from "./toon";

const UP = new THREE.Vector3(0, 1, 0);

export const PLAYER_COLORS = [0xff7eb6, 0xff9f45, 0xffe156, 0x4fd6a5, 0x4db8ff, 0x9b6bff, 0xa0705a, 0xf4f1ea];

/** Body profile (radius at height), feet at y = 0, top at y = 1. */
const PROFILE: [number, number][] = [
  [0.0, 0.3],
  [0.02, 0.4],
  [0.08, 0.44],
  [0.2, 0.445],
  [0.35, 0.43],
  [0.5, 0.4],
  [0.65, 0.355],
  [0.78, 0.29],
  [0.88, 0.21],
  [0.95, 0.12],
  [0.99, 0.04],
  [1.0, 0.0],
];

export function bodyRadiusAt(y: number) {
  for (let i = 1; i < PROFILE.length; i++) {
    const [y1, r1] = PROFILE[i];
    const [y0, r0] = PROFILE[i - 1];
    if (y <= y1) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
  }
  return 0;
}

let bodyGeo: THREE.LatheGeometry | null = null;
function getBodyGeometry() {
  if (bodyGeo) return bodyGeo;
  const pts = PROFILE.map(([y, r]) => new THREE.Vector2(Math.max(0.001, r), y));
  bodyGeo = new THREE.LatheGeometry(pts, 40);
  bodyGeo.computeVertexNormals();
  return bodyGeo;
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
  private hands: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
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

  constructor(color: number) {
    this.bodyMat = toon(color);
    const body = new THREE.Mesh(getBodyGeometry(), this.bodyMat);
    body.castShadow = true;
    addOutline(body, 0.035);

    // Glossy jelly highlight
    const gloss = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
    );
    gloss.scale.set(0.7, 1.4, 0.4);
    gloss.position.set(-0.2, 0.78, bodyRadiusAt(0.78) * 0.75);
    gloss.rotation.z = 0.5;

    // Face: a curved strip that hugs the body
    const fy = 0.6;
    const fr = bodyRadiusAt(fy) + 0.006;
    const faceGeo = new THREE.CylinderGeometry(fr, bodyRadiusAt(fy - 0.17) + 0.006, 0.34, 24, 1, true, -0.95, 1.9);
    this.faceMat = new THREE.MeshBasicMaterial({ map: faceTexture("neutral"), transparent: true, depthWrite: false });
    this.face = new THREE.Mesh(faceGeo, this.faceMat);
    this.face.position.y = fy - 0.085;

    // Nub hands (hidden until needed) and stubby feet
    const handGeo = new THREE.SphereGeometry(0.1, 14, 10);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(handGeo, this.bodyMat);
      h.position.set(s * 0.43, 0.45, 0.12);
      h.castShadow = true;
      addOutline(h, 0.025);
      this.hands.push(h);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), toon(new THREE.Color(color).multiplyScalar(0.8)));
      f.scale.set(1, 0.55, 1.35);
      f.position.set(s * 0.18, 0.05, 0.08);
      f.castShadow = true;
      addOutline(f, 0.025);
      this.feet.push(f);
    }

    this.squash.add(body, gloss, this.face, ...this.hands, ...this.feet);
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
    sprite.position.y = 1.45;
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
        handsTarget = 1;
        expr = "dizzy";
        break;
      case "held":
        pitch = -0.5;
        roll = Math.sin(time * 14) * 0.25;
        handsTarget = 1;
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

    this.feet.forEach((foot, i) => {
      const phase = this.gait + i * Math.PI;
      foot.position.z = 0.08 + (running ? Math.sin(phase) * 0.14 : 0);
      foot.position.y = 0.05 + (running ? Math.max(0, Math.cos(phase)) * 0.06 : 0);
      if (f.state === "held") foot.position.z = 0.08 + Math.sin(time * 18 + i * Math.PI) * 0.12; // kicking
    });

    const h = Math.max(0, this.handsOut.update(handsTarget, dt));
    this.hands.forEach((hand, i) => {
      hand.scale.setScalar(Math.max(0.001, h));
      hand.position.z = 0.12 + h * 0.2;
      hand.position.x = (i ? 1 : -1) * (0.36 + h * 0.08);
      hand.visible = h > 0.02;
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
    this.bodyMat.opacity = f.invulnerable ? 0.55 + Math.sin(time * 30) * 0.25 : 1;
    this.bodyMat.transparent = f.invulnerable;

    if (groundY !== null) {
      const height = Math.max(0, f.y - WOBBLER_CENTER - groundY);
      this.shadowBlob.position.set(f.x, groundY + 0.015, f.z);
      const s = Math.max(0.35, 1 - height * 0.12);
      this.shadowBlob.scale.setScalar(s);
      (this.shadowBlob.material as THREE.MeshBasicMaterial).opacity = 0.25 * s;
    }
  }
}
