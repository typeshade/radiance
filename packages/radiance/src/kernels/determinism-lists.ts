// The two lists of design record 0005 ("The lint"), and the rule that reads a determinism report
// against them. The lint (determinism.test.ts) and the site (site/src/lib/facts.ts) both import
// this file, so a row the lint admits is a row the site's page admits.
//
// This file imports nothing, and index.ts does not export it: it is a record, not API.
//
// The two lists are edited only with record 0005 amended. A pull request that adds a row cites
// the rule of the record it keeps.

/** One row of the compiler's determinism report, as far as the rule reads it. The compiler's
 *  `DeterminismEntry` has these fields and more, so it fits without a conversion. */
export interface DeterminismRow {
  readonly op: string;
  readonly kind: string;
  readonly accuracy: string;
  readonly where: readonly string[];
}

/** Operations the kernels may use anywhere (bounded, inherited, or exact on both targets). */
export const ALLOWED: readonly string[] = [
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
export const VALUE_ONLY: Record<string, readonly string[]> = {
  tonemap: ['exp2', 'pow'],
  fresnel: ['pow'] /* M3 adds the BSDF's */,
};

/**
 * The rows the two lists do not admit. A row passes when its operation is in `allowed`, or when
 * it is an `absolute` row in at least one function and every function it is in names that
 * operation in `valueOnly`. A function named like an `Object` member (`toString`) is not in
 * `valueOnly` unless the list has it as its own key.
 */
export function outsideLists<Row extends DeterminismRow>(
  rows: readonly Row[],
  allowed: readonly string[] = ALLOWED,
  valueOnly: Record<string, readonly string[]> = VALUE_ONLY,
): Row[] {
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

/** One failing row as a report names it: the operation, its kind, its accuracy, its functions. */
export function describeRow(label: string, row: DeterminismRow): string {
  return `${label}: ${row.op} (kind ${row.kind}, ${row.accuracy}) in ${row.where.join(', ')}`;
}
