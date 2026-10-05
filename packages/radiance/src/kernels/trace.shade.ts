"use typeshade";
import { hash2, sample2 } from "./sampler.shade.ts";
import {
  instanceBases,
  instanceToWorld,
  lightCdf,
  lightWords,
  params,
  triangleWords,
  vertexPosition,
} from "./layout.shade.ts";
import { NONE, nearest, occluded, surface, surfaceAt } from "./intersect.shade.ts";
import { emission, evalBsdf, sampleBsdf, Surface } from "./materials.shade.ts";

// The path tracer (plan 3.2): a compute megakernel. Every invocation traces the samples of one
// pixel of the dispatch's tile: a ray from the camera through the pixel, jittered within it, into
// a scene of triangles (design record 0001), bouncing until it leaves the scene, is absorbed or is
// stopped by Russian roulette. The samples of a pixel add up in `accum`, and `present` draws their
// mean, tone-mapped.
//
// The path loop (`radiance`, record 0004, "The path loop") reads no material word: it finds the
// nearest hit, makes its `Surface`, adds `emission` when the last bounce was specular or this is
// the camera ray, adds a light from the light table by next-event estimation through `evalBsdf`,
// takes the next direction from `sampleBsdf`, and applies Russian roulette. The BSDF sample is
// drawn before the light is, so that a delta lobe skips next-event estimation; the two draw from
// their own sampler dimensions, so the order changes no number.
//
// Every random number comes from the sampler (sampler.shade.ts), keyed by the pixel, the seed,
// the sample's index and the dimension pair, so one seed gives one image. No two invocations
// write the same element of `accum`, and each adds its samples in one order, so two renders of
// one seed on one device are bit-identical, whatever the tiles.
//
// Determinism (design record 0005, "The six rules"). This file leans on these rules:
//   Rule 1: no `random`. The sampler draws every random number.
//   Rule 2: `exp2` and `pow` make the tone map's value. Its one comparison reads a value that
//           `exp2` feeds. The comparison selects between two pieces of one curve. It does not
//           choose a path. Directions come from `turn` (materials.shade.ts): sums and products.
//   Rule 3: `sqrt`, `/`, `normalize`, `length`, `dot`, `cross` and `reflect` may steer. The
//           differential gate bounds them.
//   Rule 4: no atomics. One pixel is one invocation in one dispatch.
//   Rule 6: no `f16`, no subgroup operation, no `raw`.
// The lint in determinism.test.ts reads the compiler's determinism report of this file.
//
// The scene's buffers and the uniform block are laid out in layout.shade.ts. The material record
// and the shading functions are in materials.shade.ts. The traversal is in intersect.shade.ts.

class PresentParams {
  /**
   * The exposure, in stops; the width of the traced frame in pixels; how many displayed pixels
   * one traced pixel covers across (1, or more for a preview traced at a lower resolution); w
   * unused.
   */
  view: vec4;
}

class FullScreen {
  @builtin("position") pos: vec4;
}

class Shown {
  @location(0) color: vec4;
}

declare const present: uniform<PresentParams>;
/** Each pixel's samples added up: rgb, and how many in w. */
declare const accum: storage<array<vec4>, "read_write">;

/** The limit of a camera ray and of a bounce: nothing is this far. */
const NO_HIT = 1e30;
/** A shadow ray stops this fraction short of the light, so it does not meet the light itself. */
const SHADOW_SHORT = 0.0001;
/** The sampler's dimension pairs one bounce takes: the light's point, the BSDF's direction, the
 *  light and lobe choices, and Russian roulette. Pair 0 is the pixel's jitter. */
const PAIRS_PER_BOUNCE: u32 = 4;

/** The index of the light whose share of the table's probability holds `pick`, in [0, 1). */
export function pickLight(pick: f32, count: u32): u32 {
  let lo: u32 = 0;
  let hi: u32 = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) / 2;
    if (lightCdf(mid) > pick) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/**
 * The light that reaches the surface `s` toward `wo` from one point on one light, by next-event
 * estimation: the light chosen from the table by `pick`, the point on its triangle by `r`, the
 * BSDF's value from `evalBsdf`, the light's from `emission`. A shadow ray checks the way.
 */
export function direct(s: Surface, wo: vec3, pick: f32, r: vec2): vec3 {
  const count = params.scene.z;
  if (count === 0) {
    return vec3(0.);
  }
  const which = pickLight(pick, count);
  const light = lightWords(which);
  let chance = light.cdf;
  if (which > 0) {
    chance = light.cdf - lightCdf(which - 1);
  }
  if (chance <= 0.) {
    return vec3(0.);
  }
  // A point spread evenly over the triangle: the weights of its second and third vertices.
  const su = sqrt(r.x);
  const b1 = su * (1. - r.y);
  const b2 = su * r.y;
  const bases = instanceBases(light.instance);
  const tw = triangleWords(light.triangle);
  const p0 = vertexPosition(bases.z, tw.x);
  const e1 = instanceToWorld(light.instance, vec4(vertexPosition(bases.z, tw.y) - p0, 0.));
  const e2 = instanceToWorld(light.instance, vec4(vertexPosition(bases.z, tw.z) - p0, 0.));
  const area = length(cross(e1, e2)) * 0.5;
  const toward = instanceToWorld(light.instance, vec4(p0, 1.)) + e1 * b1 + e2 * b2 - s.p;
  const dist2 = dot(toward, toward);
  const dist = sqrt(dist2);
  const wi = toward / dist;
  if (dot(wi, s.ng) <= 0.) {
    return vec3(0.);
  }
  const at = surfaceAt(light.instance, light.triangle, b1, b2, wi);
  const le = emission(at, -wi);
  if (le.x <= 0. && le.y <= 0. && le.z <= 0.) {
    return vec3(0.);
  }
  const f = evalBsdf(s, wo, wi);
  if (f.x <= 0. && f.y <= 0. && f.z <= 0.) {
    return vec3(0.);
  }
  if (occluded(s.p, wi, dist * (1. - SHADOW_SHORT))) {
    return vec3(0.);
  }
  // The point's density in area, chance / area, turned into one in solid angle: dist2 / cosLight.
  const cosLight = -dot(at.ng, wi);
  const cosSurface = dot(s.ns, wi);
  return le * f.xyz * (max(cosSurface, 0.) * cosLight * area / (chance * dist2));
}

/** The radiance one camera ray brings back: sample `index` of the pixel keyed by `pixelSeed`. */
export function radiance(origin0: vec3, dir0: vec3, pixelSeed: u32, index: u32): vec3 {
  let origin = origin0;
  let dir = dir0;
  let throughput = vec3(1.);
  let sum = vec3(0.);
  // Whether the last bounce could not have sampled a light, so a light met now counts.
  let specular = true;
  const bounces = params.path.x;
  for (let bounce: u32 = 0; bounce <= bounces; bounce++) {
    const hit = nearest(origin, dir, NO_HIT);
    if (hit.instance === NONE) {
      break;
    }
    const s = surface(hit, dir);
    const wo = -dir;
    if (specular) {
      sum += throughput * emission(s, wo);
    }
    if (bounce === bounces) {
      break;
    }
    const pair = 1 + bounce * PAIRS_PER_BOUNCE;
    const choice = sample2(pixelSeed, index, pair + 2);
    const bsdf = sampleBsdf(s, wo, vec3(choice.y, sample2(pixelSeed, index, pair + 1)));
    if (!bsdf.specular) {
      sum += throughput * direct(s, wo, choice.x, sample2(pixelSeed, index, pair));
    }
    // A direction under the surface, which a shading normal can give, ends the path.
    if (bsdf.pdf <= 0. || dot(bsdf.wi, s.ng) <= 0.) {
      break;
    }
    throughput *= bsdf.weight;
    origin = s.p;
    dir = bsdf.wi;
    specular = bsdf.specular;
    if (bounce >= params.path.y) {
      const survive = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.05, 0.95);
      if (sample2(pixelSeed, index, pair + 3).x >= survive) {
        break;
      }
      throughput /= survive;
    }
  }
  return sum;
}

/** Adds `params.frame.w` samples to every pixel of the dispatch's tile. */
@compute([64])
export function trace(@builtin("global_invocation_id") gid: vec3u): void {
  const tile = params.tile;
  if (gid.x >= tile.z * tile.w) {
    return;
  }
  const width = params.frame.x;
  const height = params.frame.y;
  const px = tile.x + gid.x % tile.z;
  const py = tile.y + gid.x / tile.z;
  if (px >= width || py >= height) {
    return;
  }
  const pixel = py * width + px;
  const pixelSeed = hash2(pixel, params.scene.w);
  let sum = vec3(0.);
  for (let s: u32 = 0; s < params.frame.w; s++) {
    const index = params.frame.z + s;
    const jitter = sample2(pixelSeed, index, 0);
    const ndc = vec2(
      ((f32(px) + jitter.x) / f32(width)) * 2. - 1.,
      1. - ((f32(py) + jitter.y) / f32(height)) * 2.,
    );
    const dir = normalize(
      params.forward.xyz + params.right.xyz * (ndc.x * params.lens.x) + params.up.xyz * (ndc.y * params.lens.y),
    );
    sum += radiance(params.eye.xyz, dir, pixelSeed, index);
  }
  accum[pixel] += vec4(sum, f32(params.frame.w));
}

/** The display transform: exposure, Narkowicz's fit of the ACES filmic curve, the sRGB curve. */
export function tonemap(linear: vec3, exposure: f32): vec3 {
  const x = linear * exp2(exposure);
  const mapped = clamp((x * (x * 2.51 + 0.03)) / (x * (x * 2.43 + 0.59) + 0.14), vec3(0.), vec3(1.));
  const low = mapped * 12.92;
  const high = pow(mapped, vec3(1. / 2.4)) * 1.055 - 0.055;
  return select(high, low, mapped <= vec3(0.0031308));
}

@vertex
export function presentVs(@builtin("vertex_index") vi: u32): FullScreen {
  const x = f32(vi & 1) * 4. - 1.;
  const y = f32(vi >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.) };
}

/** The mean of a pixel's samples, tone-mapped; transparent black where none was taken. A
 *  frame traced at a lower resolution is shown with each traced pixel as a block. */
@fragment
export function show(@builtin("position") pos: vec4): Shown {
  const p = vec2u(pos.xy) / u32(present.view.z);
  const s = accum[p.y * u32(present.view.y) + p.x];
  if (s.w <= 0.) {
    return { color: vec4(0., 0., 0., 0.) };
  }
  return { color: vec4(tonemap(s.xyz / s.w, present.view.x), 1.) };
}
