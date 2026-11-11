// Verifies: Design 0102.1
// Verifies: Design 0102.2
// Verifies: Design 0102.3
// Verifies: Design 0102.4
// Verifies: Design 0102.5
//
// The simulation of design record 0102: named tables and one tick function.

import { expect, test } from 'vitest';
import { createSim, type SimRecord } from '../src/index.ts';
import { replaySim } from '../src/test.ts';
import { Row, bump, shift } from './fixtures/sim.shade.ts';

const rows = (...ns: number[]) =>
  ns.map((n) => {
    const row = new Row();
    row.n = n;
    return row;
  });

const bumped = {
  seed: 1,
  hz: 64,
  tick: (t: { rows: Row[] }, time: { dt: number }) => bump(t.rows, time.dt),
};

test('a simulation keeps a copy of the first rows', async () => {
  const first = rows(1, 2);
  const sim = createSim({ rows: first }, bumped);
  expect(sim.rows('rows')).not.toBe(first);
  expect(sim.rows('rows')[0]).toBeInstanceOf(Row);
  await sim.step();
  expect(first.map((r) => r.n)).toEqual([1, 2]);
  expect(sim.rows('rows').map((r) => r.n)).toEqual([2, 3]);
});

test('step waits for the tick, counts ticks and gives dt and the tick number', async () => {
  const seen: number[] = [];
  const sim = createSim(
    { rows: rows(0) },
    {
      seed: 1,
      hz: 64,
      tick: async (t, time) => {
        seen.push(time.tick);
        await bump(t.rows, time.dt);
      },
    },
  );
  expect(sim.tick).toBe(0);
  await sim.step(64);
  expect(sim.tick).toBe(64);
  expect(sim.dt).toBe(1 / 64);
  expect(seen.length).toBe(64);
  expect(seen[63]).toBe(63);
  // 64 steps of 1 / 64 are exactly 1 in f32.
  expect(sim.rows('rows')[0]).toMatchObject({ n: 64, x: 1 });
  await sim.step(0);
  expect(sim.tick).toBe(64);
});

test('a buffered table gives read and write, and the two swap after each tick', async () => {
  const sim = createSim(
    { rows: rows(10, 20, 30) },
    { seed: 1, buffered: ['rows'], tick: (t) => shift(t.rows.write, t.rows.read) },
  );
  await sim.step();
  expect(sim.rows('rows').map((r) => r.n)).toEqual([20, 30, 10]);
  await sim.step();
  expect(sim.rows('rows').map((r) => r.n)).toEqual([30, 10, 20]);
  await sim.step(4);
  expect(sim.rows('rows').map((r) => r.n)).toEqual([10, 20, 30]);
});

test('a tick that is not buffered gets the array of rows', async () => {
  let got: unknown;
  const sim = createSim({ rows: rows(1) }, { seed: 1, tick: (t) => void (got = t.rows) });
  await sim.step();
  expect(Array.isArray(got)).toBe(true);
});

test('the dump prints each table by name and each row by index', async () => {
  const sim = createSim(
    { rows: rows(1, 2), more: rows(7) },
    { ...bumped, tick: (t, time) => bump(t.rows, time.dt) },
  );
  await sim.step(2);
  expect(sim.dump()).toBe(
    [
      'tick 2  seed 1  hz 64',
      'rows',
      '  [0]  n 3  x 0.03125',
      '  [1]  n 4  x 0.03125',
      'more',
      '  [0]  n 7  x 0',
      '',
    ].join('\n'),
  );
});

test('the snapshot is a copy that JSON holds', async () => {
  const sim = createSim({ rows: rows(1) }, bumped);
  const at0 = sim.snapshot();
  await sim.step();
  expect(at0).toEqual({
    version: 1,
    tick: 0,
    seed: 1,
    hz: 64,
    tables: [{ name: 'rows', rows: [{ n: 1, x: 0 }] }],
  });
  expect(JSON.parse(JSON.stringify(sim.snapshot())).tables[0].rows[0]).toEqual({ n: 2, x: 1 / 64 });
});

test('an input applies before the tick and is recorded with its tick', async () => {
  const sim = createSim({ rows: rows(0, 0) }, bumped);
  await sim.step(3);
  sim.input('rows', 1, { n: 100 });
  expect(sim.rows('rows')[1].n).toBe(3);
  await sim.step();
  // The write came before the tick: 100, then the tick added 1.
  expect(sim.rows('rows')[1].n).toBe(101);
  expect(sim.record()).toEqual({
    version: 1,
    seed: 1,
    hz: 64,
    ticks: 4,
    inputs: [{ tick: 3, table: 'rows', index: 1, fields: { n: 100 } }],
  });
});

test('an input reaches a buffered table', async () => {
  const sim = createSim(
    { rows: rows(10, 20, 30) },
    { seed: 1, buffered: ['rows'], tick: (t) => shift(t.rows.write, t.rows.read) },
  );
  await sim.step();
  sim.input('rows', 0, { n: 99 });
  await sim.step();
  // Before the tick the rows were 99, 30, 10. The tick shifted them.
  expect(sim.rows('rows').map((r) => r.n)).toEqual([30, 10, 99]);
});

test('the invariant: a replay gives the same dump as the run', async () => {
  const first = { rows: rows(10, 20, 30), more: rows(1) };
  const options = {
    buffered: ['rows'] as const,
    tick: async (t: { rows: { read: Row[]; write: Row[] }; more: Row[] }, time: { dt: number }) => {
      await shift(t.rows.write, t.rows.read);
      await bump(t.more, time.dt);
    },
  };
  const sim = createSim(first, { ...options, seed: 5 });
  await sim.step(4);
  sim.input('rows', 2, { n: 7, x: 0.5 });
  sim.input('more', 0, { n: 1000 });
  await sim.step(30);
  sim.input('rows', 0, { x: -1 });
  await sim.step(11);

  const record = JSON.parse(JSON.stringify(sim.record())) as SimRecord;
  const again = await replaySim(first, options, record);
  expect(again.tick).toBe(sim.tick);
  expect(again.dump()).toBe(sim.dump());
  expect(again.record()).toEqual(sim.record());
});

test('each wrong use is refused with the fact and the remedy', async () => {
  const sim = createSim({ rows: rows(1, 2) }, bumped);
  const loose = createSim as (t: unknown, o?: unknown) => unknown;
  expect(() => loose({ rows: rows(1) }, { tick: () => {} })).toThrow(
    'createSim(): the seed is undefined. Give an integer from 0 to 4294967295, for example { seed: 1 }.',
  );
  expect(() => loose({ rows: rows(1) }, { seed: 1, hz: 0, tick: () => {} })).toThrow(
    'createSim(): hz is 0.',
  );
  expect(() => loose({ rows: rows(1) }, { seed: 1 })).toThrow(
    'createSim(): the options hold no tick. Give the function that runs one tick, for example { tick: (t) => tick(t.cells) }.',
  );
  expect(() => loose({ rows: 5 }, { seed: 1, tick: () => {} })).toThrow(
    'createSim(): the table "rows" is not an array. Give each table its first rows as an array.',
  );
  expect(() => loose({ rows: rows(1) }, { seed: 1, buffered: ['cells'], tick: () => {} })).toThrow(
    'createSim(): buffered names "cells", which is no table. The tables are rows.',
  );
  const input = sim.input.bind(sim) as (t: string, i: number, f: unknown) => void;
  expect(() => input('cells', 0, { n: 1 })).toThrow(
    'Sim.input(): the simulation holds no table "cells". Its tables are rows.',
  );
  expect(() => input('rows', 2, { n: 1 })).toThrow(
    'Sim.input(): the index is 2, and the table "rows" has 2 rows. Give an integer from 0 to 1.',
  );
  expect(() => input('rows', 0, { m: 1 })).toThrow(
    'Sim.input(): the class Row declares no field "m", at "rows[0]". Its fields are n, x.',
  );
  expect(() => input('rows', 0, { x: NaN })).toThrow(
    'Sim.input(): the value of "x" at "rows[0]" is NaN. An input holds a finite number, a boolean, or an array of these.',
  );
  await expect(sim.step(-1)).rejects.toThrow(
    'Sim.step(): n is -1. Give the number of ticks as an integer from 0.',
  );
  const record = sim.record();
  await expect(
    replaySim({ rows: rows(1) }, bumped, { ...record, version: 2 } as unknown as SimRecord),
  ).rejects.toThrow(
    "replaySim(): the record's version is 2. This engine reads version 1, which sim.record() writes.",
  );
  const at = (tick: number) => ({ tick, table: 'rows', index: 0, fields: { n: 1 } });
  await expect(
    replaySim({ rows: rows(1) }, bumped, { ...record, ticks: 2, inputs: [at(2)] }),
  ).rejects.toThrow(
    "replaySim(): input 0 has the tick 2, and the record has 2 ticks. An input's tick is an integer from 0 to 1.",
  );
  await expect(
    replaySim({ rows: rows(1) }, bumped, { ...record, ticks: 3, inputs: [at(2), at(1)] }),
  ).rejects.toThrow(
    'replaySim(): input 1 has the tick 1 after an input of tick 2. Give the inputs in the order of their ticks.',
  );
});
