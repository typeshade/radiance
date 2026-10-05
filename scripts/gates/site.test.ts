// The site gate must see a fault before it is trusted to see none (record 0002, "The probes":
// a still with a wrong `.sha256` fails the build). The probe copies the committed stills into a
// temporary directory and runs the check of `scripts/stills.mjs` on the copy, so the tree stays
// as it is and no browser or build is needed. These tests run in `bun run test`. The gate itself,
// which builds the site, runs as its own step of `bun run check` (`bun run gate:site`). This
// test verifies none of the decisions for the owner in record 0002, so it carries no tag for one.
import { afterAll, describe, expect, test } from 'bun:test';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exampleIds, stillPath } from '../stills.mjs';
import {
  SITE_ROOT,
  checkStills,
  copySite,
  pagesBuilt,
  probe,
  run,
  tailLines,
  wrongHash,
} from './site.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'radiance-site-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let copies = 0;
/** A new copy of the stills, to change. */
const freshCopy = () => copySite(join(scratch, String(copies++)));

/** The first example, and the paths of its still and its hash in a copy. */
function firstStill(root: string) {
  const id = exampleIds(root)[0]!;
  return { id, still: stillPath(root, id), sum: `${stillPath(root, id)}.sha256` };
}

describe('the stills of the committed tree', () => {
  test('every example has a still that matches its .sha256', () => {
    expect(exampleIds(SITE_ROOT).length).toBeGreaterThan(0);
    const result = checkStills(SITE_ROOT);
    expect(result.message).toBe('stills: every still matches its .sha256');
    expect(result.ok).toBe(true);
  });

  test('the check is not skipped by STILLS_REBASELINE', () => {
    const root = freshCopy();
    const { sum } = firstStill(root);
    writeFileSync(sum, `${wrongHash(readFileSync(sum, 'utf8').trim())}\n`);
    const saved = process.env.STILLS_REBASELINE;
    process.env.STILLS_REBASELINE = '1';
    try {
      expect(checkStills(root).ok).toBe(false);
      // The caller's value comes back, so a later test sees the environment it was given.
      expect(process.env.STILLS_REBASELINE).toBe('1');
    } finally {
      if (saved === undefined) delete process.env.STILLS_REBASELINE;
      else process.env.STILLS_REBASELINE = saved;
    }
  });
});

describe('the probe', () => {
  test('a still with a wrong .sha256 fails the check, and the probe sees it', async () => {
    await probe();
  });

  test('the probe leaves the tree as it was', async () => {
    const before = exampleIds(SITE_ROOT).map((id) =>
      readFileSync(`${stillPath(SITE_ROOT, id)}.sha256`, 'utf8'),
    );
    await probe();
    const after = exampleIds(SITE_ROOT).map((id) =>
      readFileSync(`${stillPath(SITE_ROOT, id)}.sha256`, 'utf8'),
    );
    expect(after).toEqual(before);
    expect(checkStills(SITE_ROOT).ok).toBe(true);
  });

  test('the report names the still and says how to fix it', () => {
    const root = freshCopy();
    const { id, sum } = firstStill(root);
    writeFileSync(sum, `${wrongHash(readFileSync(sum, 'utf8').trim())}\n`);
    const result = checkStills(root);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(`the still for '${id}' does not match its .sha256`);
  });

  test('a still with changed bytes fails', () => {
    const root = freshCopy();
    const { id, still } = firstStill(root);
    appendFileSync(still, Buffer.from([0]));
    const result = checkStills(root);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(`'${id}'`);
  });

  test('a still without its .sha256 fails', () => {
    const root = freshCopy();
    const { id, sum } = firstStill(root);
    unlinkSync(sum);
    const result = checkStills(root);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(`no hash for '${id}'`);
  });

  test('an example without a still fails', () => {
    const root = freshCopy();
    const { id, still } = firstStill(root);
    unlinkSync(still);
    const result = checkStills(root);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(`no still for '${id}'`);
  });
});

describe('the reader of the build output', () => {
  const output = [
    '16:39:26 [build] Complete!',
    '\u001b[32m[build] 50 page(s) built in 10.98s\u001b[39m',
    '',
  ].join('\n');

  test('the page count is the number Astro prints', () => {
    expect(pagesBuilt(output)).toBe(50);
    expect(pagesBuilt('nothing built')).toBeUndefined();
  });

  test('the tail is the last lines, without blanks or color codes', () => {
    expect(tailLines(output, 1)).toEqual(['[build] 50 page(s) built in 10.98s']);
    expect(tailLines(output, 5)).toHaveLength(2);
  });
});

describe('the gate on a build', () => {
  // The commands run in the scratch directory, which has no `dist/site` of an earlier build.
  const options = (code: string) => ({ command: [process.execPath, '-e', code], cwd: scratch });

  test('a build that exits with 0 passes, with its page count and time', async () => {
    const result = await run(options('console.log("[build] 3 page(s) built in 1.00s")'));
    expect(result.ok).toBe(true);
    expect(result.numbers.pages).toBe(3);
    expect(result.numbers.exitCode).toBe(0);
    expect(result.numbers.buildSeconds).toBeGreaterThanOrEqual(0);
    expect(result.message).toStartWith('site: built 3 pages in ');
    expect(result.message).toContain('[build] 3 page(s) built in 1.00s');
  });

  test('a build that exits with 3 fails, and the message ends with its output', async () => {
    const result = await run(
      options('console.error("[stills]\\nthe still for \'x\' does not match"); process.exit(3)'),
    );
    expect(result.ok).toBe(false);
    expect(result.numbers.exitCode).toBe(3);
    expect(result.numbers.pages).toBe(0);
    expect(result.message).toStartWith('site: the build exited with 3 after ');
    expect(result.message).toContain("the still for 'x' does not match");
  });

  test('the output keeps the order the build printed it in', async () => {
    const result = await run(
      options('console.log("first"); console.error("second"); console.log("third")'),
    );
    expect(tailLines(result.message, 3)).toEqual(['first', 'second', 'third']);
  });

  test('a build that never ends fails at the time limit', async () => {
    const result = await run({ ...options('setTimeout(() => {}, 60000)'), timeoutSeconds: 1 });
    expect(result.ok).toBe(false);
    expect(result.numbers.exitCode).toBe(-1);
    expect(result.message).toContain('could not finish');
  });

  test('a command that does not exist fails', async () => {
    const result = await run({ command: ['radiance-no-such-command'], cwd: scratch });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('could not finish');
  });

  test('the build does not see STILLS_REBASELINE', async () => {
    const saved = process.env.STILLS_REBASELINE;
    process.env.STILLS_REBASELINE = '1';
    try {
      const result = await run(
        options('console.log(`[build] ${process.env.STILLS_REBASELINE ?? "unset"}`)'),
      );
      expect(result.message).toContain('[build] unset');
    } finally {
      if (saved === undefined) delete process.env.STILLS_REBASELINE;
      else process.env.STILLS_REBASELINE = saved;
    }
  });
});
