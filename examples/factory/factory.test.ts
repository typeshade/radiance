// The tests of the reference game. They run the tick on the CPU tier, with no device.

import { expect, test } from 'vitest';
import { parseLevel, render, run, totals } from './level.ts';

const LINE = `
  E>>>M
`;

const LOOP = `
  E>>>v
  ....v
  M<<<<
`;

const MERGE = `
  .S.
  E>M
  .N.
`;

test('a level reads as it is written', () => {
  // A machine shows the digit of its stock.
  expect(render(parseLevel(LOOP))).toBe('E>>>v\n....v\n0<<<<\n');
});

test('a source makes an item, and the belts carry it to the machine', async () => {
  const f = parseLevel(LINE);
  const frames: string[] = [];
  for (let t = 0; t < 12; t++) {
    await run(f, 1);
    frames.push(render(f).trim());
  }
  // Read by hand against the rules: the source makes an item in tick 1, the first belt takes
  // it in tick 2, and each belt holds it for 3 ticks (one to take it, two to make it ready).
  expect(frames).toEqual([
    'e>>>0',
    'Eo>>0',
    'Eo>>0',
    'Eo>>0',
    'E>o>0',
    'E>o>0',
    'E>o>0',
    'e>>o0',
    'Eo>o0',
    'Eo>o0',
    'Eo>>1',
    'E>o>1',
  ]);
});

test('no item is lost and none is made from nothing', async () => {
  const f = parseLevel(LOOP);
  for (let t = 0; t < 40; t++) {
    await run(f, 5);
    const n = totals(f);
    // Each good used one item. Each item made is in a source, on a belt, in stock or used.
    expect(n.made).toBe(n.inSources + n.onBelts + n.inStock + n.goods);
  }
  expect(totals(f).goods).toBeGreaterThan(0);
});

test('two belts into one cell: the first in the order north, east, south, west gives', async () => {
  const f = parseLevel(MERGE);
  await run(f, 1);
  // Three sources hold an item each: north (S, sends south), west (E), south (N).
  expect(render(f)).toBe('.s.\ne>0\n.n.\n');
  await run(f, 1);
  // The belt takes from its first ready neighbour in the order north, east, south, west.
  expect(render(f)).toBe('.S.\neo0\n.n.\n');
});

test('two runs of one level give the same factory', async () => {
  const a = parseLevel(LOOP);
  const b = parseLevel(LOOP);
  await run(a, 300);
  await run(b, 300);
  expect(JSON.stringify(a.cells)).toBe(JSON.stringify(b.cells));
  expect(render(a)).toBe(render(b));
});

test('a wrong level is refused with the fact and the remedy', () => {
  expect(() => parseLevel('E>\nM')).toThrow(
    'parseLevel(): row 1 has 1 cells, and row 0 has 2. Give each row the same length.',
  );
  expect(() => parseLevel('E?M')).toThrow(
    'parseLevel(): row 0 holds "?". A cell is one of . ^ > v < N E S W M.',
  );
});
