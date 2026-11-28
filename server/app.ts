import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineRoom, defineServer, matchMaker } from "colyseus";
import compression from "compression";
import express from "express";
import { PROTOCOL_VERSION, ROOM_NAME } from "../shared/protocol";
import { initPhysics } from "../shared/sim";
import { PartyRoom } from "./PartyRoom";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const distDir = fileURLToPath(new URL("../dist", import.meta.url));

// Rapier is WASM; load it before the first room is created.
await initPhysics();

export const app = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(PartyRoom),
  },
  greet: false,
  express: (expressApp) => {
    expressApp.get("/health", (_req, res) => {
      res.json({ ok: true, version, protocol: PROTOCOL_VERSION });
    });
    expressApp.get("/stats", async (_req, res) => {
      const rooms = await matchMaker.query({ name: ROOM_NAME });
      res.json({ rooms: rooms.length, players: rooms.reduce((n, r) => n + r.clients, 0) });
    });
    // Production: `npm run build` then `npm start` serves the game page from the same origin.
    // Hashed assets never change (cache for a year); pages and the service worker always revalidate.
    if (existsSync(distDir)) {
      expressApp.use(compression());
      expressApp.use(
        express.static(distDir, {
          setHeaders: (res, path) => {
            if (/[\\/]assets[\\/]/.test(path)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            else res.setHeader("Cache-Control", "no-cache");
          },
        }),
      );
    }
  },
});
