import { MATERIAL_PHYSICAL } from '../kernels/materials.shade.ts';
import { Color } from '../math/Color.ts';
import { Material, toColor } from './Material.ts';

export interface PhysicalMaterialParameters {
  /** The base colour: a Color, or a 0xRRGGBB sRGB number. Default white. */
  color?: Color | number;
  /** How much the surface is a metal, from 0 to 1. Default 0. */
  metalness?: number;
  /** How rough the surface is, from 0 (polished) to 1. Default 0.5. */
  roughness?: number;
  /** The index of refraction. Default 1.5. */
  ior?: number;
  /** How much light passes through the surface, from 0 to 1. Default 0. */
  transmission?: number;
  /** The strength of the specular reflection of a dielectric, from 0 to 1. Default 1. */
  specularIntensity?: number;
  /** The emitted radiance: a Color, or a 0xRRGGBB sRGB number. Default none. */
  emissive?: Color | number;
  /** Multiplies `emissive`. Default 1. */
  emissiveIntensity?: number;
}

/**
 * A physically based material, with the parameters of three.js's `MeshPhysicalMaterial` where the
 * meaning is the same (design record 0004).
 *
 * At M2 the path tracer stores `metalness`, `roughness`, `ior`, `transmission` and
 * `specularIntensity` and renders the material as a diffuse of its colour, until the principled
 * BSDF of record 0004, step 2 reads them. The emission renders as it does for every material.
 *
 * The setter of every parameter adds 1 to `version`.
 */
export class PhysicalMaterial extends Material {
  readonly type: number = MATERIAL_PHYSICAL;

  #metalness: number;
  #roughness: number;
  #ior: number;
  #transmission: number;
  #specularIntensity: number;
  #emissiveIntensity: number;

  constructor(p: PhysicalMaterialParameters = {}) {
    super(toColor(p.color, new Color(1, 1, 1)), toColor(p.emissive, new Color(0, 0, 0)));
    this.#metalness = p.metalness ?? 0;
    this.#roughness = p.roughness ?? 0.5;
    this.#ior = p.ior ?? 1.5;
    this.#transmission = p.transmission ?? 0;
    this.#specularIntensity = p.specularIntensity ?? 1;
    this.#emissiveIntensity = p.emissiveIntensity ?? 1;
  }

  /** How much the surface is a metal, from 0 to 1. */
  get metalness(): number {
    return this.#metalness;
  }
  set metalness(value: number) {
    this.#metalness = value;
    this.version++;
  }

  /** How rough the surface is, from 0 (polished) to 1. */
  get roughness(): number {
    return this.#roughness;
  }
  set roughness(value: number) {
    this.#roughness = value;
    this.version++;
  }

  /** The index of refraction. */
  get ior(): number {
    return this.#ior;
  }
  set ior(value: number) {
    this.#ior = value;
    this.version++;
  }

  /** How much light passes through the surface, from 0 to 1. */
  get transmission(): number {
    return this.#transmission;
  }
  set transmission(value: number) {
    this.#transmission = value;
    this.version++;
  }

  /** The strength of the specular reflection of a dielectric, from 0 to 1. */
  get specularIntensity(): number {
    return this.#specularIntensity;
  }
  set specularIntensity(value: number) {
    this.#specularIntensity = value;
    this.version++;
  }

  /** Multiplies `emissive`. The packer stores the product (record 0004). */
  get emissiveIntensity(): number {
    return this.#emissiveIntensity;
  }
  set emissiveIntensity(value: number) {
    this.#emissiveIntensity = value;
    this.version++;
  }
}
