import { MATERIAL_DIFFUSE } from '../kernels/materials.shade.ts';
import { Color } from '../math/Color.ts';
import { Material, setFlatShading, toColor, type MaterialParameters } from './Material.ts';

/** A matte surface: light leaves it in every direction alike (Lambert). */
export class DiffuseMaterial extends Material {
  readonly type: number = MATERIAL_DIFFUSE;
  constructor(p: MaterialParameters = {}) {
    super(
      toColor(p.color, new Color(1, 1, 1)),
      toColor(p.emissive, new Color(0, 0, 0)).multiplyScalar(p.emissiveIntensity ?? 1),
    );
    setFlatShading(this, p.flatShading);
  }
}
