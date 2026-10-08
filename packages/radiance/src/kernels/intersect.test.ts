// The traversal and the surface (design record 0001, "Traversal") on the CPU oracle
// (`compileModuleJs`, at f32), over buffers a `ScenePack` packed: `nearest` through a TLAS of
// inner nodes and leaves against a test of every triangle, the watertight triangle test on a
// shared edge, an instance hit where its matrix puts it, and `surface` (record 0004's `Surface`).
//
// The analytic sphere (record 0001, "The analytic sphere", step 6) is held at the end of the
// file, over buffers packed by hand: the pack makes no sphere before step 7.

import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileModuleJs, type CpuModule, type CpuValue } from 'typeshade';
import { PlaneGeometry } from '../geometries/PlaneGeometry.ts';
import { SphereGeometry } from '../geometries/SphereGeometry.ts';
import { BufferGeometry } from '../geometries/BufferGeometry.ts';
import { DiffuseMaterial } from '../materials/DiffuseMaterial.ts';
import { Matrix4 } from '../math/Matrix4.ts';
import { Mesh } from '../objects/Mesh.ts';
import { SCENE_BUFFERS, ScenePack } from '../renderers/scene-pack.ts';
import { Scene } from '../scenes/Scene.ts';
import {
  INSTANCE_BASES,
  INSTANCE_FLAGS,
  INSTANCE_INVERSE,
  INSTANCE_MATRIX,
  INSTANCE_SPHERE,
  INSTANCE_STRIDE,
  MATERIAL_STRIDE,
  NODE_COUNT_MASK,
  NODE_STRIDE,
} from './layout.shade.ts';

type Vec = [number, number, number];

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

/** `a`, four numbers at a time, as the oracle takes an `array<vec4>` or an `array<vec4u>`. */
const vec4s = (a: Float32Array | Uint32Array): CpuValue =>
  Array.from({ length: a.length / 4 }, (_, i) =>
    Array.from(a.subarray(i * 4, i * 4 + 4)),
  ) as unknown as CpuValue;

/** `scene` packed, and the module's bindings set from the pack. */
function bind(cpu: CpuModule, scene: Scene): ScenePack {
  scene.updateMatrixWorld();
  const pack = new ScenePack();
  pack.update(scene);
  for (const name of SCENE_BUFFERS) cpu.setBinding(name, vec4s(pack.arrays[name]));
  const params = pack.params({
    camera: {
      eye: [0, 0, 0, 0],
      right: [1, 0, 0, 0],
      up: [0, 1, 0, 0],
      forward: [0, 0, -1, 0],
      lens: [1, 1, 0, 0],
    },
    frame: [1, 1, 0, 1],
    tile: [0, 0, 1, 1],
    seed: 0,
    bounces: 8,
    rouletteFrom: 3,
  });
  cpu.setBinding('params', JSON.parse(JSON.stringify(params)) as CpuValue);
  return pack;
}

/** Numbers in [0, 1) from a seed: mulberry32. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec): Vec => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const f32v = (a: Vec): Vec => a.map(Math.fround) as Vec;
/** `m` applied to `(x, y, z, w)`. */
const apply = (m: Matrix4, p: Vec, w: number): Vec => {
  const e = m.elements;
  return [0, 1, 2].map(
    (r) => e[r]! * p[0] + e[4 + r]! * p[1] + e[8 + r]! * p[2] + e[12 + r]! * w,
  ) as Vec;
};

const cpu = load('intersect.shade.ts');
/** A function of the module, called with the plain values the oracle takes: a struct as an
 *  object, a vector as an array. */
const fn = (name: string) => cpu.fns[name]! as unknown as (...args: unknown[]) => CpuValue;
const NONE = 0xffffffff;
const FAR = Math.fround(1e30);

interface Hit {
  t: number;
  instance: number;
  triangle: number;
  b1: number;
  b2: number;
}

/** Instance `s`'s bases from the pack's words: nodeBase, primBase, vertexBase, material. */
const basesOf = (pack: ScenePack, s: number): number[] =>
  Array.from(
    new Uint32Array(pack.arrays.instances.buffer).subarray(
      (s * INSTANCE_STRIDE + INSTANCE_BASES) * 4,
      (s * INSTANCE_STRIDE + INSTANCE_BASES) * 4 + 4,
    ),
  );

/** Where the ray meets triangle `tri` of instance `s`, by the kernel's own triangle test, or -1. */
function testTriangle(
  s: number,
  tri: number,
  o: Vec,
  d: Vec,
  limit: number,
  pack: ScenePack,
): number[] {
  const bases = basesOf(pack, s);
  const r = fn('prepare')(
    fn('instanceToObject')(s, [...o, 1]),
    fn('instanceToObject')(s, [...d, 0]),
  );
  const w = Array.from(pack.arrays.triangles.subarray(tri * 4, tri * 4 + 3));
  const p = w.map((v) => fn('vertexPosition')(bases[2]!, v));
  return fn('hitTriangle')(r, p[0]!, p[1]!, p[2]!, limit) as number[];
}

describe('nearest: the two-level walk against a test of every triangle', () => {
  const ball = new SphereGeometry(1, 16, 8);
  const a = new Mesh(ball, new DiffuseMaterial());
  const b = new Mesh(ball, new DiffuseMaterial());
  b.position.set(2.5, 0, 0);
  b.rotation.set(0.4, 0.7, -0.2);
  b.scale.set(1, 0.5, 1.5);
  const floor = new Mesh(new PlaneGeometry(8, 8), new DiffuseMaterial());
  floor.position.set(0, -1.5, 0);
  floor.rotation.x = -Math.PI / 2;
  // Four pebbles more, so the TLAS holds seven instances and its root is an inner node.
  const pebble = new SphereGeometry(0.4, 8, 4);
  const pebbles = [
    [-1.8, 0.6, 1.4],
    [0.6, 1.1, -1.5],
    [3.6, -0.6, 1.1],
    [1.2, 0.3, 1.7],
  ].map(([x, y, z]) => {
    const m = new Mesh(pebble, new DiffuseMaterial());
    m.position.set(x!, y!, z!);
    return m;
  });
  const scene = new Scene();
  scene.add(a, b, floor, ...pebbles);
  let pack = bind(cpu, scene);
  beforeEach(() => {
    pack = bind(cpu, scene);
  });
  // The geometry ids are in the order the pack first saw each geometry.
  const counts = [ball, floor.geometry as PlaneGeometry, pebble].map((g) => g.index.length / 3);
  const triangles = (s: number): number => {
    const id = new Uint32Array(pack.arrays.instances.buffer)[
      (s * INSTANCE_STRIDE + INSTANCE_FLAGS) * 4 + 1
    ]!;
    return counts[id]!;
  };

  it('walks a TLAS of seven instances, whose root is an inner node', () => {
    expect(pack.counts.instances).toBe(7);
    const root = pack.counts.tlasBase * NODE_STRIDE * 4;
    expect(new Uint32Array(pack.arrays.nodes.buffer)[root + 7]! & NODE_COUNT_MASK).toBe(0);
  });
  const next = random(5);
  const rays = Array.from({ length: 300 }, () => {
    const z = next() * 2 - 1;
    const phi = next() * 2 * Math.PI;
    const s = Math.sqrt(1 - z * z);
    const o: Vec = f32v([6 * s * Math.cos(phi), 6 * s * Math.sin(phi), 6 * z]);
    const to: Vec = [-2 + next() * 6, -1.5 + next() * 3, -2 + next() * 4];
    return [o, f32v(norm(sub(to, o)))] as const;
  });

  // Verifies: Design 0001.1
  it('finds the nearest triangle of tessellated spheres and a plane on 300 random rays', () => {
    let hits = 0;
    for (const [o, d] of rays) {
      const hit = fn('nearest')(o, d, FAR) as unknown as Hit;
      // Every triangle of every instance, by the kernel's own triangle test.
      let best = { t: FAR, instance: NONE, triangle: NONE };
      for (let s = 0; s < pack.counts.instances; s++) {
        const primBase = basesOf(pack, s)[1]!;
        for (let k = 0; k < triangles(s); k++) {
          const h = testTriangle(s, primBase + k, o, d, best.t, pack);
          if (h[0]! >= 0) best = { t: h[0]!, instance: s, triangle: primBase + k };
        }
      }
      expect(hit.t).toBe(best.t);
      if (hit.instance !== best.instance || hit.triangle !== best.triangle) {
        // A tie: the walk met another triangle at the same distance, on a shared edge.
        expect(testTriangle(hit.instance, hit.triangle, o, d, FAR, pack)[0]).toBe(best.t);
      }
      if (best.instance !== NONE) hits++;
    }
    expect(hits).toBeGreaterThan(150);
  });

  it('occluded says what nearest says, for any limit', () => {
    const near = random(9);
    for (const [o, d] of rays) {
      const hit = fn('nearest')(o, d, FAR) as unknown as Hit;
      const limit = hit.instance === NONE ? 20 : hit.t * (0.5 + near());
      const expected = (fn('nearest')(o, d, limit) as unknown as Hit).instance !== NONE;
      expect(fn('occluded')(o, d, limit)).toBe(expected);
    }
  });

  it('meets nothing in a scene with no instance', () => {
    bind(cpu, new Scene());
    expect((fn('nearest')([0, 0, 5], [0, 0, -1], FAR) as unknown as Hit).instance).toBe(NONE);
    expect(fn('occluded')([0, 0, 5], [0, 0, -1], FAR)).toBe(false);
  });
});

describe('hitTriangle: the watertight test on a shared edge (Woop, Benthin and Wald)', () => {
  // A plane is two triangles that share the diagonal from vertex 2 to vertex 1.
  const plane = new PlaneGeometry(2, 2);
  const mesh = new Mesh(plane, new DiffuseMaterial());
  mesh.position.set(0.1234, -0.567, 0.89);
  mesh.rotation.set(0.31, -0.47, 0.13);
  const scene = new Scene();
  scene.add(mesh);
  scene.updateMatrixWorld();
  const m = mesh.matrixWorld;
  // 2,000 rays from either side, each toward a point of the shared edge.
  const next = random(17);
  const v2 = apply(m, [-1, -1, 0], 1);
  const v1 = apply(m, [1, 1, 0], 1);
  const normal = norm(apply(m, [0, 0, 1], 0));
  const rays = Array.from({ length: 2000 }, (_, i) => {
    const f = next();
    const q = [0, 1, 2].map((k) => v2[k]! + (v1[k]! - v2[k]!) * f) as Vec;
    const side = i % 2 === 0 ? 1 : -1;
    const o = f32v([0, 1, 2].map((k) => q[k]! + side * normal[k]! * 3 + (next() - 0.5) * 4) as Vec);
    return [o, f32v(norm(sub(q, o)))] as const;
  });

  it('lets no ray aimed at the shared edge pass between the two triangles', () => {
    const pack = bind(cpu, scene);
    let both = 0;
    for (const [o, d] of rays) {
      const met = [0, 1].map((k) => testTriangle(0, k, o, d, FAR, pack)[0]!).filter((t) => t >= 0);
      // At least one triangle, and two only where both meet the ray at one point, to rounding.
      expect(met.length).toBeGreaterThanOrEqual(1);
      if (met.length === 2) {
        both++;
        expect(Math.abs(met[0]! - met[1]!)).toBeLessThan(met[0]! * 1e-6);
      }
      const hit = fn('nearest')(o, d, FAR) as unknown as Hit;
      expect([0, 1]).toContain(hit.triangle);
    }
    // Most rays meet exactly one: a double report needs an edge function of exactly 0.
    expect(both).toBeLessThan(rays.length / 2);
  });

  it('can fail: a Moller-Trumbore test in f32 lets some of the same rays through', () => {
    const fr = Math.fround;
    const dot = (a: number[], b: number[]) =>
      fr(fr(fr(a[0]! * b[0]!) + fr(a[1]! * b[1]!)) + fr(a[2]! * b[2]!));
    const cross = (a: number[], b: number[]) => [
      fr(fr(a[1]! * b[2]!) - fr(a[2]! * b[1]!)),
      fr(fr(a[2]! * b[0]!) - fr(a[0]! * b[2]!)),
      fr(fr(a[0]! * b[1]!) - fr(a[1]! * b[0]!)),
    ];
    const minus = (a: number[], b: number[]) => [
      fr(a[0]! - b[0]!),
      fr(a[1]! - b[1]!),
      fr(a[2]! - b[2]!),
    ];
    const meets = (o: Vec, d: Vec, p0: Vec, p1: Vec, p2: Vec): boolean => {
      const e1 = minus(p1, p0);
      const e2 = minus(p2, p0);
      const p = cross(d, e2);
      const det = dot(e1, p);
      if (det === 0) return false;
      const inv = fr(1 / det);
      const s = minus(o, p0);
      const u = fr(dot(s, p) * inv);
      if (u < 0 || u > 1) return false;
      const q = cross(s, e1);
      const v = fr(dot(d, q) * inv);
      if (v < 0 || fr(u + v) > 1) return false;
      return fr(dot(e2, q) * inv) > 0;
    };
    const corner = [0, 1, 2, 3].map((v) =>
      f32v(apply(m, Array.from(plane.position.subarray(v * 3, v * 3 + 3)) as Vec, 1)),
    );
    const [i0, i1, i2, j0, j1, j2] = Array.from(plane.index);
    let cracks = 0;
    for (const [o, d] of rays)
      if (
        !meets(o, d, corner[i0!]!, corner[i1!]!, corner[i2!]!) &&
        !meets(o, d, corner[j0!]!, corner[j1!]!, corner[j2!]!)
      )
        cracks++;
    expect(cracks).toBeGreaterThan(0);
  });
});

describe('surface: the hit made a Surface (record 0004)', () => {
  // A plane 2 wide and 1 high, turned, stretched and moved.
  const plane = new PlaneGeometry(2, 1);
  const mesh = new Mesh(plane, new DiffuseMaterial());
  mesh.position.set(1, 2, 3);
  mesh.rotation.set(-Math.PI / 3, 0.2, 0.1);
  mesh.scale.set(2, 3, 1);
  const scene = new Scene();
  scene.add(mesh);
  let pack = bind(cpu, scene);
  beforeEach(() => {
    pack = bind(cpu, scene);
  });
  const m = mesh.matrixWorld;
  // The point (0.3, -0.2) of the plane: uv (0.65, 0.3) in three.js's layout.
  const p = apply(m, [0.3, -0.2, 0], 1);
  // The outward normal: (M x) cross (M y), which the inverse transposed of M gives +z as.
  const outward = norm([
    m.elements[1]! * m.elements[6]! - m.elements[2]! * m.elements[5]!,
    m.elements[2]! * m.elements[4]! - m.elements[0]! * m.elements[6]!,
    m.elements[0]! * m.elements[5]! - m.elements[1]! * m.elements[4]!,
  ]);

  for (const [name, side] of [
    ['from the front', 1],
    ['from the back', -1],
  ] as const) {
    it(`meets the instance where its matrix puts it, ${name}`, () => {
      const o = f32v([
        p[0] + outward[0] * 2 * side,
        p[1] + outward[1] * 2 * side,
        p[2] + outward[2] * 2 * side,
      ]);
      const d = f32v(norm(sub(p, o)));
      const hit = fn('nearest')(o, d, FAR) as unknown as Hit;
      expect(hit.instance).toBe(0);
      expect(hit.t).toBeCloseTo(2, 4);
      const s = fn('surface')(hit, d) as {
        p: Vec;
        ng: Vec;
        ns: Vec;
        uv: [number, number];
        dpdu: Vec;
        material: number;
        front: boolean;
      };
      expect(s.front).toBe(side === 1);
      s.ng.forEach((x, k) => expect(x).toBeCloseTo(outward[k]! * side, 5));
      s.ns.forEach((x, k) => expect(x).toBeCloseTo(outward[k]! * side, 5));
      // The point, moved off the surface toward the ray's side by OFFSET times its largest
      // coordinate (at least 1).
      const offset = 1e-4 * Math.max(1, ...p.map(Math.abs));
      s.p.forEach((x, k) => expect(x).toBeCloseTo(p[k]! + outward[k]! * side * offset, 5));
      expect(s.uv[0]).toBeCloseTo(0.65, 5);
      expect(s.uv[1]).toBeCloseTo(0.3, 5);
      expect(s.material).toBe(0);
    });
  }

  // Verifies: Design 0001.3, Design 0004.5
  it('derives the tangent dp/du from the edges and the uvs, with no tangent stored', () => {
    const o = f32v([p[0] + outward[0] * 2, p[1] + outward[1] * 2, p[2] + outward[2] * 2]);
    const d = f32v(norm(sub(p, o)));
    const s = fn('surface')(fn('nearest')(o, d, FAR), d) as { dpdu: Vec };
    // u runs 0 to 1 across the plane's width of 2, along its x axis.
    const expected = apply(m, [2, 0, 0], 0);
    s.dpdu.forEach((x, k) => expect(x).toBeCloseTo(expected[k]!, 4));
    expect(pack.arrays.vertices.length / pack.counts.vertices).toBe(8);
  });

  it('gives a unit tangent about the shading normal when the uvs are all 0', () => {
    const g = new BufferGeometry();
    g.position = Float32Array.of(-1, -1, 0, 1, -1, 0, 0, 1, 0);
    g.index = Uint32Array.of(0, 1, 2);
    const flat = new Scene();
    flat.add(new Mesh(g, new DiffuseMaterial()));
    bind(cpu, flat);
    const d: Vec = [0, 0, -1];
    const s = fn('surface')(fn('nearest')([0, 0, 1], d, FAR), d) as { dpdu: Vec; ns: Vec };
    expect(Math.hypot(...s.dpdu)).toBeCloseTo(1, 5);
    expect(s.dpdu[0] * s.ns[0] + s.dpdu[1] * s.ns[1] + s.dpdu[2] * s.ns[2]).toBeCloseTo(0, 6);
  });

  it('keeps the outside of a mirrored instance, by the inverse transposed', () => {
    const mirrored = new Mesh(new PlaneGeometry(1, 1), new DiffuseMaterial());
    mirrored.scale.set(-1, 1, 1);
    const one = new Scene();
    one.add(mirrored);
    bind(cpu, one);
    const d: Vec = [0, 0, -1];
    const s = fn('surface')(fn('nearest')([0.1, 0.1, 2], d, FAR), d) as { ng: Vec; front: boolean };
    expect(s.front).toBe(true);
    expect(s.ng).toEqual([0, 0, 1]);
  });

  it('reads the world rows the pack wrote for the instance', () => {
    const rows = Array.from(
      pack.arrays.instances.subarray(INSTANCE_MATRIX * 4, INSTANCE_MATRIX * 4 + 12),
    );
    const e = m.elements;
    expect(rows).toEqual(
      [0, 1, 2].flatMap((r) => [e[r]!, e[4 + r]!, e[8 + r]!, e[12 + r]!]).map(Math.fround),
    );
  });
});

// ---- The analytic sphere (record 0001, "The analytic sphere", step 6) ----------------------

/** A sphere's words: its centre and radius in world space, and the rows of `R^T`. */
interface SphereWords {
  c: Vec;
  r: number;
  rows?: readonly [Vec, Vec, Vec];
}

const IDENTITY: readonly [Vec, Vec, Vec] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** The bits of `x` as an f32, for a test that holds two values bit for bit. */
const f32bits = (x: number): number => new Uint32Array(Float32Array.of(x).buffer)[0]!;

/**
 * Binds `cpu` to a scene packed by hand, as record 0001 lays it out: one instance for each sphere
 * (flags bit 0, `[0]` the centre and radius, `[3]` to `[5]` the rows of R^T), and then, when
 * `triangle` is given, one mesh instance at the identity whose BLAS is one leaf of that triangle.
 * The TLAS is one leaf of every instance, after the BLAS. The materials are 0.
 */
function bindByHand(spheres: readonly SphereWords[], triangle?: readonly [Vec, Vec, Vec]): void {
  const count = spheres.length + (triangle === undefined ? 0 : 1);
  const instances = new Float32Array(count * INSTANCE_STRIDE * 4);
  const words = new Uint32Array(instances.buffer);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const grow = (a: number[], b: number[]) => {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, a[k]!);
      hi[k] = Math.max(hi[k]!, b[k]!);
    }
  };
  spheres.forEach((sphere, i) => {
    const at = i * INSTANCE_STRIDE * 4;
    instances.set([...sphere.c, sphere.r], at + INSTANCE_MATRIX * 4);
    (sphere.rows ?? IDENTITY).forEach((row, k) =>
      instances.set([...row, 0], at + (INSTANCE_INVERSE + k) * 4),
    );
    words.set([0, 0, 0, 0], at + INSTANCE_BASES * 4);
    words.set([INSTANCE_SPHERE, NONE, 0, 0], at + INSTANCE_FLAGS * 4);
    // The box, widened past the rounding of the words to f32.
    const c = Array.from(instances.subarray(at, at + 3));
    const r = instances[at + 3]! * (1 + 1e-6);
    grow(
      c.map((x) => x - r - 1e-6 * Math.abs(x)),
      c.map((x) => x + r + 1e-6 * Math.abs(x)),
    );
  });
  let vertices = new Float32Array(8);
  let triangles = new Uint32Array(4);
  let blas: number[] = [];
  if (triangle !== undefined) {
    const at = spheres.length * INSTANCE_STRIDE * 4;
    instances.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], at + INSTANCE_MATRIX * 4);
    instances.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], at + INSTANCE_INVERSE * 4);
    words.set([0, 0, 0, 0], at + INSTANCE_BASES * 4);
    words.set([0, 0, 0, 0], at + INSTANCE_FLAGS * 4);
    vertices = new Float32Array(triangle.flatMap((p) => [...p, 0, 0, 0, 1, 0]));
    triangles = Uint32Array.of(0, 1, 2, 0);
    const tlo = [0, 1, 2].map((k) => Math.min(...triangle.map((p) => p[k]!)));
    const thi = [0, 1, 2].map((k) => Math.max(...triangle.map((p) => p[k]!)));
    blas = [...tlo, 0, ...thi, 1];
    grow(tlo, thi);
  }
  const tlasBase = blas.length / 8;
  const nodes = new Float32Array([...blas, ...lo, 0, ...hi, count]);
  const nodeWords = new Uint32Array(nodes.buffer);
  // The words a and b are bits: the BLAS leaf (a 0, count 1), the TLAS leaf (a 0, count).
  if (triangle !== undefined) {
    nodeWords[3] = 0;
    nodeWords[7] = 1;
  }
  nodeWords[tlasBase * 8 + 3] = 0;
  nodeWords[tlasBase * 8 + 7] = count;
  cpu.setBinding('nodes', vec4s(nodes));
  cpu.setBinding('triangles', vec4s(triangles));
  cpu.setBinding('vertices', vec4s(vertices));
  cpu.setBinding('instances', vec4s(instances));
  cpu.setBinding('lights', vec4s(new Float32Array(4)));
  cpu.setBinding('materials', vec4s(new Float32Array(MATERIAL_STRIDE * 4)));
  cpu.setBinding('params', {
    eye: [0, 0, 0, 0],
    right: [1, 0, 0, 0],
    up: [0, 1, 0, 0],
    forward: [0, 0, -1, 0],
    lens: [1, 1, 0, 0],
    frame: [1, 1, 0, 1],
    tile: [0, 0, 1, 1],
    scene: [tlasBase, count, 0, 0],
    path: [8, 3, 0, 0],
  } as unknown as CpuValue);
}

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len3 = (a: Vec): number => Math.hypot(...a);

/** A unit vector, uniform over the sphere. */
const onSphere = (next: () => number): Vec => {
  const z = next() * 2 - 1;
  const phi = next() * 2 * Math.PI;
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(phi), s * Math.sin(phi), z];
};
/** A number log-uniform from `a` to `b`. */
const logUniform = (next: () => number, a: number, b: number): number =>
  a * Math.pow(b / a, next());

/**
 * The independent reference in f64: the nearest point of the line to the centre, and the half
 * chord about it. The smaller root above 0, else the larger, as `hitSphere` takes them. Undefined
 * for a miss.
 */
function sphereRef(o: Vec, d: Vec, c: Vec, r: number): number | undefined {
  const oc = sub(o, c);
  const a = dot3(d, d);
  const tc = -dot3(oc, d) / a;
  const f = add(oc, scale(d, tc));
  const h2 = dot3(f, f);
  if (h2 > r * r) return undefined;
  const half = Math.sqrt((r * r - h2) / a);
  if (tc - half > 0) return tc - half;
  if (tc + half > 0) return tc + half;
  return undefined;
}

/** `S` of the precision rule: the largest of 1 and every `abs(oc_k) / r`. */
const scaleS = (o: Vec, c: Vec, r: number): number =>
  Math.max(1, ...sub(o, c).map((x) => Math.abs(x) / r));
/** The spacing of f32 at `s`: `2^(floor(log2(s)) - 23)`. */
const ulpOf = (s: number): number => Math.pow(2, Math.floor(Math.log2(s)) - 23);

/** The impact parameter of a ray, in radii, in f64 on its f32 words. */
const impactOf = (o: Vec, d: Vec, c: Vec, r: number): number =>
  len3(cross3(sub(c, o), d)) / len3(d) / r;

/** A sphere and an origin drawn as the class of the precision rule draws them, rounded to f32. */
function drawSphere(next: () => number, near: number): { c: Vec; r: number; o: Vec; len: number } {
  const r = logUniform(next, 0.01, 100);
  const c: Vec = [next() * 2000 - 1000, next() * 2000 - 1000, next() * 2000 - 1000];
  const len = logUniform(next, 1e-3, 1e3);
  const o = add(c, scale(onSphere(next), r * logUniform(next, near, 1e5)));
  return { c: f32v(c), r: Math.fround(r), o: f32v(o), len };
}

/** `count` rays of precision rule 1: an origin 1.0001 to 10^5 radii out, aimed at an impact
 *  parameter of at most 0.9. A ray whose f32 words leave the class is drawn again. */
function aimedRays(seed: number, count: number) {
  const next = random(seed);
  const rays: { o: Vec; d: Vec; c: Vec; r: number }[] = [];
  while (rays.length < count) {
    const { c, r, o, len } = drawSphere(next, 1.0001);
    const w = norm(sub(c, o));
    const e1 = norm(cross3(Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], w));
    const e2 = cross3(w, e1);
    const b = next() * 0.9 * r;
    const angle = next() * 2 * Math.PI;
    const spot = add(c, add(scale(e1, b * Math.cos(angle)), scale(e2, b * Math.sin(angle))));
    const d = f32v(scale(norm(sub(spot, o)), len));
    if (len3(sub(o, c)) / r < 1.0001 || impactOf(o, d, c, r) > 0.9) continue;
    rays.push({ o, d, c, r });
  }
  return rays;
}

/** `count` rays of precision rule 3: an origin at least 1.00005 radii out, pointing away from
 *  the centre. A ray whose f32 words leave the class is drawn again. */
function awayRays(seed: number, count: number) {
  const next = random(seed);
  const rays: { o: Vec; d: Vec; c: Vec; r: number }[] = [];
  while (rays.length < count) {
    const { c, r, o, len } = drawSphere(next, 1.00005);
    const u = onSphere(next);
    const out = sub(o, c);
    const d = f32v(scale(dot3(u, out) < 0 ? scale(u, -1) : u, len));
    if (len3(out) / r < 1.00005 || !(dot3(d, out) > 0)) continue;
    rays.push({ o, d, c, r });
  }
  return rays;
}

const ROUNDS = 100_000;

describe('hitSphere: the precision rule against an independent f64 formula', () => {
  // Verifies: Design 0001.14
  it('meets 100,000 rays of rule 1 within 16 ulp(S) of f64, with abs(length(q) - 1) <= 4e-7', () => {
    let worst = 0;
    let worstQ = 0;
    let misses = 0;
    for (const { o, d, c, r } of aimedRays(61, ROUNDS)) {
      const h = fn('hitSphere')(o, d, c, r, FAR) as number[];
      const ref = sphereRef(o, d, c, r);
      if (h[0]! < 0 || ref === undefined) {
        misses++;
        continue;
      }
      const err = (Math.abs(h[0]! - ref) * len3(d)) / r / ulpOf(scaleS(o, c, r));
      worst = Math.max(worst, err);
      worstQ = Math.max(worstQ, Math.abs(len3([h[1]!, h[2]!, h[3]!]) - 1));
    }
    expect(misses).toBe(0);
    expect(worst).toBeLessThanOrEqual(16);
    expect(worstQ).toBeLessThanOrEqual(4e-7);
  }, 60_000);

  it('meets 0 of 100,000 rays of rule 3, from 1.00005 radii out or more, pointing away', () => {
    let hits = 0;
    for (const { o, d, c, r } of awayRays(62, ROUNDS))
      if ((fn('hitSphere')(o, d, c, r, FAR) as number[])[0]! >= 0) hits++;
    expect(hits).toBe(0);
  }, 60_000);

  it('misses when the ray meets the sphere at or beyond the limit, and when d is 0', () => {
    const h = fn('hitSphere')([0, 0, 5], [0, 0, -1], [0, 0, 0], 1, FAR) as number[];
    expect(h[0]).toBe(4);
    expect(h.slice(1)).toEqual([0, 0, 1]);
    expect((fn('hitSphere')([0, 0, 5], [0, 0, -1], [0, 0, 0], 1, 4) as number[])[0]).toBe(-1);
    expect((fn('hitSphere')([0, 0, 5], [0, 0, 0], [0, 0, 0], 1, FAR) as number[])[0]).toBe(-1);
  });
});

/** The rays of the silhouette: 256 by 256, through the plane at unit distance over the square
 *  from -0.2 to 0.2, from an eye at (0, 0, 3.4), toward a sphere at the origin. */
const SILHOUETTE = (() => {
  const rays: Vec[] = [];
  for (let j = 0; j < 256; j++)
    for (let i = 0; i < 256; i++)
      rays.push(f32v([-0.2 + ((i + 0.5) * 0.4) / 256, -0.2 + ((j + 0.5) * 0.4) / 256, -1]));
  return rays;
})();
const EYE: Vec = [0, 0, 3.4];
/** The area of the silhouette of a sphere of radius 0.4 from 3.4, in cells of the square. */
const SILHOUETTE_AREA = 18_060;
/** The tolerance of the count, against the area. */
const withinSilhouette = (count: number): boolean =>
  Math.abs(count - SILHOUETTE_AREA) <= 0.005 * SILHOUETTE_AREA;

describe('nearest: the silhouette of a sphere (record 0002, "The probes")', () => {
  it('counts the area of the silhouette in cells: pi tan^2 over the cell', () => {
    const tan = 0.4 / Math.sqrt(3.4 * 3.4 - 0.4 * 0.4);
    expect(Math.round((Math.PI * tan * tan) / (0.4 / 256) ** 2)).toBe(SILHOUETTE_AREA);
  });

  it('hits 256 by 256 rays 18,072 times, within 0.5 % of the 18,060 cells', () => {
    bindByHand([{ c: [0, 0, 0], r: 0.4 }]);
    let hits = 0;
    for (const d of SILHOUETTE)
      if ((fn('nearest')(EYE, d, FAR) as unknown as Hit).instance !== NONE) hits++;
    expect(hits).toBe(18_072);
    expect(withinSilhouette(hits)).toBe(true);
  }, 60_000);

  it('can fail: the same rays at radius 0.404 count 18,440 in f64, and 0.5 % rejects them', () => {
    let at = 0;
    let wide = 0;
    for (const d of SILHOUETTE) {
      if (sphereRef(EYE, d, [0, 0, 0], 0.4) !== undefined) at++;
      if (sphereRef(EYE, d, [0, 0, 0], 0.404) !== undefined) wide++;
    }
    expect(at).toBe(18_072);
    expect(wide).toBe(18_440);
    expect(withinSilhouette(wide)).toBe(false);
  });
});

describe('nearest and occluded: the walk over a sphere instance', () => {
  // A sphere and a triangle that cuts through it, so either can be the nearer.
  const sphere: SphereWords = { c: [0.1, -0.2, 0.05], r: 1 };
  const triangle: [Vec, Vec, Vec] = [
    [-2.5, -1.5, 0.3],
    [2.5, -1.5, -0.4],
    [0.2, 2.5, 0.1],
  ];
  const rays = (seed: number, count: number) => {
    const next = random(seed);
    return Array.from({ length: count }, () => {
      const o = f32v(scale(onSphere(next), 6));
      const to: Vec = [next() * 5 - 2.5, next() * 5 - 2.5, next() * 3 - 1.5];
      return [o, f32v(norm(sub(to, o)))] as const;
    });
  };

  /** The triangle in f64, by Moller and Trumbore: t, or undefined. */
  const triangleRef = (o: Vec, d: Vec): number | undefined => {
    const [p0, p1, p2] = triangle;
    const e1 = sub(p1, p0);
    const e2 = sub(p2, p0);
    const p = cross3(d, e2);
    const det = dot3(e1, p);
    if (det === 0) return undefined;
    const s = sub(o, p0);
    const u = dot3(s, p) / det;
    const q = cross3(s, e1);
    const v = dot3(d, q) / det;
    const t = dot3(e2, q) / det;
    return u >= 0 && v >= 0 && u + v <= 1 && t > 0 ? t : undefined;
  };

  it('finds the nearest of a sphere and a triangle as a brute force in f64: 1,000 of 1,000', () => {
    bindByHand([sphere], triangle);
    let same = 0;
    const met = [0, 0, 0];
    for (const [o, d] of rays(71, 1000)) {
      const ts = sphereRef(o, d, sphere.c, sphere.r) ?? Infinity;
      const tt = triangleRef(o, d) ?? Infinity;
      const want = ts === Infinity && tt === Infinity ? NONE : ts < tt ? 0 : 1;
      const hit = fn('nearest')(o, d, FAR) as unknown as Hit;
      if (hit.instance === want) same++;
      met[want === NONE ? 2 : want]!++;
    }
    expect(same).toBe(1000);
    // The rays meet both kinds, and miss too.
    for (const n of met) expect(n).toBeGreaterThan(50);
  }, 60_000);

  it('occluded agrees with nearest on 10,000 rays, at a limit before and after the hit', () => {
    bindByHand([sphere, { c: [1.6, 1.2, -0.8], r: 0.3 }], triangle);
    const near = random(73);
    let agree = 0;
    const all = rays(72, 10_000);
    for (const [o, d] of all) {
      const hit = fn('nearest')(o, d, FAR) as unknown as Hit;
      const limit = hit.instance === NONE ? 20 : hit.t * (0.5 + near());
      const expected = (fn('nearest')(o, d, limit) as unknown as Hit).instance !== NONE;
      if (fn('occluded')(o, d, limit) === expected) agree++;
    }
    expect(agree).toBe(10_000);
  }, 120_000);

  it('a sphere hit has triangle NONE, b1 and b2 0, and q the unit vector to the point', () => {
    bindByHand([{ c: [0, 0, 0], r: 2 }]);
    const hit = fn('nearest')([0, 0, 10], [0, 0, -1], FAR) as unknown as Hit & { q: Vec };
    expect(hit).toEqual({ t: 8, instance: 0, triangle: NONE, b1: 0, b2: 0, q: [0, 0, 1] });
  });
});

interface SurfaceOut {
  p: Vec;
  ng: Vec;
  ns: Vec;
  uv: [number, number];
  dpdu: Vec;
  material: number;
  front: boolean;
}

/** The rows of a turn by `angle` about the unit axis `a`, transposed: R^T, rounded to f32. */
function turnRows(a: Vec, angle: number): [Vec, Vec, Vec] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const r: [Vec, Vec, Vec] = [
    [t * a[0] * a[0] + c, t * a[0] * a[1] - s * a[2], t * a[0] * a[2] + s * a[1]],
    [t * a[0] * a[1] + s * a[2], t * a[1] * a[1] + c, t * a[1] * a[2] - s * a[0]],
    [t * a[0] * a[2] - s * a[1], t * a[1] * a[2] + s * a[0], t * a[2] * a[2] + c],
  ];
  return [0, 1, 2].map((k) => f32v([r[0][k]!, r[1][k]!, r[2][k]!])) as [Vec, Vec, Vec];
}

describe('surface: the Surface of a sphere hit (record 0004)', () => {
  const c: Vec = [0.3, -0.2, 0.5];
  const turned: SphereWords = { c, r: 0.7, rows: turnRows(norm([0.3, 1, -0.4]), 1.1) };
  /** Random rays from 4 out toward points of the sphere's disc, each one a hit. */
  const hits = (seed: number, count: number) => {
    const next = random(seed);
    const out: { d: Vec; hit: Hit & { q: Vec } }[] = [];
    while (out.length < count) {
      const o = f32v(add(c, scale(onSphere(next), 4)));
      const to = add(c, scale(onSphere(next), 0.7 * Math.sqrt(next())));
      const d = f32v(norm(sub(to, o)));
      const hit = fn('nearest')(o, d, FAR) as unknown as Hit & { q: Vec };
      if (hit.instance !== NONE) out.push({ d, hit });
    }
    return out;
  };

  it('gives ns equal to ng bit for bit, and ng at right angles to dpdu within 1e-6, on 10,000 hits', () => {
    bindByHand([turned]);
    let equal = 0;
    let worst = 0;
    for (const { d, hit } of hits(81, 10_000)) {
      const s = fn('surface')(hit, d) as unknown as SurfaceOut;
      if (s.ng.every((x, k) => f32bits(x) === f32bits(s.ns[k]!))) equal++;
      worst = Math.max(worst, Math.abs(dot3(s.ng, s.dpdu)) / len3(s.dpdu));
    }
    expect(equal).toBe(10_000);
    expect(worst).toBeLessThanOrEqual(1e-6);
  }, 120_000);

  it('gives the point, the outward normal toward the ray, and the instance material', () => {
    bindByHand([turned]);
    for (const { d, hit } of hits(82, 100)) {
      const s = fn('surface')(hit, d) as unknown as SurfaceOut;
      const point = add(c, scale(hit.q, 0.7));
      const offset = 1e-4 * Math.max(1, ...point.map(Math.abs));
      s.p.forEach((x, k) => expect(x).toBeCloseTo(point[k]! + s.ng[k]! * offset, 5));
      expect(s.front).toBe(true);
      expect(dot3(s.ng, sub(point, c))).toBeGreaterThan(0);
      expect(dot3(s.ng, d)).toBeLessThan(0);
      expect(s.material).toBe(0);
    }
  });

  it('keeps ng pointing out on a mirrored sphere: rows of R^T with a determinant of -1', () => {
    const rows: [Vec, Vec, Vec] = [
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    expect(dot3(rows[0], cross3(rows[1], rows[2]))).toBe(-1);
    bindByHand([{ c, r: 0.7, rows }]);
    for (const { d, hit } of hits(83, 1000)) {
      const s = fn('surface')(hit, d) as unknown as SurfaceOut;
      expect(s.front).toBe(true);
      expect(dot3(s.ng, hit.q)).toBeGreaterThan(0.999999);
    }
  });

  it('meets the far side from the centre, and reports front false with ng toward the centre', () => {
    bindByHand([turned]);
    const next = random(84);
    for (let i = 0; i < 100; i++) {
      const d = f32v(onSphere(next));
      const hit = fn('nearest')(c, d, FAR) as unknown as Hit & { q: Vec };
      expect(hit.instance).toBe(0);
      expect(hit.t).toBeCloseTo(0.7, 5);
      expect(dot3(hit.q, d)).toBeGreaterThan(0.999999);
      const s = fn('surface')(hit, d) as unknown as SurfaceOut;
      expect(s.front).toBe(false);
      expect(dot3(s.ng, hit.q)).toBeLessThan(-0.999999);
    }
  });

  it('gives a sphere turned a quarter turn about y the uv of the unturned one at the point turned back, within 2e-7', () => {
    // R turns +x to -z. Its transpose's rows: (0, 0, -1), (0, 1, 0), (1, 0, 0).
    const rows: [Vec, Vec, Vec] = [
      [0, 0, -1],
      [0, 1, 0],
      [1, 0, 0],
    ];
    turnRows([0, 1, 0], Math.PI / 2).forEach((row, k) =>
      row.forEach((x, j) => expect(x).toBeCloseTo(rows[k]![j]!, 7)),
    );
    bindByHand([
      { c, r: 0.7 },
      { c, r: 0.7, rows },
    ]);
    const next = random(85);
    let worst = 0;
    for (let i = 0; i < 1000; i++) {
      const q = f32v(onSphere(next));
      const back: Vec = [-q[2], q[1], q[0]];
      const a = (fn('sphereSurfaceAt')(1, q, scale(q, -1)) as unknown as SurfaceOut).uv;
      const b = (fn('sphereSurfaceAt')(0, back, scale(back, -1)) as unknown as SurfaceOut).uv;
      const du = Math.abs(a[0] - b[0]);
      worst = Math.max(worst, Math.min(du, 1 - du), Math.abs(a[1] - b[1]));
    }
    expect(worst).toBeLessThanOrEqual(2e-7);
  });

  it('falls back to a unit tangent about ns at a pole, where dpdu is 0', () => {
    bindByHand([{ c: [0, 0, 0], r: 1 }]);
    const s = fn('sphereSurfaceAt')(0, [0, 1, 0], [0, -1, 0]) as unknown as SurfaceOut;
    expect(len3(s.dpdu)).toBeCloseTo(1, 6);
    expect(dot3(s.dpdu, s.ns)).toBeCloseTo(0, 6);
    expect(s.uv).toEqual([0, 1]);
  });
});

describe("sphereUv: three.js's spherical layout, from sums, products and sqrt", () => {
  it('puts u 0 on -x, 0.25 on +z, 0.5 on +x, and v 1 at +y, 0.5 on the equator, 0 at -y', () => {
    const uv = (q: Vec) => fn('sphereUv')(q) as number[];
    expect(uv([-1, 0, 0])).toEqual([0, 0.5]);
    expect(uv([0, 0, 1])[0]).toBeCloseTo(0.25, 7);
    expect(uv([1, 0, 0])[0]).toBeCloseTo(0.5, 7);
    expect(uv([0, 0, -1])[0]).toBeCloseTo(0.75, 7);
    expect(uv([0, 1, 0])[1]).toBe(1);
    expect(uv([0, -1, 0])[1]).toBeCloseTo(0, 7);
  });

  it('is within 2e-7 of atan2 and acos in f64 at 100,000 points, u compared on the circle', () => {
    const next = random(91);
    let worstU = 0;
    let worstV = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const q = f32v(onSphere(next));
      const [u, v] = fn('sphereUv')(q) as [number, number];
      let refU = Math.atan2(q[2], -q[0]) / (2 * Math.PI);
      if (refU < 0) refU += 1;
      const refV = 1 - Math.acos(q[1] / len3(q)) / Math.PI;
      const du = Math.abs(u - refU);
      worstU = Math.max(worstU, Math.min(du, 1 - du));
      worstV = Math.max(worstV, Math.abs(v - refV));
    }
    expect(worstU).toBeLessThanOrEqual(2e-7);
    expect(worstV).toBeLessThanOrEqual(2e-7);
  }, 60_000);
});

describe('surface: a flat-shaded material (record 0004, "Flat shading")', () => {
  const material = new DiffuseMaterial();
  const ball = new Mesh(new SphereGeometry(1, 12, 8), material);
  const scene = new Scene();
  scene.add(ball);
  const next = random(11);
  // 1,000 rays from a sphere of radius 6, each aimed at a point within 0.5 of the centre, so
  // each meets the mesh.
  const rays = Array.from({ length: 1000 }, () => {
    const z = next() * 2 - 1;
    const phi = next() * 2 * Math.PI;
    const s = Math.sqrt(1 - z * z);
    const o: Vec = f32v([6 * s * Math.cos(phi), 6 * s * Math.sin(phi), 6 * z]);
    const to: Vec = [next() - 0.5, next() - 0.5, next() - 0.5];
    return [o, f32v(norm(sub(to, o)))] as const;
  });
  /** The surface at each ray's hit, with the flag as given. */
  const surfaces = (flat: boolean): { ng: Vec; ns: Vec }[] => {
    material.flatShading = flat;
    bind(cpu, scene);
    return rays.map(([o, d]) => {
      const hit = fn('nearest')(o, d, FAR) as unknown as Hit;
      expect(hit.instance).toBe(0);
      return fn('surface')(hit, d) as unknown as { ng: Vec; ns: Vec };
    });
  };

  // Verifies: Design 0004.10
  it('gives ns equal to ng bit for bit on 1,000 of 1,000 hits', () => {
    const same = surfaces(true).filter((s) => s.ns.every((x, k) => Object.is(x, s.ng[k])));
    expect(same.length).toBe(1000);
  });

  // Verifies: Design 0004.10
  it('can fail: with the flag clear, the same rays give dot(ns, ng) below 0.99999 on 950 or more', () => {
    const tilted = surfaces(false).filter(
      (s) => s.ns[0] * s.ng[0] + s.ns[1] * s.ng[1] + s.ns[2] * s.ng[2] < 0.99999,
    );
    console.log(`flat shading, flag clear: dot(ns, ng) < 0.99999 on ${tilted.length} of 1000`);
    expect(tilted.length).toBeGreaterThanOrEqual(950);
  });
});
