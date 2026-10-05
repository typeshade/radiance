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
import { Color } from '../math/Color.ts';
import { packMaterial } from '../renderers/scene-pack.ts';

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
    const trace = readFileSync(join(import.meta.dir, 'trace.shade.ts'), 'utf8').replace(
      /\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(trace).not.toMatch(/\bmaterials\s*\[/);
    expect(trace).not.toMatch(/\bMATERIAL_[A-Z_]+/);
    expect(trace).toMatch(/\bemission\(/);
    expect(trace).toMatch(/\bsampleBsdf\(/);
    expect(trace).toMatch(/\bevalBsdf\(/);
  });

  it('can fail: a loop that reads a material word is seen', () => {
    const wrong = 'const albedo = materials[hit.material * 8];';
    expect(wrong).toMatch(/\bmaterials\s*\[/);
  });
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
