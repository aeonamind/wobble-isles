# Wobble Isles — Game Design Document

> Status: **Draft for review (M0)** · Owner: aeonamind · Last updated: 2026-11-28

## 1. Vision

**Wobble Isles is a 3D party royale for friends.** Wobbly jelly contestants tumble through a carnival of floating sky islands, competing in short, chaotic rounds of racing, surviving, hunting and team play.

It starts as the game you open on a call with 6–7 friends. It is built from day one so the same rounds can later carry public 32-player shows.

**One-line pitch:** *Short, silly rounds where falling is the funniest part, and your friends are the biggest obstacle.*

### 1.1 Design pillars

Every feature must serve at least one pillar. A feature that hurts any pillar must justify itself.

| # | Pillar | What it means in practice |
|---|---|---|
| 1 | **Falling is fun** | Failure is slapstick, never punishing. Ragdolls, squash and stretch, boing sounds, Fail Cam replays. Respawns and round lengths are tuned so that a mistake costs seconds, not minutes. |
| 2 | **Friends are the obstacle** | Players can grab, shove, dive-tackle and throw each other in every round. The most memorable moments should come from other players, not from scripted hazards. |
| 3 | **Variety and surprise** | Many round types across six themed islands. Round order is randomised with rules, and difficulty is deliberately uneven so a hard round lands as a jolt. |
| 4 | **Everyone stays in it** | Nobody sits out for minutes. Party mode has no early elimination, and there are catch-up mechanics. Players who are out keep playing as Gremlins. |

### 1.2 Inspirations and lessons

We share a **genre** with Fall Guys, Stumble Guys, Gang Beasts and Party Animals. We copy **no characters, levels, names or branding**.

| Source | Lesson we apply |
|---|---|
| Fall Guys (Mediatonic) | "Make failure fun." A slightly unstable, imprecise world is funnier than a tightly controlled one. Uneven difficulty is deliberate. Qualification should always feel within reach. Schadenfreude matters: other people's failures happen right in front of you. |
| Fall Guys Creative | Bite-sized rounds burn through content fast. Rounds must be **data-driven** so a level editor and user-generated content are possible later. |
| Stumble Guys | Browser, mobile, simple courses and cross-play scale reach enormously. Design touch controls early. |
| Ultimate Chicken Horse | They rebuilt scoring late because last place had no way back. **Catch-up is a launch requirement.** |
| Gang Beasts / Party Animals | Physics-driven interaction between players is the comedy engine. Imprecision is acceptable if it is funny and readable. |
| Mario Party | The fun is between the players. Keep everyone involved, including those who are "out". |

### 1.3 Audience and platforms

- **Primary:** friend groups of 4–8 people on PC browsers, often on a voice call. Ages 12 and up, casual to mid-core.
- **Secondary (later):** public matchmaking of 16–32 players, then mobile (touch) and an installable PWA.
- **Session:** 10–15 minutes per show. Players can drop out between shows.

## 2. Game modes

Both modes use **the same round library**. Every round declares its own player limits and scoring, so it runs at 2 or 32 players without code changes.

### 2.1 Party mode (build first)

Private room with a 4-character invite code. 2–8 players, best with 6.

- **Show length:** 5 rounds and a Final, about 12 minutes.
- **No elimination before the Final.** Everyone plays every round.
- **Stars:** each round ranks all players. In a round with *N* players, rank *r* earns `N − r + 1` stars, so with 6 players: 6, 5, 4, 3, 2, 1.
  - Ties share the higher value.
  - Team rounds give every member of the winning team the top value and every member of the losing team `ceil(N/2)`.
- **Catch-up rules:**
  1. **Bounty Crown:** the current star leader wears a visible crown. Whoever knocks the leader off the course, or steals the leader's objective, earns **+1 bonus star**.
  2. **Double Down:** the last round before the Final awards **double stars**.
  3. **Underdog round:** if an Asymmetric round (for example Claw Machine) is drawn, the player in **last place** takes the special role.
  4. **Pity boost** (optional, off by default): last place gets a 5% speed boost in Race rounds.
- **The Final:** the top 3 by stars play the Final. Ties are broken by best single-round rank, then by random.
  - Everyone else becomes a **Gremlin**: they control the Final's hazards (fans, waves, falling blocks) from a spectator view.
  - A Gremlin earns a badge if the finalist they backed before the Final wins.
- **Winner:** whoever wins the Final is the **Show Champion**, regardless of stars. Stars decide who gets into the Final and the podium afterwards.
  - This keeps every round meaningful while letting the Final be dramatic.
- **7–8 players:** team rounds split as evenly as possible. The smaller team gets a small handicap, for example a smaller goal.

### 2.2 Show mode (scale-up, M6+)

Public matchmaking for 16–32 players, possibly 40 if it plays well.

- **Fall Guys-style elimination:** each round has a qualification quota, for example the first 70% to finish a Race qualify. Survival rounds end when the quota is reached or time runs out.
- **Forced Final:** when the remaining players reach the Final's ideal count (2–8), or at round 4, the next round is a Final.
- **Eliminated players:** can spectate any survivor, act as Gremlins in rounds that support them, or queue for a new show instantly with no penalty.
- **Rewards:** cosmetic currency, no gameplay advantage.

### 2.3 Round selection (both modes)

A **Show Director** picks each next round from the eligible pool:

1. Filter by player count: `minPlayers ≤ n ≤ maxPlayers`.
2. Never repeat a round within a show. Never pick the same category twice in a row.
3. Party mode guarantees at least 1 Team round (if n ≥ 4) and at least 1 Race per show.
4. Weight toward islands not seen yet in this show.
5. The Final is always a Final-category round.

The host can override this with a custom playlist in Party mode.

## 3. Core mechanics

### 3.1 Contestant controls

| Action | Keyboard and mouse | Gamepad | Touch (later) |
|---|---|---|---|
| Move | WASD | Left stick | Virtual stick |
| Camera | Mouse | Right stick | Drag right half |
| Jump | Space | A / Cross | Button |
| Dive | Shift (or Ctrl) | X / Square | Button |
| Grab / hold | Left mouse or E (hold) | RT / R2 (hold) | Button (hold) |
| Throw (while holding) | Release, aiming with the camera | Release | Release |
| Emote | 1–4 / wheel on Q | D-pad | Emote button |

### 3.2 Movement model and target tuning

The contestant is a **kinematic capsule** driven by our own controller code running in the shared simulation. Physics bodies (balls, floes, props) are dynamic Rapier bodies. All numbers below are starting values to tune in M1 with the in-game tuning panel.

| Parameter | Start value | Notes |
|---|---|---|
| Run speed | 6.0 m/s | Contestant is about 1.0 m tall |
| Ground accel / decel | 40 / 50 m/s² | Snappy, but not instant |
| Air control | 35% of ground | |
| Jump | 1.3 m apex, about 0.45 s to apex | Coyote time 0.1 s, jump buffer 0.12 s |
| Gravity | 26 m/s² (×1.4 when falling) | Floaty up, punchy down |
| Dive | 7.5 m/s forward, 4.5 m/s hop, then a 0.45 s belly slide | Diving or fast-sliding into someone tackles them into a ragdoll |
| Grab range | 1.1 m cone, 60° | Holding slows both players to 70% |
| Throw | 6 m/s horizontal, 4 m/s up | Thrown player ragdolls |
| Ragdoll | 0.8–1.4 s, then auto get-up | Triggered by big hits (knockback ≥ 5.5 m/s), hard landings over 16 m/s, tackles, being thrown |
| Step / slope | 0.3 m step, 50° max slope | |
| Head bounce | 2.0 m (3.2 m with jump), 2.5 m/s slide-off | Stomped Wobbler: 0.7 s at 45% speed |
| Safety caps | 25 m/s horizontal, 18 m/s upward knockback | Upward kicks never stack |

### 3.3 Surface materials (variety without new rules)

| Surface | Effect |
|---|---|
| Normal | Default |
| **Ice** | Accel ×0.25, decel ×0.1. Momentum is king |
| **Jelly / bouncer** | Landing gives an upward bounce of 1.5–2.5× jump height |
| **Conveyor** | Adds the belt's velocity to the contestant |
| **Sticky (candy)** | Speed ×0.6, no slide |
| **Water (shallow)** | Speed ×0.7, splash VFX |
| **Deep water / void / clouds** | Falling out: respawn or elimination, per round rules |

### 3.4 Failure and respawn rules

- **Race rounds:** falling out puts you back at the last checkpoint after 1.5 s, with a short invulnerability glow.
- **Survival / Final rounds:** falling out means you are out of that round. You are ranked by the order you fell, and you become a Gremlin if the round supports it.
- **Hunt / Team rounds:** falling out respawns you at your spawn zone after 2 s, and you drop any held objective.
- **Anti-grief:** a player can grab another for at most 3 s before being auto-released. The same pair cannot re-grab for 1 s.

### 3.5 Hazards are functions of time

Every scripted hazard (sweepers, hammers, presses, tilting discs, conveyors) is a **pure function of round time plus a seed**. Server and clients compute the same transform locally, so hazards cost no bandwidth and never stutter. Only player-affected objects (balls, floes, eggs) are simulated and synced.

### 3.6 Signature mechanics (what Wobble Isles has that its genre peers don't)

The genre core (run, jump, dive, grab) is shared with every obstacle-course party game. These three mechanics are ours, and all of them grow out of the contestants being **jelly**:

| Mechanic | Status | Rule | Why it's fun |
|---|---|---|---|
| **Head Bounce** | Prototype in M1 sandbox | Every Wobbler's head is a trampoline. Land on someone and you spring up 2.0 m (3.2 m if you press jump as you land) and slide off the dome; they are squashed flat for 0.7 s and move at 45% speed. Nobody can stand on a head. | Instantly readable in a clip. Works both ways: boost a friend over a gap, or stomp past the leader. Creates "piggyback" shortcuts in race rounds. |
| **Jelly Clump** | Shipped in M4 | Two Wobblers colliding head-on hard (closing speed over 10.5 m/s, i.e. two sprinters, or dive into dive) stick together for 1.5 s and roll as one blob, steering at 40% speed. Either can mash jump 3× to split early; they pop apart at the end, then can't re-clump for 1.2 s. | Chaos pile-ups and "if I go down, you're coming with me" moments. Makes grabs and tackles near edges a real gamble. |
| **House Rules** | Shipped in M3 (4 rules); more in M4 | From round 2, before each Party round (not the Final), the player in last place spins one modifier for everybody. M3 set: **Moon Bounce** (half gravity), **Ice Age** (every floor is ice), **Turbo Traps** (hazards 35% faster), **Caramel Floors** (sticky feet). Rules that make no sense for a level are skipped (no Ice Age on water, no Turbo Traps without hazards). Later: big heads, reversed controls for the leader only. | Every show plays differently, and losing gives you power. Good for streams and replay value. |

Rules for new signature mechanics: readable in under 3 seconds of footage; usable to help **or** to troll; never removes control for more than about 1.5 s.

## 4. Round framework

Every round is a data definition plus a small amount of rule code.

```ts
interface RoundDef {
  id: string;                     // "frostbite-run"
  name: string;                   // "Frostbite Run"
  category: "race" | "survival" | "hunt" | "logic" | "team" | "asymmetric" | "final";
  island: "frost" | "candy" | "toy" | "splash" | "jungle" | "neon";
  players: { min: number; max: number; ideal: [number, number] };
  durationS: number;              // hard time limit
  failRule: "checkpoint" | "out" | "respawn";
  scoring: "finishOrder" | "survivalOrder" | "points" | "team";
  qualify?: { ratio: number };    // Show mode only
  gremlins?: boolean;             // eliminated players can act
  layout: string;                 // level file (glTF + JSON metadata)
}
```

A round **must**:
1. Explain itself in **one sentence**. This appears on the intro card, along with a 3-second looping preview.
2. Be playable, and fun, at both its `min` and `max` player counts. There is an automated bot test for each.
3. Last 60–120 s. Hard cap 150 s.
4. Give a visible goal and a visible clock.

## 5. Round catalogue

Names are working titles. ⭐ marks the M3 launch set.

### 5.1 Race

| Round | Island | Players | Summary |
|---|---|---|---|
| ⭐ **Frostbite Run** | Frost | 2–32 | An icy downhill course. The ice is slippery, so momentum matters. There are narrow ice bridges, sliding ice blocks, and a snowball cannon on the final straight. Falling sends you back to a checkpoint. |
| ⭐ **Gearworks Dash** | Toy | 2–32 | A toy-factory obstacle course. There are reverse conveyors, rhythmic stamping presses, swinging robot arms, and a sorting chute that splits the path. |
| **Bounce Castle** | Candy | 2–32 | A course of jelly bouncers and wobbling platforms. Risky shortcuts reward good bounces. |
| **Rapids** | Splash | 2–24 | Hop between rafts drifting down a fast river. Logs roll in from the banks. |

**Frostbite Run (detail)**
- **Layout:** start plaza, then an ice slope with gentle turns, then a field of sliding ice blocks moving on timed lanes, then a pair of narrow ice bridges (fast but risky) beside a wide snow path (slow and safe), then a snowball cannon gauntlet, then the finish arch.
- **Checkpoints:** 4.
- **Comedy beat:** players who over-steer slide off and chain-bump each other on the ice.
- **Tuning target:** median finish 70 s, best around 50 s.

**Gearworks Dash (detail)**
- **Layout:** a conveyor hall (belts alternate direction), then the press corridor (three presses on offset rhythms, with a safe beat visible), then robot arm sweepers, then a sorting chute (three funnels, one is a shortcut that sometimes dumps you back), then the finish.
- **Checkpoints:** 4.
- **Tuning target:** median finish 75 s.

### 5.2 Survival

| Round | Island | Players | Summary |
|---|---|---|---|
| ⭐ **Ice Floes** | Frost | 2–32 | Ice floes drift on freezing water and melt over time. Fall in and you are out; last players standing win. |
| **Tip Top** | Toy | 2–24 | Spinning discs tilt toward wherever the most weight is. Crowding one side flips it. |
| **Sweeper Storm** | Neon | 2–32 | Layered glowing sweepers, some low (jump) and some high (stay grounded or dive), speeding up over time. |

**Ice Floes (detail)**
- **Arena:** about 30 floes of three sizes on a circular lake. Floes drift slowly and bump each other.
- **Melting:** each floe has health. It melts faster while occupied, shrinks visibly in 3 stages, then sinks. New small floes surface occasionally, with a telegraphed bubble.
- **Gremlins:** fallen players control seals that bump floes. A seal can bump once every 6 s.
- **End:** the top 1/3 left standing, the time limit (90 s), or one player left. Ranked by survival order.

### 5.3 Hunt

| Round | Island | Players | Summary |
|---|---|---|---|
| ⭐ **Crown Grab** | Candy | 2–32 | One crown, and everyone wants it. Hold it to score. The holder is slower and drops it when grabbed or tackled. |
| **Tag Tails** | Jungle | 4–32 | Half the players start with tails. Grab a tail to take it. When time runs out, anyone without a tail loses. |

**Crown Grab (detail)**
- **Arena:** a candy plaza with bouncers, a sticky caramel moat, and pillars to juke around.
- **Scoring:** 1 point per 0.5 s held. The holder runs at 85% speed. A grab or dive tackle knocks the crown loose. With 12 or more players, a second crown spawns.
- **End:** 90 s. Ranked by points.
- **Comedy beat:** the whole lobby chasing one player.

### 5.4 Logic

| Round | Island | Players | Summary |
|---|---|---|---|
| **Pattern Party** | Neon | 2–32 | Symbols flash on the floor tiles. Remember them, then stand on the matching tile before the rest drop away. |
| **Odd One Out** | Toy | 2–32 | Three doors or boxes appear and one is different. Run through the right one; wrong choices drop you. |

### 5.5 Team

| Round | Island | Players | Summary |
|---|---|---|---|
| ⭐ **Gumball Goal** | Candy | 4–32 (2–4 teams) | Push a giant bouncy gumball into the opposing goal. With 6 players it is 3v3. |
| **Egg Heist** | Jungle | 4–32 (2–4 teams) | Carry eggs back to your nest. You can steal from rival nests. Points are counted at the buzzer. |

**Gumball Goal (detail)**
- **Teams:** 2 teams for up to 12 players, 3–4 teams above that.
- **Ball:** a dynamic Rapier sphere, 3 m diameter, bouncy and light. Dives push it harder.
- **End:** 120 s, or first to 3 goals. Overtime in sudden death for up to 30 s, then a draw where both teams get the losing-team stars.

### 5.6 Asymmetric (Party mode only)

| Round | Island | Players | Summary |
|---|---|---|---|
| **Claw Machine** | Toy | 3–8 | The **last-place** player controls a giant claw from above and drops grabbed contestants into the prize chute. Everyone else races to the exit. The claw earns stars per catch; runners earn stars by exit order. |

### 5.7 Final

| Round | Island | Players | Summary |
|---|---|---|---|
| ⭐ **Summit Scramble** | Frost | 2–8 | Climb a snowy mountain with rolling snowballs and avalanches. The first to touch the crown at the summit wins. Gremlins trigger avalanches. |
| **Last One Floating** | Splash | 2–8 | Tiered floating tile layers break shortly after being stepped on. The last contestant above water wins. Gremlins make waves. |

## 6. Social and comedy features

- **Emotes:** 4 slots, plus expressive faces. Contestants' faces change on their own: shocked when falling, smug when winning.
- **Fail Cam:** at the end of each round, a 4-second replay of the most dramatic fall. Ranked by fall height, number of collisions, and whether a friend caused it. Built from recorded snapshots, with no video encoding.
- **Show awards:** awards such as "Backstabber" (most friendly knock-offs), "Butterfingers" (most crown drops), "Human Bowling Ball" (most players bumped while ragdolled), "Kamikaze" (most self-inflicted falls).
- **Lobby playground:** while waiting, players can mess around in a small arena with bouncers and a ball.
- **Voice is out of scope.** Groups already use Discord or Zalo.

## 7. Progression and monetisation (later, M6+)

- Cosmetics only: costumes, hats, colours, emotes, celebrations. Earned through play.
- **No pay-to-win and no loot boxes.** Monetisation is undecided and out of scope until there is a real player base.

## 8. Technical architecture (summary)

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript monorepo (`shared/`, `server/`, `client/`) | Same simulation code on server and client, proven in Gunner 2 |
| Physics | Rapier (`@dimforge/rapier3d-compat`, WASM) | Fast, runs in Node and browsers |
| Networking | Colyseus 0.18. Server owns the room, the clock, hazards, balls, NPCs and referees every interaction | Rooms, matchmaking hooks, proven |
| Simulation | 60 Hz fixed step everywhere. 30 Hz uploads and snapshots | |
| Client netcode | **Owner-simulated movement** (decided in M2, see below). Others interpolated 100 ms behind. Time-based hazards computed locally on the server clock | Instant controls even at 250+ ms |
| Rendering | Three.js, toon shading, instanced contestants, LOD | Browser reach |
| Hosting | Phase 1: one Singapore VPS (about 30–50 ms from Vietnam). Phase 2: multiple processes and regions, Colyseus proxy, matchmaker | Latency first, then scale |
| Quality | Vitest for simulation, netcode and server rooms. Playwright for multi-client end-to-end. `tools/loadtest.ts` for 32 bots. CI on every PR | |

**Platform strategy (decided 2026-11-28):** **web first.** The browser build is the primary product (instant play via link).
Native apps come later by wrapping the same client: **Capacitor** for Android/iOS, **Tauri** for desktop/Steam.
Because mobile WebView performance is the main risk of this stack, M1 includes a **mobile performance spike**:
an island scene with 8 animated Wobblers, Rapier physics and shadows, packaged with Capacitor and run on a real mid-range Android phone.
**Gate:** a stable ≥ 50 FPS with no thermal throttling after 10 minutes keeps this stack for apps; otherwise re-evaluate the app client (e.g. Godot 4) before M4.
The design docs, rules, tuning values and glTF asset pipeline are engine-agnostic either way.

**Netcode model (decided in M2).** Each client simulates its *own* Wobbler with the shared controller and uploads its state 30×/s.
Everything that affects *another* Wobbler (tackle, shove, head bounce, grab, throw, mash, ball hit) is an interaction message
that the server checks (sender owns the source, both are within 5 m) and forwards to the Sim that owns the target, which applies it.
The server owns the clock (hazard timing), physics balls and NPC dummies.

Why not full server authority with rollback: from Vietnam to the current Helsinki cluster the round trip is about 270 ms, so
server-authoritative movement would feel sluggish, and Rapier world rollback is costly. Owner-simulated movement is what party
games in this genre typically do. The trade-off is trust: a modified client could move unrealistically. That's acceptable for
private Party rooms; Show mode (public, M6+) adds server-side plausibility checks on uploaded movement (speed, teleport, fly time).

**Measured in M2** (`npm run loadtest`, one room, bots uploading at 30 Hz, laptop CPU):

| Players | Server tick (avg / max) | Budget used | Snapshot | Download per client |
|---|---|---|---|---|
| 8 | 0.84 / 5.8 ms | 5% | 315 B | 9 KB/s |
| 32 | 1.03 / 6.0 ms | 6% | 855 B | 25 KB/s |

**Budgets:**
- Server: ≤ 4 ms simulation per tick for 32 players.
- Bandwidth: ≤ 25 KB/s per client at 32 players.
- Client: 60 FPS on integrated GPUs at 1080p "Medium".
- First load: ≤ 5 MB.

## 9. Milestones

Each milestone is one or more PRs, merged only after a real playtest.

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 Design** | This document, ART.md, ASSETS.md, repo skeleton | Owner approves |
| **M1 Feel** | Single-player sandbox: controller, jump, dive, grab and throw (with dummies), ragdoll, surfaces, 3 hazard types, camera, gamepad, tuning panel. Mobile performance spike (see §8) | "Fun to mess around in for 10 minutes" from 3 testers |
| **M2 Netcode** | Party rooms with codes and invite links, owner-simulated movement, server-refereed interactions (grab, tackle, stomp, throw) across the network, latency simulator (`?lag=`), load-test bots | 8 players smooth at 150 ms simulated latency. Measured CPU and bandwidth for 32 bots |
| **M3 Party Mode** | Lobby, Show Director, stars and catch-up (Bounty Crown, Double Down, House Rules), Gremlins, the 6 ⭐ rounds | A full 6-player show playtested, with feedback logged. Automated: full show in tests, 3- and 4-browser online runs |
| **M4 Polish** | Audio and music, UI, Fail Cam, awards, settings, touch, PWA, performance pass | Performance budgets met. A playtest show with no blocker bugs |
| **M5 Launch** | Singapore deploy, CI/CD, monitoring | Public link for friends |
| **M6+ Grow** | Show mode, matchmaking, more rounds, level editor, mobile | Driven by real usage |

## 10. Playtest protocol

After M1, M3 and every new round:
1. Play at least 3 shows with real people. Record the screen where possible.
2. Log: **laugh moments**, **frustration moments**, **idle time** per player, **confusion** (did anyone ask "what do I do?").
3. Rate each round 1–5 for fun and for clarity. Rework any round averaging below 3.5 before adding new ones.
4. Track metrics automatically: round duration, finish or fail distribution, falls per minute, grabs per minute.

## 11. Open questions

1. Monetisation model, if any (deferred to M6).
2. Account system: guest names only for Party mode. Accounts needed for Show mode and cosmetics.
3. Character artist: M4 ships three in-house procedural silhouettes (Bean, Gumdrop, Drop; 1.25 m tall). Commissioning a hero character is revisited with cosmetics (M6).
4. Licensing of the codebase (private versus open source).
5. Native app client: keep the web client wrapped (default) or switch engine, decided by the M1 mobile performance spike.

## Appendix: M4 implementation notes

- **Characters:** `WOBBLER_HALF` 0.245 makes the capsule 1.25 m tall. Body silhouettes are lathe profiles in `client/src/render/wobbler.ts`; the style travels in the roster (`style` in join/profile).
- **Audio:** `client/src/audio.ts` synthesises SFX (oscillators + filtered noise) and runs a look-ahead step sequencer (bass, plucks, drums, seeded pentatonic lead) per mood. Positional sounds pan and fade by distance from the camera.
- **Fail Cam:** each client records every Wobbler at 30 Hz during play and scores moments (falls, tackles, throws, clumps, stomps). In results it replays the best one at 0.6× with a slow orbit camera. No video, no network cost.
- **Awards:** the server counts tackles, stomps, falls, throws, hazard hits, grabs, bounties and crown time from uploaded events and picks up to four distinct awards (one per player) for the podium.
- **Jelly Clump netcode:** the owner who detects the collision sticks itself and sends a `clump` NetMsg; the partner's owner accepts it if free. Each owner then springs toward its partner; a `clumped` bit in the packed state draws the jelly bridge for everyone.
- **Ground fix:** an idle character used to creep into the floor until Rapier's controller refused to move it; grounded Wobblers are now lifted back to rest height every tick (regression test in `shared/test/ground.test.ts`).
- **Delivery:** production serves gzip with immutable caching for hashed assets; a service worker caches assets cache-first and pages network-first. First load ≈ 1.9 MB gzipped.

## Appendix: M3 implementation notes

- **Rounds are pure builders** `(seed, players) → LevelDef` in `shared/rounds.ts`; server and clients build the same level from the seed in the `show` message.
- **Each round runs on a fresh Sim** on the server and every client, on the shared server clock. Hazards are functions of `hazardTime = max(0, time − epoch) × ruleSpeed`, so they hold still through the intro and countdown and line up for everyone.
- **New hazard kinds:** `slider` (sliding block), `floe` (floating platform that carries you, shakes for 2 s, then sinks at `sinkAt`), `roller` (snowball on a path, periodic or one-shot for Gremlin avalanches).
- **Referees run on the server** from the states players upload: finish zones (race), elimination order with `failRule: "out"` (survival), crown holder with pickup/drop and a 1 s re-grab cooldown (hunt), ball-in-goal (team), summit zone (final). Results use competition ranking; ties share the better rank.
- **Spectating:** players who are out (or Gremlins, or who joined mid-round) are parked below the level and the camera follows someone still playing (Space to switch).
