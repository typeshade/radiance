import { Object3D } from '../core/Object3D.ts';
import type { Material } from '../materials/Material.ts';

/**
 * The analytic sphere (design record 0001, "The analytic sphere"): a centre and a radius that the
 * path tracer meets by the quadratic, with no triangle. The position is the centre. The rotation
 * turns the texture, and nothing else. The scale must be uniform, or the render stops with a
 * `RangeError`. The material must not emit, or the render stops with a `TypeError`.
 */
export class Sphere extends Object3D {
  readonly isSphere = true;
  constructor(
    /** The radius in the sphere's own space, above 0 and finite. Times the world scale. */
    public radius: number,
    public material: Material,
  ) {
    super();
  }
}
