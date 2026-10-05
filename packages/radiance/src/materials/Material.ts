import { Color } from '../math/Color.ts';

let nextId = 1;

/**
 * How a surface scatters and gives off light. Each material is one entry of the path tracer's
 * material table (kernels/trace.shade.ts reads it); a subclass says which scattering it asks
 * for. What the kernel does for each kind lives in TypeShade, as three.js keeps its shading in
 * TSL nodes.
 */
export abstract class Material {
  readonly id = nextId++;
  name = '';
  /** The scattering the kernel applies: 0 diffuse, 1 mirror. */
  abstract readonly kind: number;
  /** The fraction of light reflected, per channel. */
  readonly color: Color;
  /** The light the surface gives off from its front face, as radiance. */
  readonly emissive: Color;

  constructor(color: Color, emissive: Color) {
    this.color = color;
    this.emissive = emissive;
  }
}

export interface MaterialParameters {
  /** The reflectance: a Color, or a 0xRRGGBB sRGB number. Default white. */
  color?: Color | number;
  /** The emitted radiance: a Color, or a 0xRRGGBB sRGB number. Default none. */
  emissive?: Color | number;
  /** Multiplies `emissive`. Default 1. */
  emissiveIntensity?: number;
}

export const toColor = (c: Color | number | undefined, fallback: Color): Color =>
  c === undefined ? fallback : typeof c === 'number' ? new Color().setHex(c) : c.clone();
