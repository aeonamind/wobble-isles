// Wobbler faces are canvas textures, swapped at runtime for expressions (ART.md §2.1).

import * as THREE from "three";

export type Expression = "neutral" | "determined" | "shocked" | "dizzy" | "happy" | "strain";

const W = 256;
const H = 128;
const cache = new Map<string, THREE.CanvasTexture>();

export function faceTexture(expr: Expression, blink = false): THREE.CanvasTexture {
  const key = `${expr}:${blink}`;
  let t = cache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  draw(g, expr, blink);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

const INK = "#2b1638";

function eye(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, pupil = 0.55, look = 0) {
  g.fillStyle = "#ffffff";
  g.strokeStyle = INK;
  g.lineWidth = 5;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.beginPath();
  g.ellipse(x + look * rx * 0.3, y + ry * 0.12, rx * pupil, ry * pupil, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(x + look * rx * 0.3 - rx * 0.18, y - ry * 0.15, rx * 0.17, 0, Math.PI * 2);
  g.fill();
}

function closedEye(g: CanvasRenderingContext2D, x: number, y: number, up: boolean) {
  g.strokeStyle = INK;
  g.lineWidth = 7;
  g.lineCap = "round";
  g.beginPath();
  if (up) g.arc(x, y + 10, 18, Math.PI * 1.15, Math.PI * 1.85);
  else g.arc(x, y - 6, 18, Math.PI * 0.15, Math.PI * 0.85);
  g.stroke();
}

function cheeks(g: CanvasRenderingContext2D) {
  g.fillStyle = "rgba(255, 120, 160, 0.55)";
  for (const x of [58, 198]) {
    g.beginPath();
    g.ellipse(x, 92, 20, 11, 0, 0, Math.PI * 2);
    g.fill();
  }
}

function draw(g: CanvasRenderingContext2D, expr: Expression, blink: boolean) {
  g.clearRect(0, 0, W, H);
  const L = 92;
  const R = 164;
  const Y = 58;
  cheeks(g);
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineCap = "round";

  if (blink && expr !== "dizzy" && expr !== "shocked") {
    closedEye(g, L, Y, false);
    closedEye(g, R, Y, false);
  } else {
    switch (expr) {
      case "neutral":
        eye(g, L, Y, 22, 27, 0.78);
        eye(g, R, Y, 22, 27, 0.78);
        break;
      case "determined":
        eye(g, L, Y + 3, 21, 24, 0.6, 0.3);
        eye(g, R, Y + 3, 21, 24, 0.6, 0.3);
        // brows
        g.lineWidth = 8;
        g.beginPath();
        g.moveTo(L - 22, Y - 30);
        g.lineTo(L + 18, Y - 20);
        g.moveTo(R + 22, Y - 30);
        g.lineTo(R - 18, Y - 20);
        g.stroke();
        break;
      case "shocked":
        eye(g, L, Y, 27, 31, 0.32);
        eye(g, R, Y, 27, 31, 0.32);
        break;
      case "dizzy":
        for (const x of [L, R]) {
          g.lineWidth = 5;
          g.beginPath();
          for (let a = 0; a < Math.PI * 5; a += 0.2) {
            const r = 2 + a * 1.4;
            const px = x + Math.cos(a) * r;
            const py = Y + Math.sin(a) * r;
            if (a === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.stroke();
        }
        break;
      case "happy":
        closedEye(g, L, Y, true);
        closedEye(g, R, Y, true);
        break;
      case "strain":
        g.lineWidth = 7;
        for (const [x, s] of [
          [L, 1],
          [R, -1],
        ]) {
          g.beginPath();
          g.moveTo(x - 16 * s, Y - 14);
          g.lineTo(x + 14 * s, Y);
          g.lineTo(x - 16 * s, Y + 14);
          g.stroke();
        }
        break;
    }
  }

  // Mouth
  g.lineWidth = 6;
  g.beginPath();
  const mx = 128;
  const my = 100;
  switch (expr) {
    case "shocked":
      g.ellipse(mx, my, 10, 13, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case "dizzy":
      g.moveTo(mx - 16, my);
      for (let i = 0; i <= 4; i++) g.lineTo(mx - 16 + i * 8, my + (i % 2 ? 5 : -5));
      g.stroke();
      break;
    case "happy":
      g.arc(mx, my - 8, 16, Math.PI * 0.1, Math.PI * 0.9);
      g.stroke();
      break;
    case "strain":
      g.moveTo(mx - 14, my);
      g.lineTo(mx + 14, my);
      g.stroke();
      break;
    case "determined":
      g.arc(mx, my + 10, 10, Math.PI * 1.2, Math.PI * 1.8);
      g.stroke();
      break;
    default: {
      // Open smile with a pink tongue
      g.fillStyle = INK;
      g.beginPath();
      g.moveTo(mx - 19, my - 10);
      g.quadraticCurveTo(mx, my - 5, mx + 19, my - 10);
      g.quadraticCurveTo(mx + 17, my + 16, mx, my + 17);
      g.quadraticCurveTo(mx - 17, my + 16, mx - 19, my - 10);
      g.fill();
      g.fillStyle = "#ff7a9a";
      g.beginPath();
      g.ellipse(mx, my + 9, 10, 6, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

let heart: THREE.CanvasTexture | null = null;

/** The glowing candy heart on every Wobbler's belly (cream, soft edge). */
export function heartTexture(): THREE.CanvasTexture {
  if (heart) return heart;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const path = new Path2D("M64 108 C 20 80, 8 52, 26 34 C 40 20, 58 26, 64 40 C 70 26, 88 20, 102 34 C 120 52, 108 80, 64 108 Z");
  g.shadowColor = "rgba(255, 236, 180, 0.9)";
  g.shadowBlur = 16;
  g.fillStyle = "rgba(255, 233, 170, 0.92)";
  g.fill(path);
  g.shadowBlur = 0;
  g.fillStyle = "rgba(255, 250, 225, 0.7)";
  g.beginPath();
  g.ellipse(46, 46, 10, 6, -0.6, 0, Math.PI * 2);
  g.fill();
  heart = new THREE.CanvasTexture(c);
  heart.colorSpace = THREE.SRGBColorSpace;
  return heart;
}
