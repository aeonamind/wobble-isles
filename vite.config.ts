import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  root: "client",
  publicDir: "public",
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { host: true, port: 5180 },
  preview: { host: true, port: 5180 },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
});
