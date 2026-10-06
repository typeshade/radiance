// === The traceability tree under reqs/ is the design records as they are written, and every link holds ===
//
// `scripts/reqs-sync.ts` derives reqs/ from docs/design/. Doorstop (CI's traceability job) checks
// fingerprints, suspect links and the references it can see. This file is the half that needs no
// Python:
//
//   1. reqs/ is not stale: a record edited without `bun run reqs:sync` fails here, before Doorstop
//      sees the old text and calls it reviewed.
//   2. Every verifying file of every decision still carries its tag, including the files Doorstop
//      cannot see (`doorstopSees`).
//
// SANITY FIRST: the parser is asserted to have seen every record and every decision the records
// have, so a parser that silently stopped matching cannot pass the checks below on an empty tree.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  buildRecords,
  decUid,
  decisionTexts,
  doorstopListHazard,
  doorstopSees,
  recordFiles,
  stale,
  tagOf,
} from './reqs-sync.ts';

const records = buildRecords();

describe('sanity: the tree reads every record', () => {
  it('finds each record file and its id', () => {
    const files = recordFiles();
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(records.map((r) => r.file)).toEqual(files);
    expect(records.map((r) => r.id)).toEqual(
      files.map((f) => f.slice('docs/design/'.length, 'docs/design/'.length + 4)),
    );
  });

  it('reads every numbered decision of every record', () => {
    for (const r of records) {
      const md = readFileSync(join(ROOT, r.file), 'utf8');
      const numbered = md
        .slice(md.indexOf('## Decisions for the owner'), md.indexOf('## Record'))
        .match(/^\d+\. /gm);
      expect(numbered?.length, r.file).toBe(r.decisions.length);
      expect(decisionTexts(md).length, r.file).toBeGreaterThan(0);
      expect(r.decisions.map((d) => d.uid)).toEqual(r.decisions.map((_, i) => decUid(r.id, i + 1)));
    }
  });

  it('cites every record from at least one document', () => {
    for (const r of records) expect(r.references.length, r.file).toBeGreaterThan(0);
  });
});

describe('reqs/', () => {
  it('is derived from the records as committed (bun run reqs:sync)', () => {
    expect(stale()).toEqual([]);
  });

  it('every verifying file still carries its tag, seen by Doorstop or not', () => {
    for (const r of records) {
      for (const d of r.decisions) {
        for (const f of [...d.references, ...d.evidence]) {
          expect(readFileSync(join(ROOT, f), 'utf8'), `${f} for ${d.uid}`).toContain(
            tagOf(r.id, d.number),
          );
        }
        for (const f of d.references) expect(doorstopSees(f), f).toBe(true);
        for (const f of d.evidence) expect(doorstopSees(f), f).toBe(false);
      }
    }
  });

  it('no item text starts an indented list, which hangs Doorstop 3.2 publish', () => {
    // The JSDoc block that hung CI's traceability job on typeshade/radiance#14.
    const jsdoc = [
      '```ts',
      '  /** uv per vertex, v = 1 at the top of a plane and at a',
      "   *  sphere's north pole. Absent: every uv is 0. */",
      '```',
      '',
    ].join('\n');
    expect(doorstopListHazard(jsdoc)).toBe("   *  sphere's north pole. Absent: every uv is 0. */");
    expect(doorstopListHazard('- a list at the margin\n  - nested under it\n\ntext')).toBeNull();
    expect(doorstopListHazard('1. a step\n   1. a nested step\n2. a step')).toBeNull();
    expect(doorstopListHazard('text\n\n   - a list that starts indented\n')).toBe(
      '   - a list that starts indented',
    );
    for (const r of records) {
      expect(doorstopListHazard(r.text), r.uid).toBeNull();
      for (const d of r.decisions) expect(doorstopListHazard(d.text), d.uid).toBeNull();
    }
  });

  it('a list of the other kind does not open an indented list (typeshade/radiance#29)', () => {
    // The TLAS bullet of record 0001 at 387c520, word for word. Its four steps, indented two
    // spaces under a bullet with no blank line between, hung `doorstop publish all` in CI: the
    // publisher keeps the state of bullets and of steps apart, so the bullet opened nothing for
    // the steps. The probe that showed this ran Doorstop 3.2's HTML and LaTeX publishers.
    const lead = [
      '- The TLAS uses the same builder over instance boxes, one primitive per instance, with the',
      '  same leaf size, so a TLAS of 4 or fewer instances is one leaf. It differs in one rule: no TLAS',
      '  leaf holds more than 4 instances, so it splits every node of more than 4 (`buildTlas` in',
      '  `bvh.ts`). It splits such a node as follows:',
    ];
    const steps = [
      '  1. Bin the instances on the longest axis of their centroid box, as for a BLAS. Find the split',
      "     of least cost. The leaf's cost does not count.",
      '  2. Take that split when its larger side can reach leaves of 4 by depth 30. A side of m',
      "     instances can when the child's depth, plus the halvings from m down to 4 or fewer, is at",
      '     most 30. Each halving rounds up.',
      '  3. Otherwise split at the median. Do the same when the centroids lie at one point, or when no',
      '     bin split separates the instances.',
      "  4. The median split sorts the node's instances by centroid on the longest axis, ties by",
      '     instance index. The first half, rounded down, goes to the left child. A median split halves',
      '     the count, so the depth stays at 30 or under.',
    ];
    const after = [
      '- `bvh.test.ts` holds it: every primitive in exactly one leaf. Every box contains its',
      "  primitives' boxes.",
    ];
    const hung = [...lead, ...steps, ...after].join('\n');
    expect(doorstopListHazard(hung)).toBe(steps[0]!);

    // The near miss: the same words, as the fix wrote them. A blank line closes the bullet, and the
    // steps start at the margin. Doorstop publishes this in under a second.
    const flat = [...lead, '', ...steps.map((l) => l.slice(2)), '', ...after].join('\n');
    expect(doorstopListHazard(flat)).toBeNull();
    // A bullet nested under a bullet, and a step under a step, stay one kind and pass.
    expect(doorstopListHazard([...lead, '  - a nested bullet', ...after].join('\n'))).toBeNull();
    // A list at the margin opens nothing for the steps even when no blank line comes between.
    expect(
      doorstopListHazard([...lead, ...steps.map((l) => l.slice(2)), ...after].join('\n')),
    ).toBeNull();
  });

  it('steps hold no bullet at an indent, and a fence does not hide one', () => {
    // The other order of #29: Doorstop 3.2 hangs on it too, and the first guard let it pass.
    expect(doorstopListHazard('1. a step\n   - a nested bullet\n2. a step')).toBe(
      '   - a nested bullet',
    );
    // A bullet at the margin does not open the code inside a fence that follows it.
    expect(doorstopListHazard('- a bullet\n```ts\n/** a\n * b */\n```')).toBe(' * b */');
    // A marker with no text opens nothing, because Markdown reads no list item there.
    expect(doorstopListHazard('- \n  - a bullet')).toBe('  - a bullet');
    // A blank line closes both kinds, so a list that starts again at the margin is fine.
    expect(doorstopListHazard('- a bullet\n\n1. a step\n2. a step\n\n- a bullet')).toBeNull();
  });

  it('doorstopSees hides hidden paths and ignored words', () => {
    expect(doorstopSees('.github/workflows/ci.yml')).toBe(false);
    expect(doorstopSees('packages/radiance/src/kernels/determinism.test.ts')).toBe(true);
    expect(doorstopSees('site/dist/x.ts')).toBe(false);
  });
});
