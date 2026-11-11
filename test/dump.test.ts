// Verifies: Design 0100.6
// Verifies: Design 0100.7
//
// The dump and the snapshot (design record 0100, sections 4 and 5), and the invariants of
// section 6: a replay is exact, and `src/` reads no clock, no random source and no device.

import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createWorld, formatNumber, formatValue, node, scene } from '../src/index.ts';
import { simulate } from '../src/test.ts';
import { Belt } from './fixtures/belt.shade.ts';
import { Inner, Probe } from './fixtures/probe.shade.ts';
import { Counter, Mover } from './fixtures/world.shade.ts';

const here = new URL('.', import.meta.url);
const golden = (name: string) => readFileSync(new URL(`golden/${name}`, here), 'utf8');

const factory = scene(node('line-1', node(Belt, { speed: 2 }), node('spare', Belt, { speed: 0 })));
const kinds = scene(
  node('root', node('group', node(Probe, { speed: 2 }, node(Inner))), node(Counter)),
);

test("the record's example: the dump of the factory at tick 30", () => {
  expect(simulate(factory, { ticks: 30, seed: 7 }).dump()).toBe(golden('factory-30.txt'));
});

test("the record's example: the snapshot of the factory at tick 30", () => {
  const snap = simulate(factory, { ticks: 30, seed: 7 }).snapshot();
  expect(JSON.stringify(snap, null, 2) + '\n').toBe(golden('factory-30.json'));
});

test('the dump prints each kind of field, a group, a given name and the indent', () => {
  expect(simulate(kinds, { ticks: 3, seed: 1 }).dump()).toBe(golden('kinds-3.txt'));
});

test('the snapshot holds each kind of field', () => {
  const snap = simulate(kinds, { ticks: 3, seed: 1 }).snapshot();
  expect(JSON.stringify(snap, null, 2) + '\n').toBe(golden('kinds-3.json'));
});

test('rule 9: each line ends with one newline, and no line has a trailing space', () => {
  const text = simulate(kinds, { ticks: 1, seed: 1 }).dump();
  expect(text.endsWith('\n')).toBe(true);
  expect(text.endsWith('\n\n')).toBe(false);
  for (const line of text.split('\n')) expect(line).toBe(line.trimEnd());
});

test('rule 5: a number', () => {
  expect(formatNumber(0)).toBe('0');
  expect(formatNumber(-0)).toBe('-0');
  expect(formatNumber(2)).toBe('2');
  expect(formatNumber(-2)).toBe('-2');
  expect(formatNumber(0.5)).toBe('0.5');
  expect(formatNumber(Math.fround(0.1))).toBe('0.1');
  expect(formatNumber(Math.fround(1 / 60))).toBe('0.016666668');
  expect(formatNumber(3.5762786865234375e-7)).toBe('3.5762787e-7');
  // An integer is printed in full: these are a u32 and the largest f32.
  expect(formatNumber(4294967295)).toBe('4294967295');
  expect(formatNumber(16777217)).toBe('16777217');
  expect(formatNumber(Math.fround(3.4028234663852886e38))).toBe(
    '340282346638528859811704183484516925440',
  );
  expect(formatNumber(NaN)).toBe('NaN');
  expect(formatNumber(Infinity)).toBe('Infinity');
  expect(formatNumber(-Infinity)).toBe('-Infinity');
});

test('rule 5: the text of a number reads back to the same f32', () => {
  let word = 0x9e3779b9;
  const view = new DataView(new ArrayBuffer(4));
  for (let i = 0; i < 2000; i++) {
    word = (Math.imul(word ^ (word >>> 15), 0x2c1b3c6d) + i) >>> 0;
    view.setUint32(0, word);
    const value = view.getFloat32(0);
    if (!Number.isFinite(value)) continue;
    expect(Math.fround(Number(formatNumber(value)))).toBe(value);
  }
});

test('rules 6 to 8: a boolean, a list and an object', () => {
  expect(formatValue(true)).toBe('true');
  expect(formatValue(false)).toBe('false');
  expect(formatValue([1, 0.5, -0])).toBe('(1, 0.5, -0)');
  expect(formatValue(new Float32Array([1, 2]))).toBe('(1, 2)');
  expect(formatValue({ a: 0.5, on: true, at: [1, 2] })).toBe('{a 0.5, on true, at (1, 2)}');
});

test('a snapshot is a copy, and a number JSON cannot hold is the text of rule 5', () => {
  const world = createWorld(scene(node(Mover, { x: NaN, speed: -0 })), { seed: 1 });
  const before = world.snapshot();
  expect(before.tables[0].rows[0].fields).toEqual({ x: 'NaN', speed: '-0' });
  const moving = createWorld(scene(node(Mover)), { seed: 1 });
  const at0 = moving.snapshot();
  moving.step(5);
  expect(at0.tick).toBe(0);
  expect(at0.tables[0].rows[0].fields.x).toBe(0);
  expect(moving.snapshot().tables[0].rows[0].fields.x).not.toBe(0);
});

test('invariant 1: two runs of one scene give the same dump at tick 0, 1 and 1000', () => {
  for (const ticks of [0, 1, 1000]) {
    const a = simulate(kinds, { ticks, seed: 9 });
    const b = simulate(kinds, { ticks, seed: 9 });
    expect(a.dump()).toBe(b.dump());
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  }
});

test('invariant 4: the world adds no property to an instance', () => {
  const world = simulate(kinds, { ticks: 2, seed: 1 });
  expect(Object.keys(world.table(Counter)[0])).toEqual(Object.keys(new Counter()));
  world.dump();
  world.snapshot();
  expect(Object.keys(world.table(Counter)[0])).toEqual(Object.keys(new Counter()));
});

test('invariants 2 and 3: src/ names no clock, no random source, no timer and no device', () => {
  const banned = [
    /\bDate\b/,
    /\bperformance\b/,
    /Math\.random/,
    /\bsetTimeout\b/,
    /\bsetInterval\b/,
    /\brequestAnimationFrame\b/,
    /\bnavigator\b/,
    /\bdocument\b/,
    /\bwindow\b/,
    /\bcanvas\b/i,
    /\bGPU[A-Z]\w*/,
    /\bWebGL\w*/,
  ];
  const src = new URL('../src/', here);
  const files = readdirSync(src, { recursive: true }) as string[];
  const found: string[] = [];
  for (const file of files.filter((f) => f.endsWith('.ts'))) {
    const lines = readFileSync(new URL(file, src), 'utf8').split('\n');
    lines.forEach((line, i) => {
      // A comment may name what the code does not read.
      const code = line
        .replace(/\/\/.*$/, '')
        .replace(/^\s*\*.*$/, '')
        .replace(/^\s*\/\*.*$/, '');
      for (const name of banned)
        if (name.test(code)) found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(found).toEqual([]);
});
