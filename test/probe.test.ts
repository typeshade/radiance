// Verifies: Design 0100.2
//
// The instrument of design record 0100, section 7: a class of a `"use typeshade"` file is built
// with `new` in a test, on the CPU tier, with no device. The test states what the host gets for
// each kind of field, since the dump and the snapshot of the record print these values.

import { expect, test } from 'vitest';
import { Base, Inner, Probe } from './fixtures/probe.shade.ts';

/** The record's `dt`: `1 / hz` rounded to `f32`. */
const dt = Math.fround(1 / 60);

test('the fields of an instance are its own properties, in the order the classes declare them', () => {
  const probe = new Probe();
  expect(Object.keys(probe)).toEqual([
    'id',
    'speed',
    'offset',
    'count',
    'on',
    'pos',
    'basis',
    'slots',
    'inner',
  ]);
});

test('each kind of field is the host value the record prints', () => {
  const probe = new Probe();
  expect(probe.id).toBe(7);
  expect(probe.speed).toBe(1);
  expect(probe.count).toBe(-2);
  expect(probe.on).toBe(true);
  expect(Array.from(probe.pos)).toEqual([1, 2]);
  expect(Array.from(probe.slots)).toEqual([1, 2, 3]);
  // A matrix is a plain array of its components, column by column.
  expect(Array.isArray(probe.basis)).toBe(true);
  expect(Array.from(probe.basis)).toEqual([1, 0, 0, 1]);
  expect(Array.isArray(probe.pos)).toBe(true);
  expect(Array.isArray(probe.slots)).toBe(true);
  expect(JSON.parse(JSON.stringify(probe.inner))).toEqual({ a: 0.5, n: 3 });
});

test('a class that extends another is an instance of both, and runs the methods of both', () => {
  const probe = new Probe();
  expect(probe).toBeInstanceOf(Probe);
  expect(probe).toBeInstanceOf(Base);
  probe.bump();
  expect(probe.id).toBe(8);
});

test('step changes the fields in place, with f32 arithmetic', () => {
  const probe = new Probe();
  probe.speed = 2;
  for (let tick = 0; tick < 30; tick++) probe.step(dt);
  expect(probe.count).toBe(28);
  // Thirty steps of `2 * dt` in f32 do not sum to exactly 1 (record 0100, section 4).
  expect(probe.offset).toBe(3.5762786865234375e-7);

  // The same arithmetic in JavaScript, rounded to f32 after each operation.
  let offset = 0;
  for (let tick = 0; tick < 30; tick++) {
    offset = Math.fround(offset + Math.fround(2 * dt));
    offset = Math.fround(offset - Math.floor(offset));
  }
  expect(probe.offset).toBe(offset);
});

test('a field whose type is a class holds that class', () => {
  const probe = new Probe();
  expect(Object.keys(probe.inner)).toEqual(['a', 'n']);
  expect(probe.inner).toBeInstanceOf(Inner);
  expect(new Inner().a).toBe(0.5);
});
