// Third-person follow camera (ART.md §5): orbit with mouse / right stick, pulls in when blocked.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

export class CameraRig {
  yaw = Math.PI; // camera sits behind a Wobbler facing +Z
  pitch = 0.35;
  distance = 7;
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  private target = new THREE.Vector3();
  private initialised = false;
  private shake = 0;

  constructor(public world: RAPIER.World) {}

  addLook(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.35, 1.25);
  }

  kick(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** Forward direction on the ground plane (from camera toward the target). */
  forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  update(follow: THREE.Vector3, dt: number, reduceMotion = false) {
    const goal = follow.clone().add(new THREE.Vector3(0, 0.9, 0));
    if (!this.initialised) {
      this.target.copy(goal);
      this.initialised = true;
    }
    // Smooth horizontally fast, vertically slower so jumps don't bob the whole view.
    const kh = 1 - Math.exp(-14 * dt);
    const kv = 1 - Math.exp(-6 * dt);
    this.target.x += (goal.x - this.target.x) * kh;
    this.target.z += (goal.z - this.target.z) * kh;
    this.target.y += (goal.y - this.target.y) * kv;

    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    let dist = this.distance;
    // Pull in when level geometry blocks the view (ignore Wobblers, hazards and balls).
    const ray = new RAPIER.Ray(this.target, dir);
    const hit = this.world.castRay(ray, dist, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    if (hit) dist = Math.max(1.2, hit.timeOfImpact - 0.3);

    this.camera.position.copy(this.target).addScaledVector(dir, dist);
    if (this.shake > 0 && !reduceMotion) {
      const s = this.shake * 0.15;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.shake = Math.max(0, this.shake - dt * 3);
    this.camera.lookAt(this.target);
  }
}
