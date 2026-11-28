# Wobble Isles: notes for Claude Code

Read this first in every session. It replaces any per-machine memory: keep it current. When a milestone lands or a working rule changes, update **Where we are** and the rules below in the same PR.

## Working with the owner

- **Language:** reply in **Vietnamese**. Code, identifiers, commit messages, docs and all in-game text are **English**.
- **Questions:** never use the AskUserQuestion popup; the owner rejects it. Ask in plain chat text with a recommendation, and keep going with the safe default where possible.
- **Quality bar:** a polished, deliberate game, not "vibe-coded" throwaway work.
  - Design first, consistent art and audio direction, tests for the simulation.
  - Clean architecture beats feature count.
- **Originality:** genre peer is Fall Guys. Share the genre (round types, run/jump/dive/grab) but **never copy its characters, maps, names or branding**.
- **Delivery:** one branch and one PR per milestone or topic. The owner reviews and merges; Claude never merges.
  - Branch from the latest `origin/main`, or stack on an unmerged branch and say so.
  - If `gh` is not installed, give the compare link: `https://github.com/aeonamind/wobble-isles/compare/main...<branch>?expand=1`.
  - Never push to `main` directly.
  - Infra (gitops) changes also go through PRs only.
- **Commits:**
  - Author `user.name "eugene"`. Set it locally in a fresh clone.
  - End commit messages with the `Co-Authored-By` trailer for the model in use.
  - End PR descriptions with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Secrets:**
  - Never ask the owner to paste keys or tokens into chat, and never print secret files.
  - To move a secret, give a command that puts it on the clipboard, e.g. `xclip -sel clip < ~/.tauri/wobble-isles.key`.
  - Keep the owner's personal details out of requests to external services.
- **Verification:** check changes for real before calling them done:
  - `npm run typecheck`, `npm test`, `npm run build`;
  - for gameplay or UI, drive the game with Playwright, take screenshots, and check for console errors.
- **Reporting:** report results plainly, including what was *not* verified.

## The game

A 3D party royale: wobbly jelly contestants ("Wobblers") tumble through short chaotic rounds on floating sky islands ("Sky Carnival": Frost, Candy, Toy, Splash, Jungle, Neon).
- **Party mode** (2–8 friends, stars, no elimination) ships first. **Show mode** (16–32, elimination, matchmaking) comes in M6+.
- **Signature mechanics:** Head Bounce, Jelly Clump, House Rules.
- Full design: `docs/DESIGN.md`. Art and audio: `docs/ART.md`. Release process: `docs/RELEASING.md`.

## Stack and layout

TypeScript monorepo: Three.js client (Vite), Rapier physics, Colyseus 0.18 server, Vitest, Tauri 2 desktop app.

- `shared/` — deterministic simulation. Runs in Node and in the browser.
  - `sim.ts`: Rapier character controller.
  - `hazards.ts`: hazards are pure functions of time.
  - `level.ts`, `rounds.ts`: round builders `(seed, players) → LevelDef`.
  - `show.ts`: Party rules, stars, awards.
  - `protocol.ts`: packed wire format and `PROTOCOL_VERSION`.
  - `tuning.ts`.
- `server/` — Colyseus `PartyRoom` (clock, NPCs, interaction referee, snapshots) and `ShowRunner` (phases, referees, stars, House Rules, Gremlins, awards).
- `client/src/` — rendering, input (keyboard, mouse, gamepad, touch), camera, UI.
  - `audio.ts`: procedural Web Audio.
  - `failcam.ts`.
  - `platform.ts`: browser vs desktop app, server URL.
  - `updater.ts`.
- `client/public/` — PWA manifest, icons, service worker.
- `src-tauri/` — desktop shell only, no game logic.
- `tools/` — load test, version sync, release notes, app build.

## Commands

```bash
npm run dev          # server :2567 + client http://localhost:5180
npm test             # Vitest (shared, server, client/test)
npm run typecheck
npm run build        # web client → dist/ (npm start serves dist + server on :2567)
npm run app:dev      # Tauri window + dev server
npm run app:build    # installers; signs update bundles with ~/.tauri/wobble-isles.key if present
npm run loadtest -- 32 20
```

URL flags:
- `?solo`
- `?solo&round=<id>`
- `?lag=150`
- `?bench`
- `?debug` exposes `window.__game` in production builds; it is always exposed in dev.
- `?tune` shows the tuning panel.

Server env: `WOBBLE_PLAN=round-a,round-b` forces the rounds before the Final.

## Key technical decisions (don't undo without a reason)

- **Owner-simulated netcode:**
  - Each client simulates its own Wobbler. Remotes come from 30 Hz snapshots, drawn 100 ms behind.
  - Interactions with Wobblers you don't own go out as `NetMsg` through `sim.outbox`; the server relays and referees them.
- **Rounds:**
  - Every round runs on a **fresh Sim** built identically on server and clients from the seed.
  - Hazards use `hazardTime = max(0, t - epoch) × rules.hazardSpeed`, so everything holds still until GO.
- **Server referees** use uploaded states: finish zones, eliminations, crown, goals, summit.
- **Protocol:** bump `PROTOCOL_VERSION` when messages, packed state or shared simulation change incompatibly. Old desktop apps are then turned away (code 4426) and offered the update.
- **Ground fix:** grounded Wobblers are lifted back to rest height each tick. Rapier's controller otherwise lets an idle capsule creep into the floor until it can't move. Regression test: `shared/test/ground.test.ts`.
- **Wobbler size:** capsule `WOBBLER_HALF 0.245`, radius 0.38, so 1.25 m tall. Changing it affects stomps, sweeper heights and spawn layouts; re-run all tests.
- **Versioning:**
  - One SemVer version for the whole game, kept in `package.json`.
  - Release with `npm version` on a release branch, merge it through a PR, then push the tag (`docs/RELEASING.md`). The `v*` tag runs `.github/workflows/release.yml`, which publishes the GitHub Release (installers + signed `latest.json`) and pushes the Docker Hub image.
  - The server image goes to **Docker Hub, not GitHub Packages** (owner's choice).
- **Updater key:** public half in `src-tauri/tauri.conf.json`. The private half is `~/.tauri/wobble-isles.key` on the dev machine (backed up by the owner) and the `TAURI_SIGNING_PRIVATE_KEY` repo secret. Losing it breaks auto-update for every installed app.

## Gotchas

- Playwright: use `polling: 300` on long `waitForFunction` calls, because rAF polling is throttled in background tabs.
- The `#room-code` placeholder is `----`: wait for a real code, not for length 4.
- Linux Tauri uses WebKitGTK. If the window is blank (NVIDIA), run with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- Windows builds: inline `--config '{json}'` loses its quotes through the shell, so pass a JSON file path.

## Where we are (update this section every milestone)

| Milestone | State |
|---|---|
| M0 design docs, M1 feel sandbox, M2 netcode, M3 Party mode | Merged (tags v0.1.0, v0.2.0, v0.3.0) |
| M4 polish: characters, audio, settings, Fail Cam, awards, Jelly Clump, touch, PWA, Tauri app | Merged (PR #5) |
| Versioning and releases (`release/versioning`): CHANGELOG, protocol check, auto-update, release workflow, Docker Hub | **PR open, waiting for merge** |

**Next steps, in order:**

1. The owner merges `release/versioning` and adds the repo secrets and variables listed in `docs/RELEASING.md`:
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
   - variable `DOCKERHUB_REPO`
2. Cut the first real release:
   - Follow the steps in `docs/RELEASING.md` → v0.4.0. CHANGELOG "Unreleased" already holds the M4 notes.
   - Then check that the workflow produced the installers and the Docker image.
3. **M5 launch:**
   - Game server on a Singapore VPS. Players are in Vietnam; an earlier Helsinki host measured about 270 ms.
   - Runs the Docker Hub image, behind HTTPS/WSS.
   - CI/CD and monitoring (`/health` reports version and protocol).
   - Set `APP_SERVER_URL` so the desktop app defaults to the public server.
   - Infra changes go through gitops PRs.
4. **M6+:**
   - Show mode (16–32 players, elimination, matchmaking).
   - More rounds (catalogue in `docs/DESIGN.md` §5).
   - Level editor, mobile apps.

Open question for the owner: password-protect the updater key? It currently has none; rotating it is only free before the first public release.
