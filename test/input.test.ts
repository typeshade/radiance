// Verifies: Design 0101.1
// Verifies: Design 0101.2
// Verifies: Design 0101.3
//
// Inputs, the record of a run and the replay (design record 0101, sections 1 to 3).

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createWorld, node, scene, type RunRecord } from '../src/index.ts';
import { replay, simulate } from '../src/test.ts';
import { Belt } from './fixtures/belt.shade.ts';
import { Probe } from './fixtures/probe.shade.ts';
import { Counter, Mover } from './fixtures/world.shade.ts';

const golden = (name: string) => readFileSync(new URL(`golden/${name}`, import.meta.url), 'utf8');

const factory = scene(node('line-1', node(Belt, { speed: 2 }), node('spare', Belt, { speed: 0 })));
const mixed = scene(node('root', node(Mover), node('g', node(Probe), node(Counter))));

test('rule 1: input checks and queues, and changes no node', () => {
  const world = createWorld(factory, { seed: 7 });
  world.input('line-1/Belt#0', { speed: 4 });
  expect(world.find<Belt>('line-1/Belt#0')?.speed).toBe(2);
  expect(world.record().inputs).toEqual([]);
});

test('rules 5 and 6: the next tick applies the queue before any step, and records it', () => {
  const world = createWorld(factory, { seed: 7, hz: 64 });
  world.step(3);
  world.input('line-1/Belt#0', { speed: 4, offset: 0 });
  world.step();
  const belt = world.find<Belt>('line-1/Belt#0');
  expect(belt?.speed).toBe(4);
  // The write came before the step: the offset moved by 4 / 64 from 0.
  expect(belt?.offset).toBe(4 / 64);
  expect(world.record().inputs).toEqual([
    { tick: 3, path: 'line-1/Belt#0', fields: { speed: 4, offset: 0 } },
  ]);
});

test('rule 5: inputs apply in the order of the calls', () => {
  const world = createWorld(factory, { seed: 7 });
  world.input('line-1/spare', { speed: 1 });
  world.input('line-1/spare', { speed: 3 });
  world.step();
  expect(world.find<Belt>('line-1/spare')?.speed).toBe(3);
  expect(world.record().inputs.map((i) => i.fields.speed)).toEqual([1, 3]);
});

test('rule 7: step(0) applies nothing, and the input waits for the next tick', () => {
  const world = createWorld(factory, { seed: 7 });
  world.input('line-1/spare', { speed: 1 });
  world.step(0);
  expect(world.find<Belt>('line-1/spare')?.speed).toBe(0);
  world.step();
  expect(world.find<Belt>('line-1/spare')?.speed).toBe(1);
  expect(world.record().inputs[0].tick).toBe(0);
});

test('rule 2: the path names a node with a class', () => {
  const world = createWorld(factory, { seed: 7 });
  expect(() => world.input('line-1', { speed: 1 })).toThrow(
    'World.input(): the node at "line-1" is a group and has no field. Give the path of a node with a class.',
  );
  expect(() => world.input('line-1/none', { speed: 1 })).toThrow(
    'World.input(): the scene holds no node at "line-1/none". Read the paths in world.dump().',
  );
});

test('rule 3: each field is a field of the class', () => {
  const world = createWorld(factory, { seed: 7 });
  expect(() => world.input('line-1/spare', { sped: 1 })).toThrow(
    'World.input(): the class Belt declares no field "sped", at "line-1/spare". Its fields are speed, offset.',
  );
});

test('rule 4: a value is a finite number, a boolean, or an array of these', () => {
  const world = createWorld(mixed, { seed: 7 });
  const loose = world.input.bind(world) as (path: string, fields: unknown) => void;
  loose('root/g/Probe#0', { on: false, pos: [3, 4], count: 9 });
  world.step();
  const probe = world.find<Probe>('root/g/Probe#0');
  expect(probe?.on).toBe(false);
  expect(Array.from(probe?.pos ?? [])).toEqual([3, 4]);
  expect(() => loose('root/Mover#0', { x: NaN })).toThrow(
    'World.input(): the value of "x" at "root/Mover#0" is NaN. An input holds a finite number, a boolean, an array of these, or an object for a field that holds an object.',
  );
  expect(() => loose('root/Mover#0', { x: '1' })).toThrow('is "1". An input holds');
  expect(() => loose('root/Mover#0', { x: { a: 1 } })).toThrow('is {"a":1}. An input holds');
  expect(() => loose('root/Mover#0', 5)).toThrow(
    'World.input(): the fields of the input at "root/Mover#0" are 5. Give an object of field values, for example { speed: 2 }.',
  );
});

test('an input is a copy: a later change to the caller`s array does not reach the world', () => {
  const world = createWorld(mixed, { seed: 7 });
  const pos = [3, 4];
  world.input('root/g/Probe#0', { pos });
  pos[0] = 99;
  world.step();
  expect(Array.from(world.find<Probe>('root/g/Probe#0')?.pos ?? [])).toEqual([3, 4]);
  expect(world.record().inputs[0].fields.pos).toEqual([3, 4]);
});

test('the record of a run equals its golden file, and is a copy', () => {
  const world = createWorld(factory, { seed: 7 });
  world.input('line-1/Belt#0', { speed: 4 });
  world.step(2);
  const record = world.record();
  expect(JSON.stringify(record, null, 2) + '\n').toBe(golden('record-2.json'));
  world.input('line-1/spare', { speed: 1 });
  world.step();
  expect(record.ticks).toBe(2);
  expect(record.inputs.length).toBe(1);
});

test('the invariant: a replay of a record gives the same dump as the run', () => {
  const world = createWorld(mixed, { seed: 11 });
  world.step(5);
  world.input('root/Mover#0', { speed: 3 });
  world.input('root/g/Probe#0', { speed: 2, pos: [5, 6] });
  world.step(40);
  world.input('root/Mover#0', { speed: -1, x: 0.25 });
  world.step(1);
  world.input('root/g/Counter#0', { ticks: 1000 });
  world.step(200);

  const record = JSON.parse(JSON.stringify(world.record())) as RunRecord;
  const again = replay(mixed, record);
  expect(again.tick).toBe(world.tick);
  expect(again.dump()).toBe(world.dump());
  expect(JSON.stringify(again.snapshot())).toBe(JSON.stringify(world.snapshot()));
  expect(again.record()).toEqual(world.record());
});

test('a replay of a run with no input equals simulate', () => {
  const run = simulate(factory, { ticks: 30, seed: 7 });
  expect(replay(factory, run.record()).dump()).toBe(run.dump());
});

test('replay refuses a record it cannot run', () => {
  const base = simulate(factory, { ticks: 3, seed: 7 }).record();
  const loose = replay as (s: unknown, r: unknown) => unknown;
  expect(() => loose(factory, { ...base, version: 2 })).toThrow(
    "replay(): the record's version is 2. This engine reads version 1, which world.record() writes.",
  );
  const at = (tick: number) => ({ tick, path: 'line-1/spare', fields: { speed: 1 } });
  expect(() => replay(factory, { ...base, inputs: [at(3)] })).toThrow(
    "replay(): input 0 has the tick 3, and the record has 3 ticks. An input's tick is an integer from 0 to 2.",
  );
  expect(() => replay(factory, { ...base, inputs: [at(2), at(1)] })).toThrow(
    'replay(): input 1 has the tick 1 after an input of tick 2. Give the inputs in the order of their ticks.',
  );
  expect(() =>
    replay(factory, { ...base, inputs: [{ tick: 0, path: 'line-1/none', fields: {} }] }),
  ).toThrow('World.input(): the scene holds no node at "line-1/none".');
});
