import { Color } from '../math/Color.ts';
import { Material, toColor } from './Material.ts';

/** A light: a black surface that gives off `color` times `intensity` from its front face. */
export class EmissiveMaterial extends Material {
  readonly kind = 0;
  constructor(p: { color?: Color | number; intensity?: number } = {}) {
    super(
      new Color(0, 0, 0),
      toColor(p.color, new Color(1, 1, 1)).multiplyScalar(p.intensity ?? 1),
    );
  }
}
