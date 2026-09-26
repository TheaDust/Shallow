import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
      },
    },
  },
});
