'use typeshade';
import { MATERIAL_STRIDE } from './layout.shade.ts';

// The shading contract (design record 0004, "The shading contract"): what a surface gives off and
// how it scatters, behind three functions over a `Surface`. The path loop in trace.shade.ts calls
// `emission`, `sampleBsdf` and `evalBsdf` and reads no material word itself, so the BSDFs here
// are a library: a later rasterizer and the fitter (plan 3.3) import the same file.
//
// A material is 8 vec4 of `materials`, 128 bytes (record 0004, "The record"):
//   [0] baseColor.rgb, metalness        [1] emissive.rgb (times emissiveIntensity), roughness
//   [2] ior, transmission, specularIntensity, bits(type and flags)
//   [3] bits(map), bits(normalMap), bits(roughnessMap), bits(metalnessMap)
//   [4] to [6] M3's parameters, 0 at M2  [7] bits(emissiveMap), then reserved
// The type is the low 8 bits of [2].w: 0 diffuse, 1 mirror, 2 physical. Bit 8 says the material
// emits, bit 9 that it is double sided, bit 10 that it has an alpha cutout (M3), bit 11 that it is
// flat shaded: `surfaceAt` takes its shading normal as the geometric normal.
//
// At M2 there are two lobes: the diffuse (Lambert, sampled by the cosine) and the mirror (a delta
// lobe). The physical type renders as a diffuse of its base colour until record 0004, step 2,
// brings the principled BSDF.
//
// The three exported functions are the `grad` boundary (record 0004, "The grad boundary"): they
// use f32 and float-vector arithmetic, the component-wise builtins, `if` and calls to other
// functions of this module. They have no `while` and no texture sample. Their one `bitcast`
// reads the type and flags word, which no derivative flows through.
//
// Determinism (design record 0005, "The six rules"). This file leans on these rules:
//   Rule 1: no `random`. The caller gives every random number, from the sampler.
//   Rule 2: `turn` makes a direction from sums and products. No transcendental decides.
//   Rule 3: `sqrt`, `normalize`, `cross`, `dot` and `reflect` may steer. The differential gate
//           bounds them.
//   Rule 6: no `f16`, no subgroup operation, no `raw`.
// The lint in determinism.test.ts reads the compiler's determinism report of this file.

/** The type of a diffuse material. */
export const MATERIAL_DIFFUSE: u32 = 0;
/** The type of a mirror. */
export const MATERIAL_MIRROR: u32 = 1;
/** The type of a physical material. It renders as a diffuse until record 0004, step 2. */
export const MATERIAL_PHYSICAL: u32 = 2;
/** The bits of word [2].w that hold the type. */
export const MATERIAL_TYPE_MASK: u32 = 0xff;
/** The flag of a material whose emission is not black, set by the host. */
export const MATERIAL_EMITS: u32 = 0x100;
/** The flag of a material that gives off light from both faces. */
export const MATERIAL_DOUBLE_SIDED: u32 = 0x200;
/** The flag of a material with an alpha cutout (M3). */
export const MATERIAL_ALPHA_CUTOUT: u32 = 0x400;
/** The flag of a flat-shaded material: `ns` is `ng` (record 0004, "Flat shading"). */
export const MATERIAL_FLAT_SHADING: u32 = 0x800;
/** The texture id that names no texture. */
export const TEXTURE_NONE: u32 = 0xffffffff;

/** The offset in a material of `(baseColor, metalness)`. */
export const MATERIAL_BASE: u32 = 0;
/** The offset in a material of `(emissive, roughness)`. */
export const MATERIAL_EMISSIVE: u32 = 1;
/** The offset in a material of `(ior, transmission, specularIntensity, bits(type and flags))`. */
export const MATERIAL_PARAMS: u32 = 2;
/** The offset in a material of its four texture ids: map, normalMap, roughnessMap, metalnessMap. */
export const MATERIAL_MAPS: u32 = 3;
/** The offset in a material of `(bits(emissiveMap), reserved, reserved, reserved)`. */
export const MATERIAL_EMISSIVE_MAP: u32 = 7;

/** The materials, MATERIAL_STRIDE vec4s each. */
declare const materials: storage<array<vec4>>;

/** What the shading functions know of the point a ray met. */
export class Surface {
  /** The hit point, in world space, offset along the geometric normal. */
  p: vec3;
  /** The geometric normal, unit, facing the incoming ray. */
  ng: vec3;
  /** The shading normal, unit, on the same side as ng. */
  ns: vec3;
  uv: vec2;
  /** The tangent along u, from the triangle's positions and uvs (not stored). */
  dpdu: vec3;
  /** The material's index in `materials`. */
  material: u32;
  /** Whether the ray met the front face. */
  front: bool;
}

/** A direction drawn from a surface's BSDF. */
export class BsdfSample {
  /** The sampled direction, unit, world space. */
  wi: vec3;
  /** f * cos / pdf: what the throughput is multiplied by. */
  weight: vec3;
  /** The density the direction was sampled with. */
  pdf: f32;
  /** A delta lobe: the next light hit counts, and next-event estimation is skipped. */
  specular: bool;
}

const INV_PI = 0.3183098861837907;

/** Word `k` of material `m`. */
function word(m: u32, k: u32): vec4 {
  return materials[m * MATERIAL_STRIDE + k];
}

/** The type and flags word of material `m`. */
function flagsOf(m: u32): u32 {
  return bitcast<u32>(word(m, MATERIAL_PARAMS).w);
}

/** Whether material `m` is flat shaded: `surfaceAt` gives it `ns` equal to `ng`. */
export function materialFlat(m: u32): bool {
  return (flagsOf(m) & MATERIAL_FLAT_SHADING) !== 0;
}

/**
 * cos and sin of 2 pi r, for r in [0, 1), from multiplications and additions alone. WGSL lets a
 * GPU's `cos` and `sin` be off by 2^-11 (an absolute error), enough to send a path past another
 * edge than the oracle's does; a sum and a product are correctly rounded on every target, so this
 * keeps the GPU's paths on the oracle's (plan 3.1, constraint 4). The quarter turn r falls in is
 * folded away, and the angle left, in [0, pi/2), goes through the Taylor series to the 13th and
 * 14th powers: under 1e-8 off, below f32's resolution.
 */
export function turn(r: f32): vec2 {
  const a = r * 4.;
  const quarter = min(u32(a), 3);
  const x = (a - f32(quarter)) * 1.5707963267948966;
  const x2 = x * x;
  const s = x * (1. + x2 * (-1. / 6. + x2 * (1. / 120. + x2 * (-1. / 5040. + x2 * (1. / 362880. + x2 * (-1. / 39916800. + x2 / 6227020800.))))));
  const c = 1. + x2 * (-0.5 + x2 * (1. / 24. + x2 * (-1. / 720. + x2 * (1. / 40320. + x2 * (-1. / 3628800. + x2 * (1. / 479001600. - x2 / 87178291200.))))));
  if (quarter === 0) {
    return vec2(c, s);
  }
  if (quarter === 1) {
    return vec2(-s, c);
  }
  if (quarter === 2) {
    return vec2(-c, -s);
  }
  return vec2(s, -c);
}

/** A unit vector at right angles to the unit vector `n`. */
export function tangentOf(n: vec3): vec3 {
  const helper = select(vec3(1., 0., 0.), vec3(0., 1., 0.), abs(n.x) > 0.9);
  return normalize(cross(helper, n));
}

/** A direction about `n` with the cosine's distribution, from two numbers in [0, 1). */
export function aboutNormal(n: vec3, r: vec2): vec3 {
  const phi = turn(r.x);
  const cosTheta = sqrt(1. - r.y);
  const sinTheta = sqrt(r.y);
  const tangent = tangentOf(n);
  const bitangent = cross(n, tangent);
  return tangent * (phi.x * sinTheta) + bitangent * (phi.y * sinTheta) + n * cosTheta;
}

/**
 * The radiance the surface gives off toward `wo` (away from the surface, toward the ray's
 * origin). A material emits from its front face only, unless it is double sided.
 */
export function emission(s: Surface, wo: vec3): vec3 {
  const flags = flagsOf(s.material);
  if ((flags & MATERIAL_EMITS) === 0) {
    return vec3(0.);
  }
  if (!s.front && (flags & MATERIAL_DOUBLE_SIDED) === 0) {
    return vec3(0.);
  }
  return word(s.material, MATERIAL_EMISSIVE).xyz;
}

/**
 * A direction drawn from the surface's BSDF for light leaving toward `wo`. `r` is three numbers
 * from the sampler: the lobe choice, then the two direction numbers. The lobe choice is unused
 * at M2, where every material has one lobe.
 */
export function sampleBsdf(s: Surface, wo: vec3, r: vec3): BsdfSample {
  const color = word(s.material, MATERIAL_BASE).xyz;
  if ((flagsOf(s.material) & MATERIAL_TYPE_MASK) === MATERIAL_MIRROR) {
    return { wi: reflect(-wo, s.ns), weight: color, pdf: 1., specular: true };
  }
  // The diffuse lobe, which the physical type takes until record 0004, step 2. With f = color /
  // pi and pdf = cos / pi, f * cos / pdf is the colour itself.
  const wi = aboutNormal(s.ns, r.yz);
  return { wi: wi, weight: color, pdf: dot(s.ns, wi) * INV_PI, specular: false };
}

/**
 * The BSDF's value for light arriving from `wi` and leaving toward `wo`, in xyz, and the density
 * `sampleBsdf` draws `wi` with, in w. A delta lobe has no value at any one direction: 0.
 */
export function evalBsdf(s: Surface, wo: vec3, wi: vec3): vec4 {
  if ((flagsOf(s.material) & MATERIAL_TYPE_MASK) === MATERIAL_MIRROR) {
    return vec4(0.);
  }
  const c = dot(s.ns, wi);
  if (c <= 0.) {
    return vec4(0.);
  }
  return vec4(word(s.material, MATERIAL_BASE).xyz * INV_PI, c * INV_PI);
}
