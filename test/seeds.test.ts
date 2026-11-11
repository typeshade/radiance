// Verifies: Design 0106.1
// Verifies: Design 0106.2
//
// The seed of a row and the replay from the function that builds the simulation (design
// record 0106). The device here is the CPU tier, with no browser.

import { hash32 } from 'typeshade/random';
import { createDevice, type Device } from 'typeshade/runtime';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createSim, type Frame, type SimRecord } from '../src/index.ts';
import { fnv1a } from '../src/seed.ts';
import { replaySim, type ReplayRun } from '../src/test.ts';
import { Die, Row, roll } from './fixtures/sim.shade.ts';

let device: Device;
beforeAll(async () => {
  device = await createDevice({ prefer: ['cpu'] });
});
afterAll(async () => {
  await device.dispose();
});

type Dice = { dice: Die[] };
const game = (seed: number, hz = 60) =>
  createSim(
    { dice: [new Die(), new Die(), new Die()] },
    { device, seed, hz, tick: (t: Frame<Dice, never>) => roll(t.dice) },
  );

test('section 1: a row with seed 0 gets the value of the formula', async () => {
  const dice = await game(7).read('dice');
  dice.forEach((die, i) => {
    expect(die.seed).toBe(hash32((7 ^ fnv1a(`dice[${i}]`)) >>> 0) >>> 0);
  });
  expect(new Set(dice.map((die) => die.seed)).size).toBe(3);
  expect((await game(7).read('dice')).map((d) => d.seed)).toEqual(dice.map((d) => d.seed));
  expect((await game(8).read('dice')).map((d) => d.seed)).not.toEqual(dice.map((d) => d.seed));
});

test('section 1: a row with a seed keeps it, and a row with no field seed gets none', async () => {
  const given = new Die();
  given.seed = 99;
  const sim = createSim(
    { dice: [given, new Die()], rows: [new Row()] },
    { device, seed: 7, tick: () => {} },
  );
  const dice = await sim.read('dice');
  expect(dice[0].seed).toBe(99);
  expect(dice[1].seed).not.toBe(0);
  expect(Object.keys((await sim.read('rows'))[0])).toEqual(['n', 'x']);
  // The caller's rows are not changed.
  expect(given.seed).toBe(99);
});

test('section 2: a record replays from the function that builds the simulation', async () => {
  const sim = game(7, 30);
  await sim.step(3);
  sim.input('dice', 1, { seed: 5 });
  await sim.step(4);
  const again = await replaySim((run) => game(run.seed, run.hz), sim.record());
  expect(again.tick).toBe(7);
  expect(await again.dump()).toBe(await sim.dump());
});

test('section 2: the refusals of a builder', async () => {
  const record = game(7).record();
  const loose = replaySim as unknown as (
    build: (run: ReplayRun) => unknown,
    record: SimRecord,
  ) => Promise<unknown>;
  await expect(loose(() => game(8), record)).rejects.toThrow(
    'replaySim(): the simulation has the seed 8 and 60 hz, and the record has the seed 7 and 60 hz. Build the simulation with the seed and the hz that the function gets.',
  );
  await expect(loose(() => 5, record)).rejects.toThrow(
    'replaySim(): the function returned no simulation. Return the simulation that createSim() gives, for example (run) => createGame({ seed: run.seed }).sim.',
  );
  const late = game(7);
  await late.step(2);
  await expect(loose(() => late, record)).rejects.toThrow(
    'replaySim(): the simulation is at tick 2. Return a simulation at tick 0.',
  );
  await expect(
    loose(() => game(7), { ...record, version: 2 } as unknown as SimRecord),
  ).rejects.toThrow("replaySim(): the record's version is 2.");
});
