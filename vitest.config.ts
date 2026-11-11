import { defineConfig } from 'vitest/config';
import { typeshade } from 'typeshade/vite';

// The plugin compiles each `.shade.ts` a test imports into the module a host gets (compiler
// surface §64): the CPU tier of its functions and classes. The tests run on the CPU tier, with no
// device and no browser (design record 0100, invariant 2).
export default defineConfig({
  plugins: [typeshade()],
  test: { include: ['test/**/*.test.ts', 'examples/**/*.test.ts'] },
});
