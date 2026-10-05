// === The prose follows ASD-STE100: the structural rules, checked by the asd-ste100 skill's linter ===
//
// Every document in this tree is written in Simplified Technical English (CLAUDE.md, "Writing and
// configuration management"). The `asd-ste100` skill (`.agents/skills/asd-ste100`, pinned by
// `skills-lock.json`) carries the rules and a linter for the ones a script can check: no semicolon,
// a sentence of at most 25 words (20 in a numbered step), no phrasal verb, no nominalization, no
// marketing adjective, one word for one thing. This script runs that linter over the documents and
// fails on any hard violation. Passive voice and compound tenses are advisory and never fail it.
//
// What it does not read: the compiler (`vendor/`), the installed skills (`.agents/`, `.claude/`),
// the design documents the design skills own (`DESIGN.md`, `PRODUCT.md`, `.impeccable/`, kept as
// they arrive), the items `reqs/` derives from the design records, and the API reference the site
// generates. In an `.mdx` page the `import` and `export` lines are code and are stripped first.

import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const LINTER = '.agents/skills/asd-ste100/scripts/ste-lint.py';
const SKIP =
  /^(vendor|\.agents|\.claude|\.impeccable|reqs|site\/src\/content\/docs\/api)\/|^(DESIGN|PRODUCT|LICENSE)\.md$/;

const files = execFileSync('git', ['ls-files', '*.md', '*.mdx'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !SKIP.test(f));

const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
if (python.error) {
  console.log('ste: python3 not found, so this check did not run (CI runs it)');
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), 'ste-'));
const args = files.map((f) => {
  if (!f.endsWith('.mdx')) return f;
  const copy = join(scratch, f);
  mkdirSync(dirname(copy), { recursive: true });
  const text = readFileSync(f, 'utf8')
    .split('\n')
    .map((l) => (/^(import|export) /.test(l) ? '' : l))
    .join('\n');
  writeFileSync(copy, text);
  return copy;
});

const run = spawnSync('python3', [LINTER, ...args], { encoding: 'utf8' });
rmSync(scratch, { recursive: true, force: true });
const out = `${run.stdout}${run.stderr}`.replaceAll(`${scratch}/`, '');
if (run.status !== 0) {
  // The report keeps the hard violations and the summary; the advisory lines are noise here.
  const hard = out.split('\n').filter((l) => !/ (passive-voice|present-perfect): /.test(l));
  process.stderr.write(
    `${hard.join('\n').trim()}\n\nRewrite each flagged sentence as the asd-ste100 skill says (.agents/skills/asd-ste100/SKILL.md).\n`,
  );
  process.exit(1);
}
const summary = out.split('\n').find((l) => /violations/.test(l)) ?? '';
console.log(`ste: ${files.length} documents, ${summary.trim()}`);
