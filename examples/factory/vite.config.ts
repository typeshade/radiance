import { defineConfig } from 'vite';
import { typeshade } from 'typeshade/vite';

// The build of the reference game: one page, the compiler's plugin and nothing else.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [typeshade()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
