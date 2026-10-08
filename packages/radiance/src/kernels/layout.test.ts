// The layout module (design record 0001, "The GPU layout") on the CPU oracle (`compileModuleJs`,
// at f32): its constants are the record's table, the host reads the same numbers through the
// module's host view, and each decoder reads back what a hand-packed buffer holds. The builder's
// own nodes go through the kernel's decoders too, so the builder and the kernel agree on the words.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileModuleJs, type CpuModule, type CpuValue } from 'typeshade';
import * as layout from './layout.shade.ts';
import trace from './trace.shade.ts';
import { buildBlas } from '../accel/bvh.ts';

const PATH = join(import.meta.dir, 'layout.shade.ts');
const read = (f: string): string | undefined => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return undefined;
  }
};
const compiled = compile(readFileSync(PATH, 'utf8'), { fileName: PATH, readDocument: read });

function load(): CpuModule {
  expect(compiled.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return compileModuleJs(compiled.module!, { precision: 'f32' });
}

/** `a`, four numbers at a time, as the oracle takes an `array<vec4>`. */
const vec4s = (a: Float32Array): CpuValue =>
  Array.from({ length: a.length / 4 }, (_, i) =>
    Array.from(a.subarray(i * 4, i * 4 + 4)),
  ) as unknown as CpuValue;

/** The record's table and words, as numbers. */
const RECORD = {
  NODE_STRIDE: 2,
  TRIANGLE_STRIDE: 1,
  VERTEX_STRIDE: 2,
  INSTANCE_STRIDE: 8,
  MATERIAL_STRIDE: 8,
  LIGHT_STRIDE: 1,
  ACCUM_STRIDE: 1,
  NODE_COUNT_MASK: 0x3fffffff,
  NODE_AXIS_SHIFT: 30,
  INSTANCE_MATRIX: 0,
  INSTANCE_INVERSE: 3,
  INSTANCE_BASES: 6,
  INSTANCE_FLAGS: 7,
  INSTANCE_SPHERE: 1,
  LIGHT_TRIANGLE: 0,
} as const;

describe('layout.shade.ts: the numbers', () => {
  it("the kernel's constants are the record's table", () => {
    const consts = Object.fromEntries(compiled.module!.consts.map((c) => [c.name, c.cpuValue]));
    expect(consts).toEqual(RECORD);
  });

  // Record 0001, step 6: the sphere's flag bit is 1, and it moves no stride.
  it('INSTANCE_SPHERE is 1, and the strides do not change', () => {
    const consts = Object.fromEntries(compiled.module!.consts.map((c) => [c.name, c.cpuValue]));
    expect(consts.INSTANCE_SPHERE).toBe(1);
    expect(layout.INSTANCE_SPHERE).toBe(1);
    const strides = Object.entries(consts).filter(([name]) => name.endsWith('_STRIDE'));
    expect(Object.fromEntries(strides)).toEqual({
      NODE_STRIDE: 2,
      TRIANGLE_STRIDE: 1,
      VERTEX_STRIDE: 2,
      INSTANCE_STRIDE: 8,
      MATERIAL_STRIDE: 8,
      LIGHT_STRIDE: 1,
      ACCUM_STRIDE: 1,
    });
  });

  it("the host imports the kernel's own constants through the host view, and keeps no copy", () => {
    const host = Object.fromEntries(
      Object.keys(RECORD).map((k) => [k, layout[k as keyof typeof RECORD]]),
    );
    expect(host).toEqual(RECORD);
  });

  it('declares nodes, vertices, instances and lights as read-only arrays of vec4', () => {
    for (const name of ['nodes', 'vertices', 'instances', 'lights']) {
      expect(compiled.wgsl).toMatch(new RegExp(`var<storage, read> ${name}: array<vec4<f32>>;`));
    }
    expect(compiled.wgsl).toMatch(/var<storage, read> triangles: array<vec4<u32>>;/);
  });

  // Verifies: Design 0001.2
  it("lays the trace's uniform block out as the record's TraceParams: nine vec4, 144 bytes", () => {
    const manifest = trace as unknown as {
      bindings: {
        name: string;
        space: string;
        layout: { size: number; fields?: { name: string; offset: number }[] };
      }[];
    };
    const params = manifest.bindings.find((b) => b.name === 'params')!;
    expect(params.space).toBe('uniform');
    expect(params.layout.size).toBe(144);
    expect(params.layout.fields!.map((f) => [f.name, f.offset])).toEqual([
      ['eye', 0],
      ['right', 16],
      ['up', 32],
      ['forward', 48],
      ['lens', 64],
      ['frame', 80],
      ['tile', 96],
      ['scene', 112],
      ['path', 128],
    ]);
    const storage = manifest.bindings.filter((b) => b.space === 'storage').map((b) => b.name);
    expect(storage.sort()).toEqual(
      ['accum', 'instances', 'lights', 'materials', 'nodes', 'triangles', 'vertices'].sort(),
    );
  });
});

/** Nodes packed by hand, as the record lays them out: (min, bits(a)), (max, bits(b)). */
function packNodes(list: { lo: number[]; hi: number[]; a: number; count: number; axis: number }[]) {
  const nodes = new Float32Array(list.length * 8);
  const words = new Uint32Array(nodes.buffer);
  list.forEach((n, i) => {
    nodes.set(n.lo, i * 8);
    words[i * 8 + 3] = n.a;
    nodes.set(n.hi, i * 8 + 4);
    words[i * 8 + 7] = (n.count | (n.axis << 30)) >>> 0;
  });
  return nodes;
}

describe('layout.shade.ts: the decoders', () => {
  const cpu = load();
  const fn = (name: string) => cpu.fns[name]!;

  it('nodeBounds and nodeWords read a node, its axis and the largest count', () => {
    const list = [
      // An inner node split on z: b is 0x80000000, the bits of -0.
      { lo: [-1, -2, -3], hi: [4, 5, 6], a: 1, count: 0, axis: 2 },
      { lo: [0.5, 0.25, 0.125], hi: [1, 1, 1], a: 7, count: 3, axis: 0 },
      // The last node index one binding holds, as a child: a denormal's bits.
      { lo: [-8, -8, -8], hi: [8, 8, 8], a: 4_194_303, count: 0, axis: 1 },
      { lo: [0, 0, 0], hi: [0, 0, 0], a: 0, count: RECORD.NODE_COUNT_MASK, axis: 0 },
    ];
    cpu.setBinding('nodes', vec4s(packNodes(list)));
    list.forEach((n, i) => {
      expect(fn('nodeBounds')(i)).toEqual({ lo: n.lo, hi: n.hi });
      expect(fn('nodeWords')(i)).toEqual({ a: n.a, count: n.count, axis: n.axis });
    });
  });

  it('decodes every node of a BLAS as the builder wrote it', () => {
    const ring = 24;
    const position: number[] = [];
    const index: number[] = [];
    for (let i = 0; i < ring; i++) {
      const t = (i / ring) * 2 * Math.PI;
      position.push(Math.cos(t), Math.sin(t), 0, Math.cos(t), Math.sin(t), 1);
      const j = (i + 1) % ring;
      index.push(2 * i, 2 * j, 2 * i + 1, 2 * j, 2 * j + 1, 2 * i + 1);
    }
    const bvh = buildBlas({ position: new Float32Array(position), index: new Uint32Array(index) });
    const words = new Uint32Array(bvh.nodes.buffer);
    cpu.setBinding('nodes', vec4s(bvh.nodes));
    for (let i = 0; i < bvh.nodes.length / 8; i++) {
      const b = words[i * 8 + 7]!;
      expect(fn('nodeBounds')(i)).toEqual({
        lo: Array.from(bvh.nodes.subarray(i * 8, i * 8 + 3)),
        hi: Array.from(bvh.nodes.subarray(i * 8 + 4, i * 8 + 7)),
      });
      expect(fn('nodeWords')(i)).toEqual({
        a: words[i * 8 + 3],
        count: b & 0x3fffffff,
        axis: b >>> 30,
      });
    }
  });

  // Verifies: Design 0001.4
  it('vertexPosition reads vertex i of the geometry whose vertices start at base', () => {
    // Three vertices, each (position, u) then (normal, v).
    const vertices = new Float32Array([
      ...[1, 2, 3, 0.1],
      ...[0, 0, 1, 0.2],
      ...[4, 5, 6, 0.3],
      ...[0, 1, 0, 0.4],
      ...[7, 8, 9, 0.5],
      ...[1, 0, 0, 0.6],
    ]);
    cpu.setBinding('vertices', vec4s(vertices));
    expect(fn('vertexPosition')(0, 0)).toEqual([1, 2, 3]);
    expect(fn('vertexPosition')(0, 2)).toEqual([7, 8, 9]);
    expect(fn('vertexPosition')(1, 1)).toEqual([7, 8, 9]);
    expect(fn('vertexPosition')(2, 0)).toEqual([7, 8, 9]);
  });

  it('triangleWords, vertexNormal and vertexUv read a triangle and its vertices', () => {
    cpu.setBinding('triangles', [
      [0, 0, 0, 0],
      [3, 1, 2, 0],
    ] as unknown as CpuValue);
    expect(fn('triangleWords')(1)).toEqual([3, 1, 2, 0]);
    const vertices = new Float32Array([
      ...[1, 2, 3, 0.25],
      ...[0, 0, 1, 0.75],
      ...[4, 5, 6, 0.5],
      ...[0, 1, 0, 0.125],
    ]);
    cpu.setBinding('vertices', vec4s(vertices));
    expect(fn('vertexNormal')(0, 1)).toEqual([0, 1, 0]);
    expect(fn('vertexUv')(0, 0)).toEqual([0.25, 0.75]);
    expect(fn('vertexUv')(1, 0)).toEqual([0.5, 0.125]);
  });

  it('lightWords and lightCdf read (bits(type), bits(instance), bits(triangle), cdf)', () => {
    const lights = new Float32Array(8);
    new Uint32Array(lights.buffer).set([0, 7, 4_194_303], 4);
    lights[3] = 0.25;
    lights[7] = 1;
    cpu.setBinding('lights', vec4s(lights));
    expect(fn('lightWords')(1)).toEqual({ kind: 0, instance: 7, triangle: 4_194_303, cdf: 1 });
    expect(fn('lightCdf')(0)).toBe(0.25);
  });

  describe('the instance decoders', () => {
    // Instance 1: a quarter turn about z, a scale of 2, a move of (1, 2, 3). All exact in f32.
    const matrix = [0, -2, 0, 1, 2, 0, 0, 2, 0, 0, 2, 3];
    const inverse = [0, 0.5, 0, -1, -0.5, 0, 0, 0.5, 0, 0, 0.5, -1.5];
    const instances = new Float32Array(16 * 4);
    const words = new Uint32Array(instances.buffer);
    // Instance 0 is a plain move, so a decoder that ignored `i` reads the wrong one.
    instances.set([1, 0, 0, 9, 0, 1, 0, 9, 0, 0, 1, 9], 0);
    instances.set([1, 0, 0, -9, 0, 1, 0, -9, 0, 0, 1, -9], 12);
    words.set([1, 2, 3, 4], 24);
    instances.set(matrix, 32);
    instances.set(inverse, 44);
    words.set([10, 4_194_303, 0, 4], 56);
    words.set([1, 77, 0, 0], 60);

    it('instanceBases reads (nodeBase, primBase, vertexBase, material) from the bits', () => {
      cpu.setBinding('instances', vec4s(instances));
      expect(fn('instanceBases')(0)).toEqual([1, 2, 3, 4]);
      expect(fn('instanceBases')(1)).toEqual([10, 4_194_303, 0, 4]);
    });

    it('instanceToWorld moves a point (w = 1) and turns a direction (w = 0)', () => {
      cpu.setBinding('instances', vec4s(instances));
      expect(fn('instanceToWorld')(1, [1, 1, 1, 1])).toEqual([-1, 4, 5]);
      expect(fn('instanceToWorld')(1, [1, 1, 1, 0])).toEqual([-2, 2, 2]);
      expect(fn('instanceToWorld')(0, [1, 1, 1, 1])).toEqual([10, 10, 10]);
    });

    it('instanceNormalToWorld turns a normal by the inverse transposed', () => {
      cpu.setBinding('instances', vec4s(instances));
      // A quarter turn and a scale of 2: the normal turns, and shrinks by the scale.
      expect(fn('instanceNormalToWorld')(1, [1, 0, 0])).toEqual([0, 0.5, 0]);
      expect(fn('instanceNormalToWorld')(0, [0, 0, 1])).toEqual([0, 0, 1]);
    });

    it('instanceToObject undoes instanceToWorld', () => {
      cpu.setBinding('instances', vec4s(instances));
      expect(fn('instanceToObject')(1, [-1, 4, 5, 1])).toEqual([1, 1, 1]);
      expect(fn('instanceToObject')(1, [-2, 2, 2, 0])).toEqual([1, 1, 1]);
      expect(fn('instanceToObject')(0, [10, 10, 10, 1])).toEqual([1, 1, 1]);
      for (const p of [
        [0.3, -1.7, 2.9],
        [100, 0.001, -42],
      ]) {
        const world = fn('instanceToWorld')(1, [...p, 1]) as number[];
        const back = fn('instanceToObject')(1, [...world, 1]) as number[];
        back.forEach((x, k) => expect(x).toBeCloseTo(p[k]!, 4));
      }
    });
  });

  // Record 0001, "The analytic sphere": the words of a `Sphere`'s instance, packed by hand.
  describe('the sphere decoders', () => {
    // Instance 0 is a mesh. Instance 1 is a sphere of centre (1, 2, 3) and radius 0.5, turned a
    // quarter turn about y: the rows of R^T are (0, 0, -1), (0, 1, 0) and (1, 0, 0).
    const instances = new Float32Array(16 * 4);
    const words = new Uint32Array(instances.buffer);
    instances.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], 0);
    instances.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], 12);
    words.set([0, 0, 0, 5], 24);
    words.set([0, 3, 0, 0], 28);
    instances.set([1, 2, 3, 0.5], 32);
    instances.set([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0], 44);
    words.set([0, 0, 0, 7], 56);
    words.set([RECORD.INSTANCE_SPHERE, 0xffffffff, 0, 0], 60);

    it('instanceFlags reads bit 0 for the sphere and 0 for the mesh', () => {
      cpu.setBinding('instances', vec4s(instances));
      expect(fn('instanceFlags')(0)).toBe(0);
      expect(fn('instanceFlags')(1)).toBe(RECORD.INSTANCE_SPHERE);
      expect(fn('instanceBases')(1)).toEqual([0, 0, 0, 7]);
    });

    it('sphereCentre and sphereRadius read [0]', () => {
      cpu.setBinding('instances', vec4s(instances));
      expect(fn('sphereCentre')(1)).toEqual([1, 2, 3]);
      expect(fn('sphereRadius')(1)).toBe(0.5);
    });

    it('sphereToObject and sphereToWorld move a vector by the rows of R^T, and back', () => {
      cpu.setBinding('instances', vec4s(instances));
      // R turns +x to -z: R^T takes -z back to +x.
      expect(fn('sphereToObject')(1, [0, 0, -1])).toEqual([1, 0, 0]);
      expect(fn('sphereToWorld')(1, [1, 0, 0])).toEqual([0, 0, -1]);
      expect(fn('sphereToWorld')(1, [0.25, -0.5, 2])).toEqual([2, -0.5, -0.25]);
      expect(fn('sphereToObject')(1, [2, -0.5, -0.25])).toEqual([0.25, -0.5, 2]);
    });
  });
});
