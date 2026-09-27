import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: false,
    poolOptions: {
      forks: {
        // keep minForks low so the single-worker (--maxWorkers=1) mode used
        // by the test runner does not conflict with Tinypool's sizing
        minForks: 1,
      },
    },
  },
});
