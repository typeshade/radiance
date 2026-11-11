// Verifies: Design 0108.1
// Verifies: Design 0108.2
// Verifies: Design 0108.3
// Verifies: Design 0108.4
// Verifies: Design 0108.10
//
// The project of a game (design record 0108): the engine reads it and writes the game's class.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import type { GameConfig } from '../src/config.ts';
import { readProject, syncProject, writeGame } from '../src/project.ts';

const made: string[] = [];
afterAll(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Makes a project in a new directory from its files, by path. */
function project(files: { [path: string]: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'radiance-project-'));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const CELL = '"use typeshade";\nexport class Cell {\n  n: u32 = 0;\n}\n';
const MARK = '"use typeshade";\nexport class Mark {\n  n: u32 = 0;\n}\n';
const BASE = {
  'state/cells.shade.ts': CELL,
  'state/spare.shade.ts': CELL.replace('Cell', 'Slot') + 'export const slots = 8;\n',
  'scratch/marks.shade.ts': MARK,
  'systems/move.shade.ts':
    '"use typeshade";\nexport function move(cellsNext: array<Cell>, cells: array<Cell>, marks: array<Mark>, spare: array<Slot>, width: u32, tick: u32, dt: f32) {}\n',
  'systems/count.shade.ts':
    '"use typeshade";\nexport function count(marks: array<Mark>, seed: u32) {}\n',
};
const CONFIG: GameConfig = {
  tick: ['move', 'count'],
  values: ['width'],
  scratch: { marks: 'cells' },
};

test('a project gives the class of the game, as text', () => {
  const dir = project(BASE);
  expect(writeGame(readProject(dir, CONFIG))).toBe(
    [
      '// Written by "radiance sync" from the project. Do not change this file: change the',
      '// project, and run "radiance sync" again.',
      '',
      "import { Engine, system } from 'radiance';",
      "import { Cell } from '../state/cells.shade.ts';",
      "import { Slot } from '../state/spare.shade.ts';",
      "import { Mark } from '../scratch/marks.shade.ts';",
      "import { move } from '../systems/move.shade.ts';",
      "import { count } from '../systems/count.shade.ts';",
      '',
      'export class Game extends Engine {',
      '  readonly cells = this.table(Cell, { buffered: true });',
      '  readonly spare = this.pool(Slot, { size: 8 });',
      '  readonly marks = this.scratch(Mark, { like: this.cells });',
      '',
      '  // systems/move.shade.ts',
      '  @system() move() {',
      '    return move(this.cells.next, this.cells.rows, this.marks.rows, this.spare.rows, this.values.width, this.tick, this.dt);',
      '  }',
      '',
      '  // systems/count.shade.ts',
      '  @system() count() {',
      '    return count(this.marks.rows, this.seed);',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
});

test('a table is buffered only when a system names it with Next, and the order is the config', () => {
  const dir = project(BASE);
  const read = readProject(dir, { ...CONFIG, tick: ['count', 'move'], stepOn: 'input' });
  expect(read.systems.map((s) => s.name)).toEqual(['count', 'move']);
  expect(read.tables.map((t) => [t.name, t.kind, t.buffered])).toEqual([
    ['cells', 'table', true],
    ['spare', 'pool', true],
    ['marks', 'scratch', false],
  ]);
  expect(writeGame(read)).toContain("  readonly stepOn = 'input' as const;");
  const plain = project({
    ...BASE,
    'systems/move.shade.ts': '"use typeshade";\nexport function move(cells: array<Cell>) {}\n',
  });
  expect(readProject(plain, CONFIG).tables[0].buffered).toBe(false);
});

test('sync writes the file once, and --check says when it is stale', () => {
  const dir = project(BASE);
  expect(syncProject(dir, CONFIG, { check: true }).stale).toBe(true);
  expect(syncProject(dir, CONFIG).stale).toBe(true);
  expect(syncProject(dir, CONFIG).stale).toBe(false);
  expect(readFileSync(join(dir, '.radiance/game.ts'), 'utf8')).toContain('export class Game');
  expect(syncProject(dir, { ...CONFIG, tick: ['count', 'move'] }, { check: true }).stale).toBe(
    true,
  );
});

test('each error of a project names the file, the fact and a remedy', () => {
  const bad =
    (files: { [path: string]: string }, config: GameConfig = CONFIG) =>
    () =>
      readProject(project({ ...BASE, ...files }), config);
  expect(bad({ 'systems/notes.md': 'x' })).toThrow(
    'systems/notes.md: a file of systems/ is a "use typeshade" file named <name>.shade.ts. Move the file, or give it that name.',
  );
  expect(bad({ 'state/cells.shade.ts': CELL + 'export class Other {}\n' })).toThrow(
    'state/cells.shade.ts: the file exports 2 classes (Cell, Other). A file of a table exports one class, the class of its rows.',
  );
  expect(bad({ 'state/spare.shade.ts': CELL + 'export const slots = 0;\n' })).toThrow(
    'state/spare.shade.ts: "slots" is not a whole number from 1. Write the number of rows, for example "export const slots = 16;".',
  );
  expect(bad({}, { ...CONFIG, scratch: {} })).toThrow(
    "scratch/marks.shade.ts: the config gives this scratch table no size. Name the state table it follows, for example { scratch: { marks: 'cells' } }. The state tables are cells, spare.",
  );
  expect(bad({}, { ...CONFIG, tick: ['move', 'count', 'draw'] })).toThrow(
    'radiance.config.ts: "tick" names the system "draw", and systems/ has no draw.shade.ts. The systems are count, move.',
  );
  expect(bad({}, { ...CONFIG, tick: ['move'] })).toThrow(
    'systems/count.shade.ts: the config\'s "tick" does not name this system. Add "count" to "tick", or remove the file.',
  );
  expect(bad({}, { ...CONFIG, tick: [] })).toThrow('radiance.config.ts: "tick" lists no system.');
  expect(
    bad({
      'systems/count.shade.ts': '"use typeshade";\nexport function tally(marks: array<Mark>) {}\n',
    }),
  ).toThrow(
    'systems/count.shade.ts: the file exports no function "count". It exports tally. A file of a system exports one function with the file\'s name.',
  );
  expect(
    bad({
      'systems/count.shade.ts':
        '"use typeshade";\nexport function count(marks: array<Mark>, speed: f32) {}\n',
    }),
  ).toThrow(
    'systems/count.shade.ts: the engine knows no value for the parameter "speed" of "count". A parameter is a table, a table with "Next", tick, seed, dt, or a value of the config. The names are cells, spare, marks, cellsNext, spareNext, tick, seed, dt, width.',
  );
  expect(
    bad({
      'systems/count.shade.ts':
        '"use typeshade";\nexport function count(marksNext: array<Mark>) {}\n',
    }),
  ).toThrow(
    'systems/count.shade.ts: the parameter "marksNext" asks for a second array of the scratch table "marks". A scratch table has one array: name the parameter "marks".',
  );
});

test('one module reads source, and the runtime imports no module of the project layer', () => {
  const source = (name: string) => readFileSync(join('src', name), 'utf8');
  const files = readdirSync('src').filter((name) => name.endsWith('.ts'));
  // Section 10, rule 2: only `facts.ts` parses a file of the language.
  expect(files.filter((name) => /from 'typescript'/.test(source(name)))).toEqual(['facts.ts']);
  expect(files.filter((name) => /from '\.\/facts\.ts'/.test(source(name)))).toEqual(['project.ts']);
  // Section 10, rule 7: the runtime and the page stand below the project.
  for (const name of ['engine.ts', 'sim.ts', 'page.ts', 'index.ts', 'config.ts']) {
    expect(source(name), name).not.toMatch(/from '\.\/(project|facts|cli|test)\.ts'/);
    expect(source(name), name).not.toMatch(/from 'node:/);
  }
});
