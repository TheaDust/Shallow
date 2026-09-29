import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    minWorkers: 1,
    maxWorkers: 1,
    setupFiles: ["./src/test/setup.ts"],
  },
});
