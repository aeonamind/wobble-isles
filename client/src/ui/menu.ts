import { VERSION_MISMATCH } from "../../../shared/protocol";
import { isApp, normalizeServer, saveServer, serverUrl } from "../platform";
import { checkForUpdate, type UpdateOffer } from "../updater";

// Title menu: name, look (body style + colour), create a room, join by code, or practise alone.

import { BODY_STYLES, cleanName, cleanStyle, type BodyStyle } from "../../../shared/protocol";
import type { NetClient } from "../net";
import { Color } from "three";
import { LEG_TOP, PLAYER_COLORS, bodyRadiusAt, bodyTop, faceAt } from "../render/wobbler";
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

/** Front silhouette of a body style as SVG: body, legs, arms, head swirl and eyes. */
function silhouette(style: BodyStyle, color: number) {
  const H = WOBBLER_HEIGHT;
  const scale = 50 / H;
  const Y = (y: number) => (58 - y * scale).toFixed(1);
  const pts: string[] = [];
  const steps = 28;
  const y0 = H * LEG_TOP;
  const y1 = H * bodyTop(style);
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    pts.push(`${(30 + bodyRadiusAt(y, style) * scale).toFixed(1)},${Y(y)}`);
  }
  for (let i = steps; i >= 0; i--) {
    const y = y0 + ((y1 - y0) * i) / steps;
    pts.push(`${(30 - bodyRadiusAt(y, style) * scale).toFixed(1)},${Y(y)}`);
  }
  const ink = "#3a2450";
  const dark = hex(new Color(color).multiplyScalar(0.72).getHex());
  const sx = (H * 0.55 - 0.2) * scale;
  const armX = (bodyRadiusAt(H * 0.55, style) + 0.06) * scale;
  const faceY = Number(Y(H * faceAt(style) + 0.02));
  return `<svg viewBox="0 0 60 62" width="54" height="56" aria-hidden="true">
    <g stroke="${ink}" stroke-width="2.2" stroke-linejoin="round">
      <rect x="21" y="${Y(y0 + 0.04)}" width="7" height="${(y0 * scale).toFixed(1)}" rx="3.5" fill="${dark}"/>
      <rect x="32" y="${Y(y0 + 0.04)}" width="7" height="${(y0 * scale).toFixed(1)}" rx="3.5" fill="${dark}"/>
      <ellipse cx="${(30 - armX).toFixed(1)}" cy="${(58 - sx).toFixed(1)}" rx="3.6" ry="5.5" transform="rotate(25 ${(30 - armX).toFixed(1)} ${(58 - sx).toFixed(1)})" fill="${hex(color)}"/>
      <ellipse cx="${(30 + armX).toFixed(1)}" cy="${(58 - sx).toFixed(1)}" rx="3.6" ry="5.5" transform="rotate(-25 ${(30 + armX).toFixed(1)} ${(58 - sx).toFixed(1)})" fill="${hex(color)}"/>
      <circle cx="30.5" cy="${Y(y1 + 0.02)}" r="3.4" fill="${hex(color)}"/>
      <polygon points="${pts.join(" ")}" fill="${hex(color)}"/>
    </g>
    <ellipse cx="25.5" cy="${faceY}" rx="2.3" ry="3.2" fill="${ink}"/><ellipse cx="34.5" cy="${faceY}" rx="2.3" ry="3.2" fill="${ink}"/>
  </svg>`;
}

/** Resolves with a connected room, or "solo" (with the chosen profile). */
export function showMenu(prefillCode: string, connect: Connect): Promise<{ net: NetClient | "solo"; profile: Profile }> {
  const form = $<HTMLFormElement>("menu");
  const nameIn = $<HTMLInputElement>("menu-name");
  const codeIn = $<HTMLInputElement>("menu-code");
  const error = $("menu-error");
  form.hidden = false;
  document.getElementById("help")!.hidden = true; // the HUD shows it again once in game
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

  $("menu-version").textContent = `v${__APP_VERSION__}${isApp ? " · desktop" : ""}`;
  // Desktop app: offer a newer release (checked in the background).
  let offer: UpdateOffer | null = null;
  const showOffer = (o: UpdateOffer) => {
    offer = o;
    $("menu-update-text").textContent = `Wobble Isles ${o.version} is out!`;
    $("menu-update").hidden = false;
  };
  if (isApp) void checkForUpdate().then((o) => o && showOffer(o));
  $("menu-update-go").onclick = async () => {
    if (!offer) return;
    const go = $<HTMLButtonElement>("menu-update-go");
    go.disabled = true;
    try {
      await offer.install((p) => ($("menu-update-text").textContent = p == null ? "Downloading…" : `Downloading… ${Math.round(p * 100)}%`));
      $("menu-update-text").textContent = "Restarting…";
    } catch (e) {
      console.warn("Update failed:", e);
      $("menu-update-text").textContent = "Update failed. Try again later.";
      go.disabled = false;
    }
  };

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
        const code = (e as { code?: number }).code;
        if (code === VERSION_MISMATCH) {
          // Old client, newer server (or the other way round).
          if (isApp) {
            error.textContent = "This server runs a different version of Wobble Isles. Update the app to play.";
            void checkForUpdate().then((o) => o && showOffer(o));
          } else {
            // Reload once to fetch the new page; never loop if that didn't help.
            if (sessionStorage.getItem("wobble-isles.reloaded")) error.textContent = "This server runs a different version of Wobble Isles.";
            else {
              sessionStorage.setItem("wobble-isles.reloaded", "1");
              error.textContent = "Wobble Isles was just updated. Reloading…";
              setTimeout(() => location.reload(), 1500);
            }
          }
        } else
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
