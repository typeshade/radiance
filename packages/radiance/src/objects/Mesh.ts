import { Object3D } from '../core/Object3D.ts';
import type { Geometry } from '../geometries/Geometry.ts';
import type { Material } from '../materials/Material.ts';

/** A shape with a material, placed in the scene. */
export class Mesh<G extends Geometry = Geometry, M extends Material = Material> extends Object3D {
  readonly isMesh = true;
  constructor(
    public geometry: G,
    public material: M,
  ) {
    super();
  }
}
