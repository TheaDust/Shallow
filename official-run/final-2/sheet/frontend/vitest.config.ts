import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Keep a single worker so the suite stays within the bounded test memory.
    minWorkers: 1,
    maxWorkers: 1,
  },
});
