// Verifies: Design 0100.4
// Verifies: Design 0100.5
//
// The world (design record 0100, section 3): the tables, the schedule, the tick and `dt`.

import { expect, test, vi } from 'vitest';
import { createWorld, node, scene } from '../src/index.ts';
import { simulate } from '../src/test.ts';
import { Counter, Marker, Mover } from './fixtures/world.shade.ts';

const three = scene(
  node(
    'root',
    node(Mover, { speed: 2 }),
    node('group', node(Counter), node('m', Marker, { id: 5 }), node(Mover)),
    node(Counter),
  ),
);

test('the tables are in the order the scene first meets each class', () => {
  const world = createWorld(three, { seed: 1 });
  expect(world.tables.map((t) => t.cls)).toEqual([Mover, Counter, Marker]);
});

test('the rows of a table are in visit order, and carry the first values', () => {
  const world = createWorld(three, { seed: 1 });
  expect(world.tables[0].rows.map((r) => r.node.path)).toEqual([
    'root/Mover#0',
    'root/group/Mover#0',
  ]);
  expect(world.table(Mover).map((m) => m.speed)).toEqual([2, 1]);
  expect(world.table(Marker).map((m) => m.id)).toEqual([5]);
  expect(world.find<Marker>('root/group/m')).toBe(world.table(Marker)[0]);
  expect(world.find('root/group')).toBeUndefined();
  expect(world.find('root/none')).toBeUndefined();
});

test('a world starts at tick 0 and has run no step', () => {
  const world = createWorld(three, { seed: 1 });
  expect(world.tick).toBe(0);
  expect(world.table(Counter).map((c) => c.ticks)).toEqual([0, 0]);
});

test('step runs each row once in each tick, tables in schedule order, rows in visit order', () => {
  const world = createWorld(three, { seed: 1 });
  const calls: string[] = [];
  for (const table of world.tables) {
    for (const row of table.rows) {
      if (!('step' in row.instance)) continue;
      const spy = vi.spyOn(row.instance as { step(dt: number): void }, 'step');
      spy.mockImplementation(() => void calls.push(row.node.path));
    }
  }
  world.step(2);
  const order = ['root/Mover#0', 'root/group/Mover#0', 'root/group/Counter#0', 'root/Counter#0'];
  expect(calls).toEqual([...order, ...order]);
  expect(world.tick).toBe(2);
});

test('a class with no step has a table and no call', () => {
  const world = simulate(three, { ticks: 3, seed: 1 });
  expect(world.table(Marker)[0].id).toBe(5);
  expect(world.table(Counter).map((c) => c.ticks)).toEqual([3, 3]);
});

test('dt is Math.fround(1 / hz) in each call, and hz is 60 unless given', () => {
  const at60 = simulate(three, { ticks: 4, seed: 1 });
  expect(at60.hz).toBe(60);
  expect(at60.dt).toBe(Math.fround(1 / 60));
  expect(at60.table(Counter).map((c) => c.last)).toEqual([at60.dt, at60.dt]);

  const at64 = simulate(three, { ticks: 32, seed: 1, hz: 64 });
  expect(at64.dt).toBe(1 / 64);
  // 1 / 64 is exact in f32, so 32 ticks at speed 2 move exactly 1.
  expect(at64.table(Mover)[0].x).toBe(1);
});

test('step(0) runs nothing, and step() runs one tick', () => {
  const world = createWorld(three, { seed: 1 });
  world.step(0);
  expect(world.tick).toBe(0);
  world.step();
  expect(world.tick).toBe(1);
});

test('two nodes of one class do not share an instance', () => {
  const world = createWorld(three, { seed: 1 });
  const [a, b] = world.table(Mover);
  expect(a).not.toBe(b);
  world.step(1);
  expect(a.x).not.toBe(b.x);
});

test('the seed is required and stored, and a wrong option is refused', () => {
  expect(createWorld(three, { seed: 7 }).seed).toBe(7);
  const loose = createWorld as (s: unknown, o?: unknown) => unknown;
  expect(() => loose(three)).toThrow(
    'createWorld(): the seed is undefined. Give an integer from 0 to 4294967295, for example { seed: 1 }.',
  );
  expect(() => createWorld(three, { seed: -1 })).toThrow('createWorld(): the seed is -1.');
  expect(() => createWorld(three, { seed: 1, hz: 0 })).toThrow(
    'createWorld(): hz is 0. Give the tick rate as an integer from 1, for example { hz: 60 }.',
  );
  expect(() => createWorld(three, { seed: 1 }).step(-1)).toThrow(
    'World.step(): n is -1. Give the number of ticks as an integer from 0.',
  );
});

test('table of a class the scene does not hold names the classes it holds', () => {
  const world = createWorld(scene(node(Mover)), { seed: 1 });
  expect(() => world.table(Counter)).toThrow(
    'World.table(): the scene holds no node of the class Counter. Its classes are Mover.',
  );
});
