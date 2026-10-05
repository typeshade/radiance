// === The `*.shade.ts` loader for bun ===
//
// A host imports a shader module by its `*.shade.ts` name and gets its compiled program (the
// manifest `rt.load()` takes). In an application the compiler's Vite plugin (`typeshade/vite`)
// does that; bun has no such plugin, so this one runs the Vite plugin's own `transform` for
// `bun build` (scripts/bundle.ts) and `bun test` (bunfig.toml preloads scripts/preload.ts).
// Scripts may import the compiler; packages may not (scripts/boundary.mjs).

import { readFileSync } from 'node:fs';
import type { BunPlugin } from 'bun';
import { typeshade } from 'typeshade/vite';

export function shadePlugin(): BunPlugin {
  const vite = typeshade({ console: 'never' });
  return {
    name: 'typeshade',
    setup(build) {
      build.onLoad({ filter: /\.shade\.ts$/ }, async ({ path }) => {
        const out = await vite.transform(readFileSync(path, 'utf8'), path);
        if (out === null) throw new Error(`${path}: the typeshade plugin did not compile it`);
        return { contents: out.code, loader: 'js' };
      });
    },
  };
}
