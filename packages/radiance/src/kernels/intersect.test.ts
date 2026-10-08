// The traversal and the surface (design record 0001, "Traversal") on the CPU oracle
// (`compileModuleJs`, at f32), over buffers a `ScenePack` packed: `nearest` through a TLAS of
// inner nodes and leaves against a test of every triangle, the watertight triangle test on a
// shared edge, an instance hit where its matrix puts it, and `surface` (record 0004's `Surface`).

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
  INSTANCE_MATRIX,
  INSTANCE_STRIDE,
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
