import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/test/**/*.test.ts", "server/test/**/*.test.ts"],
    testTimeout: 15000,
    silent: false,
    environment: "node",
  },
});
