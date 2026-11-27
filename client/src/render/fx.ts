// Pooled particle bursts and rings (ART.md §7). Everything is preallocated: no per-event allocations.

import * as THREE from "three";

const MAX = 400;

export class Fx {
  private mesh: THREE.InstancedMesh;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private gravity = new Float32Array(MAX);
  private next = 0;
  private dummy = new THREE.Object3D();
  private rings: { mesh: THREE.Mesh; t: number; max: number; to: number }[] = [];
  private ringPool: THREE.Mesh[] = [];

  constructor(private scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.mesh.setColorAt(i, new THREE.Color(0xffffff));
      this.hide(i);
    }
    scene.add(this.mesh);
  }

  private hide(i: number) {
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  burst(at: THREE.Vector3, colors: number[], n: number, speed: number, opts: { up?: number; gravity?: number; size?: number; life?: number } = {}) {
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([Math.cos(a) * s, (opts.up ?? speed * 0.6) * (0.5 + Math.random()), Math.sin(a) * s], i * 3);
      this.life[i] = 0;
      this.maxLife[i] = (opts.life ?? 0.6) * (0.7 + Math.random() * 0.6);
      this.size[i] = (opts.size ?? 0.09) * (0.6 + Math.random() * 0.8);
      this.gravity[i] = opts.gravity ?? 9;
      this.mesh.setColorAt(i, c.setHex(colors[k % colors.length]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  ring(at: THREE.Vector3, color: number, radius: number, duration = 0.4) {
    const mesh =
      this.ringPool.pop() ??
      new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    this.rings.push({ mesh, t: 0, max: duration, to: radius });
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.maxLife[i] <= 0) continue;
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        this.maxLife[i] = 0;
        this.hide(i);
        continue;
      }
      const j = i * 3;
      this.vel[j + 1] -= this.gravity[i] * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const k = 1 - this.life[i] / this.maxLife[i];
      this.dummy.position.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      this.dummy.scale.setScalar(this.size[i] * (0.3 + 0.7 * k));
      this.dummy.rotation.set(this.life[i] * 6, this.life[i] * 4, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.rings = this.rings.filter((r) => {
      r.t += dt;
      const k = r.t / r.max;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        this.ringPool.push(r.mesh);
        return false;
      }
      r.mesh.scale.setScalar(0.1 + (r.to - 0.1) * (1 - (1 - k) ** 3));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      return true;
    });
  }
}
