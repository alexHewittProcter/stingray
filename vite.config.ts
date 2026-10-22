import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served from https://alexhewittprocter.github.io/stingray/ on GitHub Pages (.github/workflows/deploy.yml)
  base: '/stingray/',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        model: fileURLToPath(new URL('./model.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
