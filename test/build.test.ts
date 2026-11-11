// Verifies: Design 0109.2
// Verifies: Design 0109.3
//
// The build of a project (design record 0109): the page's two files and the size of a page.
// The build itself runs in the harness, which has a browser.

import { expect, test } from 'vitest';
import { loadedAtStart, measure, pageFiles, type Chunk } from '../src/build.ts';
import type { GameConfig } from '../src/config.ts';

const CONFIG: GameConfig = { tick: ['tick'], name: 'Factory', start: { level: 'demo', seed: 1 } };

test('the build writes the entry of the page, with the level and the seed of the config', () => {
  expect(pageFiles('/games/factory', CONFIG).main).toBe(
    [
      '// Written by "radiance build" from the project. Do not change this file: change the',
      '// project, and build again.',
      '',
      "import { run } from 'radiance/page';",
      "import level from '../levels/demo.ts';",
      "import { Game } from './game.ts';",
      '',
      "const canvas = document.querySelector('canvas')!;",
      '// The canvas has one pixel for each pixel of its place on the page.',
      'const fit = () => {',
      '  const ratio = window.devicePixelRatio || 1;',
      '  canvas.width = Math.round(canvas.clientWidth * ratio);',
      '  canvas.height = Math.round(canvas.clientHeight * ratio);',
      '};',
      'fit();',
      "addEventListener('resize', fit);",
      '',
      'const seed = 1;',
      'void run(Game, { seed, canvas, rows: level.rows, values: level.values });',
      '',
    ].join('\n'),
  );
});

test('a page with no seed takes one from the clock, and the hook is there only when asked', () => {
  const plain = pageFiles('/games/factory', { ...CONFIG, start: { level: 'demo' } }).main;
  expect(plain).toContain('const seed = Date.now() >>> 0;');
  expect(plain).not.toContain('globalThis');
  expect(plain).not.toContain('manual');
  const hooked = pageFiles('/games/factory', CONFIG, { hook: true }).main;
  expect(hooked).toContain('(globalThis as { game?: unknown }).game = game;');
  expect(hooked).toContain("const manual = new URLSearchParams(location.search).has('manual');");
});

test('the page is one canvas, with the name of the config or of the directory as its title', () => {
  const html = pageFiles('/games/factory', CONFIG).html;
  expect(html).toContain('<title>Factory</title>');
  expect(html).toContain('<canvas></canvas>');
  expect(html).toContain('<script type="module" src="./main.ts"></script>');
  const unnamed = pageFiles('/games/dungeon', { tick: ['plan'], start: { level: 'cave' } }).html;
  expect(unnamed).toContain('<title>dungeon</title>');
});

test('a project with no start is refused with the fact and a remedy', () => {
  expect(() => pageFiles('/games/dungeon', { tick: ['plan'] })).toThrow(
    'radiance.config.ts: the config has no "start", so the project has no page. Name the level the page starts with, for example { start: { level: \'demo\' } }.',
  );
});

test('the size of a page counts the entry and its static imports, and no later import', () => {
  const chunk = (fileName: string, isEntry: boolean, imports: string[]): Chunk => ({
    fileName,
    isEntry,
    imports,
    code: fileName,
  });
  const chunks = [
    chunk('index.js', true, ['runtime.js']),
    chunk('runtime.js', false, ['shared.js']),
    chunk('shared.js', false, []),
    // The page imports these two later, with a dynamic import.
    chunk('gl.js', false, ['shared.js']),
    chunk('planner.js', false, []),
  ];
  expect(loadedAtStart(chunks).map((c) => c.fileName)).toEqual([
    'index.js',
    'runtime.js',
    'shared.js',
  ]);
});

test('a page over its budget says so, and a page with no budget is never over', () => {
  const entry: Chunk = { fileName: 'index.js', isEntry: true, imports: [], code: 'x'.repeat(100) };
  const later: Chunk = { fileName: 'gl.js', isEntry: false, imports: [], code: 'y'.repeat(900) };
  expect(measure([entry, later], 100).over).toBe(false);
  const over = measure([entry, later], 99);
  expect(over.over).toBe(true);
  expect(over.loaded.bytes).toBe(100);
  expect(over.scripts.map((script) => script.bytes)).toEqual([100, 900]);
  expect(measure([entry, later], undefined).over).toBe(false);
});
