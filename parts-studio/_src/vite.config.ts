import { defineConfig } from 'vite';

// The built site is written to the parent folder (parts-studio/) so that the
// existing GitHub Pages site of this repository serves it at /parts-studio/.
export default defineConfig({
  base: './',
  resolve: { dedupe: ['three'] },
  build: {
    outDir: '..',
    emptyOutDir: false,
    assetsDir: 'assets',
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
  },
});
