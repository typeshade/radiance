// The kernels' building blocks on the CPU oracle (the compiler's `compileModuleJs`, at f32): the
// functions the path tracer composes, each held to what it promises. The traversal is held in
// intersect.test.ts and the shading contract in materials.test.ts. The whole frame is held to the
// GPU's by the harness (scripts/harness.mjs).

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileModuleJs, type CpuModule, type CpuValue } from 'typeshade';
import { PlaneGeometry } from '../geometries/PlaneGeometry.ts';
import { SphereGeometry } from '../geometries/SphereGeometry.ts';
import { DiffuseMaterial } from '../materials/DiffuseMaterial.ts';
import { EmissiveMaterial } from '../materials/EmissiveMaterial.ts';
import { MirrorMaterial } from '../materials/MirrorMaterial.ts';
import { Mesh } from '../objects/Mesh.ts';
import { PerspectiveCamera } from '../cameras/PerspectiveCamera.ts';
import { cameraFrame, SCENE_BUFFERS, ScenePack } from '../renderers/scene-pack.ts';
import { Scene } from '../scenes/Scene.ts';

const read = (f: string): string | undefined => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return undefined;
  }
};

function compileKernel(file: string) {
  const path = join(import.meta.dir, file);
  const c = compile(readFileSync(path, 'utf8'), { fileName: path, readDocument: read });
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c;
}

function load(file: string): CpuModule {
  return compileModuleJs(compileKernel(file).module!, { precision: 'f32' });
}

/** `a`, four numbers at a time, as the oracle takes an `array<vec4>` or an `array<vec4u>`. */
const vec4s = (a: Float32Array | Uint32Array): CpuValue =>
  Array.from({ length: a.length / 4 }, (_, i) =>
    Array.from(a.subarray(i * 4, i * 4 + 4)),
  ) as unknown as CpuValue;

const sampler = load('sampler.shade.ts');
const trace = load('trace.shade.ts');
const fn = (m: CpuModule, name: string) => m.fns[name]!;

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

  it('pickLight finds the light whose share of the cdf holds the number', () => {
    const cdf = [0.2, 0.5, 0.5, 1];
    trace.setBinding('lights', cdf.map((c, i) => [0, i, i, c]) as unknown as CpuValue);
    const pick = (x: number) => fn(trace, 'pickLight')(x, cdf.length);
    expect([0, 0.1999, 0.2, 0.4999, 0.5, 0.75, 0.9999].map(pick)).toEqual([0, 0, 1, 1, 3, 3, 3]);
  });
});

// Verifies: Design 0001.2
describe('the path tracer binds seven storage buffers (record 0001, rule 1)', () => {
  it("binds the record's six scene buffers and accum, so the console buffer has the eighth", () => {
    const wgsl = compileKernel('trace.shade.ts').wgsl!;
    const storage = [
      ...wgsl.matchAll(/var<storage, (read|read_write)> (\w+): array<(vec4<f32>|vec4<u32>)>;/g),
    ].map((m) => `${m[2]} ${m[1]} ${m[3]}`);
    expect(storage.sort()).toEqual(
      [
        'accum read_write vec4<f32>',
        'instances read vec4<f32>',
        'lights read vec4<f32>',
        'materials read vec4<f32>',
        'nodes read vec4<f32>',
        'triangles read vec4<u32>',
        'vertices read vec4<f32>',
      ].sort(),
    );
    expect([...wgsl.matchAll(/var<storage/g)]).toHaveLength(7);
  });
});

/** A small scene with a light, a mirror and a diffuse sphere, packed and bound to `trace`. */
function bindScene(width: number, height: number) {
  const scene = new Scene();
  const floor = new Mesh(new PlaneGeometry(4, 4), new DiffuseMaterial());
  floor.rotation.x = -Math.PI / 2;
  const lamp = new Mesh(new PlaneGeometry(1, 1), new EmissiveMaterial({ intensity: 8 }));
  lamp.position.set(0, 2, 0);
  lamp.rotation.x = Math.PI / 2;
  const ball = new Mesh(new SphereGeometry(0.5, 8, 4), new MirrorMaterial());
  ball.position.set(0.4, 0.5, 0);
  const matte = new Mesh(new SphereGeometry(0.4, 8, 4), new DiffuseMaterial({ color: 0xe8703a }));
  matte.position.set(-0.6, 0.4, 0.2);
  scene.add(floor, lamp, ball, matte);
  const camera = new PerspectiveCamera(50, width / height);
  camera.position.set(0, 1.2, 3);
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  const pack = new ScenePack();
  pack.update(scene);
  for (const name of SCENE_BUFFERS) trace.setBinding(name, vec4s(pack.arrays[name]));
  return { pack, camera };
}

/** The frame's accum after the given tiles, `samples` each, starting at sample `first`. */
function render(
  width: number,
  height: number,
  tiles: readonly (readonly [number, number, number, number])[],
  batches: readonly number[],
): number[][] {
  const { pack, camera } = bindScene(width, height);
  const accum = Array.from({ length: width * height }, () => [0, 0, 0, 0]);
  trace.setBinding('accum', accum as unknown as CpuValue);
  let first = 0;
  for (const samples of batches) {
    for (const tile of tiles) {
      const params = pack.params({
        camera: cameraFrame(camera),
        frame: [width, height, first, samples],
        tile: [...tile],
        seed: 3,
        bounces: 6,
        rouletteFrom: 2,
      });
      trace.setBinding('params', JSON.parse(JSON.stringify(params)) as CpuValue);
      for (let i = 0; i < tile[2] * tile[3]; i++) fn(trace, 'trace')([i, 0, 0]);
    }
    first += samples;
  }
  return accum;
}

// Verifies: Design 0001.6
describe('trace in tiles (record 0001, "Tiles and the watchdog")', () => {
  const [w, h] = [12, 9];

  it('adds the same samples to every pixel whatever the tiles, bit for bit', () => {
    const whole = render(w, h, [[0, 0, w, h]], [2, 3]);
    // Whole rows: rows 0 to 4, then 5 to 8. `tileFrame` makes one tile of a frame this small
    // (the smallest nominal tile is 4,096 pixels), so the tiles are written here.
    const rows = [
      [0, 0, 12, 5],
      [0, 5, 12, 4],
    ] as const;
    expect(render(w, h, rows, [2, 3])).toEqual(whole);
    // Parts of rows, in any order.
    const columns = [
      [5, 0, 7, 9],
      [0, 0, 5, 9],
    ] as const;
    expect(render(w, h, columns, [2, 3])).toEqual(whole);
    // Every pixel took its five samples, and the light reached the frame.
    expect(whole.every((p) => p[3] === 5)).toBe(true);
    expect(whole.some((p) => p[0]! > 0)).toBe(true);
  });

  it('touches no pixel outside its tile', () => {
    const one = render(w, h, [[3, 2, 4, 5]], [1]);
    one.forEach((p, i) => {
      const [x, y] = [i % w, Math.floor(i / w)];
      const inside = x >= 3 && x < 7 && y >= 2 && y < 7;
      expect(p[3]).toBe(inside ? 1 : 0);
    });
  });
});
