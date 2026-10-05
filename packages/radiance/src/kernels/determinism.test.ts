// The determinism lint (design record 0005, "The lint", with record 0002, step 3). It compiles
// every `*.shade.ts` under `src/kernels` and reads `compile().determinism`, the compiler's list of
// the operations whose result may differ by driver (surface section 38). Each row must be in the
// allowlist below, or be an `absolute` row whose every function lists that operation as value-only.
// A row outside both fails the test with its operation, kind, accuracy and functions.
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
  'reflect',
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
 * it is an `absolute` row in at least one function and every function it is in names that
 * operation in `valueOnly`. A function named like an `Object` member (`toString`) is not in
 * `valueOnly` unless the list has it as its own key.
 */
function outsideLists(
  rows: readonly DeterminismEntry[],
  allowed: readonly string[] = ALLOWED,
  valueOnly: Record<string, readonly string[]> = VALUE_ONLY,
): DeterminismEntry[] {
  return rows.filter((row) => {
    if (allowed.includes(row.op)) return false;
    const valueOnlyHere =
      row.kind === 'absolute' &&
      row.where.length > 0 &&
      row.where.every(
        (fn) => Object.hasOwn(valueOnly, fn) && valueOnly[fn]?.includes(row.op) === true,
      );
    return !valueOnlyHere;
  });
}

/** One failing row as the test reports it: the operation, its kind, its accuracy, its functions. */
function describeRow(label: string, row: DeterminismEntry): string {
  return `${label}: ${row.op} (kind ${row.kind}, ${row.accuracy}) in ${row.where.join(', ')}`;
}

/**
 * Operations a kernel file is known to hold at the pin. A report that lacks one of them is a
 * broken instrument, not a clean kernel, so the lint fails on it. A new kernel file needs no entry.
 */
const KNOWN_OPS: Record<string, readonly string[]> = {
  'sampler.shade.ts': ['/'],
  'trace.shade.ts': ['/', 'dot'],
};

/** The operations of `known` that no row of the report names. */
function missingOps(rows: readonly DeterminismEntry[], known: readonly string[]): string[] {
  return known.filter((op) => !rows.some((row) => row.op === op));
}

/**
 * A kernel file is a `*.shade.ts` file that is not under a `__fixtures__` directory. A fixture is
 * a program written wrong on purpose, and the lint must not read it as a kernel. The path uses
 * the separator of the host, so both `/` and `\\` split it.
 */
function isKernelFile(path: string): boolean {
  return path.endsWith('.shade.ts') && !path.split(/[\\/]/).includes('__fixtures__');
}

const kernelsDir = import.meta.dir;
const kernelFiles = (readdirSync(kernelsDir, { recursive: true }) as string[])
  .filter(isKernelFile)
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
      expect(missingOps(rows, KNOWN_OPS[file] ?? [])).toEqual([]);
    });
  }
});

describe('the probe: an empty report', () => {
  it('fails the known-operations check, so a report that lost its rows is not a pass', () => {
    expect(missingOps([], KNOWN_OPS['trace.shade.ts'] ?? [])).toEqual(['/', 'dot']);
  });
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

// The probe for the two conditions the first probe leaves open: the `absolute` guard, and the
// rule that every function of a row lists the operation. `exp` is a `ulp` row. `sin` is an
// `absolute` row in two functions.
const PROBE_CONDITIONS = `"use typeshade";

export function grow(x: f32): f32 {
  return exp(x);
}

export function wobble(x: f32): f32 {
  return sin(x);
}

export function swing(x: f32): f32 {
  return sin(x) * 2.0;
}
`;

describe('the probe: a row that is not absolute, and a row in two functions', () => {
  const rows = determinismOf(PROBE_CONDITIONS, 'probe-conditions.shade.ts');
  const valueOnly = { grow: ['exp'], wobble: ['sin'], swing: ['sin'] };

  it('is two rows of the report, so the lint can see both', () => {
    const exp = rows.find((row) => row.op === 'exp');
    const sin = rows.find((row) => row.op === 'sin');
    expect(exp?.kind).toBe('ulp');
    expect(sin?.kind).toBe('absolute');
    expect([...(sin?.where ?? [])].sort()).toEqual(['swing', 'wobble']);
  });

  it('fails a row that is not absolute, even when its function lists it as value-only', () => {
    const failures = outsideLists(rows, ALLOWED, valueOnly).map((row) => row.op);
    expect(failures).toEqual(['exp']);
  });

  it('fails an absolute row when only one of its two functions lists it', () => {
    const failures = outsideLists(rows, ALLOWED, { ...valueOnly, swing: [] }).map((row) => row.op);
    expect(failures).toContain('sin');
  });

  it('passes an absolute row when both of its functions list it', () => {
    const failures = outsideLists(rows, ALLOWED, valueOnly).map((row) => row.op);
    expect(failures).not.toContain('sin');
  });
});

// The probe for the two edges of the value-only lookup: a row with no function, and a function
// named like an `Object` member. Both rows are built by hand, since a report never has a row with
// no function.
function absoluteRow(op: string, where: readonly string[]): DeterminismEntry {
  return { op, elem: 'f32', kind: 'absolute', accuracy: 'absolute error', count: 1, where };
}

describe('the probe: the edges of the value-only lookup', () => {
  it('fails an absolute row that is in no function, since every() of nothing is true', () => {
    const failures = outsideLists([absoluteRow('sin', [])], ALLOWED, { steer: ['sin'] });
    expect(failures).toHaveLength(1);
  });

  for (const name of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    it(`reports an absolute row in a function named ${name}, and does not throw`, () => {
      const failures = outsideLists([absoluteRow('sin', [name])], ALLOWED, {});
      expect(failures).toHaveLength(1);
    });
  }

  it('passes a function named like an Object member when the list has it as its own key', () => {
    expect(
      outsideLists([absoluteRow('sin', ['toString'])], ALLOWED, { toString: ['sin'] }),
    ).toEqual([]);
  });
});

// The probe for the file filter: a fixture is not a kernel, on either separator.
describe('the probe: which files are kernels', () => {
  it('reads a `*.shade.ts` file at the top and in a subdirectory', () => {
    expect(isKernelFile('trace.shade.ts')).toBe(true);
    expect(isKernelFile('sub/lights.shade.ts')).toBe(true);
    expect(isKernelFile('sub\\lights.shade.ts')).toBe(true);
  });

  it('skips a file under __fixtures__, on either separator', () => {
    expect(isKernelFile('__fixtures__/wrong.shade.ts')).toBe(false);
    expect(isKernelFile('sub/__fixtures__/wrong.shade.ts')).toBe(false);
    expect(isKernelFile('__fixtures__\\wrong.shade.ts')).toBe(false);
  });

  it('skips a file that is not a `*.shade.ts` file', () => {
    expect(isKernelFile('determinism.test.ts')).toBe(false);
    expect(isKernelFile('notes.md')).toBe(false);
  });
});
