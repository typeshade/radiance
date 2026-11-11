// Verifies: Design 0105.2
//
// An input writes a field that holds a class (design record 0105, section 2). The device here
// is the CPU tier, with no browser.

import { createDevice, type Device } from 'typeshade/runtime';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createWorld, node, scene } from '../src/index.ts';
import { createSim, type Frame } from '../src/sim.ts';
import { replaySim } from '../src/sim-replay.ts';
import { replay } from '../src/test.ts';
import { Carrier, Holder, run } from './fixtures/kinds.shade.ts';

let device: Device;
beforeAll(async () => {
  device = await createDevice({ prefer: ['cpu'] });
});
afterAll(async () => {
  await device.dispose();
});

type One = { rows: Holder[] };
const holders = () => [new Holder(), new Holder()];
const options = () => ({
  device,
  seed: 1,
  tick: (t: Frame<One, never>) => run(t.rows),
});

test('rules 1, 2 and 4: an object writes the fields it names, and the others keep their values', async () => {
  const sim = createSim({ rows: holders() }, options());
  sim.input('rows', 1, { kind: 1, part: { dir: 3 } });
  await sim.step(2);
  sim.input('rows', 1, { part: { dir: 2 } });
  await sim.step(1);
  const rows = await sim.read('rows');
  expect(rows[1].kind).toBe(1);
  expect({ ...rows[1].part }).toEqual({ dir: 2, count: 3 });
  expect({ ...rows[0].part }).toEqual({ dir: 0, count: 0 });
  expect((await sim.dump()).split('\n')[3]).toBe('  [1]  kind 1  part {dir 2, count 3}');
});

test('rules 2 and 3: the refusals name the object and its fields', () => {
  const sim = createSim({ rows: holders() }, options());
  const input = sim.input.bind(sim) as (t: string, i: number, f: unknown) => void;
  expect(() => input('rows', 0, { part: { speed: 1 } })).toThrow(
    'Sim.input(): the object declares no field "speed", at "rows[0].part". Its fields are dir, count.',
  );
  expect(() => input('rows', 0, { kind: { a: 1 } })).toThrow(
    'Sim.input(): the value of "kind" at "rows[0]" is {"a":1}. An input holds a finite number, a boolean, an array of these, or an object for a field that holds an object.',
  );
  expect(() => input('rows', 0, { part: 5 })).toThrow(
    'Sim.input(): the value of "part" at "rows[0]" is 5, and the field holds an object. Give an object of its fields: dir, count.',
  );
  expect(() => input('rows', 0, { part: { dir: 'east' } })).toThrow(
    'Sim.input(): the value of "dir" at "rows[0].part" is "east". An input holds',
  );
});

test('rule 5: the record holds the object, and the run replays to the same dump', async () => {
  const sim = createSim({ rows: holders() }, options());
  await sim.step(1);
  sim.input('rows', 0, { kind: 1, part: { dir: 1 } });
  await sim.step(3);
  const record = sim.record();
  expect(record.inputs).toEqual([
    { tick: 1, table: 'rows', index: 0, fields: { kind: 1, part: { dir: 1 } } },
  ]);
  expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  const again = await replaySim({ rows: holders() }, options(), record);
  expect(await again.dump()).toBe(await sim.dump());
});

test('rule 6: an object value on a world', () => {
  const carriers = scene(node('root', node(Carrier)));
  const world = createWorld(carriers, { seed: 7 });
  world.input('root/Carrier#0', { part: { dir: 2 } });
  world.step(2);
  expect({ ...world.find<Carrier>('root/Carrier#0')?.part }).toEqual({ dir: 2, count: 2 });
  expect(() =>
    (world.input.bind(world) as (p: string, f: unknown) => void)('root/Carrier#0', {
      part: { speed: 1 },
    }),
  ).toThrow(
    'World.input(): the object declares no field "speed", at "root/Carrier#0.part". Its fields are dir, count.',
  );
  expect(replay(carriers, world.record()).dump()).toBe(world.dump());
});
