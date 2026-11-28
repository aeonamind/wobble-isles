// Runs inside `npm version <patch|minor|major|x.y.z>` (the "version" lifecycle script), after
// package.json has the new version and before npm commits and tags it:
//  - copies the version into src-tauri/Cargo.toml and Cargo.lock (tauri.conf.json reads package.json)
//  - turns CHANGELOG.md's "Unreleased" section into the new version's section
//  - stages the files so they land in npm's "Release vX.Y.Z" commit.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, "utf8").replace(/\r\n/g, "\n")));

edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = ".*"$/m, `version = "${version}"`));
edit("src-tauri/Cargo.lock", (s) => s.replace(/(\[\[package\]\]\nname = "wobble-isles"\nversion = )".*"/, `$1"${version}"`));

edit("CHANGELOG.md", (s) => {
  if (s.includes(`## [${version}]`)) return s;
  const prev = s.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
  const unreleased = s.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## \[)/)?.[1].trim();
  if (!unreleased) {
    console.error("CHANGELOG.md: write what changed under ## [Unreleased] first.");
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  const repo = "https://github.com/aeonamind/wobble-isles";
  return s
    .replace("## [Unreleased]\n", `## [Unreleased]\n\n## [${version}] - ${today}\n`)
    .replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${repo}/compare/v${version}...HEAD\n[${version}]: ${repo}/compare/v${prev}...v${version}`);
});

execFileSync("git", ["add", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "CHANGELOG.md"], { stdio: "inherit" });
console.log(`Wobble Isles ${version}: Cargo.toml, Cargo.lock and CHANGELOG.md updated.`);
