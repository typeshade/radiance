// Verifies: Design 0101.4
//
// The seed of a node (design record 0101, section 4).

import { hash32, uniform, xorshift32 } from 'typeshade/random';
import { expect, test } from 'vitest';
import { createWorld, fnv1a, node, nodeSeed, scene } from '../src/index.ts';
import { replay, simulate } from '../src/test.ts';
import { Spark } from './fixtures/spark.shade.ts';

const fire = scene(node('fire', node(Spark), node(Spark), node('fixed', Spark, { seed: 5 })));

test('fnv1a is the 32-bit FNV-1a hash', () => {
  // The empty text gives the offset basis. Each code unit gives two bytes, low byte first, so
  // the test computes the hash a second way, byte by byte.
  expect(fnv1a('')).toBe(0x811c9dc5);
  const bytes = (text: string) => {
    let hash = 0x811c9dc5;
    for (const ch of text) {
      for (const byte of [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >>> 8]) {
        hash = Math.imul(hash ^ byte, 0x01000193);
      }
    }
    return hash >>> 0;
  };
  expect(fnv1a('fire/Spark#0')).toBe(bytes('fire/Spark#0'));
  expect(fnv1a('a')).not.toBe(fnv1a('b'));
  expect(fnv1a('가')).not.toBe(fnv1a('각'));
});

test('a class that calls typeshade/random in step runs on the CPU tier', () => {
  const spark = new Spark();
  spark.seed = 1;
  spark.step(0);
  expect(spark.seed).toBe(xorshift32(1));
  expect(spark.heat).toBe(uniform(xorshift32(1)));
});

test('rules 1 and 2: the world gives an unset seed the value of the formula', () => {
  const world = createWorld(fire, { seed: 7 });
  const [a, b] = world.table(Spark);
  expect(a.seed).toBe(hash32((7 ^ fnv1a('fire/Spark#0')) >>> 0) >>> 0);
  expect(a.seed).toBe(nodeSeed(7, 'fire/Spark#0'));
  expect(b.seed).toBe(nodeSeed(7, 'fire/Spark#1'));
});

test('two nodes have different seeds, and so different numbers', () => {
  const world = simulate(fire, { ticks: 1, seed: 7 });
  const [a, b] = world.table(Spark);
  expect(a.seed).not.toBe(b.seed);
  expect(a.heat).not.toBe(b.heat);
  expect(a.heat).toBeGreaterThanOrEqual(0);
  expect(a.heat).toBeLessThan(1);
});

test('rule 3: a seed of 0 becomes 1', () => {
  // hash32(0) is 0, so a world seed equal to the path's hash gives the word 0.
  const path = 'fire/Spark#0';
  expect(hash32(0)).toBe(0);
  expect(nodeSeed(fnv1a(path), path)).toBe(1);
  const world = createWorld(fire, { seed: fnv1a(path) });
  expect(world.table(Spark)[0].seed).toBe(1);
});

test('rule 4: a node that gives a seed keeps it', () => {
  const world = createWorld(fire, { seed: 7 });
  expect(world.find<Spark>('fire/fixed')?.seed).toBe(5);
});

test('one node has the same seed in each run, and another world seed gives another', () => {
  const a = createWorld(fire, { seed: 7 }).table(Spark)[0].seed;
  const b = createWorld(fire, { seed: 7 }).table(Spark)[0].seed;
  const c = createWorld(fire, { seed: 8 }).table(Spark)[0].seed;
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});

test("a node's seed does not change when another node is added to the scene", () => {
  const more = scene(
    node('fire', node('first', Spark), node(Spark), node(Spark), node('fixed', Spark, { seed: 5 })),
  );
  const before = createWorld(fire, { seed: 7 });
  const after = createWorld(more, { seed: 7 });
  expect(after.find<Spark>('fire/Spark#0')?.seed).toBe(before.find<Spark>('fire/Spark#0')?.seed);
  expect(after.find<Spark>('fire/Spark#1')?.seed).toBe(before.find<Spark>('fire/Spark#1')?.seed);
});

test('a run with random numbers replays to the same dump', () => {
  const world = createWorld(fire, { seed: 7 });
  world.step(10);
  world.input('fire/Spark#1', { seed: 123 });
  world.step(50);
  expect(replay(fire, world.record()).dump()).toBe(world.dump());
  expect(simulate(fire, { ticks: 60, seed: 7 }).dump()).not.toBe(world.dump());
});

test('the dump shows the seed as any other field', () => {
  const world = createWorld(scene(node(Spark, { seed: 5 })), { seed: 7 });
  expect(world.dump()).toBe('tick 0  seed 7  hz 60\nSpark#0  seed 5  heat 0\n');
});
