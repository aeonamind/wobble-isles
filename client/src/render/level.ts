// Builds the visual scene for a LevelDef: island blocks, hazards, balls, sky and cloud sea.

import * as THREE from "three";
import { hazardPose, hazardShapes, pressTelegraph, type HazardDef } from "../../../shared/hazards";
import type { LevelDef, SolidDef } from "../../../shared/level";
import { addOutline, gradientTexture, stripeTexture, toon } from "./toon";

/** Candy island palette (ART.md §3.3). */
const PALETTE = {
  sky: ["#FFB3D9", "#FFF1C9"] as const,
  top: [0xffc6dd, 0xffe0a8, 0xc9ecff],
  side: 0xf2c28b,
  under: 0xd99a5b,
  ice: 0x9ee7f5,
  bouncer: 0x57d9b7,
  conveyor: 0x4a4458,
  sticky: 0xe0a050,
  hazard: 0xff4f5e,
  goal: 0xffc93c,
};

export class LevelView {
  readonly group = new THREE.Group();
  private hazards: { def: HazardDef; obj: THREE.Object3D }[] = [];
  private belts: THREE.Texture[] = [];
  private beltSpeeds: number[] = [];
  readonly balls: THREE.Object3D[] = [];
  private clouds: THREE.InstancedMesh;

  constructor(level: LevelDef, scene: THREE.Scene) {
    scene.background = gradientTexture(PALETTE.sky[0], PALETTE.sky[1]);
    scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky[1]), 60, 190);

    level.solids.forEach((s, i) => this.group.add(this.solid(s, i)));
    for (const h of level.hazards) {
      const obj = this.hazard(h);
      this.hazards.push({ def: h, obj });
      this.group.add(obj);
    }
    for (const b of level.balls) {
      const ball = this.ball(b.radius);
      this.balls.push(ball);
      this.group.add(ball);
    }
    this.clouds = this.cloudSea(level);
    this.group.add(this.clouds);
    scene.add(this.group);
  }

  private solid(s: SolidDef, i: number) {
    const surface = s.surface ?? "normal";
    const topColor =
      surface === "ice"
        ? PALETTE.ice
        : surface === "bouncer"
          ? PALETTE.bouncer
          : surface === "conveyor"
            ? PALETTE.conveyor
            : surface === "sticky"
              ? PALETTE.sticky
              : (s.color ?? PALETTE.top[i % PALETTE.top.length]);
    let topMat: THREE.Material;
    if (surface === "conveyor") {
      const tex = beltTexture();
      tex.repeat.set(s.size.x / 2, s.size.z / 2);
      this.belts.push(tex);
      const belt = s.belt ?? { x: 0, z: 0 };
      this.beltSpeeds.push(belt.x !== 0 ? -belt.x / 2 : -belt.z / 2);
      if (belt.z !== 0) tex.rotation = Math.PI / 2;
      topMat = toon(0xffffff, { map: tex });
    } else if (surface === "ice") {
      topMat = toon(topColor, { emissive: 0x2a6f80, emissiveIntensity: 0.25 });
    } else {
      // Soft 2 m tiles give a sense of speed and distance without visual noise.
      const tex = tileTexture();
      tex.repeat.set(s.size.x / 2, s.size.z / 2);
      topMat = toon(topColor, { map: tex });
    }
    const side = toon(surface === "ice" ? 0x7fd0e6 : surface === "bouncer" ? 0x3fbf9c : PALETTE.side);
    const under = toon(PALETTE.under);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.size.x, s.size.y, s.size.z), [side, side, topMat, under, side, side]);
    mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = s.yaw ?? 0;
    mesh.rotation.x = s.tilt ?? 0;
    mesh.receiveShadow = true;
    mesh.castShadow = false; // static blocks only receive; moving things cast
    addOutline(mesh, 0.05);

    // Big islands get a chunky "frosting drip" underside so they read as floating.
    if (s.size.x >= 6 && s.size.z >= 6 && surface !== "ice") {
      const rock = new THREE.Mesh(new THREE.ConeGeometry(Math.min(s.size.x, s.size.z) * 0.45, Math.min(s.size.x, s.size.z) * 0.6, 7), toon(PALETTE.under));
      rock.rotation.x = Math.PI;
      rock.position.y = -s.size.y / 2 - Math.min(s.size.x, s.size.z) * 0.3;
      mesh.add(rock);
    }
    if (surface === "bouncer") mesh.userData.bouncer = true;
    return mesh;
  }

  private hazard(h: HazardDef) {
    const g = new THREE.Group();
    const stripes = stripeTexture("#FF4F5E", "#FFFFFF", 1);
    const plain = toon(PALETTE.hazard);
    for (const shape of hazardShapes(h)) {
      const isArm = h.kind === "hammer" && shape.half.x < 0.2;
      let material: THREE.Material;
      if (isArm) material = toon(0x6b5a7a);
      else {
        const t = stripes.clone();
        t.repeat.set(Math.max(1, shape.half.x * 2), Math.max(1, shape.half.y * 2));
        t.needsUpdate = true;
        material = toon(0xffffff, { map: t });
      }
      const m = new THREE.Mesh(new THREE.BoxGeometry(shape.half.x * 2, shape.half.y * 2, shape.half.z * 2), material);
      m.position.set(shape.offset.x, shape.offset.y, shape.offset.z);
      m.castShadow = true;
      addOutline(m, 0.035);
      g.add(m);
    }
    if (h.kind === "sweeper") {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 12), plain);
      cap.position.y = 1.05;
      addOutline(cap, 0.03);
      g.add(cap);
    }
    if (h.kind === "press") {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 12), toon(0x6b5a7a));
      rod.position.y = 3.5;
      g.add(rod);
    }
    if (h.kind === "hammer") {
      // Static frame: two posts and a crossbar around the pivot (visual only).
      const frame = new THREE.Group();
      const postMat = toon(0x8d6e63);
      const span = h.axis === "z" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, h.pivot.y + 4, 0.3), postMat);
        post.position.copy(span.clone().multiplyScalar(s * 2.2)).setY(-(h.pivot.y + 4) / 2 + 0.2);
        addOutline(post, 0.03);
        frame.add(post);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(span.x ? 4.7 : 0.3, 0.3, span.z ? 4.7 : 0.3), postMat);
      addOutline(bar, 0.03);
      frame.add(bar);
      frame.position.set(h.pivot.x, h.pivot.y, h.pivot.z);
      frame.userData.static = true;
      this.group.add(frame);
    }
    return g;
  }

  private ball(radius: number) {
    const g = new THREE.Group();
    const tex = stripeTexture("#9B6BFF", "#FFE156", 1);
    tex.repeat.set(3, 2);
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), toon(0xffffff, { map: tex }));
    m.castShadow = true;
    addOutline(m, 0.04);
    g.add(m);
    return g;
  }

  private cloudSea(level: LevelDef) {
    const count = 140;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const mat = toon(0xffffff, { emissive: 0xfff0f6, emissiveIntensity: 0.35 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 10 + rnd() * 110;
      const s = 3 + rnd() * 7;
      m.compose(
        new THREE.Vector3(Math.cos(a) * r, level.killY + 2 - rnd() * 6, 20 + Math.sin(a) * r),
        new THREE.Quaternion(),
        new THREE.Vector3(s * 1.6, s * 0.7, s),
      );
      mesh.setMatrixAt(i, m);
    }
    mesh.receiveShadow = false;
    return mesh;
  }

  update(simTime: number) {
    for (const { def, obj } of this.hazards) {
      const p = hazardPose(def, simTime);
      obj.position.set(p.pos.x, p.pos.y, p.pos.z);
      obj.quaternion.set(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
      if (def.kind === "press" && pressTelegraph(simTime / def.period + (def.phase ?? 0))) {
        obj.position.x += Math.sin(simTime * 90) * 0.05;
        obj.position.z += Math.cos(simTime * 77) * 0.05;
      }
    }
    this.belts.forEach((t, i) => (t.offset.x = simTime * this.beltSpeeds[i]));
    this.clouds.position.x = Math.sin(simTime * 0.05) * 3;
  }
}

let tileCanvas: HTMLCanvasElement | null = null;
function tileTexture() {
  if (!tileCanvas) {
    tileCanvas = document.createElement("canvas");
    tileCanvas.width = tileCanvas.height = 64;
    const g = tileCanvas.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#ece4ee";
    g.fillRect(0, 0, 32, 32);
    g.fillRect(32, 32, 32, 32);
    g.strokeStyle = "rgba(90, 60, 110, 0.12)";
    g.lineWidth = 2;
    g.strokeRect(1, 1, 62, 62);
  }
  const t = new THREE.CanvasTexture(tileCanvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function beltTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#4a4458";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#FFD23F";
  // chevrons pointing toward +u (movement direction)
  g.beginPath();
  g.moveTo(16, 8);
  g.lineTo(40, 32);
  g.lineTo(16, 56);
  g.lineTo(26, 56);
  g.lineTo(50, 32);
  g.lineTo(26, 8);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
