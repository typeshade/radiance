// === No em dashes ===
//
// The repository's prose is written without the em dash (U+2014), as the compiler's and the
// site's are: a sentence is split, or a comma or a colon carries the pause. One in a new
// Markdown file once cost a CI round trip in a sibling repository, so this check runs before
// every commit (`scripts/commit-gate.mjs`) and in CI.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The character, spelled by code point so that this file can name the rule without breaking it. */
const EM_DASH = String.fromCharCode(0x2014);
const SKIP = new Set(['node_modules', 'vendor', '.git', '.harness', 'dist', 'LICENSE']);
const READ = /\.(md|ts|mjs|json|yml|yaml)$/;
const found = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    if (SKIP.has(name)) continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (READ.test(name)) {
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (l.includes(EM_DASH)) found.push(`${relative(process.cwd(), p)}:${i + 1}`);
      });
    }
  }
};
walk(process.cwd());
if (found.length > 0) {
  process.stderr.write(
    `em dash (U+2014) at:\n${found.join('\n')}\nSplit the sentence, or use a comma or a colon.\n`,
  );
  process.exit(1);
}
console.log('prose: no em dashes');
