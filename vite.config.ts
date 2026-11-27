import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: "public",
  server: { host: true, port: 5180 },
  preview: { host: true, port: 5180 },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
});
