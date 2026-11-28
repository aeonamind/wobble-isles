// Prints the CHANGELOG.md section for a version (used as the GitHub Release text).
// Usage: node tools/release-notes.mjs 0.4.0   (a leading "v" is fine)
import { readFileSync } from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (!version || start < 0) {
  console.error(`No CHANGELOG.md section for ${version || "(no version given)"}`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((l) => l.startsWith("## [") || /^\[[^\]]+\]: /.test(l));
process.stdout.write(rest.slice(0, end < 0 ? undefined : end).join("\n").trim() + "\n");
