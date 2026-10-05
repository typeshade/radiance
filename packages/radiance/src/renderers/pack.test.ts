// The temporary adapter of design record 0001, step 1: what packScene makes of the new geometry
// classes while the kernel still draws two analytic shapes. Step 3 of the record deletes pack.ts
// and this file with it.

import { describe, expect, it } from 'bun:test';
import { BoxGeometry } from '../geometries/BoxGeometry.ts';
import { BufferGeometry } from '../geometries/BufferGeometry.ts';
import { PlaneGeometry } from '../geometries/PlaneGeometry.ts';
import { QuadGeometry } from '../geometries/QuadGeometry.ts';
import { SphereGeometry } from '../geometries/SphereGeometry.ts';
import { DiffuseMaterial } from '../materials/DiffuseMaterial.ts';
import { EmissiveMaterial } from '../materials/EmissiveMaterial.ts';
import type { Geometry } from '../geometries/Geometry.ts';
import { Mesh } from '../objects/Mesh.ts';
import { Scene } from '../scenes/Scene.ts';
import { packScene } from './pack.ts';

/** A scene of one mesh, its matrices updated. */
function sceneOf(geometry: Geometry, place?: (m: Mesh) => void, material = new DiffuseMaterial()) {
  const scene = new Scene();
  const mesh = new Mesh(geometry, material);
  place?.(mesh);
  scene.add(mesh);
  scene.updateMatrixWorld();
  return scene;
}

describe('packScene, with the geometry classes of record 0001', () => {
  it('packs a SphereGeometry as the analytic sphere of its radius', () => {
    const packed = packScene(
      sceneOf(new SphereGeometry(0.5, 8, 4), (m) => {
        m.position.set(1, 2, 3);
        m.scale.set(2, 2, 2);
      }),
    );
    expect(packed.counts).toEqual([1, 0, 0]);
    // The centre, the radius times the scale, the material index.
    expect(Array.from(packed.spheres)).toEqual([1, 2, 3, 1, 0, 0, 0, 0]);
  });

  it('ignores the segments of a SphereGeometry', () => {
    const coarse = packScene(sceneOf(new SphereGeometry(0.7, 3, 2)));
    const fine = packScene(sceneOf(new SphereGeometry(0.7, 64, 32)));
    expect(Array.from(coarse.spheres)).toEqual(Array.from(fine.spheres));
    expect(Array.from(coarse.spheres)[3]).toBeCloseTo(0.7, 6);
  });

  it('packs a PlaneGeometry and a QuadGeometry as the same analytic quad', () => {
    const plane = packScene(sceneOf(new PlaneGeometry(2, 3)));
    const quad = packScene(sceneOf(new QuadGeometry(2, 3)));
    expect(plane.counts).toEqual([0, 1, 0]);
    // The corner and the material index, then the edge along u, then the edge along v.
    expect(Array.from(plane.quads)).toEqual([-1, -1.5, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0]);
    expect(Array.from(quad.quads)).toEqual(Array.from(plane.quads));
  });

  it('lists an emissive PlaneGeometry as a light', () => {
    const packed = packScene(sceneOf(new PlaneGeometry(1, 1), undefined, new EmissiveMaterial()));
    expect(packed.counts).toEqual([0, 1, 1]);
    expect(Array.from(packed.lights)).toEqual([0]);
  });

  it('refuses a BoxGeometry, which has no analytic form, until step 3', () => {
    expect(() => packScene(sceneOf(new BoxGeometry()))).toThrow(
      /cannot draw a BoxGeometry yet.*step 3 of design record 0001/,
    );
  });

  it('refuses a BufferGeometry by its type', () => {
    expect(() => packScene(sceneOf(new BufferGeometry()))).toThrow(
      'the path tracer cannot draw a BufferGeometry yet',
    );
  });
});
