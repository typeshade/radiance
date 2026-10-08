import { Color } from '../math/Color.ts';

let nextId = 1;

/** Sets a new material's `flatShading` with no change to its `version`. Set by `Material`. */
let initFlatShading: (m: Material, value: boolean) => void;

/**
 * How a surface scatters and gives off light. Each material is one 128-byte record of the path
 * tracer's material table (design record 0004, "The record"), and the kernel's shading functions
 * (kernels/materials.shade.ts) read it. A subclass says which scattering it asks for by its
 * `type`. What the kernel does for each type lives in TypeShade, as three.js keeps its shading in
 * TSL nodes.
 *
 * The setter of every parameter adds 1 to `version`. The renderer also compares each material's
 * record with the last frame's, so an edit in place, such as `material.color.setHex(0xff0000)`,
 * reaches the next frame too.
 */
export abstract class Material {
  readonly id = nextId++;
  /** A name for the author. The renderer does not read it. */
  name = '';
  /** Incremented by the setter of every parameter. */
  version = 0;
  /** The scattering the kernel applies: 0 diffuse, 1 mirror, 2 physical. */
  abstract readonly type: number;

  #color: Color;
  #emissive: Color;
  #doubleSided = false;
  #flatShading = false;

  static {
    initFlatShading = (m, value) => {
      m.#flatShading = value;
    };
  }

  constructor(color: Color, emissive: Color) {
    this.#color = color;
    this.#emissive = emissive;
  }

  /** The fraction of light reflected, per channel. */
  get color(): Color {
    return this.#color;
  }
  set color(value: Color) {
    this.#color = value;
    this.version++;
  }

  /** The light the surface gives off from its front face, as radiance. */
  get emissive(): Color {
    return this.#emissive;
  }
  set emissive(value: Color) {
    this.#emissive = value;
    this.version++;
  }

  /** Whether the surface gives off light from its back face too. Default false. */
  get doubleSided(): boolean {
    return this.#doubleSided;
  }
  set doubleSided(value: boolean) {
    this.#doubleSided = value;
    this.version++;
  }

  /**
   * Whether the kernel shades with the geometric normal in place of the interpolated vertex
   * normals, as three.js's `material.flatShading` does. Default false. The geometry and the hits
   * do not change (design record 0004, "Flat shading").
   */
  get flatShading(): boolean {
    return this.#flatShading;
  }
  set flatShading(value: boolean) {
    this.#flatShading = value;
    this.version++;
  }
}

export interface MaterialParameters {
  /** The reflectance: a Color, or a 0xRRGGBB sRGB number. Default white. */
  color?: Color | number;
  /** The emitted radiance: a Color, or a 0xRRGGBB sRGB number. Default none. */
  emissive?: Color | number;
  /** Multiplies `emissive`. Default 1. */
  emissiveIntensity?: number;
  /** Shade with the geometric normal, as three.js's `flatShading`. Default false. */
  flatShading?: boolean;
}

/** Sets `m.flatShading` from a constructor's parameters, with no change to `m.version`. */
export const setFlatShading = (m: Material, value: boolean | undefined): void =>
  initFlatShading(m, value ?? false);

export const toColor = (c: Color | number | undefined, fallback: Color): Color =>
  c === undefined ? fallback : typeof c === 'number' ? new Color().setHex(c) : c.clone();
