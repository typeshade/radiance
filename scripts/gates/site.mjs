// === The site gate: the site builds from the tree, with the stills' hashes checked ===
//
// Record 0002 lists this gate. Pull request #5 passed CI and then failed the deploy of `main`,
// because the build needed a file that another job had generated. `bun run gate:site` builds the
// site from the tree (`bun run site`: `bun run sync`, then `astro build` into `dist/site`). The
// build runs `verifyStills` of `scripts/stills.mjs` (the `radiance:stills` hook in
// `site/astro.config.mjs`), so a still with a wrong `.sha256` fails the build.
//
// The convention of every gate: `run(options)` returns `{ ok, numbers, message }`, `probe()`
// throws when the gate cannot see a planted fault, and a module run directly calls `run`, prints
// the message and exits with 1 when `ok` is false. This gate needs no browser, so it runs in
// `bun run check`. It is not in `scripts/commit-gate.mjs`, because the build takes too long for a
// commit.
//
// `run(options)` answers `{ ok, numbers, message }`. `ok` is true when the build exits with 0.
// `numbers`:
//
//   buildSeconds  the wall time of the build, in seconds.
//   pages         the pages the build wrote.
//   exitCode      the exit code of the build, or -1 when a signal or a timeout ended it.
//
// `message` holds the last lines of the build output. The gate removes `STILLS_REBASELINE` from
// the environment of the build, so the hashes are always checked.
//
// `probe()` copies the committed stills into a temporary directory, gives one a wrong `.sha256`
// and runs the check of `scripts/stills.mjs` on the copy. It throws when the check passes, or
// when its report does not name the still. The probe never changes the tree.
//
// Options: `command` is the argument list of the build (default `bun run site`). `cwd` is the
// directory the build runs in (default: this repository). `timeoutSeconds` stops a build that
// hangs (default 600).

import { spawnSync } from 'node:child_process';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exampleIds, stillPath, verifyStills } from '../stills.mjs';

/** The root of this repository. */
export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The site's own root: the directory `verifyStills` reads. */
export const SITE_ROOT = join(ROOT, 'site');

/** The command that builds the site. `package.json` names it `site`. */
export const BUILD = ['bun', 'run', 'site'];

/** The most lines of the build output that a passing and a failing message print. */
const TAIL_OK = 6;
const TAIL_FAILED = 30;

/** The terminal color codes that CI makes the build print. */
const COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * The number of pages the build reports: the `N page(s) built` line of Astro. It is undefined
 * when the output has no such line.
 * @param {string} output
 * @returns {number | undefined}
 */
export function pagesBuilt(output) {
  const found = /(\d+) page\(s\) built/.exec(output);
  return found === null ? undefined : Number(found[1]);
}

/**
 * The last `count` lines of an output that are not blank, without color codes.
 * @param {string} output
 * @param {number} count
 * @returns {string[]}
 */
export function tailLines(output, count) {
  return output
    .replace(COLOR, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-count);
}

/** The `.html` files below a directory: the pages the build wrote. 0 when there is none. */
function countPages(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.html')).length;
}

/**
 * Builds the site and answers whether the build exited with 0.
 * @param {{ command?: string[], cwd?: string, timeoutSeconds?: number }} [options]
 * @returns {Promise<{ ok: boolean, numbers: Record<string, number>, message: string }>}
 */
export async function run(options = {}) {
  const [file, ...args] = options.command ?? BUILD;
  const cwd = options.cwd ?? ROOT;
  // The switch that skips the hash check is for the build `capture:stills` captures from.
  const { STILLS_REBASELINE: _skipped, ...env } = process.env;
  // One file takes both streams, so the lines stay in the order the build printed them.
  const scratch = mkdtempSync(join(tmpdir(), 'radiance-site-build-'));
  try {
    const log = join(scratch, 'build.log');
    const fd = openSync(log, 'w');
    const started = performance.now();
    const build = spawnSync(file, args, {
      cwd,
      env,
      stdio: ['ignore', fd, fd],
      timeout: (options.timeoutSeconds ?? 600) * 1000,
      shell: process.platform === 'win32',
    });
    const seconds = Math.round(((performance.now() - started) / 1000) * 10) / 10;
    closeSync(fd);
    return judge(build, readFileSync(log, 'utf8'), seconds, cwd);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The answer of the gate for a finished build.
 * @param {import('node:child_process').SpawnSyncReturns<unknown>} build
 * @param {string} output
 * @param {number} seconds
 * @param {string} cwd
 * @returns {{ ok: boolean, numbers: Record<string, number>, message: string }}
 */
function judge(build, output, seconds, cwd) {
  const exitCode = build.status ?? -1;
  const ok = build.error === undefined && exitCode === 0;
  // A stale `dist/site` of an earlier build is not the pages of a build that failed.
  const pages = pagesBuilt(output) ?? (ok ? countPages(join(cwd, 'dist', 'site')) : 0);
  const numbers = { buildSeconds: seconds, pages, exitCode };
  if (ok) {
    return {
      ok,
      numbers,
      message: [`site: built ${pages} pages in ${seconds} s`, ...tailLines(output, TAIL_OK)].join(
        '\n',
      ),
    };
  }
  const why =
    build.error !== undefined
      ? `could not finish (${build.error.message})`
      : `exited with ${exitCode}`;
  return {
    ok,
    numbers,
    message: [`site: the build ${why} after ${seconds} s`, ...tailLines(output, TAIL_FAILED)].join(
      '\n',
    ),
  };
}

/**
 * The check of `scripts/stills.mjs` on one site root, with its rebaseline switch off. The switch
 * would make the check pass with nothing read, so this function never lets it through.
 * @param {string} siteRoot
 * @returns {{ ok: boolean, message: string }}
 */
export function checkStills(siteRoot) {
  const saved = process.env.STILLS_REBASELINE;
  delete process.env.STILLS_REBASELINE;
  try {
    verifyStills(siteRoot);
    return { ok: true, message: 'stills: every still matches its .sha256' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (saved !== undefined) process.env.STILLS_REBASELINE = saved;
  }
}

/**
 * A copy of what `verifyStills` reads, in a new directory below `parent`: an empty file for each
 * example (the check reads their names) and the committed stills with their hashes. It answers
 * the root of the copy.
 * @param {string} parent
 * @returns {string}
 */
export function copySite(parent) {
  const root = join(parent, 'site');
  mkdirSync(join(root, 'examples'), { recursive: true });
  for (const id of exampleIds(SITE_ROOT)) writeFileSync(join(root, 'examples', `${id}.ts`), '');
  cpSync(join(SITE_ROOT, 'public', 'stills'), join(root, 'public', 'stills'), { recursive: true });
  return root;
}

/** A hash that differs from `hash` in its first digit. */
export const wrongHash = (/** @type {string} */ hash) =>
  hash.replace(/^./, (c) => (c === '0' ? '1' : '0'));

/**
 * Runs the check once wrong on purpose: the first example's still with a wrong `.sha256`, in a
 * copy. The check must pass on the copy before the fault, fail after it, and name the example.
 * It throws when it does not, so a gate that cannot see a wrong hash is not trusted to pass.
 */
export async function probe() {
  const scratch = mkdtempSync(join(tmpdir(), 'radiance-site-probe-'));
  try {
    const root = copySite(scratch);
    const before = checkStills(root);
    if (!before.ok)
      throw new Error(`site probe: the copy fails before the fault is planted:\n${before.message}`);
    const [id] = exampleIds(root);
    if (id === undefined) throw new Error('site probe: the site has no example');
    const sum = `${stillPath(root, id)}.sha256`;
    writeFileSync(sum, `${wrongHash(readFileSync(sum, 'utf8').trim())}\n`);
    const after = checkStills(root);
    if (after.ok) throw new Error('site probe: the check passed with a wrong .sha256');
    if (!after.message.includes(`'${id}'`)) {
      throw new Error(
        `site probe: the check failed, but it did not name '${id}':\n${after.message}`,
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
