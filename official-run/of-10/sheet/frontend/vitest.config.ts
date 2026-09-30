import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Single worker keeps the suite inside the memory budget, and pinning both worker
    // bounds keeps CLI overrides (for example --maxWorkers=1) from conflicting.
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
});
