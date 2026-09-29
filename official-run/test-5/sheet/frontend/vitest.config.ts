import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    minWorkers: 1,
    maxWorkers: 1,
  },
});
