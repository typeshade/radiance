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

  it('doorstopSees hides hidden paths and ignored words', () => {
    expect(doorstopSees('.github/workflows/ci.yml')).toBe(false);
    expect(doorstopSees('packages/radiance/src/kernels/determinism.test.ts')).toBe(true);
    expect(doorstopSees('site/dist/x.ts')).toBe(false);
  });
});
