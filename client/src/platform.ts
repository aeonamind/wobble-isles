// Where the game is running: a normal browser tab, or the desktop app (Tauri). The app's page is
// served from inside the app, so it can't find the game server from its own address: the player
// picks one in the menu (a LAN host such as 192.168.1.20, or the public server).

export const isApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SERVER_KEY = "wobble-isles.server";
const DEFAULT_PORT = 2567;

/** Accepts "192.168.1.20", "localhost:2567", "play.example.com", "ws://…", "https://…". */
export function normalizeServer(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, "ws");
  if (!/^wss?:\/\//i.test(s)) {
    const host = s.split("/")[0];
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host);
    s = `${local ? "ws" : "wss"}://${s}`;
  }
  try {
    const u = new URL(s);
    // Bare LAN addresses mean the default game server port.
    if (!u.port && u.protocol === "ws:") u.port = String(DEFAULT_PORT);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function savedServer(): string | null {
  return localStorage.getItem(SERVER_KEY);
}

export function saveServer(url: string) {
  localStorage.setItem(SERVER_KEY, url);
}

/** Game server WebSocket base URL. */
export function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (isApp) return savedServer() ?? fromEnv ?? `ws://localhost:${DEFAULT_PORT}`;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // Vite dev server → game server on the same machine (works over LAN too).
  if (location.port === "5180") return `${proto}://${location.hostname}:${DEFAULT_PORT}`;
  return `${proto}://${location.host}`;
}

/** A link friends can open in a browser to join (the server also serves the web game). */
export function inviteUrl(code: string): string {
  if (isApp) {
    const web = new URL(serverUrl().replace(/^ws/, "http"));
    web.search = new URLSearchParams({ room: code }).toString();
    return web.toString();
  }
  const url = new URL(location.href);
  url.search = new URLSearchParams({ room: code }).toString();
  return url.toString();
}
