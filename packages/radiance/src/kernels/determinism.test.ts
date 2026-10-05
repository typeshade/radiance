// The determinism lint (design record 0005, "The lint", with record 0002, step 3). It compiles
// every `*.shade.ts` under `src/kernels` and reads `compile().determinism`, the compiler's list of
// the operations whose result may differ by driver (surface section 38). Each row must be in the
// allowlist below, or be an `absolute` row that only a value-only function holds. A row outside both
// fails the test with its operation, kind, accuracy and functions.
//
// The two lists are edited only with record 0005 amended. A pull request that adds a row cites the
// rule of the record it keeps.
//
// Verifies: Design 0005.3

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, type DeterminismEntry } from 'typeshade';

/** Operations the kernels may use anywhere (bounded, inherited, or exact on both targets). */
const ALLOWED = [
  '/',
  'sqrt',
  'inverseSqrt',
  'normalize',
  'length',
  'dot',
  'cross',
  'mix',
  'fma',
  'exp2',
  'pow',
  'mod',
];
/** Operations a function may use only to produce a value: the functions named here. */
const VALUE_ONLY: Record<string, readonly string[]> = {
  tonemap: ['exp2', 'pow'],
  fresnel: ['pow'] /* M3 adds the BSDF's */,
};

/**
 * The rows the two lists do not admit. A row passes when its operation is in `allowed`, or when
 * it is an `absolute` row and every function it is in names that operation in `valueOnly`.
 */
function outsideLists(
  rows: readonly DeterminismEntry[],
  allowed: readonly string[] = ALLOWED,
  valueOnly: Record<string, readonly string[]> = VALUE_ONLY,
): DeterminismEntry[] {
  return rows.filter((row) => {
    if (allowed.includes(row.op)) return false;
    const valueOnlyHere =
      row.kind === 'absolute' && row.where.every((fn) => valueOnly[fn]?.includes(row.op) === true);
    return !valueOnlyHere;
  });
}

/** One failing row as the test reports it: the operation, its kind, its accuracy, its functions. */
function describeRow(label: string, row: DeterminismEntry): string {
  return `${label}: ${row.op} (kind ${row.kind}, ${row.accuracy}) in ${row.where.join(', ')}`;
}

const kernelsDir = import.meta.dir;
const kernelFiles = (readdirSync(kernelsDir, { recursive: true }) as string[])
  .filter((f) => f.endsWith('.shade.ts'))
  .sort();

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function determinismOf(source: string, fileName: string): readonly DeterminismEntry[] {
  const c = compile(source, { fileName, readDocument: readText });
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c.determinism;
}

describe('the determinism lint over src/kernels', () => {
  it('reads the kernels it is meant to read', () => {
    expect(kernelFiles).toContain('sampler.shade.ts');
    expect(kernelFiles).toContain('trace.shade.ts');
  });

  for (const file of kernelFiles) {
    it(`${file}: every row of the determinism report is in the lists`, () => {
      const path = join(kernelsDir, file);
      const rows = determinismOf(readFileSync(path, 'utf8'), path);
      expect(outsideLists(rows).map((row) => describeRow(file, row))).toEqual([]);
    });
  }
});

// The probe (record 0002, "The probes"): the lint runs once wrong on purpose and must fail. The
// module has a `sin` in a function that steers a comparison, which record 0005 rule 2 forbids.
const PROBE = `"use typeshade";

export function steer(x: f32): u32 {
  if (sin(x) > 0.5) {
    return 1;
  }
  return 0;
}
`;

describe('the probe: a sin in a function that steers a comparison', () => {
  const rows = determinismOf(PROBE, 'probe.shade.ts');

  it('is a row of the report, so the lint can see it', () => {
    const sin = rows.find((row) => row.op === 'sin');
    expect(sin?.kind).toBe('absolute');
    expect(sin?.where).toEqual(['steer']);
  });

  it('fails the lint, and the failure names the operation, kind, accuracy and function', () => {
    const failures = outsideLists(rows).map((row) => describeRow('probe', row));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('sin');
    expect(failures[0]).toContain('kind absolute');
    expect(failures[0]).toContain('absolute error');
    expect(failures[0]).toContain('steer');
  });

  it('still fails when its function is value-only for another operation', () => {
    expect(outsideLists(rows, ALLOWED, { steer: ['pow'] })).toHaveLength(1);
  });

  it('passes when its function is value-only for sin, so the lint is not a wall', () => {
    expect(outsideLists(rows, ALLOWED, { steer: ['sin'] })).toEqual([]);
  });
});
