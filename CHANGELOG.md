# Changelog

All notable changes to Wobble Isles. Versions follow [Semantic Versioning](https://semver.org):
one version for the whole game (web client, desktop app and server). How to cut a release: [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Added
- Three character silhouettes (Bean, Gumdrop, Drop) and 8 colours, picked in the menu; Wobblers are now 1.25 m tall.
- Procedural music (lobby, rounds, Final) and sound effects, synthesised live with Web Audio.
- Settings panel (Esc or ⚙): volumes, camera sensitivity, invert Y, reduce motion, Fail Cam, graphics quality, leave room.
- Fail Cam: a slow-motion replay of the round's most dramatic moment while results are shown.
- Show awards on the podium (Bulldozer, Head Hopper, Crown Thief, Royalty, Gravity's Best Friend…).
- Jelly Clump: two Wobblers colliding head-on hard stick together for 1.5 s.
- Touch controls for phones and tablets; the web game is installable (PWA).
- Desktop app for Windows, macOS and Linux (Tauri) with a server picker and automatic updates.
- Version shown in the menu and settings; the server turns away clients on a different protocol version and asks them to update.

### Fixed
- A Wobbler standing still for a few seconds could sink into the floor and get stuck.

## [0.3.0] - 2026-11-28 · M3 Party mode
### Added
- A full Party show: lobby, up to 5 rounds picked by the Show Director, stars, and a Final.
- Six rounds: Frostbite Run, Gearworks Dash, Ice Floes, Crown Grab, Gumball Goal, Summit Scramble.
- Catch-up rules: Bounty Crown, Double Down, House Rules (Moon Bounce, Ice Age, Turbo Traps, Caramel Floors).
- Gremlins: players outside the Final roll avalanches down the mountain.

## [0.2.0] - 2026-11-28 · M2 Online
### Added
- Online rooms with 4-letter codes and invite links, for up to 32 players.
- Owner-simulated netcode with interpolation; the server referees interactions.
- Head Bounce: land on someone's head to spring up.

## [0.1.0] - 2026-11-28 · M1 Feel sandbox
### Added
- Run, jump, dive, grab and throw; ragdolls; ice, bouncers, conveyors and sticky floors; gamepad support.
- Toon renderer with automatic graphics quality, and an in-game tuning panel.

[Unreleased]: https://github.com/aeonamind/wobble-isles/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/aeonamind/wobble-isles/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/aeonamind/wobble-isles/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aeonamind/wobble-isles/releases/tag/v0.1.0
