import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineRoom, defineServer, matchMaker } from "colyseus";
import express from "express";
import { ROOM_NAME } from "../shared/protocol";
import { initPhysics } from "../shared/sim";
import { PartyRoom } from "./PartyRoom";

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
      res.json({ ok: true });
    });
    expressApp.get("/stats", async (_req, res) => {
      const rooms = await matchMaker.query({ name: ROOM_NAME });
      res.json({ rooms: rooms.length, players: rooms.reduce((n, r) => n + r.clients, 0) });
    });
    // Production: `npm run build` then `npm start` serves the game page from the same origin.
    if (existsSync(distDir)) expressApp.use(express.static(distDir));
  },
});
