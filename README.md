# Wobble Isles

A 3D party royale for friends: wobbly jelly contestants tumble through short, chaotic rounds
across a carnival of floating sky islands. Built for 6–8 friends first, designed to scale to 32-player shows.

> **Status:** M3 — Party mode: a full show of rounds with stars, catch-up rules, House Rules and a Final.

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

Create a room, then send friends the 4-letter code or the invite link. The host presses **Start the show** (or Enter) in the lobby.
Add `?lag=150` to the URL to simulate 150 ms of round-trip latency, `?solo` to skip the menu, `?solo&round=ice-floes` to practise one round
(`frostbite-run`, `gearworks-dash`, `ice-floes`, `crown-grab`, `gumball-goal`, `summit-scramble`).
Testing: start the server with `WOBBLE_PLAN=gumball-goal,ice-floes` to force the rounds before the Final.

### A Party show

1. **Lobby:** everyone runs around the sandbox. The host starts the show.
2. **Rounds:** up to 5 rounds picked by the Show Director (no repeats, never the same type twice in a row, a team round from 4 players).
   Each round has a 5 s intro card and a 3-2-1 countdown (everyone is frozen and hazards hold still until GO).
3. **Stars:** place r of n earns n − r + 1 stars. Team rounds: winners n, losers half. The last round before the Final is a **Double Down** (×2).
4. **Catch-up:** the star leader wears the **Bounty Crown**; knock them off the course (or take the crown off them) for +1★.
   From round 2 the player in last place spins a **House Rule** for everyone: Moon Bounce, Ice Age, Turbo Traps or Caramel Floors.
5. **Final:** the top 3 race up Summit Scramble; the first to touch the summit crown is the **Show Champion**.
   Everyone else becomes a **Gremlin** and presses **F** to roll avalanches down the mountain.

**Production:** `npm run build && npm start` serves the game and the server on one port (default 2567). Or `docker build -t wobble-isles .`

**Controls:** WASD move · mouse camera · Space jump · Shift / right mouse dive · hold left mouse / E to grab, release to throw · R respawn. Land on someone's head to bounce (press jump on landing for a bigger boost).
Gamepad: left stick move, right stick camera, A jump, X dive, RT grab.

**Debug:** <kbd>`</kbd> toggles the tuning panel (values persist in localStorage; "Copy tuning JSON" to commit them) · F3 stats (incl. GPU name) · P FPS/ping · G cycles graphics quality (Auto → Low → Medium → High). Auto lowers render resolution, then shadows, to hold 50+ FPS.

**Performance spike:** open `/?bench` (optionally `&q=low|medium|high`). After a 3 s warm-up it records 30 s with 9 Wobblers
and prints avg FPS, 1% low and p95 frame time. The mobile gate is ≥ 50 FPS average.

## Layout

- `shared/` — deterministic simulation (Rapier character controller, hazards, level data, tuning), the round library (`rounds.ts`) and Party rules (`show.ts`). Runs in Node and the browser.
- `server/` — Colyseus Party room (clock, hazards, balls, NPC dummies, interaction referee, snapshots) and `ShowRunner` (phases, round referees, stars, Bounty, House Rules, Gremlins).
- `client/` — Three.js rendering, input, camera, menu, show overlays, netcode client, tuning panel.
- `tools/loadtest.ts` — bot load test.

## Stack

TypeScript monorepo · Three.js (client) · Rapier physics (shared simulation) · Colyseus (room server) · Vitest / Playwright
