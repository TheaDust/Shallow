import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // The controller runs the suite with --maxWorkers=1; keep the worker floor
    // in sync so the pool never asks for more workers than it may create.
    minWorkers: 1,
    maxWorkers: 1,
  },
});
