# Wobble Isles

A 3D party royale for friends: wobbly jelly contestants tumble through short, chaotic rounds
across a carnival of floating sky islands. Built for 6–8 friends first, designed to scale to 32-player shows.

> **Status:** M1 — feel sandbox. Single-player movement playground; no multiplayer yet.

- [Game design](docs/DESIGN.md)
- [Art & audio direction](docs/ART.md)
- [Third-party assets](docs/ASSETS.md)

## Run it

```bash
npm install
npm run dev        # http://localhost:5180 (also reachable on your LAN)
npm test           # simulation tests
```

**Controls:** WASD move · mouse camera · Space jump · Shift / right mouse dive · hold left mouse / E to grab, release to throw · R respawn.
Gamepad: left stick move, right stick camera, A jump, X dive, RT grab.

**Debug:** <kbd>`</kbd> toggles the tuning panel (values persist in localStorage; "Copy tuning JSON" to commit them) · F3 stats (incl. GPU name) · P FPS/ping · G cycles graphics quality (Auto → Low → Medium → High). Auto lowers render resolution, then shadows, to hold 50+ FPS.

**Performance spike:** open `/?bench` (optionally `&q=low|medium|high`). After a 3 s warm-up it records 30 s with 9 Wobblers
and prints avg FPS, 1% low and p95 frame time. The mobile gate is ≥ 50 FPS average.

## Layout

- `shared/` — deterministic simulation (Rapier character controller, hazards, level data, tuning). Runs in Node and the browser.
- `client/` — Three.js rendering, input, camera, tuning panel.

## Stack

TypeScript monorepo · Three.js (client) · Rapier physics (shared simulation) · Colyseus (authoritative server, from M2) · Vitest / Playwright
