// The tests of the reference game. They run the tick on the CPU tier, with no device.

import { createDevice, type Device } from 'typeshade/runtime';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { replaySim } from '../../src/test.ts';
import { BELT, tick } from './cells.shade.ts';
import { createFactory, parseLevel, putCell, render, totals, type Factory } from './level.ts';

let device: Device;
beforeAll(async () => {
  device = await createDevice({ prefer: ['cpu'] });
});
afterAll(async () => {
  await device.dispose();
});

/** The factory as text, read from the device. */
const picture = async (f: Factory) => render(f, await f.sim.read('cells'));
/** The counts, read from the device. */
const counts = async (f: Factory) => totals(await f.sim.read('cells'));

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

test('a level reads as it is written', async () => {
  // A machine shows the digit of its stock.
  expect(await picture(createFactory(LOOP, { seed: 1, device }))).toBe('E>>>v\n....v\n0<<<<\n');
});

test('a source makes an item, and the belts carry it to the machine', async () => {
  const f = createFactory(LINE, { seed: 1, device });
  const frames: string[] = [];
  for (let t = 0; t < 12; t++) {
    await f.sim.step();
    frames.push((await picture(f)).trim());
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
  const f = createFactory(LOOP, { seed: 1, device });
  for (let t = 0; t < 40; t++) {
    await f.sim.step(5);
    const n = await counts(f);
    // Each good used one item. Each item made is in a source, on a belt, in stock or used.
    expect(n.made).toBe(n.inSources + n.onBelts + n.inStock + n.goods);
  }
  expect((await counts(f)).goods).toBeGreaterThan(0);
});

test('two belts into one cell: the first in the order north, east, south, west gives', async () => {
  const f = createFactory(MERGE, { seed: 1, device });
  await f.sim.step();
  // Three sources hold an item each: north (S, sends south), west (E), south (N).
  expect(await picture(f)).toBe('.s.\ne>0\n.n.\n');
  await f.sim.step();
  // The belt takes from its first ready neighbour in the order north, east, south, west.
  expect(await picture(f)).toBe('.S.\neo0\n.n.\n');
});

test('two runs of one level give the same factory', async () => {
  const a = createFactory(LOOP, { seed: 1, device });
  const b = createFactory(LOOP, { seed: 1, device });
  await a.sim.step(300);
  await b.sim.step(300);
  expect(await a.sim.dump()).toBe(await b.sim.dump());
  expect(await picture(a)).toBe(await picture(b));
});

test('the player builds a belt with an input, and the run replays', async () => {
  const GAP = `
    E>.>M
  `;
  const f = createFactory(GAP, { seed: 1, device });
  await f.sim.step(40);
  // The gap stops the items: the machine has made nothing.
  expect((await counts(f)).goods).toBe(0);
  expect(await picture(f)).toBe('eo.>0\n');

  // The player puts a belt in the gap. `putCell` is the call the page makes from the pointer.
  putCell(f, 2, 0, BELT, 1);
  await f.sim.step(60);
  expect((await counts(f)).goods).toBeGreaterThan(0);

  // The record of the run is data, and it replays to the same factory.
  const again = await replaySim(
    (run) => createFactory(GAP, { seed: run.seed, device }).sim,
    f.sim.record(),
  );
  expect(await again.dump()).toBe(await f.sim.dump());
});

test('the dump of the engine reads the cells', async () => {
  const f = createFactory(`E>M`, { seed: 1, device });
  await f.sim.step(2);
  expect(await f.sim.dump()).toBe(
    [
      'tick 2  seed 1  hz 60',
      'cells',
      // The source gave its item in tick 2 and began the count to its next item in the same tick.
      '  [0]  kind 2  belt {dir 0, item 0, wait 0}  source {dir 1, item 0, wait 5, made 1}  machine {stock 0, wait 0, made 0}',
      '  [1]  kind 1  belt {dir 1, item 1, wait 2}  source {dir 0, item 0, wait 0, made 0}  machine {stock 0, wait 0, made 0}',
      '  [2]  kind 3  belt {dir 0, item 0, wait 0}  source {dir 0, item 0, wait 0, made 0}  machine {stock 0, wait 0, made 0}',
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
