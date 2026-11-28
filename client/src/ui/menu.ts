import { isApp, normalizeServer, saveServer, serverUrl } from "../platform";

// Title menu: name, look (body style + colour), create a room, join by code, or practise alone.

import { BODY_STYLES, cleanName, cleanStyle, type BodyStyle } from "../../../shared/protocol";
import type { NetClient } from "../net";
import { PLAYER_COLORS, bodyRadiusAt } from "../render/wobbler";
import { WOBBLER_HEIGHT } from "../../../shared/sim";

const NAME_KEY = "wobble-isles.name";
const LOOK_KEY = "wobble-isles.look";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Profile {
  name: string;
  color: number;
  style: BodyStyle;
}

type Connect = (how: { create: true } | { code: string }, profile: Profile) => Promise<NetClient>;

const STYLE_NAMES: Record<BodyStyle, string> = { bean: "Bean", gumdrop: "Gumdrop", drop: "Drop" };

export function savedLook(): { color: number; style: BodyStyle } {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_KEY) ?? "{}");
    const color = Number.isInteger(v.color) && v.color >= 0 && v.color < PLAYER_COLORS.length ? v.color : Math.floor(Math.random() * PLAYER_COLORS.length);
    return { color, style: cleanStyle(v.style) };
  } catch {
    return { color: 0, style: "bean" };
  }
}

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/** Side silhouette of a body style as an SVG path (front view, face dots included). */
function silhouette(style: BodyStyle, color: number) {
  const H = WOBBLER_HEIGHT;
  const scale = 52 / H;
  const pts: string[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * H;
    pts.push(`${(30 + bodyRadiusAt(y, style) * scale).toFixed(1)},${(58 - y * scale).toFixed(1)}`);
  }
  for (let i = steps; i >= 0; i--) {
    const y = (i / steps) * H;
    pts.push(`${(30 - bodyRadiusAt(y, style) * scale).toFixed(1)},${(58 - y * scale).toFixed(1)}`);
  }
  const faceY = 58 - H * (style === "drop" ? 0.44 : style === "gumdrop" ? 0.58 : 0.62) * scale;
  return `<svg viewBox="0 0 60 62" width="54" height="56" aria-hidden="true">
    <polygon points="${pts.join(" ")}" fill="${hex(color)}" stroke="#3a2450" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="25" cy="${faceY}" rx="2.2" ry="3.2" fill="#3a2450"/><ellipse cx="35" cy="${faceY}" rx="2.2" ry="3.2" fill="#3a2450"/>
  </svg>`;
}

/** Resolves with a connected room, or "solo" (with the chosen profile). */
export function showMenu(prefillCode: string, connect: Connect): Promise<{ net: NetClient | "solo"; profile: Profile }> {
  const form = $<HTMLFormElement>("menu");
  const nameIn = $<HTMLInputElement>("menu-name");
  const codeIn = $<HTMLInputElement>("menu-code");
  const error = $("menu-error");
  form.hidden = false;
  nameIn.value = localStorage.getItem(NAME_KEY) ?? "";
  codeIn.value = prefillCode.toUpperCase();
  (prefillCode ? codeIn : nameIn).focus();
  codeIn.addEventListener("input", () => (codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, "")));
  // Desktop app: the page is local, so the player says which server to play on.
  const serverIn = $<HTMLInputElement>("menu-server");
  if (isApp) {
    $("menu-server-row").hidden = false;
    serverIn.value = serverUrl().replace(/^wss?:\/\//, "");
  }

  // Look picker
  const look = savedLook();
  const styles = $("menu-styles");
  const colors = $("menu-colors");
  const render = () => {
    styles.replaceChildren(
      ...BODY_STYLES.map((st) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "look-style" + (st === look.style ? " on" : "");
        b.title = STYLE_NAMES[st];
        b.innerHTML = silhouette(st, PLAYER_COLORS[look.color]) + `<span>${STYLE_NAMES[st]}</span>`;
        b.onclick = () => {
          look.style = st;
          save();
        };
        return b;
      }),
    );
    colors.replaceChildren(
      ...PLAYER_COLORS.map((c, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "look-color" + (i === look.color ? " on" : "");
        b.style.background = hex(c);
        b.title = `Colour ${i + 1}`;
        b.onclick = () => {
          look.color = i;
          save();
        };
        return b;
      }),
    );
  };
  const save = () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
    render();
  };
  render();
  const buttons = () => [...form.querySelectorAll<HTMLButtonElement>("button:not(.look-style):not(.look-color)")];

  return new Promise((resolve) => {
    const profile = (): Profile => {
      const n = cleanName(nameIn.value, "");
      if (n) localStorage.setItem(NAME_KEY, n);
      return { name: n || `Wobbler ${Math.floor(Math.random() * 90 + 10)}`, color: look.color, style: look.style };
    };
    const attempt = async (how: { create: true } | { code: string }) => {
      error.hidden = true;
      if (isApp) {
        const url = normalizeServer(serverIn.value);
        if (!url) {
          error.textContent = "Enter the game server address, e.g. 192.168.1.20";
          error.hidden = false;
          serverIn.focus();
          return;
        }
        saveServer(url);
      }
      buttons().forEach((b) => (b.disabled = true));
      try {
        const p = profile();
        const net = await connect(how, p);
        form.hidden = true;
        resolve({ net, profile: p });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("Could not join:", e);
        error.textContent = /not found|invalid|locked|full/i.test(msg)
          ? "That room doesn't exist or is full. Check the code."
          : "Can't reach the game server. Is it running?";
        error.hidden = false;
        buttons().forEach((b) => (b.disabled = false));
      }
    };
    $("menu-create").onclick = () => void attempt({ create: true });
    form.onsubmit = (e) => {
      e.preventDefault();
      if (codeIn.value.length === 4) void attempt({ code: codeIn.value });
      else {
        error.textContent = "Room codes have 4 characters.";
        error.hidden = false;
        codeIn.focus();
      }
    };
    $("menu-solo").onclick = () => {
      const p = profile();
      form.hidden = true;
      resolve({ net: "solo", profile: p });
    };
  });
}
