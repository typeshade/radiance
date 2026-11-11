// The tests of the reference game. They run the tick on the CPU tier, with no device.

import { expect, test } from 'vitest';
import { replaySim } from '../../src/test.ts';
import { BELT, tick } from './cells.shade.ts';
import { createFactory, parseLevel, render, totals } from './level.ts';

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
  expect(render(createFactory(LOOP, { seed: 1 }))).toBe('E>>>v\n....v\n0<<<<\n');
});

test('a source makes an item, and the belts carry it to the machine', async () => {
  const f = createFactory(LINE, { seed: 1 });
  const frames: string[] = [];
  for (let t = 0; t < 12; t++) {
    await f.sim.step();
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
  const f = createFactory(LOOP, { seed: 1 });
  for (let t = 0; t < 40; t++) {
    await f.sim.step(5);
    const n = totals(f);
    // Each good used one item. Each item made is in a source, on a belt, in stock or used.
    expect(n.made).toBe(n.inSources + n.onBelts + n.inStock + n.goods);
  }
  expect(totals(f).goods).toBeGreaterThan(0);
});

test('two belts into one cell: the first in the order north, east, south, west gives', async () => {
  const f = createFactory(MERGE, { seed: 1 });
  await f.sim.step();
  // Three sources hold an item each: north (S, sends south), west (E), south (N).
  expect(render(f)).toBe('.s.\ne>0\n.n.\n');
  await f.sim.step();
  // The belt takes from its first ready neighbour in the order north, east, south, west.
  expect(render(f)).toBe('.S.\neo0\n.n.\n');
});

test('two runs of one level give the same factory', async () => {
  const a = createFactory(LOOP, { seed: 1 });
  const b = createFactory(LOOP, { seed: 1 });
  await a.sim.step(300);
  await b.sim.step(300);
  expect(a.sim.dump()).toBe(b.sim.dump());
  expect(render(a)).toBe(render(b));
});

test('the player builds a belt with an input, and the run replays', async () => {
  const GAP = `
    E>.>M
  `;
  const f = createFactory(GAP, { seed: 1 });
  await f.sim.step(40);
  // The gap stops the items: the machine has made nothing.
  expect(totals(f).goods).toBe(0);
  expect(render(f)).toBe('eo.>0\n');

  // The player puts a belt in the gap. An input is a write of field values to one row.
  f.sim.input('cells', 2, { kind: BELT, dir: 1 });
  await f.sim.step(60);
  expect(totals(f).goods).toBeGreaterThan(0);

  // The record of the run is data, and it replays to the same factory.
  const level = parseLevel(GAP);
  const again = await replaySim(
    { cells: level.cells },
    {
      buffered: ['cells'],
      tick: (t) => tick(t.cells.write, t.cells.read, level.width, level.height),
    },
    f.sim.record(),
  );
  expect(again.dump()).toBe(f.sim.dump());
});

test('the dump of the engine reads the cells', async () => {
  const f = createFactory(`E>M`, { seed: 1 });
  await f.sim.step(2);
  expect(f.sim.dump()).toBe(
    [
      'tick 2  seed 1  hz 60',
      'cells',
      // The source gave its item in tick 2 and began the count to its next item in the same tick.
      '  [0]  kind 2  dir 1  item 0  wait 5  stock 0  made 1',
      '  [1]  kind 1  dir 1  item 1  wait 2  stock 0  made 0',
      '  [2]  kind 3  dir 0  item 0  wait 0  stock 0  made 0',
      '',
    ].join('\n'),
  );
});

test('a wrong level is refused with the fact and the remedy', () => {
  expect(() => parseLevel('E>\nM')).toThrow(
    'parseLevel(): row 1 has 1 cells, and row 0 has 2. Give each row the same length.',
  );
  expect(() => parseLevel('E?M')).toThrow(
    'parseLevel(): row 0 holds "?". A cell is one of . ^ > v < N E S W M.',
  );
});
