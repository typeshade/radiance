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
  /** The direction of the anisotropic highlight, in radians. Default 0. */
  anisotropy?: number;
  /** The rotation of the anisotropic highlight, in radians. Default 0. */
  anisotropyRotation?: number;
  /** The strength of the clear coat, from 0 to 1. Default 0. */
  clearcoat?: number;
  /** The roughness of the clear coat, from 0 (polished) to 1. Default 0. */
  clearcoatRoughness?: number;
  /** The strength of the sheen, from 0 to 1. Default 0. */
  sheen?: number;
  /** The colour of the sheen: a Color, or a 0xRRGGBB sRGB number. Default black. */
  sheenColor?: Color | number;
  /** The roughness of the sheen, from 0 to 1. Default 1. */
  sheenRoughness?: number;
  /** The distance light travels through the object, in scene units. 0 is thin walled. Default 0. */
  thickness?: number;
  /** The colour light keeps after one `attenuationDistance`: a Color, or a 0xRRGGBB number. Default white. */
  attenuationColor?: Color | number;
  /** The distance over which light takes `attenuationColor`. Default Infinity (no absorption). */
  attenuationDistance?: number;
  /** Whether the lobes are compensated for the energy a single scatter loses. Default true. */
  multipleScattering?: boolean;
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
  #anisotropy: number;
  #anisotropyRotation: number;
  #clearcoat: number;
  #clearcoatRoughness: number;
  #sheen: number;
  #sheenColor: Color;
  #sheenRoughness: number;
  #thickness: number;
  #attenuationColor: Color;
  #attenuationDistance: number;
  #multipleScattering: boolean;

  constructor(p: PhysicalMaterialParameters = {}) {
    super(toColor(p.color, new Color(1, 1, 1)), toColor(p.emissive, new Color(0, 0, 0)));
    this.#metalness = p.metalness ?? 0;
    this.#roughness = p.roughness ?? 0.5;
    this.#ior = p.ior ?? 1.5;
    this.#transmission = p.transmission ?? 0;
    this.#specularIntensity = p.specularIntensity ?? 1;
    this.#emissiveIntensity = p.emissiveIntensity ?? 1;
    this.#anisotropy = p.anisotropy ?? 0;
    this.#anisotropyRotation = p.anisotropyRotation ?? 0;
    this.#clearcoat = p.clearcoat ?? 0;
    this.#clearcoatRoughness = p.clearcoatRoughness ?? 0;
    this.#sheen = p.sheen ?? 0;
    this.#sheenColor = toColor(p.sheenColor, new Color(0, 0, 0));
    this.#sheenRoughness = p.sheenRoughness ?? 1;
    this.#thickness = p.thickness ?? 0;
    this.#attenuationColor = toColor(p.attenuationColor, new Color(1, 1, 1));
    this.#attenuationDistance = p.attenuationDistance ?? Infinity;
    this.#multipleScattering = p.multipleScattering ?? true;
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

  /** The strength of the anisotropic highlight. Its direction is `anisotropyRotation`. */
  get anisotropy(): number {
    return this.#anisotropy;
  }
  set anisotropy(value: number) {
    this.#anisotropy = value;
    this.version++;
  }

  /** The rotation of the anisotropic highlight, in radians. */
  get anisotropyRotation(): number {
    return this.#anisotropyRotation;
  }
  set anisotropyRotation(value: number) {
    this.#anisotropyRotation = value;
    this.version++;
  }

  /** The strength of the clear coat, from 0 to 1. */
  get clearcoat(): number {
    return this.#clearcoat;
  }
  set clearcoat(value: number) {
    this.#clearcoat = value;
    this.version++;
  }

  /** The roughness of the clear coat, from 0 (polished) to 1. */
  get clearcoatRoughness(): number {
    return this.#clearcoatRoughness;
  }
  set clearcoatRoughness(value: number) {
    this.#clearcoatRoughness = value;
    this.version++;
  }

  /** The strength of the sheen, from 0 to 1. */
  get sheen(): number {
    return this.#sheen;
  }
  set sheen(value: number) {
    this.#sheen = value;
    this.version++;
  }

  /** The colour of the sheen. */
  get sheenColor(): Color {
    return this.#sheenColor;
  }
  set sheenColor(value: Color) {
    this.#sheenColor = value;
    this.version++;
  }

  /** The roughness of the sheen, from 0 to 1. */
  get sheenRoughness(): number {
    return this.#sheenRoughness;
  }
  set sheenRoughness(value: number) {
    this.#sheenRoughness = value;
    this.version++;
  }

  /** The distance light travels through the object, in scene units. 0 is thin walled. */
  get thickness(): number {
    return this.#thickness;
  }
  set thickness(value: number) {
    this.#thickness = value;
    this.version++;
  }

  /** The colour light keeps after one `attenuationDistance`. */
  get attenuationColor(): Color {
    return this.#attenuationColor;
  }
  set attenuationColor(value: Color) {
    this.#attenuationColor = value;
    this.version++;
  }

  /** The distance over which light takes `attenuationColor`. */
  get attenuationDistance(): number {
    return this.#attenuationDistance;
  }
  set attenuationDistance(value: number) {
    this.#attenuationDistance = value;
    this.version++;
  }

  /** Whether the lobes are compensated for the energy a single scatter loses. */
  get multipleScattering(): boolean {
    return this.#multipleScattering;
  }
  set multipleScattering(value: boolean) {
    this.#multipleScattering = value;
    this.version++;
  }
}
