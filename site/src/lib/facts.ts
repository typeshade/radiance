// Every number the site prints, read at build time from the repository: the packages'
// versions, the pinned compiler, the commit the page is built from, the examples, and the
// bounds CI holds the engine to (scripts/gates.mjs). A number that is not here is not on a page.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compile } from 'typeshade';
import {
  ALLOWED,
  VALUE_ONLY,
  describeRow,
  outsideLists,
} from '../../../packages/radiance/src/kernels/determinism-lists.ts';
import { GATE, ORACLE } from '../../../scripts/gates.mjs';
import { exampleIds } from '../../../scripts/stills.mjs';

// The build runs in site/ (`bun run site` is `cd site && astro build`). The module's own URL
// cannot place it: Astro bundles it into .astro/.prerender before it runs.
const siteRoot = process.cwd();
const repoRoot = path.resolve(siteRoot, '..');
const json = (file: string): { version: string; name: string } =>
  JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));
const git = (args: string, cwd = repoRoot): string =>
  execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim();

const engine = json('packages/radiance/package.json');
const addons = json('packages/addons/package.json');
const compiler = json('vendor/typeshade/package.json');

/** The kernels whose determinism report the site prints, in the order it prints them. */
const REPORTED_KERNELS = ['trace.shade.ts', 'sampler.shade.ts'] as const;

/** One row of a kernel's determinism report: the compiler's, with the file it came from. */
export interface KernelRow {
  readonly file: string;
  readonly op: string;
  readonly kind: string;
  readonly accuracy: string;
  readonly count: number;
  readonly where: readonly string[];
}

const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * Compiles each reported kernel and reads `compile().determinism`, as the lint does
 * (packages/radiance/src/kernels/determinism.test.ts). The page says that every row is in the
 * allowlist of record 0005, so a row outside the lists stops the build: the page must not say it.
 */
function kernelDeterminism(): readonly KernelRow[] {
  const rows: KernelRow[] = [];
  for (const file of REPORTED_KERNELS) {
    const at = path.join(repoRoot, 'packages/radiance/src/kernels', file);
    const compiled = compile(readFileSync(at, 'utf8'), { fileName: at, readDocument: readText });
    const errors = compiled.diagnostics.filter((d) => d.category === 'error');
    if (errors.length > 0)
      throw new Error(`[determinism] ${file} does not compile: ${errors[0]!.message}`);
    for (const { op, kind, accuracy, count, where } of compiled.determinism)
      rows.push({ file, op, kind, accuracy, count, where });
  }
  const outside = outsideLists(rows);
  if (outside.length > 0)
    throw new Error(
      `[determinism] a row is outside the lists of record 0005, so the page cannot say that every row is in them. Do not widen the lists: amend the record first.\n${outside.map((row) => describeRow(row.file, row)).join('\n')}`,
    );
  return rows;
}

export const facts = {
  /** The engine package, and its version in the tree. */
  packageName: engine.name,
  addonsName: addons.name,
  version: engine.version,
  /** The commit the site is built from, long and short. */
  commit: git('rev-parse HEAD'),
  shortCommit: git('rev-parse --short HEAD'),
  /** The compiler pinned as a submodule, and its version. */
  compilerCommit: git('rev-parse --short HEAD', path.join(repoRoot, 'vendor/typeshade')),
  compilerVersion: compiler.version,
  repoUrl: 'https://github.com/typeshade/radiance',
  compilerUrl: 'https://github.com/typeshade/typeshade',
  npmUrl: 'https://www.npmjs.com/package/@typeshade/radiance',
  license: 'Apache-2.0',
  /** The examples, by id. */
  examples: exampleIds(siteRoot),
  /** The determinism report of the reported kernels, and the two lists of record 0005 every row
   *  is held to: `ALLOWED` and `VALUE_ONLY`. */
  determinism: { rows: kernelDeterminism(), allowed: ALLOWED, valueOnly: VALUE_ONLY },
  /** The gates CI holds the engine to. */
  gate: {
    size: `${GATE.size[0]} x ${GATE.size[1]}`,
    samples: GATE.samples,
    oracleMean: ORACLE.mean,
    oracleAbs: ORACLE.abs,
    oracleRel: ORACLE.rel,
  },
} as const;

/** A file of this repository on GitHub, at the commit the site is built from. */
export const sourceUrl = (file: string): string => `${facts.repoUrl}/blob/${facts.commit}/${file}`;

/** The source of an example, read from the file that runs on its page. */
export const exampleSource = (id: string): string =>
  readFileSync(path.join(siteRoot, 'examples', `${id}.ts`), 'utf8');

/** The API reference page of a class, under /api/, as starlight-typedoc writes it: one module
 *  per entry point, named by its path under packages/ (`radiance/src`, `addons/src`). */
export const apiPath = (name: string, pkg: 'radiance' | 'addons' = 'radiance'): string =>
  `${pkg}/src/classes/${name.toLowerCase()}`;

/** The API reference's index page, which lists the two modules. */
export const API_INDEX = '/api/readme/';
