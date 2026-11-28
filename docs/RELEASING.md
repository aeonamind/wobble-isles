# Releasing Wobble Isles

## Versions

- **One version for the whole game:** web client, desktop app and server. They ship together because they share the network protocol.
- **[Semantic Versioning](https://semver.org):** `0.MINOR.0` for a milestone or a feature release, `0.x.PATCH` for fixes. `1.0.0` is the public launch.
- **Single source of truth:** `version` in `package.json`.
  - `npm version` copies it to `src-tauri/Cargo.toml` and `Cargo.lock` (`tools/sync-version.mjs`).
  - `tauri.conf.json` reads `package.json` directly.
  - The client shows it in the menu and Settings (`__APP_VERSION__`).
  - The server reports it at `/health`.
- **`CHANGELOG.md`:** write each change under `## [Unreleased]` as you merge it. The release turns that section into the version's notes.

## Protocol version (old apps vs new servers)

The web game always matches its server, because the server serves the page. The desktop app can be older than the server.

- **What it is:** `PROTOCOL_VERSION` in `shared/protocol.ts`. Clients send it when they join.
- **What happens on a mismatch:** the server refuses the join with code `VERSION_MISMATCH` (4426).
  - The app says "Update the app to play" and offers the update.
  - A browser tab reloads once to fetch the new page.
- **Bump it when** client ⇄ server messages or the shared simulation change in a way an older client can't follow, for example:
  - new or changed message fields;
  - packed state layout;
  - tuning or physics that both sides simulate.

  Pure client changes (UI, audio, art) and server-only changes don't need a bump.
- **Bumping it** kicks every older app until it updates, so release the new app and the new server together.

## Cutting a release

`main` only changes through PRs, so the release commit does too:

```bash
git fetch && git checkout -b release/v0.5.0 origin/main
# CHANGELOG.md: make sure [Unreleased] lists everything
npm version minor          # or patch / major / 0.5.0 → commit "Release v0.5.0" + local tag v0.5.0
git push -u origin release/v0.5.0      # branch only, not the tag yet
# open the PR and merge it with a merge commit (not squash, which would leave the tagged commit off main)
git push origin v0.5.0                  # now publish
```

The tag starts `.github/workflows/release.yml`:

1. **prepare:**
   - checks that the tag matches `package.json` and `Cargo.toml`;
   - runs typecheck and tests;
   - creates a draft GitHub Release with the CHANGELOG section.
2. **app:** builds the installers on Windows, macOS and Linux. Each upload includes:
   - NSIS `.exe` and `.msi` (Windows), `.dmg` (macOS), `.AppImage` and `.deb` (Linux);
   - signed update bundles and `latest.json`.
3. **docker:** pushes the server image to Docker Hub as `:<version>` and `:latest`.
4. **publish:** makes the release public once every installer is uploaded.

Installed apps check `releases/latest/download/latest.json` when the menu opens, and offer the update.

**Test build without releasing:** Actions → Release → Run workflow. The installers become run artifacts; nothing is published.

**Local build:** `npm run app:build`. It signs update bundles with `~/.tauri/wobble-isles.key` if that file exists.

## One-time setup (repository settings)

| Where | Name | Value |
|---|---|---|
| Secrets | `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/wobble-isles.key` (the updater signing key) |
| Secrets | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Empty (the key has no password); the secret can be left out |
| Secrets | `DOCKERHUB_USERNAME` | Docker Hub user |
| Secrets | `DOCKERHUB_TOKEN` | Docker Hub access token (Account settings → Personal access tokens, Read & Write) |
| Variables | `DOCKERHUB_REPO` | e.g. `yourname/wobble-isles`; the docker job is skipped while unset |
| Variables | `APP_SERVER_URL` | Default server baked into the app, e.g. `wss://play.example.com` (after M5) |

**Back up the updater key.** Its public half is in `tauri.conf.json`, and every installed app only accepts updates signed by it. If the key is lost, existing installs can never auto-update again: players would have to reinstall by hand.

## Retagging history

Milestones before versioning were tagged after the fact:

| Tag | Commit |
|---|---|
| `v0.1.0` | M1 merge |
| `v0.2.0` | M2 merge |
| `v0.3.0` | M3 merge |

These are plain tags with no release builds.
