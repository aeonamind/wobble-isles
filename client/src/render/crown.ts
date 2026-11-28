// Golden crown: the Hunt prize, the Final's summit goal and (small) the Bounty Crown on the star leader.

import * as THREE from "three";
import { addOutline, toon } from "./toon";

export function makeCrown(scale = 1) {
  const g = new THREE.Group();
  const gold = toon(0xffd23f, { emissive: 0xffa800, emissiveIntensity: 0.35 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.22, 16, 1, true), gold);
  band.material.side = THREE.DoubleSide;
  addOutline(band, 0.025);
  g.add(band);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), gold);
    spike.position.set(Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3);
    addOutline(spike, 0.02);
    g.add(spike);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), toon([0xff4f8b, 0x57d9b7, 0x9b6bff][i % 3]));
    gem.position.set(Math.cos(a) * 0.315, 0.0, Math.sin(a) * 0.315);
    g.add(gem);
  }
  g.scale.setScalar(scale);
  g.traverse((o) => (o.castShadow = !o.userData.outline));
  return g;
}
