import { Color } from '../math/Color.ts';
import { Material, toColor, type MaterialParameters } from './Material.ts';

/** A perfect mirror, tinted by its colour. */
export class MirrorMaterial extends Material {
  readonly kind = 1;
  constructor(p: Omit<MaterialParameters, 'emissive' | 'emissiveIntensity'> = {}) {
    super(toColor(p.color, new Color(0.95, 0.95, 0.95)), new Color(0, 0, 0));
  }
}
