import { MATERIAL_MIRROR } from '../kernels/materials.shade.ts';
import { Color } from '../math/Color.ts';
import { Material, setFlatShading, toColor, type MaterialParameters } from './Material.ts';

/** A perfect mirror, tinted by its colour. */
export class MirrorMaterial extends Material {
  readonly type: number = MATERIAL_MIRROR;
  constructor(p: Omit<MaterialParameters, 'emissive' | 'emissiveIntensity'> = {}) {
    super(toColor(p.color, new Color(0.95, 0.95, 0.95)), new Color(0, 0, 0));
    setFlatShading(this, p.flatShading);
  }
}
