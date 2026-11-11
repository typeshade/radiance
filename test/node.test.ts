// Verifies: Design 0100.3
//
// `node` and `scene` (design record 0100, section 2): each rule's valid form and its error text.

import { expect, test } from 'vitest';
import { node, scene } from '../src/index.ts';
import { Inner, Probe } from './fixtures/probe.shade.ts';

const paths = (s: ReturnType<typeof scene>) => s.nodes.map((n) => n.path);

test('node reads a name, a class, the field values and the children, in that order', () => {
  const spec = node('a', Probe, { speed: 2 }, node(Inner), node('g', node(Inner)));
  expect(spec.name).toBe('a');
  expect(spec.cls).toBe(Probe);
  expect(spec.fields).toEqual({ speed: 2 });
  expect(spec.children.length).toBe(2);
  expect(node(Probe).name).toBeUndefined();
  expect(node(Probe, { speed: 3 }).fields).toEqual({ speed: 3 });
  expect(node('g').cls).toBeUndefined();
});

test('a node is immutable', () => {
  const spec = node(Probe, { speed: 2 });
  expect(Object.isFrozen(spec)).toBe(true);
  expect(Object.isFrozen(spec.fields)).toBe(true);
  expect(Object.isFrozen(spec.children)).toBe(true);
});

test('rule 1: a node with no class is a group, and a group has a name', () => {
  expect(() => (node as (...a: unknown[]) => unknown)()).toThrow(
    'node(): a node with no class is a group, and a group has a name. Give the name first.',
  );
});

test('rule 2: an unnamed node takes <Class>#<n>, counted for each class among its siblings', () => {
  const s = scene(node('root', node(Probe), node(Inner), node('named', Probe), node(Probe)));
  expect(paths(s)).toEqual(['root', 'root/Probe#0', 'root/Inner#0', 'root/named', 'root/Probe#1']);
  expect(s.nodes.map((n) => n.named)).toEqual([true, false, false, true, false]);
  expect(paths(scene(node(Probe)))).toEqual(['Probe#0']);
});

test('rule 3: two siblings do not have the same name', () => {
  expect(() => scene(node('root', node('a', Probe), node('a', Inner)))).toThrow(
    'scene(): two children of "root" have the name "a". Give each sibling its own name.',
  );
  expect(() => scene(node('root', node('Probe#0'), node(Probe)))).toThrow(
    'scene(): two children of "root" have the name "Probe#0". Give each sibling its own name.',
  );
  // The same name under two parents is two paths.
  expect(paths(scene(node('root', node('x', node('a')), node('y', node('a')))))).toEqual([
    'root',
    'root/x',
    'root/x/a',
    'root/y',
    'root/y/a',
  ]);
});

test('rule 4: a field value names a field the class declares', () => {
  const bad = node('root', node(Inner, { b: 1 } as object));
  expect(() => scene(bad)).toThrow(
    'scene(): the class Inner declares no field "b", at "root/Inner#0". Its fields are a, n.',
  );
});

test('rule 5: a name does not hold "/", and is not empty', () => {
  expect(() => node('a/b')).toThrow(
    'node(): the name "a/b" holds "/". A path joins names with "/", so use another character.',
  );
  expect(() => node('')).toThrow(
    'node(): the name is an empty string. Give a name of one character or more.',
  );
});

test('rule 6: scene visits depth first, a parent before its children, and is immutable', () => {
  const s = scene(node('root', node('a', node(Probe, node(Inner))), node('b')));
  expect(paths(s)).toEqual([
    'root',
    'root/a',
    'root/a/Probe#0',
    'root/a/Probe#0/Inner#0',
    'root/b',
  ]);
  expect(s.nodes.map((n) => n.depth)).toEqual([0, 1, 2, 3, 1]);
  expect(Object.isFrozen(s)).toBe(true);
  expect(Object.isFrozen(s.nodes)).toBe(true);
});

test('an argument out of order is refused with the order', () => {
  const loose = node as (...a: unknown[]) => unknown;
  expect(() => loose('a', { speed: 1 })).toThrow(
    'node(): an object of field values follows no class. Put the class before the object.',
  );
  expect(() => loose(Probe, node(Inner), 'late')).toThrow(
    'node(): "late" is where a child is read. Give the name, the class and the field values first, then each child as node(...).',
  );
  expect(() => (scene as (r: unknown) => unknown)('root')).toThrow(
    'scene(): "root" is not a node. Give the root as node(...).',
  );
});
