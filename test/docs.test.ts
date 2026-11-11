// The examples of `README.md` and of `docs/vision.md` (section 4, moments 1 to 4), run as they
// are written there. A document that shows code the engine does not run is a defect.

import { expect, test } from 'vitest';
import { createWorld, node, scene } from '../src/index.ts';
import { replay, simulate } from '../src/test.ts';
import { Belt } from './fixtures/belt.shade.ts';

const factory = scene(node('line-1', node(Belt, { speed: 2 }), node('spare', Belt, { speed: 0 })));

test('vision, moment 3: a belt wraps after one unit at 64 ticks in a second', () => {
  const world = simulate(factory, { ticks: 32, seed: 7, hz: 64 });
  expect(world.find<Belt>('line-1/Belt#0')?.offset).toBe(0);
});

test('README and vision, moment 4: the dump of the factory at tick 30', () => {
  const world = simulate(factory, { ticks: 30, seed: 7 });
  expect(world.dump()).toBe(
    [
      'tick 30  seed 7  hz 60',
      'line-1',
      '  Belt#0  speed 2  offset 3.5762787e-7',
      '  spare  Belt  speed 0  offset 0',
      '',
    ].join('\n'),
  );
});

test('README and vision, moment 5: a record replays to the same dump', () => {
  const world = createWorld(factory, { seed: 7 });
  world.input('line-1/Belt#0', { speed: 4 });
  world.step(2);

  const record = world.record();
  expect(replay(factory, record).dump() === world.dump()).toBe(true);
  expect(record).toEqual({
    version: 1,
    seed: 7,
    hz: 60,
    ticks: 2,
    inputs: [{ tick: 0, path: 'line-1/Belt#0', fields: { speed: 4 } }],
  });
});

test('README: a simulation of tables and a tick runs and prints its dump', async () => {
  const { createDevice } = await import('typeshade/runtime');
  const { createSim } = await import('../src/index.ts');
  const { Cell, tick } = await import('../examples/factory/cells.shade.ts');
  const width = 3;
  const height = 1;
  const cells = Array.from({ length: width * height }, () => new Cell());
  const device = await createDevice({ prefer: ['cpu'] });
  const sim = createSim(
    { cells },
    {
      device,
      seed: 1,
      buffered: ['cells'],
      tick: (t) => tick(t.cells.write, t.cells.read, width, height),
    },
  );
  await sim.step(200);
  expect(sim.tick).toBe(200);
  expect((await sim.dump()).split('\n')[0]).toBe('tick 200  seed 1  hz 60');
  await device.dispose();
});

test('README: a project loads, runs and prints its dump', async () => {
  const { load } = await import('../src/test.ts');
  const game = await load('examples/dungeon', { seed: 7, level: 'cave' });
  await game.step(1);
  expect((await game.dump()).split('\n')[0]).toBe('tick 1  seed 7  hz 60');
  await game.dispose();
});
