import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // The platform runs a bounded single worker; keep min and max aligned so the
    // pool never resolves conflicting thread counts.
    minWorkers: 1,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
