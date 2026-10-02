import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // Pinned so that an external --maxWorkers hint cannot leave minThreads above
    // maxThreads (vitest 2.1 derives minThreads from minForks/minWorkers only).
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        minForks: 1,
        maxForks: 1,
      },
    },
  },
});
