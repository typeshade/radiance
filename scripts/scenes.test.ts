// The differential scenes of M2 (scripts/scenes.ts): each one holds the feature its name says.
// The gate renders them on the GPU and on the oracle (scripts/gates/differential.mjs), and it
// would pass a scene that lost its feature. These tests read the scene pack the renderer uploads,
// so a scene that stops being triangles, instances or lights fails here, in `bun run check`.
//
// Verifies: Design 0002.4
// This file holds the three scenes of M2 in the table of "The differential scenes". It does not
// hold the scenes of M3 (`physical`, `textures` and `hdri`), which no scene function makes yet.

import { describe, expect, test } from 'bun:test';
import { BufferGeometry, Mesh, SphereGeometry } from '@typeshade/radiance';
import { INSTANCE_STRIDE, LIGHT_STRIDE } from '../packages/radiance/src/kernels/layout.shade.ts';
import { ScenePack } from '../packages/radiance/src/renderers/scene-pack.ts';
import { scenes, type SceneName } from './scenes.ts';

/** The scene `name`, packed as the renderer packs it. */
function packed(name: SceneName) {
  const made = scenes[name]();
  made.scene.updateMatrixWorld();
  const pack = new ScenePack();
  pack.update(made.scene);
  const meshes: Mesh[] = [];
  made.scene.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o);
  });
  return { ...made, pack, meshes };
}

/** The determinant of the upper 3 x 3 of the world matrix of the instance in slot `i`. */
function determinant(pack: ScenePack, i: number): number {
  const w = pack.arrays.instances;
  const row = (r: number) =>
    Array.from(w.subarray((i * INSTANCE_STRIDE + r) * 4, (i * INSTANCE_STRIDE + r) * 4 + 3));
  const [a, b, c] = [row(0), row(1), row(2)] as [number[], number[], number[]];
  return (
    a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
    a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
    a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)
  );
}

/** The area of each triangle of `g`. */
function areas(g: BufferGeometry): number[] {
  const p = g.position;
  const out: number[] = [];
  for (let t = 0; t < g.index.length; t += 3) {
    const [a, b, c] = [g.index[t]!, g.index[t + 1]!, g.index[t + 2]!].map((v) => v * 3) as [
      number,
      number,
      number,
    ];
    const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!] as const;
    const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!] as const;
    out.push(
      0.5 *
        Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]),
    );
  }
  return out;
}

describe('the scene triangles', () => {
  const s = packed('triangles');
  test('holds a sphere of 12 x 8 segments and a box, as triangles', () => {
    const spheres = s.meshes.filter((m) => m.geometry instanceof SphereGeometry);
    expect(spheres).toHaveLength(1);
    const sphere = spheres[0]!.geometry as SphereGeometry;
    expect([sphere.widthSegments, sphere.heightSegments]).toEqual([12, 8]);
    expect(sphere.index.length / 3).toBe(12 * 8 * 2 - 2 * 12);
    // Two quads of the room, the lamp's two triangles, the sphere's 168 and the box's 12.
    expect(s.pack.counts.triangles).toBe(2 + 2 + 2 + 168 + 12);
  });
  test('shades the sphere with smooth normals: a vertex normal is the unit direction outward', () => {
    const sphere = s.meshes.find((m) => m.geometry instanceof SphereGeometry)!
      .geometry as SphereGeometry;
    const n = sphere.normal!;
    const p = sphere.position;
    for (let v = 0; v < p.length / 3; v++) {
      const r = Math.hypot(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!);
      if (r === 0) continue;
      expect(n[v * 3]!).toBeCloseTo(p[v * 3]! / r, 6);
      expect(n[v * 3 + 1]!).toBeCloseTo(p[v * 3 + 1]! / r, 6);
    }
  });
  test('walks a BVH of many nodes for the sphere', () => {
    // `tlasBase` is where the TLAS starts, so it counts the nodes of the BLASes. The five
    // geometries would have 5 nodes if each were one leaf.
    expect(s.pack.counts.tlasBase).toBeGreaterThan(5 * 4);
  });
});

describe('the scene instances', () => {
  const s = packed('instances');
  const shared = () => {
    const count = new Map<BufferGeometry, number>();
    for (const m of s.meshes)
      count.set(m.geometry as BufferGeometry, (count.get(m.geometry as BufferGeometry) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]!;
  };
  test('puts one geometry in four instances that share one BLAS', () => {
    const [geometry, uses] = shared();
    expect(uses).toBe(4);
    // Three quads of the room (2 triangles each) and the shared geometry once (8 triangles).
    expect(geometry.index.length / 3).toBe(8);
    expect(s.pack.counts.triangles).toBe(3 * 2 + 8);
    expect(s.pack.counts.instances).toBe(7);
  });
  test('has a TLAS of more than one leaf, so the traversal descends into it', () => {
    expect(s.pack.counts.instances).toBeGreaterThan(4);
    expect(s.pack.counts.nodes - s.pack.counts.tlasBase).toBeGreaterThan(1);
  });
  test('scales one instance non-uniformly and mirrors another', () => {
    const dets = Array.from({ length: s.pack.counts.instances }, (_, i) => determinant(s.pack, i));
    expect(dets.filter((d) => d < 0)).toHaveLength(1);
    expect(dets.some((d) => Math.abs(d - 1.6 * 0.7) < 1e-4)).toBe(true);
    const stretched = s.meshes.filter((m) => m.scale.x !== m.scale.y && m.scale.x > 0);
    expect(stretched).toHaveLength(1);
    expect(stretched[0]!.rotation.y).not.toBe(0);
  });
  test('gives the instances of one geometry more than two materials', () => {
    const own = new Set(s.meshes.filter((m) => m.geometry === shared()[0]).map((m) => m.material));
    expect(own.size).toBe(4);
  });
  test('uses a geometry with no mirror symmetry, so the mirrored instance differs', () => {
    const p = shared()[0].position;
    const xs = new Set<string>();
    for (let v = 0; v < p.length / 3; v++) xs.add([p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!].join());
    const flipped = [...xs].filter((k) => {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      return !xs.has([-x, y, z].join());
    });
    expect(flipped.length).toBeGreaterThan(0);
  });
});

describe('the scene lights', () => {
  const s = packed('lights');
  const words = (i: number) =>
    Array.from(s.pack.arrays.lights.subarray(i * LIGHT_STRIDE * 4, (i + 1) * LIGHT_STRIDE * 4));
  test('has three lights, one triangle each, with the cumulative chance rising to 1', () => {
    expect(s.pack.counts.lights).toBe(3);
    const cdf = [0, 1, 2].map((i) => words(i)[3]!);
    expect(cdf[0]!).toBeGreaterThan(0);
    expect(cdf[1]!).toBeGreaterThan(cdf[0]!);
    expect(cdf[2]!).toBeGreaterThan(cdf[1]!);
    expect(cdf[2]).toBe(1);
  });
  test('gives each lamp a chance of its own, none within a tenth of another', () => {
    const cdf = [0, ...[0, 1, 2].map((i) => words(i)[3]!)];
    const share = [1, 2, 3].map((i) => cdf[i]! - cdf[i - 1]!);
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const)
      expect(Math.abs(share[a]! - share[b]!)).toBeGreaterThan(0.1);
  });
  test('makes the lamps of triangles of three different areas and colours', () => {
    const lamps = s.meshes.filter(
      (m) => m.material.emissive.r + m.material.emissive.g + m.material.emissive.b > 0,
    );
    expect(lamps).toHaveLength(3);
    const area = lamps.map((m) => areas(m.geometry as BufferGeometry));
    for (const a of area) expect(a).toHaveLength(1);
    const flat = area.map((a) => a[0]!).sort((a, b) => a - b);
    expect(flat[1]! / flat[0]!).toBeGreaterThan(2);
    expect(flat[2]! / flat[1]!).toBeGreaterThan(2);
    const colours = new Set(
      lamps.map((m) =>
        [m.material.emissive.r, m.material.emissive.g, m.material.emissive.b].join(),
      ),
    );
    expect(colours.size).toBe(3);
  });
});
