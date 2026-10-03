import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // The platform runs tests with a single worker and a bounded memory budget.
    minWorkers: 1,
    maxWorkers: 1,
  },
});
