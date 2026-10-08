// The analytic sphere's host object (design record 0001, "The analytic sphere", "The host
// model"): a plain radius and material, `isSphere`, and the transform of an `Object3D`. The pack's
// words and refusals for it are held in renderers/scene-pack.test.ts.

import { describe, expect, it } from 'bun:test';
import { Object3D } from '../core/Object3D.ts';
import { DiffuseMaterial } from '../materials/DiffuseMaterial.ts';
import { Sphere } from './Sphere.ts';

describe('Sphere', () => {
  it('keeps the radius and the material it is given, and isSphere is true', () => {
    const material = new DiffuseMaterial();
    const sphere = new Sphere(0.5, material);
    expect(sphere.radius).toBe(0.5);
    expect(sphere.material).toBe(material);
    expect(sphere.isSphere).toBe(true);
  });

  it('is an Object3D whose position is its centre', () => {
    const sphere = new Sphere(1, new DiffuseMaterial());
    expect(sphere).toBeInstanceOf(Object3D);
    sphere.position.set(1, 2, 3);
    sphere.updateMatrixWorld();
    expect(Array.from(sphere.matrixWorld.elements.subarray(12, 15))).toEqual([1, 2, 3]);
  });
});
