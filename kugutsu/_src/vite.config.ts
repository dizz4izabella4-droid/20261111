import { defineConfig } from 'vite';

// The built site is written to the parent folder (photo-tex/) so that the
// existing GitHub Pages site of this repository serves it at /photo-tex/.
export default defineConfig({
  base: './',
  build: {
    outDir: '..',
    emptyOutDir: false,
    assetsDir: 'assets',
    target: 'es2022', // top-level await in main.ts
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
  },
});
