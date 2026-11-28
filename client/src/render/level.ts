// Builds the visual scene for a LevelDef: island blocks, hazards, balls, goals, water, sky and cloud sea.

import * as THREE from "three";
import { hazardPose, hazardShapes, pressTelegraph, type HazardDef } from "../../../shared/hazards";
import type { Island, LevelDef, SolidDef, Zone } from "../../../shared/level";
import { addOutline, gradientTexture, stripeTexture, toon } from "./toon";

interface Palette {
  sky: readonly [string, string];
  top: number[];
  side: number;
  under: number;
  ice: number;
  bouncer: number;
  conveyor: number;
  sticky: number;
  hazard: number;
  goal: number;
  cloud: number;
}

/** Island palettes (ART.md §3.3). */
const CANDY: Palette = {
  sky: ["#FFB3D9", "#FFF1C9"],
  top: [0xffc6dd, 0xffe0a8, 0xc9ecff],
  side: 0xf2c28b,
  under: 0xd99a5b,
  ice: 0x9ee7f5,
  bouncer: 0x57d9b7,
  conveyor: 0x4a4458,
  sticky: 0xe0a050,
  hazard: 0xff4f5e,
  goal: 0xffc93c,
  cloud: 0xfff0f6,
};

const PALETTES: Partial<Record<Island, Palette>> = {
  candy: CANDY,
  frost: {
    ...CANDY,
    sky: ["#8CCBFF", "#EAF7FF"],
    top: [0xf4fbff, 0xe6f3ff, 0xdcefff],
    side: 0xb9d7f0,
    under: 0x86a9d1,
    sticky: 0xc6b6e8,
    cloud: 0xeef6ff,
  },
  toy: {
    ...CANDY,
    sky: ["#FFC77A", "#FFF3D1"],
    top: [0xffe08a, 0xa8d8ff, 0xffb3b3],
    side: 0xd7a46f,
    under: 0x9a6b4f,
    cloud: 0xfff4e0,
  },
};

export const TEAM_COLORS = [0xff6b81, 0x2bb5a8];
export const TEAM_NAMES = ["Coral", "Teal"];

export class LevelView {
  readonly group = new THREE.Group();
  private hazards: { def: HazardDef; obj: THREE.Object3D }[] = [];
  private belts: THREE.Texture[] = [];
  private beltSpeeds: number[] = [];
  readonly balls: THREE.Object3D[] = [];
  private clouds: THREE.InstancedMesh;
  private water: THREE.Mesh | null = null;
  private flags: THREE.Object3D[] = [];
  private pal: Palette;

  constructor(
    level: LevelDef,
    private scene: THREE.Scene,
  ) {
    this.pal = PALETTES[level.island] ?? CANDY;
    (scene.background as THREE.Texture | null)?.dispose?.();
    scene.background = gradientTexture(this.pal.sky[0], this.pal.sky[1]);
    scene.fog = new THREE.Fog(new THREE.Color(this.pal.sky[1]), 70, 230);

    level.solids.forEach((s, i) => this.group.add(this.solid(s, i)));
    for (const h of level.hazards) this.addHazard(h);
    for (const b of level.balls) {
      const ball = this.ball(b.radius, b.bouncy);
      this.balls.push(ball);
      this.group.add(ball);
    }
    if (level.finish) this.group.add(this.arch(level.finish));
    for (const g of level.goals ?? []) this.group.add(this.goal(g.zone, g.team));
    if (level.water != null) {
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(160, 48),
        toon(0x55c3ee, { transparent: true, opacity: 0.88, emissive: 0x1d6f9a, emissiveIntensity: 0.25 }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = level.water;
      water.receiveShadow = true;
      this.water = water;
      this.group.add(water);
    }
    this.clouds = this.cloudSea(level);
    this.group.add(this.clouds);
    scene.add(this.group);
  }

  /** Add a hazard's visuals (level load, or a Gremlin avalanche mid-round). */
  addHazard(h: HazardDef) {
    const obj = this.hazard(h);
    this.hazards.push({ def: h, obj });
    this.group.add(obj);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.userData.outline) return; // outline materials are shared
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) {
        (mat as THREE.MeshToonMaterial).map?.dispose();
        mat.dispose();
      }
    });
  }

  private solid(s: SolidDef, i: number) {
    const P = this.pal;
    const surface = s.surface ?? "normal";
    const topColor =
      surface === "ice"
        ? P.ice
        : surface === "bouncer"
          ? P.bouncer
          : surface === "conveyor"
            ? P.conveyor
            : surface === "sticky"
              ? P.sticky
              : (s.color ?? P.top[i % P.top.length]);
    let topMat: THREE.Material;
    if (surface === "conveyor") {
      const tex = beltTexture();
      const belt = s.belt ?? { x: 0, z: 0 };
      const alongZ = belt.z !== 0;
      // Texture u runs along the belt: rotate for belts moving along Z.
      tex.repeat.set((alongZ ? s.size.z : s.size.x) / 2, (alongZ ? s.size.x : s.size.z) / 2);
      if (alongZ) tex.rotation = -Math.PI / 2;
      this.belts.push(tex);
      this.beltSpeeds.push(alongZ ? -belt.z / 2 : -belt.x / 2);
      topMat = toon(0xffffff, { map: tex });
    } else if (surface === "ice") {
      topMat = toon(topColor, { emissive: 0x2a6f80, emissiveIntensity: 0.25 });
    } else {
      // Soft 2 m tiles give a sense of speed and distance without visual noise.
      const tex = tileTexture();
      tex.repeat.set(s.size.x / 2, s.size.z / 2);
      topMat = toon(topColor, { map: tex });
    }
    const side = toon(surface === "ice" ? 0x7fd0e6 : surface === "bouncer" ? 0x3fbf9c : P.side);
    const under = toon(P.under);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.size.x, s.size.y, s.size.z), [side, side, topMat, under, side, side]);
    mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
    mesh.rotation.order = "YXZ";
    mesh.rotation.y = s.yaw ?? 0;
    mesh.rotation.x = s.tilt ?? 0;
    mesh.receiveShadow = true;
    mesh.castShadow = false; // static blocks only receive; moving things cast
    addOutline(mesh, 0.05);

    // Big islands get a chunky "frosting drip" underside so they read as floating.
    if (s.size.x >= 6 && s.size.z >= 6 && surface !== "ice" && !s.tilt) {
      const rock = new THREE.Mesh(new THREE.ConeGeometry(Math.min(s.size.x, s.size.z) * 0.45, Math.min(s.size.x, s.size.z) * 0.6, 7), toon(P.under));
      rock.rotation.x = Math.PI;
      rock.position.y = -s.size.y / 2 - Math.min(s.size.x, s.size.z) * 0.3;
      mesh.add(rock);
    }
    if (surface === "bouncer") mesh.userData.bouncer = true;
    return mesh;
  }

  /** Finish line: two posts and a chequered banner across the zone's near edge. */
  private arch(z: Zone) {
    const g = new THREE.Group();
    const base = z.pos.y - z.size.y / 2;
    const postMat = toon(this.pal.goal);
    const edge = z.pos.z - z.size.z / 2;
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 5, 14), postMat);
      post.position.set(z.pos.x + s * (z.size.x / 2 - 0.4), base + 2.5, edge);
      post.castShadow = true;
      addOutline(post, 0.04);
      g.add(post);
    }
    const tex = checkerTexture();
    tex.repeat.set(z.size.x / 2.4, 1);
    const dark = toon(0x3a2450);
    const face = toon(0xffffff, { map: tex });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(z.size.x, 1.1, 0.3), [dark, dark, dark, dark, face, face]);
    banner.position.set(z.pos.x, base + 4.8, edge);
    addOutline(banner, 0.04);
    g.add(banner);
    const colors = [0xff4f8b, 0xffe156, 0x57d9b7];
    for (let i = 0; i < 6; i++) {
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 3), toon(colors[i % 3]));
      flag.position.set(z.pos.x - z.size.x / 2 + (i + 0.5) * (z.size.x / 6), base + 5.7, edge);
      this.flags.push(flag);
      g.add(flag);
    }
    return g;
  }

  /** Team goal: a glowing frame in the team colour around the goal mouth. */
  private goal(z: Zone, team: number) {
    const g = new THREE.Group();
    const color = TEAM_COLORS[team] ?? 0xffffff;
    const frameMat = toon(color, { emissive: color, emissiveIntensity: 0.35 });
    const base = z.pos.y - z.size.y / 2;
    const mouthZ = z.pos.z - Math.sign(z.pos.z) * (z.size.z / 2 + 0.3);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), frameMat);
      post.position.set(z.pos.x + s * (z.size.x / 2 + 0.25), base + 1.7, mouthZ);
      addOutline(post, 0.04);
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(z.size.x + 1, 0.5, 0.5), frameMat);
    bar.position.set(z.pos.x, base + 3.4, mouthZ);
    addOutline(bar, 0.04);
    g.add(bar);
    return g;
  }

  private hazard(h: HazardDef) {
    const g = new THREE.Group();
    const stripes = stripeTexture("#FF4F5E", "#FFFFFF", 1);
    const plain = toon(this.pal.hazard);
    for (const shape of hazardShapes(h)) {
      if (h.kind === "roller") {
        const r = shape.radius!;
        const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), toon(0xffffff, { emissive: 0xdfefff, emissiveIntensity: 0.2 }));
        ball.castShadow = true;
        addOutline(ball, 0.05);
        // A few lumps so the roll reads.
        for (let i = 0; i < 5; i++) {
          const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.28, 0), toon(0xd8ecff));
          const a = i * 2.4;
          lump.position.set(Math.cos(a) * r * 0.85, Math.sin(i * 1.7) * r * 0.5, Math.sin(a) * r * 0.85);
          ball.add(lump);
        }
        g.add(ball);
        continue;
      }
      if (h.kind === "floe" || h.kind === "slider") {
        const top = toon(0xf4fbff);
        const side = toon(0x9fdcf2, { emissive: 0x2a6f80, emissiveIntensity: 0.2 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(shape.half.x * 2, shape.half.y * 2, shape.half.z * 2), [side, side, top, side, side, side]);
        m.castShadow = h.kind === "slider";
        m.receiveShadow = true;
        addOutline(m, 0.04);
        if (h.kind === "floe") {
          // Underwater skirt so it reads as floating ice.
          const skirt = new THREE.Mesh(
            new THREE.CylinderGeometry(shape.half.x * 1.25, shape.half.x * 0.7, 0.8, 7),
            toon(0x7fcbe6, { transparent: true, opacity: 0.7 }),
          );
          skirt.position.y = -shape.half.y - 0.4;
          m.add(skirt);
        }
        g.add(m);
        continue;
      }
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

  private ball(radius: number, bouncy = false) {
    const g = new THREE.Group();
    const tex = bouncy ? stripeTexture("#FF7EB6", "#FFF1F7", 1) : stripeTexture("#9B6BFF", "#FFE156", 1);
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
    const mat = toon(0xffffff, { emissive: this.pal.cloud, emissiveIntensity: 0.35 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    // Centre the cloud sea on the level's footprint.
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of level.solids) {
      minZ = Math.min(minZ, s.pos.z);
      maxZ = Math.max(maxZ, s.pos.z);
    }
    const cz = Number.isFinite(minZ) ? (minZ + maxZ) / 2 : 0;
    const spread = Number.isFinite(minZ) ? Math.max(110, (maxZ - minZ) / 2 + 60) : 110;
    const top = level.water != null ? level.water - 14 : level.killY + 2;
    const m = new THREE.Matrix4();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 10 + rnd() * spread;
      const s = 3 + rnd() * 7;
      m.compose(new THREE.Vector3(Math.cos(a) * r, top - rnd() * 6, cz + Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(s * 1.6, s * 0.7, s));
      mesh.setMatrixAt(i, m);
    }
    mesh.receiveShadow = false;
    return mesh;
  }

  /** `t` is seconds into the round (hazard time). */
  update(t: number) {
    for (const { def, obj } of this.hazards) {
      const p = hazardPose(def, t);
      obj.position.set(p.pos.x, p.pos.y, p.pos.z);
      obj.quaternion.set(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
      if (def.kind === "press" && pressTelegraph(t / def.period + (def.phase ?? 0))) {
        obj.position.x += Math.sin(t * 90) * 0.05;
        obj.position.z += Math.cos(t * 77) * 0.05;
      }
    }
    this.belts.forEach((tex, i) => (tex.offset.x = t * this.beltSpeeds[i]));
    this.flags.forEach((f, i) => (f.rotation.x = Math.sin(t * 4 + i) * 0.4));
    if (this.water) this.water.position.x = Math.sin(t * 0.4) * 0.3;
    this.clouds.position.x = Math.sin(t * 0.05) * 3;
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

function checkerTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 64, 32);
  g.fillStyle = "#3a2450";
  for (let x = 0; x < 4; x++) for (let y = 0; y < 2; y++) if ((x + y) % 2 === 0) g.fillRect(x * 16, y * 16, 16, 16);
  const t = new THREE.CanvasTexture(c);
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
