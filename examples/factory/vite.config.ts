import { defineConfig } from 'vite';
import { typeshade } from 'typeshade/vite';

// The build of the reference game: one page, the compiler's plugin and the engine by its name.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [typeshade()],
  // The project's files import the engine by its name, as a game outside this repository does.
  resolve: { alias: { radiance: new URL('../../src/index.ts', import.meta.url).pathname } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
