// Shared toon look (ART.md §4): stepped light ramp + inverted-hull outlines, applied to everything.

import * as THREE from "three";

const ramp = (() => {
  const data = new Uint8Array([70, 150, 215, 255]); // 4 light steps
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
}

const outlineCache = new Map<number, THREE.MeshBasicMaterial>();
export function outlineMaterial(color = 0x3a2450) {
  let m = outlineCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    outlineCache.set(color, m);
  }
  return m;
}

/**
 * Inverted-hull outline: a back-face copy pushed out along the normals.
 * `width` is in metres, so thin parts and big blocks get the same line weight.
 */
export function addOutline(mesh: THREE.Mesh, width = 0.03, color?: number) {
  const geo = mesh.geometry.clone();
  geo.deleteAttribute("uv");
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();
  // Use smooth normals so hard-edged boxes don't crack at the corners.
  const smooth = smoothNormals(geo);
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + smooth[i * 3] * width, pos.getY(i) + smooth[i * 3 + 1] * width, pos.getZ(i) + smooth[i * 3 + 2] * width);
  }
  const shell = new THREE.Mesh(geo, outlineMaterial(color));
  shell.userData.outline = true;
  shell.castShadow = false;
  shell.receiveShadow = false;
  mesh.add(shell);
  return shell;
}

/** Average normals of vertices that share a position. */
function smoothNormals(geo: THREE.BufferGeometry): Float32Array {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const sum = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const v = sum.get(k) ?? new THREE.Vector3();
    v.x += nor.getX(i);
    v.y += nor.getY(i);
    v.z += nor.getZ(i);
    sum.set(k, v);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = sum.get(key(i))!.clone().normalize();
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** Diagonal hazard stripes (coral + white, ART.md §3.1). */
export function stripeTexture(a = "#FF4F5E", b = "#FFFFFF", repeat = 1) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 - 64, 64);
    g.lineTo(i - 64, 64);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function gradientTexture(top: string, bottom: string) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
