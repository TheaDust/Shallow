import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    pool: "forks",
    // Bounded memory: one worker, no file parallelism.
    minWorkers: 1,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
