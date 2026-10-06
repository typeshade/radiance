// The Sponza geometry of the `sponza` example (design record 0001, step 5): the committed .glb is
// the one scripts/assets/sponza.mjs records, the loader reads it into 22 meshes of 227,327
// triangles together, the orbit limits of the example keep the camera in free space of the model,
// and the BVH builder takes each mesh. The test prints the milliseconds the BVH
// builds and the whole scene pack take on the machine that runs it. It holds them only to a loose
// bound, because a time depends on the machine and must not fail a check.

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BufferGeometry,
  EmissiveMaterial,
  Mesh,
  PhysicalMaterial,
  PlaneGeometry,
  Scene,
} from '@typeshade/radiance';
import { GLTFLoader } from '@typeshade/radiance-addons';
import { ScenePack, buildBlas } from '@typeshade/radiance/internal';
import { ORBIT } from '../site/examples/sponza.ts';
import { SPONZA_GLB_SHA256 } from './assets/sponza.mjs';

const GLB = new URL('../site/public/assets/sponza.glb', import.meta.url);
const LICENSES = new URL('../site/public/assets/LICENSES.md', import.meta.url);
/** The most one committed asset may weigh. */
const ASSET_LIMIT = 8 * 1024 * 1024;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

describe('the Sponza asset', () => {
  const bytes = readFileSync(GLB);

  it('is the file that the script records, under the size limit, with its licence listed', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SPONZA_GLB_SHA256);
    expect(bytes.length).toBeLessThan(ASSET_LIMIT);
    const licences = readFileSync(LICENSES, 'utf8');
    expect(licences).toContain(SPONZA_GLB_SHA256);
    expect(licences).toContain('scripts/assets/sponza.mjs');
    expect(licences).toContain('CC BY 3.0');
    expect(licences).toContain('Frank Meinl');
  });

  it('loads as 22 meshes of 227,327 triangles that stand on y = 0 and centre on x = z = 0', async () => {
    const gltf = await new GLTFLoader().parseAsync(bytes);
    expect(gltf.warnings).toEqual([]);
    const node = gltf.scene.children[0]!;
    expect(node.name).toBe('sponza');
    expect(node.children.length).toBe(22);
    gltf.scene.updateMatrixWorld();

    let triangles = 0;
    let vertices = 0;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (const child of node.children) {
      expect(child).toBeInstanceOf(Mesh);
      const mesh = child as Mesh<BufferGeometry, PhysicalMaterial>;
      triangles += mesh.geometry.index.length / 3;
      vertices += mesh.geometry.position.length / 3;
      expect(mesh.geometry.normal!.length).toBe(mesh.geometry.position.length);
      // The child's world matrix is the node's: a scale of 0.008 and a translation.
      const m = mesh.matrixWorld.elements;
      const box = mesh.geometry.computeBoundingBox();
      for (const [k, lo, hi, t] of [
        [0, box.min.x, box.max.x, m[12]!],
        [1, box.min.y, box.max.y, m[13]!],
        [2, box.min.z, box.max.z, m[14]!],
      ] as const) {
        low[k] = Math.min(low[k]!, m[0]! * lo + t);
        high[k] = Math.max(high[k]!, m[0]! * hi + t);
      }
    }
    expect(triangles).toBe(227_327);
    expect(vertices).toBe(147_804);
    expect(low[1]!).toBeCloseTo(0, 4);
    expect((low[0]! + high[0]!) / 2).toBeCloseTo(0, 4);
    expect((low[2]! + high[2]!) / 2).toBeCloseTo(0, 4);
    // The atrium is about 29.8 m long, 18.2 m wide and 12.4 m high.
    expect(high[0]! - low[0]!).toBeCloseTo(29.76, 1);
    expect(high[2]! - low[2]!).toBeCloseTo(18.31, 1);
    expect(high[1]! - low[1]!).toBeCloseTo(12.45, 1);
  });

  it('lets the camera orbit only in free space of the nave, above its floor', async () => {
    const gltf = await new GLTFLoader().parseAsync(bytes);
    gltf.scene.updateMatrixWorld();
    // The world-space box of each triangle of the model, six numbers each.
    const boxes: number[] = [];
    for (const child of gltf.scene.children[0]!.children) {
      const mesh = child as Mesh<BufferGeometry, PhysicalMaterial>;
      const m = mesh.matrixWorld.elements;
      const p = mesh.geometry.position;
      const index = mesh.geometry.index;
      for (let t = 0; t < index.length; t += 3) {
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let j = 0; j < 3; j++) {
          const v = index[t + j]! * 3;
          for (let k = 0; k < 3; k++) {
            const c = m[k]! * p[v]! + m[4 + k]! * p[v + 1]! + m[8 + k]! * p[v + 2]! + m[12 + k]!;
            lo[k] = Math.min(lo[k]!, c);
            hi[k] = Math.max(hi[k]!, c);
          }
        }
        boxes.push(...lo, ...hi);
      }
    }
    /** Whether the box of a triangle meets the cube of half-side `clearance` about `at`. */
    const touches = (at: readonly number[], clearance: number): boolean => {
      for (let i = 0; i < boxes.length; i += 6) {
        if (
          boxes[i]! <= at[0]! + clearance &&
          boxes[i + 3]! >= at[0]! - clearance &&
          boxes[i + 1]! <= at[1]! + clearance &&
          boxes[i + 4]! >= at[1]! - clearance &&
          boxes[i + 2]! <= at[2]! + clearance &&
          boxes[i + 5]! >= at[2]! - clearance
        )
          return true;
      }
      return false;
    };

    // The floor of the nave: a vertical ray over the model finds it at y = 0.991.
    const FLOOR = 0.991;
    const CLEARANCE = 0.2;
    const [tx, ty, tz] = ORBIT.target;
    // Every camera position the orbit reaches, over a grid of its distance, polar angle and
    // azimuth angle, ends included. The pivot is a point: the pan gestures do not move it.
    const steps = 12;
    let lowest = Infinity;
    for (let i = 0; i <= steps; i++) {
      const r = ORBIT.minDistance + ((ORBIT.maxDistance - ORBIT.minDistance) * i) / steps;
      for (let j = 0; j <= steps; j++) {
        const phi = ORBIT.minPolar + ((ORBIT.maxPolar - ORBIT.minPolar) * j) / steps;
        for (let k = 0; k <= steps; k++) {
          const theta = -Math.PI / 2 - ORBIT.azimuth + (2 * ORBIT.azimuth * k) / steps;
          const at = [
            tx + r * Math.sin(phi) * Math.sin(theta),
            ty + r * Math.cos(phi),
            tz + r * Math.sin(phi) * Math.cos(theta),
          ] as const;
          lowest = Math.min(lowest, at[1]);
          expect(touches(at, CLEARANCE)).toBe(false);
        }
      }
    }
    // At the lowest, the camera is 0.25 m or more above the floor.
    expect(lowest).toBeGreaterThanOrEqual(FLOOR + 0.25);

    // The start is inside the limits, so the controls do not move it.
    const d = [ORBIT.start[0] - tx, ORBIT.start[1] - ty, ORBIT.start[2] - tz] as const;
    const r0 = Math.hypot(...d);
    expect(r0).toBeGreaterThanOrEqual(ORBIT.minDistance);
    expect(r0).toBeLessThanOrEqual(ORBIT.maxDistance);
    const phi0 = Math.acos(d[1] / r0);
    expect(phi0).toBeGreaterThanOrEqual(ORBIT.minPolar);
    expect(phi0).toBeLessThanOrEqual(ORBIT.maxPolar);
    expect(Math.abs(Math.atan2(d[0], d[2]) + Math.PI / 2)).toBeLessThanOrEqual(ORBIT.azimuth);
    expect(touches(ORBIT.start, CLEARANCE)).toBe(false);
  }, 60_000);

  it('is built into 22 BVHs, and packed with a light', async () => {
    const gltf = await new GLTFLoader().parseAsync(bytes);
    const geometries = gltf.scene.children[0]!.children.map(
      (c) => (c as Mesh<BufferGeometry>).geometry,
    );

    const buildAll = (): number => {
      const t0 = performance.now();
      for (const g of geometries) buildBlas(g);
      return performance.now() - t0;
    };
    const firstMs = buildAll();
    const runs = Array.from({ length: 5 }, buildAll);
    let nodes = 0;
    let primitives = 0;
    for (const g of geometries) {
      const blas = buildBlas(g);
      nodes += blas.nodes.length / 8;
      expect(new Set(blas.order).size).toBe(g.index.length / 3);
      primitives += blas.order.length;
    }
    expect(primitives).toBe(227_327);

    const scene = new Scene();
    const lamp = new Mesh(new PlaneGeometry(20, 10), new EmissiveMaterial({ intensity: 10 }));
    lamp.position.set(0, 14, 0);
    lamp.rotation.x = Math.PI / 2;
    scene.add(lamp, gltf.scene);
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
      `sponza: ${primitives} triangles, ${geometries.reduce((n, g) => n + g.position.length / 3, 0)} vertices, ` +
        `BVH build of the 22 geometries ${median(runs).toFixed(1)} ms (median of 5 after the first, which took ${firstMs.toFixed(1)} ms, runs ${runs.map((r) => r.toFixed(1)).join(', ')}), ` +
        `${nodes} nodes, ` +
        `scene pack ${median(packTimes).toFixed(1)} ms (median of 5, a new ScenePack each: ` +
        `${c.instances} instances, ${c.triangles} triangles, ${c.nodes} nodes, ${c.lights} lights)`,
    );
    expect(c.instances).toBe(23);
    expect(c.triangles).toBe(227_327 + 2);
    expect(c.lights).toBe(2);
    expect(median(runs)).toBeLessThan(20_000);
  }, 60_000);
});
