# Wobble Isles

A 3D party royale for friends: wobbly jelly contestants tumble through short, chaotic rounds
across a carnival of floating sky islands. Built for 6–8 friends first, designed to scale to 32-player shows.

> **Status:** M2 — online Party rooms in the sandbox (create a room, share the code or link, play together).

- [Game design](docs/DESIGN.md)
- [Art & audio direction](docs/ART.md)
- [Third-party assets](docs/ASSETS.md)

## Run it

```bash
npm install
npm run dev        # game server :2567 + client http://localhost:5180 (friends on your LAN: http://<your-ip>:5180)
npm test           # simulation, netcode and server tests
npm run loadtest -- 32 20   # 32 bot players for 20 s, prints server/bandwidth budget
```

Create a room, then send friends the 4-letter code or the invite link. Add `?lag=150` to the URL to simulate 150 ms of round-trip latency, `?solo` to skip the menu.

**Production:** `npm run build && npm start` serves the game and the server on one port (default 2567). Or `docker build -t wobble-isles .`

**Controls:** WASD move · mouse camera · Space jump · Shift / right mouse dive · hold left mouse / E to grab, release to throw · R respawn. Land on someone's head to bounce (press jump on landing for a bigger boost).
Gamepad: left stick move, right stick camera, A jump, X dive, RT grab.

**Debug:** <kbd>`</kbd> toggles the tuning panel (values persist in localStorage; "Copy tuning JSON" to commit them) · F3 stats (incl. GPU name) · P FPS/ping · G cycles graphics quality (Auto → Low → Medium → High). Auto lowers render resolution, then shadows, to hold 50+ FPS.

**Performance spike:** open `/?bench` (optionally `&q=low|medium|high`). After a 3 s warm-up it records 30 s with 9 Wobblers
and prints avg FPS, 1% low and p95 frame time. The mobile gate is ≥ 50 FPS average.

## Layout

- `shared/` — deterministic simulation (Rapier character controller, hazards, level data, tuning). Runs in Node and the browser.
- `server/` — Colyseus Party room: clock, hazards, balls, NPC dummies, interaction referee, snapshots.
- `client/` — Three.js rendering, input, camera, menu, netcode client, tuning panel.
- `tools/loadtest.ts` — bot load test.

## Stack

TypeScript monorepo · Three.js (client) · Rapier physics (shared simulation) · Colyseus (room server) · Vitest / Playwright
