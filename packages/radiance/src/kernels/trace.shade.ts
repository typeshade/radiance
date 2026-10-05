"use typeshade";
import { hash2, sample2 } from "./sampler.shade.ts";

// The path tracer (plan 3.2, M1): a compute megakernel. Every invocation traces the samples of
// one pixel: a ray from the camera through the pixel, jittered within it, into a scene of
// spheres and quads, bouncing until it leaves the scene, is absorbed or is stopped by Russian
// roulette. A diffuse surface takes the light of the emissive quads by next-event estimation
// (a point sampled on a light, and a shadow ray to it) and bounces on in a cosine-distributed
// direction; a mirror reflects. The samples of a pixel add up in `accum`, and `present` draws
// their mean, tone-mapped.
//
// Every random number comes from the sampler (sampler.shade.ts), keyed by the pixel, the seed,
// the sample's index and the dimension pair, so one seed gives one image. No two invocations
// write the same element of `accum`, and each adds its samples in one order, so two renders of
// one seed on one device are bit-identical.
//
// Determinism (design record 0005, "The six rules"). This file leans on these rules:
//   Rule 1: no `random`. The sampler draws every random number.
//   Rule 2: `turn` makes a direction from sums and products. `exp2` and `pow` make the tone
//           map's value. Its one comparison selects between two pieces of one curve. It does not
//           choose a path.
//   Rule 3: `sqrt`, `/`, `normalize`, `length`, `dot` and `cross` may steer. The differential
//           gate bounds them.
//   Rule 4: no atomics. One pixel is one invocation.
//   Rule 6: no `f16`, no subgroup operation, no `raw`.
// The lint in determinism.test.ts reads the compiler's determinism report of this file.
//
// The scene layout is `packScene`'s (src/renderers/pack.ts):
//   spheres:   two vec4 per sphere: centre and radius; material index in x.
//   quads:     three vec4 per quad: corner and material index (w); edge u; edge v.
//              The front face is the side cross(u, v) points to; a light emits only there.
//   materials: two vec4 per material: albedo and kind (w: 0 diffuse, 1 mirror); emission.
//   lights:    the index of every quad that emits.

class TraceParams {
  /** The camera's eye, and its right, up and forward axes in the world (w unused). */
  eye: vec4;
  right: vec4;
  up: vec4;
  forward: vec4;
  /** tan of half the horizontal and vertical field of view (z, w unused). */
  lens: vec4;
  /** The frame's width and height in pixels, the first sample's index, and how many to take. */
  frame: vec4u;
  /** How many spheres, quads and lights, and the seed. */
  counts: vec4u;
  /** The bounces a path may take, the bounce Russian roulette starts at (z, w unused). */
  path: vec4u;
}

class PresentParams {
  /**
   * The exposure, in stops; the width of the traced frame in pixels; how many displayed pixels
   * one traced pixel covers across (1, or more for a preview traced at a lower resolution); w
   * unused.
   */
  view: vec4;
}

class Hit {
  /** How far along the ray, or NO_HIT. */
  t: f32;
  /** The geometric normal, unit length, on the side cross(u, v) or the outward side points. */
  normal: vec3;
  material: u32;
}

class FullScreen {
  @builtin("position") pos: vec4;
}

class Shown {
  @location(0) color: vec4;
}

declare const params: uniform<TraceParams>;
declare const present: uniform<PresentParams>;
declare const spheres: storage<array<vec4>>;
declare const quads: storage<array<vec4>>;
declare const materials: storage<array<vec4>>;
declare const lights: storage<array<u32>>;
/** Each pixel's samples added up: rgb, and how many in w. */
declare const accum: storage<array<vec4>, "read_write">;

/** What `nearest` returns for a ray that meets nothing. */
const NO_HIT = 1e30;
/** How far a new ray starts off the surface it leaves, against self-intersection. */
const EPSILON = 0.0001;
const INV_PI = 0.3183098861837907;

/** How far along the ray the sphere is met from outside or inside, or NO_HIT. */
export function hitSphere(origin: vec3, dir: vec3, centre: vec3, radius: f32): f32 {
  const oc = origin - centre;
  const b = dot(oc, dir);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0.) {
    return NO_HIT;
  }
  const s = sqrt(disc);
  const near = -b - s;
  if (near > EPSILON) {
    return near;
  }
  const far = -b + s;
  return select(NO_HIT, far, far > EPSILON);
}

/** How far along the ray the parallelogram `corner + a u + b v` (a, b in [0, 1]) is met, or NO_HIT. */
export function hitQuad(origin: vec3, dir: vec3, corner: vec3, u: vec3, v: vec3): f32 {
  const n = cross(u, v);
  const denom = dot(n, dir);
  if (abs(denom) < 1e-12) {
    return NO_HIT;
  }
  const t = dot(n, corner - origin) / denom;
  if (t <= EPSILON) {
    return NO_HIT;
  }
  const p = origin + dir * t - corner;
  const w = n / dot(n, n);
  const a = dot(w, cross(p, v));
  const b = dot(w, cross(u, p));
  if (a < 0. || a > 1. || b < 0. || b > 1.) {
    return NO_HIT;
  }
  return t;
}

/** The nearest surface the ray meets before `limit`. */
export function nearest(origin: vec3, dir: vec3, limit: f32): Hit {
  let best: Hit = { t: limit, normal: vec3(0., 0., 1.), material: 0 };
  for (let i: u32 = 0; i < params.counts.x; i++) {
    const s = spheres[i * 2];
    const t = hitSphere(origin, dir, s.xyz, s.w);
    if (t < best.t) {
      best = { t: t, normal: normalize(origin + dir * t - s.xyz), material: u32(spheres[i * 2 + 1].x) };
    }
  }
  for (let i: u32 = 0; i < params.counts.y; i++) {
    const q = quads[i * 3];
    const u = quads[i * 3 + 1].xyz;
    const v = quads[i * 3 + 2].xyz;
    const t = hitQuad(origin, dir, q.xyz, u, v);
    if (t < best.t) {
      best = { t: t, normal: normalize(cross(u, v)), material: u32(q.w) };
    }
  }
  return best;
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

/** A direction about `n` with the cosine's distribution, from two numbers in [0, 1). */
export function aboutNormal(n: vec3, r: vec2): vec3 {
  const phi = turn(r.x);
  const cosTheta = sqrt(1. - r.y);
  const sinTheta = sqrt(r.y);
  const helper = select(vec3(1., 0., 0.), vec3(0., 1., 0.), abs(n.x) > 0.9);
  const tangent = normalize(cross(helper, n));
  const bitangent = cross(n, tangent);
  return tangent * (phi.x * sinTheta) + bitangent * (phi.y * sinTheta) + n * cosTheta;
}

/** The light that reaches `p` on a diffuse surface facing `n`, from a point sampled on one
 *  light: the light chosen by `pick`, the point by `r`. Not yet multiplied by the albedo. */
export function direct(p: vec3, n: vec3, pick: f32, r: vec2): vec3 {
  const count = params.counts.z;
  if (count === 0) {
    return vec3(0.);
  }
  const which = lights[min(u32(pick * f32(count)), count - 1)];
  const q = quads[which * 3];
  const u = quads[which * 3 + 1].xyz;
  const v = quads[which * 3 + 2].xyz;
  const to = q.xyz + u * r.x + v * r.y - p;
  const dist2 = dot(to, to);
  const dist = sqrt(dist2);
  const wi = to / dist;
  const ln = cross(u, v);
  const area = length(ln);
  const cosLight = -dot(ln, wi) / area;
  const cosSurface = dot(n, wi);
  if (cosLight <= 0. || cosSurface <= 0.) {
    return vec3(0.);
  }
  if (nearest(p, wi, dist * (1. - EPSILON)).t < dist * (1. - EPSILON)) {
    return vec3(0.);
  }
  const emission = materials[u32(q.w) * 2 + 1].xyz;
  return emission * (INV_PI * cosSurface * cosLight * area * f32(count) / dist2);
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
    if (hit.t >= NO_HIT) {
      break;
    }
    const albedo = materials[hit.material * 2];
    const emission = materials[hit.material * 2 + 1].xyz;
    const front = dot(hit.normal, dir) < 0.;
    if (specular && front) {
      sum += throughput * emission;
    }
    if (bounce === bounces) {
      break;
    }
    const n = select(-hit.normal, hit.normal, front);
    const p = origin + dir * hit.t + n * EPSILON;
    if (albedo.w > 0.5) {
      // The mirror's formula, written out: the lint of record 0005 does not list `reflect`.
      dir = dir - 2. * dot(dir, n) * n;
      origin = p;
      throughput *= albedo.xyz;
      specular = true;
      continue;
    }
    const pair = bounce * 3 + 1;
    const pick = sample2(pixelSeed, index, pair + 2);
    sum += throughput * albedo.xyz * direct(p, n, pick.x, sample2(pixelSeed, index, pair));
    dir = aboutNormal(n, sample2(pixelSeed, index, pair + 1));
    origin = p;
    throughput *= albedo.xyz;
    specular = false;
    if (bounce >= params.path.y) {
      const survive = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.05, 0.95);
      if (pick.y >= survive) {
        break;
      }
      throughput /= survive;
    }
  }
  return sum;
}

/** Adds `params.frame.w` samples to every pixel of the frame. */
@compute([64])
export function trace(@builtin("global_invocation_id") gid: vec3u): void {
  const width = params.frame.x;
  const height = params.frame.y;
  if (gid.x >= width * height) {
    return;
  }
  const px = gid.x % width;
  const py = gid.x / width;
  const pixelSeed = hash2(gid.x, params.counts.w);
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
  accum[gid.x] += vec4(sum, f32(params.frame.w));
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
