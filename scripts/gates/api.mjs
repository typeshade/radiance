// === The api gate: the public API of each package equals its committed bake ===
//
// Record 0002 lists this gate and record 0003 defines the bake. `bun run gate:api` bakes each
// package's "." entry again into a temporary directory and compares the result with
// `packages/<package>/__api__/surface.md`. A difference fails the gate. The fix is the bake
// (`bun run bake:api-surface`) committed in the same pull request, and the diff is the review.
//
// The convention of every gate: `run(options)` returns `{ ok, numbers, message }`, `probe()`
// throws when the gate cannot see a planted fault, and a module run directly calls `run`, prints
// the message and exits with 1 when `ok` is false. This gate needs no browser, so it runs in
// `bun run check`.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  REBAKE,
  ROOT,
  bakeSurfaces,
  publicPackages,
  surfaceFile,
  writeSurfaces,
} from '../bake-api-surface.ts';

/** The most lines of a difference the message prints. */
const MAX_LINES = 40;

/** The name a line starts with: the text before its first two spaces. */
const keyOf = (/** @type {string} */ line) => line.split('  ')[0];

/** A line cut to a length a reader can scan. */
const clip = (/** @type {string} */ line, max = 160) =>
  line.length > max ? `${line.slice(0, max)}...` : line;

/**
 * The lines that differ between a committed bake and a fresh one, one report line each:
 * `-` for a line only in the committed file, `+` for a line only in the fresh bake, and `~`
 * for a name on both sides with another type. An empty array means the two texts are equal.
 * @param {string} committed
 * @param {string} fresh
 * @returns {string[]}
 */
export function diffSurface(committed, fresh) {
  if (committed === fresh) return [];
  const left = committed.split('\n');
  const right = fresh.split('\n');
  const unmatched = new Map();
  for (const line of right) unmatched.set(line, (unmatched.get(line) ?? 0) + 1);
  const removed = [];
  for (const line of left) {
    const n = unmatched.get(line) ?? 0;
    if (n > 0) unmatched.set(line, n - 1);
    else removed.push(line);
  }
  const added = [];
  const seen = new Map();
  for (const line of left) seen.set(line, (seen.get(line) ?? 0) + 1);
  for (const line of right) {
    const n = seen.get(line) ?? 0;
    if (n > 0) seen.set(line, n - 1);
    else added.push(line);
  }
  const out = [];
  const changed = new Set();
  for (const line of removed) {
    const twin = added.find((a) => keyOf(a) === keyOf(line) && !changed.has(a));
    if (twin === undefined) {
      out.push(`- ${clip(line)}`);
      continue;
    }
    changed.add(twin);
    let at = 0;
    while (at < line.length && at < twin.length && line[at] === twin[at]) at++;
    const from = Math.max(0, at - 30);
    const excerpt = (/** @type {string} */ s) =>
      `${from > 0 ? '...' : ''}${s.slice(from, from + 120)}${s.length > from + 120 ? '...' : ''}`;
    out.push(
      `~ ${keyOf(line)}`,
      `    committed: ${excerpt(line)}`,
      `    fresh:     ${excerpt(twin)}`,
    );
  }
  for (const line of added) if (!changed.has(line)) out.push(`+ ${clip(line)}`);
  if (out.length === 0) out.push('the same lines, in another order');
  return out;
}

/**
 * Bakes again and compares with the committed files.
 * @param {{ root?: string, committedRoot?: string }} [options] `root` is the tree to bake
 * (default: this repository). `committedRoot` is the tree that holds the files to compare with
 * (default: `root`).
 * @returns {Promise<{ ok: boolean, numbers: Record<string, number>, message: string }>}
 */
export async function run(options = {}) {
  const root = options.root ?? ROOT;
  const committedRoot = options.committedRoot ?? root;
  const scratch = mkdtempSync(join(tmpdir(), 'radiance-api-'));
  try {
    const surfaces = bakeSurfaces(root);
    writeSurfaces(surfaces, scratch);
    const numbers = { packages: surfaces.length, exports: 0, differing: 0 };
    const report = [];
    for (const s of surfaces) {
      const file = surfaceFile(s.dir);
      numbers.exports += s.exports.length;
      numbers[s.dir] = s.exports.length;
      const committedPath = join(committedRoot, file);
      if (!existsSync(committedPath)) {
        numbers.differing++;
        report.push(`${file} is missing.`);
        continue;
      }
      // A checkout that converts line endings must not fail the gate.
      const committed = readFileSync(committedPath, 'utf8').replace(/\r\n/g, '\n');
      const diff = diffSurface(committed, readFileSync(join(scratch, file), 'utf8'));
      if (diff.length > 0) {
        numbers.differing++;
        report.push(`${file} differs from a fresh bake:`, ...diff.map((l) => `  ${l}`));
      }
    }
    if (numbers.differing === 0) {
      const counts = surfaces.map((s) => `${s.name}: ${s.exports.length} exports`).join(', ');
      return {
        ok: true,
        numbers,
        message: `api: the committed bake equals a fresh bake (${counts})`,
      };
    }
    const shown = report.slice(0, MAX_LINES);
    if (report.length > shown.length)
      shown.push(`... and ${report.length - shown.length} more lines`);
    return {
      ok: false,
      numbers,
      message: [
        `api: ${numbers.differing} of ${numbers.packages} packages differ from their committed bake`,
        ...shown,
        `If the change to the exports is intended, run \`${REBAKE}\` and commit the files.`,
      ].join('\n'),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Runs the gate once wrong on purpose: the committed bake of the first package with one export
 * line removed. The gate must report that package, and name the line. It throws when it does
 * not, so a gate that cannot see a removed line is not trusted to pass.
 */
export async function probe() {
  const scratch = mkdtempSync(join(tmpdir(), 'radiance-api-probe-'));
  try {
    let planted = '';
    for (const pkg of publicPackages()) {
      const file = surfaceFile(pkg.dir);
      if (!existsSync(join(ROOT, file))) throw new Error(`api probe: ${file} is missing`);
      let text = readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
      if (planted === '') {
        const lines = text.split('\n');
        const first = lines.indexOf('```') + 1;
        if (first === 0 || lines[first] === '```')
          throw new Error(`api probe: ${file} lists no export`);
        planted = keyOf(lines[first]);
        lines.splice(first, 1);
        text = lines.join('\n');
      }
      mkdirSync(dirname(join(scratch, file)), { recursive: true });
      writeFileSync(join(scratch, file), text);
    }
    const result = await run({ committedRoot: scratch });
    if (result.ok) throw new Error('api probe: the gate passed with one export line removed');
    if (result.numbers.differing !== 1 || !result.message.includes(planted)) {
      throw new Error(
        `api probe: the gate failed, but it did not name "${planted}":\n${result.message}`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const result = await run();
  console.log(result.message);
  if (!result.ok) process.exit(1);
}
