// `bun scripts/build-site.ts`: the demo page (site/) built into dist/site, which wrangler.jsonc
// serves at radiance.typeshade.dev.

import { copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

mkdirSync('dist/site', { recursive: true });
const bundle = spawnSync('bun', ['scripts/bundle.ts', 'site/main.ts', 'dist/site/main.js'], {
  stdio: 'inherit',
});
if (bundle.status !== 0) process.exit(bundle.status ?? 1);
for (const page of ['index.html', '404.html']) copyFileSync(`site/${page}`, `dist/site/${page}`);
console.log('site: dist/site/index.html, 404.html and main.js');
