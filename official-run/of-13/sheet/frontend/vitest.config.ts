import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Keep the worker bounds explicit so a single-worker CLI override never
    // resolves to a larger implicit minimum.
    minWorkers: 1,
    maxWorkers: 1,
  },
});
