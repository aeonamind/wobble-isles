// `npm run app:build`: builds the desktop app installers.
// Update bundles must be signed with the project's updater key. Locally the key lives in
// ~/.tauri/wobble-isles.key, its password in ~/.tauri/wobble-isles.key.password (CI gets both from
// the TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD secrets). Without a key the installers are still built, just without the signed update files.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const env = { ...process.env };
const args = ["tauri", "build", ...process.argv.slice(2)];
const keyFile = join(homedir(), ".tauri", "wobble-isles.key");
const passwordFile = `${keyFile}.password`;

if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(keyFile)) {
  env.TAURI_SIGNING_PRIVATE_KEY = keyFile;
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= existsSync(passwordFile) ? readFileSync(passwordFile, "utf8").trim() : "";
}
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  console.warn(`No updater key (${keyFile}): building installers without update bundles.`);
  // A file, not inline JSON: the Windows shell would strip the quotes.
  const override = join(mkdtempSync(join(tmpdir(), "wobble-")), "no-updater.json");
  writeFileSync(override, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
  args.push("--config", override);
}

// Cargo installed by rustup may not be on PATH yet in an old terminal.
const cargoBin = join(homedir(), ".cargo", "bin");
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
env[pathKey] = `${cargoBin}${process.platform === "win32" ? ";" : ":"}${env[pathKey] ?? ""}`;

const r = spawnSync("npx", args, { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
