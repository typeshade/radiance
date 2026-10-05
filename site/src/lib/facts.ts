// Every number the site prints, read at build time from the repository: the packages'
// versions, the pinned compiler, the commit the page is built from, the examples, and the
// bounds CI holds the engine to (scripts/gates.mjs). A number that is not here is not on a page.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
