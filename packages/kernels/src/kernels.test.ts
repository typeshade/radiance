// The kernels' building blocks on the CPU oracle (the compiler's `compileModuleJs`, at f32): the
// functions the path tracer composes, each held to what it promises. The whole frame is held to
// the GPU's by the harness (scripts/harness.mjs).

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileModuleJs, type CpuModule } from 'typeshade';

function load(file: string): CpuModule {
  const path = join(import.meta.dir, file);
  const read = (f: string): string | undefined => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return undefined;
    }
  };
  const c = compile(readFileSync(path, 'utf8'), { fileName: path, readDocument: read });
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return compileModuleJs(c.module!, { precision: 'f32' });
}

const sampler = load('sampler.shade.ts');
const trace = load('trace.shade.ts');
const fn = (m: CpuModule, name: string) => m.fns[name]!;
/** `NO_HIT` in trace.shade.ts, as an f32. */
const NO_HIT = Math.fround(1e30);

describe('sampler.shade.ts', () => {
  it('hash wraps as u32 arithmetic does', () => {
    const ref = (x: number): number => {
      const state = (Math.imul(x, 747796405) + 2891336453) >>> 0;
      const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
      return ((word >>> 22) ^ word) >>> 0;
    };
    for (const x of [0, 1, 2, 12345, 0x7fffffff, 0x80000000, 0xffffffff])
      expect(fn(sampler, 'hash')(x)).toBe(ref(x));
  });

  it('draws numbers in [0, 1)', () => {
    for (let i = 0; i < 256; i++) {
      const [x, y] = fn(sampler, 'sample2')(7, i, 3) as number[];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(1);
    }
  });

  it('is a (0, 2)-sequence: every 16 samples put one in each elementary interval of area 1/16', () => {
    for (const pair of [0, 1, 5]) {
      for (const first of [0, 16, 48]) {
        const points = Array.from(
          { length: 16 },
          (_, i) => fn(sampler, 'sample2')(99, first + i, pair) as number[],
        );
        for (const [cols, rows] of [
          [1, 16],
          [2, 8],
          [4, 4],
          [8, 2],
          [16, 1],
        ] as const) {
          const cells = new Set(
            points.map(([x, y]) => `${Math.floor(x! * cols)},${Math.floor(y! * rows)}`),
          );
          expect(cells.size).toBe(16);
        }
      }
    }
  });

  it('gives another pixel and another dimension pair other numbers', () => {
    const a = fn(sampler, 'sample2')(1, 0, 0);
    expect(fn(sampler, 'sample2')(2, 0, 0)).not.toEqual(a);
    expect(fn(sampler, 'sample2')(1, 0, 1)).not.toEqual(a);
  });
});

describe('trace.shade.ts', () => {
  it('turn is cos and sin of 2 pi r to below f32 resolution', () => {
    for (let i = 0; i < 4096; i++) {
      const r = i / 4096 + 1 / 8192;
      const [c, s] = fn(trace, 'turn')(r) as number[];
      expect(Math.abs(c! - Math.cos(2 * Math.PI * r))).toBeLessThan(3e-7);
      expect(Math.abs(s! - Math.sin(2 * Math.PI * r))).toBeLessThan(3e-7);
    }
  });

  it('aboutNormal gives unit directions on the side of the normal', () => {
    const n = [0, 0.6, 0.8];
    for (let i = 0; i < 64; i++) {
      const d = fn(trace, 'aboutNormal')(n, [
        (i % 8) / 8 + 0.01,
        Math.floor(i / 8) / 8 + 0.01,
      ]) as number[];
      expect(Math.hypot(d[0]!, d[1]!, d[2]!)).toBeCloseTo(1, 5);
      expect(d[0]! * n[0]! + d[1]! * n[1]! + d[2]! * n[2]!).toBeGreaterThan(0);
    }
  });

  it('hitSphere meets a sphere from outside and from inside, and misses past it', () => {
    const hit = fn(trace, 'hitSphere');
    expect(hit([0, 0, 5], [0, 0, -1], [0, 0, 0], 1)).toBeCloseTo(4, 5);
    expect(hit([0, 0, 0], [0, 0, -1], [0, 0, 0], 1)).toBeCloseTo(1, 5);
    expect(hit([0, 2, 5], [0, 0, -1], [0, 0, 0], 1)).toBe(NO_HIT);
    expect(hit([0, 0, -5], [0, 0, -1], [0, 0, 0], 1)).toBe(NO_HIT);
  });

  it('hitQuad meets the parallelogram inside its edges and nowhere else', () => {
    const hit = fn(trace, 'hitQuad');
    const quad = [
      [-1, -1, 0],
      [2, 0, 0],
      [0, 2, 0],
    ];
    expect(hit([0, 0, 3], [0, 0, -1], ...quad)).toBeCloseTo(3, 5);
    expect(hit([0.9, -0.9, 3], [0, 0, -1], ...quad)).toBeCloseTo(3, 5);
    expect(hit([1.1, 0, 3], [0, 0, -1], ...quad)).toBe(NO_HIT);
    expect(hit([0, 0, 3], [1, 0, 0], ...quad)).toBe(NO_HIT);
    expect(hit([0, 0, -3], [0, 0, -1], ...quad)).toBe(NO_HIT);
  });

  it('tonemap is black at zero, rises, and stays in [0, 1]', () => {
    const tm = (x: number) => (fn(trace, 'tonemap')([x, x, x], 0) as number[])[0]!;
    expect(tm(0)).toBe(0);
    let last = 0;
    for (const x of [0.01, 0.1, 0.5, 1, 4, 100]) {
      const y = tm(x);
      expect(y).toBeGreaterThan(last);
      expect(y).toBeLessThanOrEqual(1);
      last = y;
    }
  });
});
