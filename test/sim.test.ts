// Verifies: Design 0102.1
// Verifies: Design 0102.2
// Verifies: Design 0102.3
// Verifies: Design 0102.4
// Verifies: Design 0102.5
// Verifies: Design 0104.1
// Verifies: Design 0104.2
// Verifies: Design 0104.3
// Verifies: Design 0104.4
//
// The simulation of design records 0102 and 0104: named tables on a device and one tick
// function. The device here is the CPU tier, with no browser.

import { createDevice, type Device } from 'typeshade/runtime';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createSim, type Frame, type SimRecord, type TickTime } from '../src/sim.ts';
import { replaySim } from '../src/sim-replay.ts';
import { Row, bump, shift } from './fixtures/sim.shade.ts';

let device: Device;
beforeAll(async () => {
  device = await createDevice({ prefer: ['cpu'] });
});
afterAll(async () => {
  await device.dispose();
});

const rows = (...ns: number[]) =>
  ns.map((n) => {
    const row = new Row();
    row.n = n;
    return row;
  });

type One = { rows: Row[] };
const bumped = () => ({
  device,
  seed: 1,
  hz: 64,
  tick: (t: Frame<One, never>, time: TickTime) => bump(t.rows, time.dt),
});
const shifted = () => ({
  device,
  seed: 1,
  buffered: ['rows'] as const,
  tick: (t: Frame<One, 'rows'>) => shift(t.rows.write, t.rows.read),
});
const ns = async (sim: { read(name: 'rows'): Promise<Row[]> }) =>
  (await sim.read('rows')).map((r) => r.n);

test('the device of the tests is the CPU tier', () => {
  expect(device.tier).toBe('cpu');
});

test('a simulation keeps a copy of the first rows on the device', async () => {
  const first = rows(1, 2);
  const sim = createSim({ rows: first }, bumped());
  await sim.step();
  expect(first.map((r) => r.n)).toEqual([1, 2]);
  const read = await sim.read('rows');
  expect(read.map((r) => r.n)).toEqual([2, 3]);
  expect(read[0]).toBeInstanceOf(Row);
});

test('step waits for the tick, counts ticks and gives dt and the tick number', async () => {
  const seen: number[] = [];
  const sim = createSim(
    { rows: rows(0) },
    {
      device,
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
  await sim.wait();
  expect(sim.tick).toBe(64);
  expect(sim.dt).toBe(1 / 64);
  expect(seen.length).toBe(64);
  expect(seen[63]).toBe(63);
  // 64 steps of 1 / 64 are exactly 1 in f32.
  expect((await sim.read('rows'))[0]).toMatchObject({ n: 64, x: 1 });
  await sim.step(0);
  expect(sim.tick).toBe(64);
});

test('a buffered table gives read and write, and the two swap after each tick', async () => {
  const sim = createSim({ rows: rows(10, 20, 30) }, shifted());
  await sim.step();
  expect(await ns(sim)).toEqual([20, 30, 10]);
  await sim.step();
  expect(await ns(sim)).toEqual([30, 10, 20]);
  await sim.step(4);
  expect(await ns(sim)).toEqual([10, 20, 30]);
});

test('table gives the handle the last tick wrote, for a buffered table too', async () => {
  const sim = createSim({ rows: rows(10, 20, 30) }, shifted());
  const before = sim.table('rows');
  await sim.step();
  const after = sim.table('rows');
  expect(after).not.toBe(before);
  expect((await after.read()).map((r) => r.n)).toEqual([20, 30, 10]);
  await sim.step();
  expect(sim.table('rows')).toBe(before);

  const plain = createSim({ rows: rows(1) }, bumped());
  const handle = plain.table('rows');
  await plain.step(3);
  expect(plain.table('rows')).toBe(handle);
});

test('a tick with no input reads no table', async () => {
  const sim = createSim({ rows: rows(1, 2) }, bumped());
  const read = vi.spyOn(sim.table('rows'), 'read');
  await sim.step(5);
  expect(read).not.toHaveBeenCalled();
  sim.input('rows', 0, { n: 9 });
  await sim.step();
  expect(read).toHaveBeenCalledTimes(1);
  await sim.step(5);
  expect(read).toHaveBeenCalledTimes(1);
  read.mockRestore();
});

test('the dump prints each table by name and each row by index', async () => {
  const sim = createSim(
    { rows: rows(1, 2), more: rows(7) },
    { device, seed: 1, hz: 64, tick: (t, time) => bump(t.rows, time.dt) },
  );
  await sim.step(2);
  expect(await sim.dump()).toBe(
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
  const sim = createSim({ rows: rows(1) }, bumped());
  const at0 = await sim.snapshot();
  await sim.step();
  expect(at0).toEqual({
    version: 1,
    tick: 0,
    seed: 1,
    hz: 64,
    tables: [{ name: 'rows', rows: [{ n: 1, x: 0 }] }],
  });
  expect(JSON.parse(JSON.stringify(await sim.snapshot())).tables[0].rows[0]).toEqual({
    n: 2,
    x: 1 / 64,
  });
});

test('an input applies before the tick and is recorded with its tick', async () => {
  const sim = createSim({ rows: rows(0, 0) }, bumped());
  await sim.step(3);
  sim.input('rows', 1, { n: 100 });
  expect((await sim.read('rows'))[1].n).toBe(3);
  await sim.step();
  // The write came before the tick: 100, then the tick added 1.
  expect((await sim.read('rows'))[1].n).toBe(101);
  expect((await sim.read('rows'))[0].n).toBe(4);
  expect(sim.record()).toEqual({
    version: 1,
    seed: 1,
    hz: 64,
    ticks: 4,
    inputs: [{ tick: 3, table: 'rows', index: 1, fields: { n: 100 } }],
  });
});

test('an input reaches a buffered table', async () => {
  const sim = createSim({ rows: rows(10, 20, 30) }, shifted());
  await sim.step();
  sim.input('rows', 0, { n: 99 });
  await sim.step();
  // Before the tick the rows were 99, 30, 10. The tick shifted them.
  expect(await ns(sim)).toEqual([30, 10, 99]);
});

test('the invariant: a replay gives the same dump as the run', async () => {
  type Two = { rows: Row[]; more: Row[] };
  const first = { rows: rows(10, 20, 30), more: rows(1) };
  const options = {
    device,
    buffered: ['rows'] as const,
    tick: async (t: Frame<Two, 'rows'>, time: TickTime) => {
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
  expect(await again.dump()).toBe(await sim.dump());
  expect(again.record()).toEqual(sim.record());
});

test('each wrong use is refused with the fact and the remedy', async () => {
  const sim = createSim({ rows: rows(1, 2) }, bumped());
  const loose = createSim as (t: unknown, o?: unknown) => unknown;
  expect(() => loose({ rows: rows(1) }, { seed: 1, tick: () => {} })).toThrow(
    "createSim(): the options hold no device. Give a device of the compiler's runtime, for example { device: await createDevice({ prefer: ['cpu'] }) }.",
  );
  expect(() => loose({ rows: rows(1) }, { device, tick: () => {} })).toThrow(
    'createSim(): the seed is undefined. Give an integer from 0 to 4294967295, for example { seed: 1 }.',
  );
  expect(() => loose({ rows: rows(1) }, { device, seed: 1, hz: 0, tick: () => {} })).toThrow(
    'createSim(): hz is 0.',
  );
  expect(() => loose({ rows: rows(1) }, { device, seed: 1 })).toThrow(
    'createSim(): the options hold no tick. Give the function that runs one tick, for example { tick: (t) => tick(t.cells) }.',
  );
  expect(() => loose({ rows: 5 }, { device, seed: 1, tick: () => {} })).toThrow(
    'createSim(): the table "rows" is not an array. Give each table its first rows as an array.',
  );
  expect(() => loose({ rows: [] }, { device, seed: 1, tick: () => {} })).toThrow(
    'createSim(): the table "rows" has no row. Give each table one row or more.',
  );
  expect(() =>
    loose({ rows: rows(1) }, { device, seed: 1, buffered: ['cells'], tick: () => {} }),
  ).toThrow('createSim(): buffered names "cells", which is no table. The tables are rows.');
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
    'Sim.input(): the value of "x" at "rows[0]" is NaN. An input holds a finite number, a boolean, an array of these, or an object for a field that holds an object.',
  );
  await expect(sim.step(-1)).rejects.toThrow(
    'Sim.step(): n is -1. Give the number of ticks as an integer from 0.',
  );
  const record = sim.record();
  const options = bumped();
  await expect(
    replaySim({ rows: rows(1) }, options, { ...record, version: 2 } as unknown as SimRecord),
  ).rejects.toThrow(
    "replaySim(): the record's version is 2. This engine reads version 1, which sim.record() writes.",
  );
  const at = (tick: number) => ({ tick, table: 'rows', index: 0, fields: { n: 1 } });
  await expect(
    replaySim({ rows: rows(1) }, options, { ...record, ticks: 2, inputs: [at(2)] }),
  ).rejects.toThrow(
    "replaySim(): input 0 has the tick 2, and the record has 2 ticks. An input's tick is an integer from 0 to 1.",
  );
  await expect(
    replaySim({ rows: rows(1) }, options, { ...record, ticks: 3, inputs: [at(2), at(1)] }),
  ).rejects.toThrow(
    'replaySim(): input 1 has the tick 1 after an input of tick 2. Give the inputs in the order of their ticks.',
  );
});
