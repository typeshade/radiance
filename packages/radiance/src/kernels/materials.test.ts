// The shading contract (design record 0004, "The shading contract") on the CPU oracle
// (`compileModuleJs`, at f32): `emission`, `sampleBsdf` and `evalBsdf` over a `Surface`, reading
// the material records the host packed. A diffuse sample's weight is its colour, a mirror sample is
// the reflection, `evalBsdf`'s pdf integrates to 1 over the sphere, and a single-sided light is
// dark from behind. The path loop calls these functions and reads no material word itself.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileModuleJs, type CpuModule, type CpuValue } from 'typeshade';
import { DiffuseMaterial } from '../materials/DiffuseMaterial.ts';
import { EmissiveMaterial } from '../materials/EmissiveMaterial.ts';
import type { Material } from '../materials/Material.ts';
import { MirrorMaterial } from '../materials/MirrorMaterial.ts';
import { PhysicalMaterial } from '../materials/PhysicalMaterial.ts';
import { SphereGeometry } from '../geometries/SphereGeometry.ts';
import { Color } from '../math/Color.ts';
import { Mesh } from '../objects/Mesh.ts';
import { SCENE_BUFFERS, ScenePack, packMaterial } from '../renderers/scene-pack.ts';
import { Scene } from '../scenes/Scene.ts';
import { MATERIAL_MAPS, MATERIAL_PARAMS } from './materials.shade.ts';
import {
  INSTANCE_BASES,
  INSTANCE_FLAGS,
  INSTANCE_INVERSE,
  INSTANCE_MATRIX,
  INSTANCE_SPHERE,
  INSTANCE_STRIDE,
} from './layout.shade.ts';

type Vec = [number, number, number];

const PATH = join(import.meta.dir, 'materials.shade.ts');
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

/** intersect.shade.ts on the oracle: `nearest` and `surface`, which this file's module lacks. */
function loadIntersect(): CpuModule {
  const path = join(import.meta.dir, 'intersect.shade.ts');
  const c = compile(readFileSync(path, 'utf8'), { fileName: path, readDocument: read });
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return compileModuleJs(c.module!, { precision: 'f32' });
}

/** `a`, four numbers at a time, as the oracle takes an `array<vec4>` or an `array<vec4u>`. */
const vec4s = (a: Float32Array | Uint32Array): CpuValue =>
  Array.from({ length: a.length / 4 }, (_, i) =>
    Array.from(a.subarray(i * 4, i * 4 + 4)),
  ) as unknown as CpuValue;

/** The materials, packed by the host's packer, as the oracle takes an `array<vec4>`. */
function bindMaterials(cpu: CpuModule, list: readonly Material[]): void {
  const words = list.flatMap((m) => Array.from(packMaterial(m)));
  cpu.setBinding(
    'materials',
    Array.from({ length: words.length / 4 }, (_, i) =>
      words.slice(i * 4, i * 4 + 4),
    ) as unknown as CpuValue,
  );
}

interface Surface {
  p: Vec;
  ng: Vec;
  ns: Vec;
  uv: [number, number];
  dpdu: Vec;
  material: number;
  front: boolean;
}

interface BsdfSample {
  wi: Vec;
  weight: Vec;
  pdf: number;
  specular: boolean;
}

const f32v = (a: Vec): Vec => a.map(Math.fround) as Vec;
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec): Vec => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A surface of material `material`, its shading normal tilted off its geometric one. */
const surfaceOf = (material: number, front = true): Surface => ({
  p: [0, 0, 0],
  ng: [0, 0, 1],
  ns: f32v(norm([0.2, -0.1, 1])),
  uv: [0, 0],
  dpdu: [1, 0, 0],
  material,
  front,
});

const cpu = load();
/** A function of the module, called with the plain values the oracle takes: a struct as an
 *  object, a vector as an array. */
const fn = (name: string) => cpu.fns[name]! as unknown as (...args: unknown[]) => CpuValue;
const diffuse = new DiffuseMaterial({ color: new Color(0.6, 0.3, 0.15) });
const mirror = new MirrorMaterial({ color: new Color(0.9, 0.8, 0.5) });
const physical = new PhysicalMaterial({ color: new Color(0.2, 0.7, 0.4), roughness: 0.1 });
const lamp = new EmissiveMaterial({ color: new Color(4, 2, 1) });
const twoSided = new EmissiveMaterial({ color: new Color(1, 1, 3) });
twoSided.doubleSided = true;
const MATERIALS = [diffuse, mirror, physical, lamp, twoSided];
bindMaterials(cpu, MATERIALS);
const colorOf = (m: Material): Vec => f32v([m.color.r, m.color.g, m.color.b]);
const wo: Vec = f32v(norm([0.3, 0.5, 0.8]));

// Verifies: Design 0004.2
describe('sampleBsdf', () => {
  for (const [name, index] of [
    ['a diffuse surface', 0],
    ['a physical surface, which renders as a diffuse until record 0004 step 2', 2],
  ] as const) {
    it(`gives ${name} a cosine-distributed direction whose weight is its colour`, () => {
      const s = surfaceOf(index);
      for (let i = 0; i < 64; i++) {
        const r = [0.5, ((i % 8) + 0.5) / 8, (Math.floor(i / 8) + 0.5) / 8];
        const b = fn('sampleBsdf')(s, wo, r) as unknown as BsdfSample;
        expect(b.weight).toEqual(colorOf(MATERIALS[index]!));
        expect(b.specular).toBe(false);
        expect(Math.hypot(...b.wi)).toBeCloseTo(1, 5);
        expect(dot(b.wi, s.ns)).toBeGreaterThan(0);
        expect(b.pdf).toBeCloseTo(dot(b.wi, s.ns) / Math.PI, 6);
      }
    });
  }

  it('gives a mirror the reflection about the shading normal, its colour, a pdf of 1', () => {
    const s = surfaceOf(1);
    const b = fn('sampleBsdf')(s, wo, [0.3, 0.6, 0.9]) as unknown as BsdfSample;
    const c = 2 * dot(wo, s.ns);
    const reflection: Vec = [c * s.ns[0] - wo[0], c * s.ns[1] - wo[1], c * s.ns[2] - wo[2]];
    b.wi.forEach((x, k) => expect(x).toBeCloseTo(reflection[k]!, 6));
    expect(b.weight).toEqual(colorOf(mirror));
    expect(b.pdf).toBe(1);
    expect(b.specular).toBe(true);
  });
});

// Verifies: Design 0004.2
describe('evalBsdf', () => {
  it("gives a diffuse surface's value as colour over pi, and the cosine's pdf", () => {
    const s = surfaceOf(0);
    const wi: Vec = f32v(norm([-0.4, 0.2, 0.7]));
    const v = fn('evalBsdf')(s, wo, wi) as number[];
    colorOf(diffuse).forEach((c, k) => expect(v[k]).toBeCloseTo(c / Math.PI, 6));
    expect(v[3]).toBeCloseTo(dot(wi, s.ns) / Math.PI, 6);
    expect(fn('evalBsdf')(s, wo, [0, 0, -1])).toEqual([0, 0, 0, 0]);
  });

  it('gives a mirror nothing at any one direction: its lobe is a delta', () => {
    expect(fn('evalBsdf')(surfaceOf(1), wo, [0, 0, 1])).toEqual([0, 0, 0, 0]);
  });

  it('has a pdf that integrates to 1 over the sphere, within 2 % by 4,096 samples', () => {
    for (const index of [0, 2]) {
      const s = surfaceOf(index);
      // A stratified estimate over directions spread evenly on the sphere.
      let sum = 0;
      const n = 64;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const z = 1 - (2 * (i + 0.5)) / n;
          const phi = (2 * Math.PI * (j + 0.5)) / n;
          const r = Math.sqrt(1 - z * z);
          const wi = f32v([r * Math.cos(phi), r * Math.sin(phi), z]);
          sum += (fn('evalBsdf')(s, wo, wi) as number[])[3]!;
        }
      const integral = (4 * Math.PI * sum) / (n * n);
      expect(Math.abs(integral - 1)).toBeLessThan(0.02);
    }
  });
});

// Verifies: Design 0010.5
describe('the integer words of the material record (record 0010, Part 1)', () => {
  /** Bind one material whose words are `words`, as the oracle's `materials` array, then run `use`. */
  const withWords = (words: Float32Array, use: () => void): void => {
    cpu.setBinding('materials', vec4s(words) as unknown as CpuValue);
    try {
      use();
    } finally {
      bindMaterials(cpu, MATERIALS);
    }
  };

  it('reads every texture id from 0 to 1,024 in each of the four slots', () => {
    for (let slot = 0; slot < 4; slot++) {
      for (let id = 0; id <= 1024; id++) {
        const words = new Float32Array(8 * 4);
        words[MATERIAL_MAPS * 4 + slot] = id;
        withWords(words, () => {
          expect(fn('materialMap')(0, slot)).toBe(id);
        });
      }
    }
  });

  it('reads every flag mask below 0x4000 back, from the type and flags word', () => {
    for (let mask = 0; mask < 0x4000; mask++) {
      const words = new Float32Array(8 * 4);
      words[MATERIAL_PARAMS * 4 + 3] = mask;
      withWords(words, () => {
        expect(fn('materialFlags')(0)).toBe(mask);
      });
    }
  });

  it('can fail: 16,777,217 does not survive f32 and reads back as 16,777,216', () => {
    const words = new Float32Array(8 * 4);
    words[MATERIAL_PARAMS * 4 + 3] = 16777217;
    withWords(words, () => {
      // The exactness rule of record 0010 holds below 2^24. This value is above it, so the rule
      // must read it as the nearest f32, and the test shows that an exact read is not owed.
      expect(fn('materialFlags')(0)).toBe(16777216);
    });
  });
});

// Verifies: Design 0004.2
describe('emission', () => {
  it("gives a light's radiance from its front face", () => {
    expect(fn('emission')(surfaceOf(3, true), wo)).toEqual(f32v([4, 2, 1]));
  });

  it('is zero on the back face of a single-sided light', () => {
    expect(fn('emission')(surfaceOf(3, false), wo)).toEqual([0, 0, 0]);
  });

  it('gives a double-sided light its radiance from both faces', () => {
    expect(fn('emission')(surfaceOf(4, false), wo)).toEqual(f32v([1, 1, 3]));
    expect(fn('emission')(surfaceOf(4, true), wo)).toEqual(f32v([1, 1, 3]));
  });

  it('is zero for a material that does not emit', () => {
    expect(fn('emission')(surfaceOf(0, true), wo)).toEqual([0, 0, 0]);
  });
});

// Verifies: Design 0004.2
const TRACE = readFileSync(join(import.meta.dir, 'trace.shade.ts'), 'utf8');

/** What in `source` reads a material word: an index into `materials` or a MATERIAL_ offset. The
 *  comments are taken out first, so a comment that names one reads nothing. */
function materialReads(source: string): string[] {
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  return [...code.matchAll(/\bmaterials\s*\[|\bMATERIAL_[A-Z_]+/g)].map((m) => m[0]);
}

/** trace.shade.ts with `line` put in the path loop, before the line that calls `sampleBsdf`. */
function beforeSampleBsdf(line: string): string {
  const call = TRACE.search(/^.*\bsampleBsdf\(/m);
  expect(call).toBeGreaterThan(0);
  return `${TRACE.slice(0, call)}${line}\n${TRACE.slice(call)}`;
}

describe('the contract, as the record states it', () => {
  it('exports Surface, BsdfSample, emission, sampleBsdf and evalBsdf', () => {
    const exported = readFileSync(PATH, 'utf8');
    for (const name of ['class Surface', 'class BsdfSample'])
      expect(exported).toContain(`export ${name}`);
    expect(exported).toContain('export function emission(s: Surface, wo: vec3): vec3');
    expect(exported).toContain(
      'export function sampleBsdf(s: Surface, wo: vec3, r: vec3): BsdfSample',
    );
    expect(exported).toContain('export function evalBsdf(s: Surface, wo: vec3, wi: vec3): vec4');
  });

  it('leaves the path loop no material word to read: trace.shade.ts names no material binding or offset', () => {
    expect(materialReads(TRACE)).toEqual([]);
    expect(TRACE).toMatch(/\bemission\(/);
    expect(TRACE).toMatch(/\bsampleBsdf\(/);
    expect(TRACE).toMatch(/\bevalBsdf\(/);
  });

  it('can fail: a read of a material word put into the path loop is seen, and a comment is not', () => {
    expect(
      materialReads(beforeSampleBsdf('const albedo = materials[hit.material * 8u].xyz;')),
    ).toEqual(['materials[']);
    expect(materialReads(beforeSampleBsdf('const base = MATERIAL_BASE;'))).toEqual([
      'MATERIAL_BASE',
    ]);
    expect(
      materialReads(beforeSampleBsdf('// materials[hit.material * 8u] is the base colour.')),
    ).toEqual([]);
  });
});

// Verifies: Design 0004.10
describe('a flat-shaded mesh sphere (record 0004, "Flat shading")', () => {
  const RAYS = 100_000;
  const material = new MirrorMaterial();
  const scene = new Scene();
  scene.add(new Mesh(new SphereGeometry(1, 12, 8), material));
  scene.updateMatrixWorld();
  const intersect = loadIntersect();
  const shade = load();
  const call = (m: CpuModule, name: string) =>
    m.fns[name]! as unknown as (...args: unknown[]) => CpuValue;

  /** Numbers in [0, 1) from a seed: mulberry32. */
  const random = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /**
   * RAYS primary rays along -z that meet the ball, at offsets 0.7 to 1 from its axis, so the
   * hits lie across its silhouette. At each hit, a mirror sample. Returns how many samples have
   * `dot(wi, ng)` of 0 or less, how many reflections about `ns` went under `ng` before the fold,
   * and how many rays missed the ball on the way to RAYS hits.
   */
  const run = (flat: boolean): { under: number; folded: number; missed: number } => {
    material.flatShading = flat;
    const pack = new ScenePack();
    pack.update(scene);
    for (const name of SCENE_BUFFERS) intersect.setBinding(name, vec4s(pack.arrays[name]));
    intersect.setBinding(
      'params',
      JSON.parse(
        JSON.stringify(
          pack.params({
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
          }),
        ),
      ) as CpuValue,
    );
    shade.setBinding('materials', vec4s(pack.arrays.materials));
    const next = random(17);
    const d: Vec = [0, 0, -1];
    const wo: Vec = [0, 0, 1];
    let hits = 0;
    let missed = 0;
    let under = 0;
    let folded = 0;
    while (hits < RAYS) {
      const r = Math.sqrt(0.49 + 0.51 * next());
      const phi = 2 * Math.PI * next();
      const o = f32v([r * Math.cos(phi), r * Math.sin(phi), 4]);
      const hit = call(intersect, 'nearest')(o, d, 1e30) as unknown as { instance: number };
      if (hit.instance !== 0) {
        missed++;
        continue;
      }
      hits++;
      const s = call(intersect, 'surface')(hit, d) as unknown as Surface;
      const c = 2 * dot(wo, s.ns);
      if (dot([c * s.ns[0] - wo[0], c * s.ns[1] - wo[1], c * s.ns[2] - wo[2]], s.ng) < 0) folded++;
      const b = call(shade, 'sampleBsdf')(s, wo, [0.5, 0.5, 0.5]) as unknown as BsdfSample;
      if (dot(b.wi, s.ng) <= 0) under++;
    }
    return { under, folded, missed };
  };

  it('gives no mirror sample at or under ng: 0 of 100,000, and the fold has nothing to do', () => {
    const flat = run(true);
    console.log(`flat mesh sphere: ${JSON.stringify(flat)} of ${RAYS} hits`);
    expect(flat.under).toBe(0);
    expect(flat.folded).toBe(0);
  }, 120_000);

  it('can fail: with the flag clear, some reflections about ns go under ng', () => {
    // The count of `under` here depends on the fold of record 0004, step 7, so it is not held.
    const smooth = run(false);
    console.log(`smooth mesh sphere: ${JSON.stringify(smooth)} of ${RAYS} hits`);
    expect(smooth.folded).toBeGreaterThan(0);
  }, 120_000);
});

describe('the helpers sampleBsdf draws with', () => {
  it('turn is cos and sin of 2 pi r to below f32 resolution', () => {
    for (let i = 0; i < 4096; i++) {
      const r = i / 4096 + 1 / 8192;
      const [c, s] = fn('turn')(r) as number[];
      expect(Math.abs(c! - Math.cos(2 * Math.PI * r))).toBeLessThan(3e-7);
      expect(Math.abs(s! - Math.sin(2 * Math.PI * r))).toBeLessThan(3e-7);
    }
  });

  it('aboutNormal gives unit directions on the side of the normal', () => {
    const n = [0, 0.6, 0.8];
    for (let i = 0; i < 64; i++) {
      const d = fn('aboutNormal')(n, [
        (i % 8) / 8 + 0.01,
        Math.floor(i / 8) / 8 + 0.01,
      ]) as number[];
      expect(Math.hypot(d[0]!, d[1]!, d[2]!)).toBeCloseTo(1, 5);
      expect(d[0]! * n[0]! + d[1]! * n[1]! + d[2]! * n[2]!).toBeGreaterThan(0);
    }
  });
});

// Record 0004, "The fold on a `Sphere`", with record 0001, step 6: on a `Sphere` `ns` is `ng`,
// so a mirror sample never goes under `ng`. Record 0004's Amendment 2 measured 0.416 % of the
// area of a mesh sphere under `ng`, before its fold.
describe('a mirror sample on a Sphere', () => {
  it('never has dot(wi, ng) of 0 or less, on 100,000 primary rays across the silhouette: 0', () => {
    const g = loadIntersect();
    const call = (name: string) => g.fns[name]! as unknown as (...args: unknown[]) => CpuValue;
    // One sphere of radius 0.4 at the origin, with the mirror (material 1), packed by hand as
    // record 0001 lays it out.
    const instances = new Float32Array(INSTANCE_STRIDE * 4);
    const words = new Uint32Array(instances.buffer);
    instances.set([0, 0, 0, 0.4], INSTANCE_MATRIX * 4);
    instances.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], INSTANCE_INVERSE * 4);
    words.set([0, 0, 0, 1], INSTANCE_BASES * 4);
    words.set([INSTANCE_SPHERE, 0xffffffff, 0, 0], INSTANCE_FLAGS * 4);
    g.setBinding(
      'instances',
      Array.from({ length: INSTANCE_STRIDE }, (_, i) =>
        Array.from(instances.subarray(i * 4, i * 4 + 4)),
      ) as unknown as CpuValue,
    );
    // From an eye 3.4 away, rays through points spread evenly over the disc the sphere covers
    // in the plane at unit distance (a sunflower), out to its rim.
    const eye: Vec = [0, 0, 3.4];
    const rim = 0.4 / Math.sqrt(3.4 * 3.4 - 0.4 * 0.4);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const N = 100_000;
    let hits = 0;
    let under = 0;
    for (let i = 0; i < N; i++) {
      const rho = rim * Math.sqrt((i + 0.5) / N);
      const d = f32v([rho * Math.cos(i * golden), rho * Math.sin(i * golden), -1]);
      const h = call('hitSphere')(eye, d, [0, 0, 0], 0.4, 1e30) as number[];
      if (h[0]! < 0) continue;
      hits++;
      const s = call('sphereSurfaceAt')(0, h.slice(1), d) as unknown as Surface;
      expect(s.material).toBe(1);
      const wo = norm([-d[0], -d[1], -d[2]]);
      const b = fn('sampleBsdf')(s, f32v(wo), [0.5, 0.5, 0.5]) as unknown as BsdfSample;
      if (dot(b.wi, s.ng) <= 0) under++;
    }
    expect(hits).toBe(N);
    expect(under).toBe(0);
  }, 60_000);
});
