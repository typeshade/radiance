// Verifies: Design 0107.1
// Verifies: Design 0107.2
//
// A table with free slots (design record 0107). The device here is the CPU tier, with no
// browser.

import { createDevice, type Device } from 'typeshade/runtime';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createSim } from '../src/sim.ts';
import { Die, Row } from './fixtures/sim.shade.ts';

let device: Device;
beforeAll(async () => {
  device = await createDevice({ prefer: ['cpu'] });
});
afterAll(async () => {
  await device.dispose();
});

const die = (face: number) => {
  const d = new Die();
  d.face = face;
  return d;
};
const free = (d: Die) => d.face === 0;
const loose = createSim as unknown as (tables: unknown, options: unknown) => unknown;

test('section 1: a table gets free rows up to its size, and each has a seed', async () => {
  const sim = createSim(
    { dice: [die(3)] },
    { device, seed: 7, slots: { dice: { size: 4, free } }, tick: () => {} },
  );
  const dice = await sim.read('dice');
  expect(dice.map((d) => d.face)).toEqual([3, 0, 0, 0]);
  expect(new Set(dice.map((d) => d.seed)).size).toBe(4);
  expect(dice.every((d) => d.seed !== 0)).toBe(true);
  // An input reaches an added row.
  sim.input('dice', 3, { face: 5 });
  await sim.step(1);
  expect((await sim.read('dice'))[3].face).toBe(5);
});

test('section 1: a buffered table with slots has two arrays of its size', async () => {
  const sim = createSim(
    { dice: [die(3)] },
    {
      device,
      seed: 7,
      buffered: ['dice'],
      slots: { dice: { size: 3, free } },
      tick: async (t) => t.dice.write.write(await t.dice.read.read()),
    },
  );
  await sim.step(2);
  expect((await sim.read('dice')).map((d) => d.face)).toEqual([3, 0, 0]);
});

test('section 1: the refusals', () => {
  const base = { device, seed: 1, tick: () => {} };
  expect(() => loose({ dice: [die(1)] }, { ...base, slots: { cards: { size: 2, free } } })).toThrow(
    'createSim(): slots names "cards", which is no table. The tables are dice.',
  );
  expect(() => loose({ dice: [die(1)] }, { ...base, slots: { dice: { size: 2 } } })).toThrow(
    'createSim(): the slots of "dice" need a size and a function free, for example { size: 16, free: (row) => row.kind === 0 }.',
  );
  expect(() =>
    loose({ dice: [die(1), die(2), die(3)] }, { ...base, slots: { dice: { size: 2, free } } }),
  ).toThrow(
    'createSim(): the table "dice" has 3 rows, and its slots are 2. Give more slots or fewer rows.',
  );
  expect(() =>
    loose({ dice: [{ face: 1 }] }, { ...base, slots: { dice: { size: 2, free } } }),
  ).toThrow(
    'createSim(): the rows of "dice" have no class, so the simulation cannot make a free row. Give rows of a class.',
  );
  expect(() =>
    loose({ dice: [die(1)] }, { ...base, slots: { dice: { size: 2, free: () => false } } }),
  ).toThrow(
    'createSim(): a new row of the class Die is not free, in the table "dice". The function free must be true for a row with the class\'s first values.',
  );
});

test('section 2: the dump shows the count and no free row, and the reads hold every row', async () => {
  const given = die(3);
  given.seed = 11;
  const sim = createSim(
    { dice: [given], rows: [new Row()] },
    { device, seed: 7, slots: { dice: { size: 4, free } }, tick: () => {} },
  );
  sim.input('dice', 2, { face: 6, seed: 5 });
  await sim.step(1);
  expect(await sim.dump()).toBe(
    [
      'tick 1  seed 7  hz 60',
      'dice  2 of 4',
      '  [0]  seed 11  face 3',
      '  [2]  seed 5  face 6',
      'rows',
      '  [0]  n 0  x 0',
      '',
    ].join('\n'),
  );
  expect((await sim.read('dice')).length).toBe(4);
  expect((await sim.snapshot()).tables[0].rows.length).toBe(4);
});
