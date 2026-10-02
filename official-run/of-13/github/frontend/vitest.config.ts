import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Keep a single bounded worker even when the host reports many CPUs.
    minWorkers: 1,
    maxWorkers: 1,
  },
});
