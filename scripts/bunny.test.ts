// The Stanford bunny of the `bunny` example (design record 0001, step 4): the committed .glb is
// the one scripts/assets/bunny.mjs records, the loader reads it into one mesh of 69,451
// triangles, and the BVH builder takes it. The test prints the milliseconds the BVH build and the
// whole scene pack take on the machine that runs it. It holds them only to a loose bound, because
// a time depends on the machine and must not fail a check.

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BufferGeometry,
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  PlaneGeometry,
  Scene,
} from '@typeshade/radiance';
import { GLTFLoader } from '@typeshade/radiance-addons';
import { buildBlas } from '../packages/radiance/src/accel/bvh.ts';
import { ScenePack } from '../packages/radiance/src/renderers/scene-pack.ts';
import { BUNNY_GLB_SHA256 } from './assets/bunny.mjs';

const GLB = new URL('../site/public/assets/bunny.glb', import.meta.url);
const LICENSES = new URL('../site/public/assets/LICENSES.md', import.meta.url);
/** The most one committed asset may weigh, and the most the assets of a wave may weigh together. */
const ASSET_LIMIT = 8 * 1024 * 1024;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

describe('the bunny asset', () => {
  const bytes = readFileSync(GLB);

  it('is the file that the script records, under the size limit, with its licence listed', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(BUNNY_GLB_SHA256);
    expect(bytes.length).toBeLessThan(ASSET_LIMIT);
    const licences = readFileSync(LICENSES, 'utf8');
    expect(licences).toContain(BUNNY_GLB_SHA256);
    expect(licences).toContain('scripts/assets/bunny.mjs');
  });

  it('loads as one mesh of 69,451 triangles that stands on y = 0', async () => {
    const gltf = await new GLTFLoader().parseAsync(bytes);
    expect(gltf.warnings).toEqual([]);
    expect(gltf.asset.copyright).toBe('Stanford University Computer Graphics Laboratory');
    const bunny = gltf.scene.children[0]!;
    expect(bunny).toBeInstanceOf(Mesh);
    expect(bunny.name).toBe('bunny');
    const geometry = (bunny as Mesh<BufferGeometry>).geometry;
    expect(geometry.position.length / 3).toBe(35_947);
    expect(geometry.index.length / 3).toBe(69_451);
    expect(geometry.normal!.length).toBe(geometry.position.length);
    // A vertex that no triangle uses has the normal (0, 0, 0). Every other normal has length 1.
    const used = new Set(geometry.index);
    expect(used.size).toBe(34_834);
    for (const v of used) {
      const [x, y, z] = geometry.normal!.subarray(v * 3, v * 3 + 3);
      expect(Math.hypot(x!, y!, z!)).toBeCloseTo(1, 5);
    }
    // The node's scale and translation put the bunny on the floor, as the example places it.
    gltf.scene.updateMatrixWorld();
    const m = bunny.matrixWorld.elements;
    const box = geometry.computeBoundingBox();
    expect(m[5]! * box.min.y + m[13]!).toBeCloseTo(0, 5);
    expect(m[5]! * box.max.y + m[13]!).toBeCloseTo(1.5434, 3);
    expect(m[0]! * ((box.min.x + box.max.x) / 2) + m[12]!).toBeCloseTo(0, 5);
  });

  it('is built into a BVH, and packed with a floor and a light', async () => {
    const gltf = await new GLTFLoader().parseAsync(bytes);
    const geometry = (gltf.scene.children[0] as Mesh<BufferGeometry>).geometry;

    const first = performance.now();
    let blas = buildBlas(geometry);
    const firstMs = performance.now() - first;
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      blas = buildBlas(geometry);
      runs.push(performance.now() - t0);
    }
    const triangles = geometry.index.length / 3;
    expect(blas.order.length).toBe(triangles);
    expect(new Set(blas.order).size).toBe(triangles);
    const box = geometry.computeBoundingBox();
    expect([...blas.box.min.toArray()]).toEqual([box.min.x, box.min.y, box.min.z].map(Math.fround));

    const scene = new Scene();
    const floor = new Mesh(new PlaneGeometry(8, 8), new DiffuseMaterial());
    floor.rotation.x = -Math.PI / 2;
    const lamp = new Mesh(new PlaneGeometry(1.4, 1.4), new EmissiveMaterial({ intensity: 14 }));
    lamp.position.set(-1, 3, 1);
    lamp.rotation.x = Math.PI / 2;
    scene.add(floor, lamp, gltf.scene);
    scene.updateMatrixWorld();
    const packTimes: number[] = [];
    let pack = new ScenePack();
    for (let i = 0; i < 5; i++) {
      pack = new ScenePack();
      const t0 = performance.now();
      pack.update(scene);
      packTimes.push(performance.now() - t0);
    }
    const c = pack.counts;
    console.log(
      `bunny: ${triangles} triangles, ${geometry.position.length / 3} vertices, ` +
        `BVH build ${median(runs).toFixed(1)} ms (median of 5 after the first, which took ${firstMs.toFixed(1)} ms, runs ${runs.map((r) => r.toFixed(1)).join(', ')}), ` +
        `${blas.nodes.length / 8} nodes, ` +
        `scene pack ${median(packTimes).toFixed(1)} ms (median of 5, a new ScenePack each: ` +
        `${c.instances} instances, ${c.triangles} triangles, ${c.nodes} nodes, ${c.lights} lights)`,
    );
    expect(c.instances).toBe(3);
    expect(c.triangles).toBe(triangles + 4);
    expect(c.lights).toBe(2);
    expect(median(runs)).toBeLessThan(10_000);
  });
});
