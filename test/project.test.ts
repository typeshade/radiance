// Verifies: Design 0108.1
// Verifies: Design 0108.2
// Verifies: Design 0108.3
// Verifies: Design 0108.4
// Verifies: Design 0108.10
// Verifies: Design 0111.2
// Verifies: Design 0111.3
// Verifies: Design 0111.4
//
// The project of a game (design record 0108): the engine reads it and writes the game's class.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import type { GameConfig } from '../src/config.ts';
import { readLayer } from '../src/facts.ts';
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
      "import { Engine } from 'radiance';",
      "import { Cell } from '../state/cells.shade.ts';",
      "import { Slot } from '../state/spare.shade.ts';",
      "import { Mark } from '../scratch/marks.shade.ts';",
      "import { move } from '../systems/move.shade.ts';",
      "import { count } from '../systems/count.shade.ts';",
      '',
      'export class Game extends Engine {',
      '  readonly tables = {',
      '    cells: this.table(Cell, { buffered: true }),',
      '    spare: this.pool(Slot, { size: 8 }),',
      "    marks: this.scratch(Mark, { like: 'cells' }),",
      '  };',
      '',
      '  readonly systems = {',
      '    // systems/move.shade.ts',
      '    move: () => move(this.tables.cells.next, this.tables.cells.rows, this.tables.marks.rows, this.tables.spare.rows, this.values.width, this.tick, this.dt),',
      '    // systems/count.shade.ts',
      '    count: () => count(this.tables.marks.rows, this.seed),',
      '  };',
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
  expect(writeGame(read)).toContain("  override readonly stepOn = 'input' as const;");
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
  for (const name of ['engine.ts', 'sim.ts', 'page.ts', 'index.ts', 'config.ts', 'draw.ts']) {
    expect(source(name), name).not.toMatch(/from '\.\/(project|facts|cli|test|build)\.ts'/);
    expect(source(name), name).not.toMatch(/from 'vite'/);
    expect(source(name), name).not.toMatch(/from 'node:/);
  }
});

// The layers of a game (design record 0111).

const layer = (body = '', names = 'declare const cells: storage<array<Cell>>;') =>
  [
    '"use typeshade";',
    names,
    'declare const view: uniform<mat4x4>;',
    'declare const width: uniform<u32>;',
    body,
    '@vertex',
    'export function place(corner: builtin<"vertex_index">): vec4 { return vec4(0., 0., 0., 1.); }',
    '@fragment',
    'export function paint(): location<0, vec4> { return vec4(1., 1., 1., 1.); }',
    '',
  ].join('\n');
const LAYERS = {
  'draw/cells.shade.ts': layer(),
  'draw/marks.shade.ts': layer('', 'declare const marks: storage<array<Mark>>;'),
};
const DRAWING: GameConfig = {
  ...CONFIG,
  draw: ['cells', 'marks'],
  view: { fit: [10, 6], clear: [0.03, 0.03, 0.04] },
};

test('a layer is read: its two entries and its names, with their kinds', () => {
  expect(readLayer('draw/cells.shade.ts', layer())).toEqual({
    vertex: ['place'],
    fragment: ['paint'],
    declares: [
      { name: 'cells', kind: 'storage' },
      { name: 'view', kind: 'uniform' },
      { name: 'width', kind: 'uniform' },
    ],
  });
  // An entry with a call after the @, an entry that is not exported and a name with no type.
  const odd = [
    '"use typeshade";',
    'declare const tex: texture_2d<f32>;',
    'const hidden = 1;',
    '@vertex()',
    'export function a() {}',
    '@fragment',
    'function b() {}',
    '@fragment',
    'export function c() {}',
    '',
  ].join('\n');
  expect(readLayer('x.shade.ts', odd)).toEqual({
    vertex: ['a'],
    fragment: ['c'],
    declares: [{ name: 'tex', kind: 'texture_2d' }],
  });
});

test('a project with layers gives the class of the game with its layers and its view', () => {
  const dir = project({ ...BASE, ...LAYERS });
  const read = readProject(dir, DRAWING);
  expect(read.draws).toBe(false);
  expect(read.layers.map((l) => [l.name, l.table])).toEqual([
    ['cells', 'cells'],
    ['marks', 'marks'],
  ]);
  const text = writeGame(read);
  expect(text).toContain("import layer_cells from '../draw/cells.shade.ts';");
  expect(text).toContain("import layer_marks from '../draw/marks.shade.ts';");
  expect(text).toContain(
    [
      '  override readonly layers = [',
      '    // draw/cells.shade.ts',
      '    {',
      "      name: 'cells',",
      '      program: layer_cells,',
      "      vertex: 'place',",
      "      fragment: 'paint',",
      '      rows: this.tables.cells,',
      '      bind: (view: readonly number[]) => ({ cells: this.tables.cells.rows, view, width: this.values.width }),',
      '    },',
      '    // draw/marks.shade.ts',
      '    {',
      "      name: 'marks',",
      '      program: layer_marks,',
      "      vertex: 'place',",
      "      fragment: 'paint',",
      '      rows: this.tables.marks,',
      '      bind: (view: readonly number[]) => ({ marks: this.tables.marks.rows, view, width: this.values.width }),',
      '    },',
      '  ];',
      '',
      '  override readonly view = { fit: [10, 6], clear: [0.03, 0.03, 0.04] } as const;',
    ].join('\n'),
  );
  // The order of the layers is the order of the config, and the colour is not required.
  const back = writeGame(
    readProject(dir, { ...DRAWING, draw: ['marks', 'cells'], view: { fit: [4, 3] } }),
  );
  expect(back.indexOf('layer_marks,')).toBeLessThan(back.indexOf('layer_cells,'));
  expect(back).toContain('  override readonly view = { fit: [4, 3] } as const;');
});

test('the engine names of a layer are bound to the game: tick, seed, dt and the values', () => {
  const names = [
    'declare const cells: storage<array<Cell>>;',
    'declare const tick: uniform<u32>;',
    'declare const seed: uniform<u32>;',
    'declare const dt: uniform<f32>;',
  ].join('\n');
  const dir = project({ ...BASE, 'draw/cells.shade.ts': layer('', names) });
  const text = writeGame(readProject(dir, { ...DRAWING, draw: ['cells'] }));
  expect(text).toContain(
    '({ cells: this.tables.cells.rows, tick: this.tick, seed: this.seed, dt: this.dt, view, width: this.values.width })',
  );
});

test('a project with draw/draw.ts and no draw in its config draws as it did', () => {
  const dir = project({
    ...BASE,
    'draw/draw.ts': 'export function draw(game: unknown) {}\n',
  });
  const read = readProject(dir, CONFIG);
  expect([read.draws, read.layers]).toEqual([true, []]);
  expect(writeGame(read)).toContain('draw() {');
});

test('a project with a draw in its config and a draw/draw.ts is refused', () => {
  const dir = project({
    ...BASE,
    ...LAYERS,
    'draw/draw.ts': 'export function draw(game: unknown) {}\n',
  });
  expect(() => readProject(dir, DRAWING)).toThrow(
    'radiance.config.ts: the config has "draw", so the game draws in layers, and the project has draw/draw.ts, the host function of the older way. Remove draw/draw.ts, or remove "draw" from the config.',
  );
});

test('each error of a layer names the file, the fact and a remedy', () => {
  const bad =
    (files: { [path: string]: string }, config: GameConfig = DRAWING) =>
    () =>
      readProject(project({ ...BASE, ...LAYERS, ...files }), config);
  // A name that the engine does not know.
  expect(bad({ 'draw/cells.shade.ts': layer('declare const speed: uniform<f32>;') })).toThrow(
    'draw/cells.shade.ts: the engine knows no value for the name "speed" of the layer "cells". A name is a table, a scratch table, view, tick, seed, dt, or a value of the config. The names are cells, spare, marks, view, tick, seed, dt, width.',
  );
  // Two tables.
  expect(
    bad({
      'draw/cells.shade.ts': layer(
        '',
        'declare const cells: storage<array<Cell>>;\ndeclare const spare: storage<array<Slot>>;',
      ),
    }),
  ).toThrow(
    'draw/cells.shade.ts: the layer "cells" names 2 tables (cells, spare). A layer draws the rows of one table. Name one table, and make one layer for each table.',
  );
  // No table.
  expect(bad({ 'draw/cells.shade.ts': layer('', '') })).toThrow(
    'draw/cells.shade.ts: the layer "cells" names no table. A layer draws one instance for each row of one table. Declare it, for example "declare const cells: storage<array<Row>>;". The tables are cells, spare, marks.',
  );
  // A table that is a uniform, and a view that is a storage binding.
  expect(bad({ 'draw/cells.shade.ts': layer('', 'declare const cells: uniform<Cell>;') })).toThrow(
    'draw/cells.shade.ts: the name "cells" of the layer "cells" is a uniform binding. The engine gives a table as a storage binding, for example "declare const cells: storage<array<Row>>;".',
  );
  expect(
    bad({
      'draw/cells.shade.ts': layer('').replace(
        'declare const view: uniform<mat4x4>;',
        'declare const view: storage<array<f32>>;',
      ),
    }),
  ).toThrow(
    'draw/cells.shade.ts: the name "view" of the layer "cells" is a storage binding. The engine gives the view as a uniform binding, for example "declare const view: uniform<mat4x4>;".',
  );
  // A kind that the engine cannot give.
  expect(
    bad({
      'draw/cells.shade.ts': layer('declare const width: texture_2d<f32>;').replace(
        'declare const width: uniform<u32>;\n',
        '',
      ),
    }),
  ).toThrow(
    'draw/cells.shade.ts: the name "width" of the layer "cells" is a texture_2d binding. The engine gives a value as a uniform binding, for example "declare const width: uniform<u32>;".',
  );
  // The entries.
  const vertexOnly = layer().replace('@fragment\n', '');
  expect(bad({ 'draw/cells.shade.ts': vertexOnly })).toThrow(
    'draw/cells.shade.ts: the layer "cells" has no @fragment entry. A layer exports one @vertex entry and one @fragment entry, for example "@fragment export function paint(...)".',
  );
  const fragmentOnly = layer().replace('@vertex\n', '');
  expect(bad({ 'draw/cells.shade.ts': fragmentOnly })).toThrow(
    'draw/cells.shade.ts: the layer "cells" has no @vertex entry. A layer exports one @vertex entry and one @fragment entry, for example "@vertex export function place(...)".',
  );
  const two = layer() + '@vertex\nexport function other(): vec4 { return vec4(0., 0., 0., 1.); }\n';
  expect(bad({ 'draw/cells.shade.ts': two })).toThrow(
    'draw/cells.shade.ts: the layer "cells" has 2 @vertex entries (place, other). A layer exports one @vertex entry and one @fragment entry.',
  );
  // The config.
  expect(bad({}, { ...DRAWING, draw: ['cells', 'sparks'] })).toThrow(
    'radiance.config.ts: "draw" names the layer "sparks", and draw/ has no sparks.shade.ts. The layers are cells, marks.',
  );
  expect(bad({}, { ...DRAWING, draw: ['cells'] })).toThrow(
    'draw/marks.shade.ts: the config\'s "draw" does not name this layer. Add "marks" to "draw", or remove the file.',
  );
  expect(bad({}, { ...DRAWING, draw: [] })).toThrow(
    'radiance.config.ts: "draw" lists no layer. Give the layers from the back to the front, for example { draw: [\'cells\'] }.',
  );
  expect(bad({}, { ...DRAWING, view: undefined })).toThrow(
    'radiance.config.ts: the config has "draw" and no "view". Give the rectangle of the world that the screen shows, for example { view: { fit: [10, 6] } }.',
  );
  expect(bad({}, { ...DRAWING, view: { fit: [10, 0] } })).toThrow(
    'radiance.config.ts: "view.fit" is [10,0]. Give the width and the height of the rectangle of the world, two numbers above 0, for example { fit: [10, 6] }.',
  );
  expect(bad({}, { ...DRAWING, view: { fit: [10, 6], clear: [0, 2, 0] } })).toThrow(
    'radiance.config.ts: "view.clear" is [0,2,0]. Give a colour, three numbers from 0 to 1, for example { clear: [0.07, 0.07, 0.09] }.',
  );
  expect(bad({}, { ...CONFIG, view: { fit: [10, 6] } })).toThrow(
    'radiance.config.ts: the config has "view" and no "draw". A view is for layers. Add "draw: [\'<layer>\']" with a file of draw/, or remove "view".',
  );
});
