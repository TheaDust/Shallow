import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Both bounds are set so the forks pool never receives only one of them
    // (a lone maxWorkers would conflict with the default minimum).
    minWorkers: 1,
    maxWorkers: 1,
  },
});
