import { defineConfig } from 'vitest/config';
import { typeshade } from 'typeshade/vite';

// The harness: the checks that need a browser with a GPU. It builds the reference game, opens
// it in headless Chromium and holds what the GPU computed to the CPU tier. `bun run test` does
// not run these files, so the tests of the engine need no browser.
export default defineConfig({
  plugins: [typeshade()],
  resolve: { alias: { radiance: new URL('./src/index.ts', import.meta.url).pathname } },
  test: { include: ['examples/**/*.harness.ts'], testTimeout: 120_000, hookTimeout: 180_000 },
});
