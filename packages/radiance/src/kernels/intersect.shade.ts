'use typeshade';
import {
  Bounds,
  instanceBases,
  instanceNormalToWorld,
  instanceToObject,
  instanceToWorld,
  nodeBounds,
  nodeWords,
  params,
  triangleWords,
  vertexNormal,
  vertexPosition,
  vertexUv,
} from './layout.shade.ts';
import { Surface, tangentOf } from './materials.shade.ts';

// The geometry tests and the traversal (design record 0001, "Traversal"): a ray against a box, a
// ray against a triangle, the two-level walk of the TLAS and of each instance's BLAS, and the
// surface at a hit, which record 0004's shading contract takes.
//
// - The box test is the slab test with `1 / d` computed once per ray in each space. A component
//   of `d` that is 0 is taken as a tiny positive number, so no infinity reaches the arithmetic.
// - The triangle test is the watertight test of Woop, Benthin and Wald (2013): the ray's axes are
//   permuted so that z is its largest, the triangle is sheared into the ray's frame, and three
//   edge functions decide. Two triangles that share an edge compute one edge function with
//   opposite signs, so a ray cannot pass between them. Its one division is the final 1 / det.
// - `nearest` walks the TLAS with a stack of 32 entries. At an instance leaf it moves the ray into
//   the instance's space (the direction is not normalised, so `t` stays a world-space parameter)
//   and walks that BLAS with a second stack of 32. The farther child is pushed first, so the
//   nearer one is walked first. A leaf's primitives are tested in their order.
// - `occluded` is the same walk, and it stops at the first hit.
// - The builder makes a leaf at depth 30, so a walk never holds more than 31 entries.
//
// Determinism (design record 0005, "The six rules"). This file leans on these rules:
//   Rule 2: no transcendental function.
//   Rule 3: `/` (the slab test's 1 / d and the triangle test's 1 / det), `sqrt`, `normalize`,
//           `length`, `dot` and `cross` may steer. The differential gate bounds them.
//   Rule 6: no `f16`, no subgroup operation, no `raw`.
// The lint in determinism.test.ts reads the compiler's determinism report of this file.

/** The instance or triangle of a hit that met nothing. */
export const NONE: u32 = 0xffffffff;
/** How far the hit point is moved off the surface along its geometric normal, against a new ray
 *  meeting the surface it leaves. It grows with the point's distance from the origin. */
export const OFFSET: f32 = 0.0001;
/** What a component of a ray's direction below it is taken as, in the slab test. */
const TINY: f32 = 1e-20;
/** The slab test's far distance is widened by this factor (1 + 2 gamma(3), Ize 2013), so a hit
 *  the triangle test finds on a box's face is not culled by the box's rounding. */
const SLAB_SLACK: f32 = 1.0000004;

/** What `nearest` finds. */
export class Hit {
  /** How far along the ray: the limit when nothing is met. */
  t: f32;
  /** The instance met: its slot in `instances`. NONE when nothing is met. */
  instance: u32;
  /** The triangle met: its index in `triangles`, the instance's `primBase` added. */
  triangle: u32;
  /** The barycentric weights of the triangle's second and of its third vertex at the hit. */
  b1: f32;
  b2: f32;
}

/** A ray made ready for the tests in one space. */
class Ray {
  o: vec3;
  d: vec3;
  /** 1 / d per component, a component of 0 taken as TINY. */
  inv: vec3;
  /** The axes of the ray's frame: kz is the axis of the largest |d|. */
  k: vec3u;
  /** The shear: d[kx] / d[kz], d[ky] / d[kz] and 1 / d[kz]. */
  shear: vec3;
}

/** Component `k` of `v` (0 x, 1 y, 2 z), by selects: a GPU indexes a vector by a variable
 *  through memory, and a select stays in registers. */
export function pick(v: vec3, k: u32): f32 {
  return select(select(v.x, v.y, k === 1), v.z, k === 2);
}

/** The ray from `o` along `d`, made ready for the box and triangle tests. */
export function prepare(o: vec3, d: vec3): Ray {
  const ax = abs(d.x);
  const ay = abs(d.y);
  const az = abs(d.z);
  let kz: u32 = 2;
  if (ax >= ay && ax >= az) {
    kz = 0;
  } else if (ay >= az) {
    kz = 1;
  }
  let kx = (kz + 1) % 3;
  let ky = (kx + 1) % 3;
  const dz = pick(d, kz);
  // A negative z swaps x and y, so that the triangles keep their winding in the ray's frame.
  if (dz < 0.) {
    const swap = kx;
    kx = ky;
    ky = swap;
  }
  // The scalar form keeps the oracle's code scalar: it runs the slab test on every node.
  const ix = 1. / select(d.x, TINY, ax < TINY);
  const iy = 1. / select(d.y, TINY, ay < TINY);
  const iz = 1. / select(d.z, TINY, az < TINY);
  return {
    o: o,
    d: d,
    inv: vec3(ix, iy, iz),
    k: vec3u(kx, ky, kz),
    shear: vec3(pick(d, kx) / dz, pick(d, ky) / dz, 1. / dz),
  };
}

/** Whether the ray meets the box `b` before `limit`. */
export function enters(r: Ray, b: Bounds, limit: f32): bool {
  const x0 = (b.lo.x - r.o.x) * r.inv.x;
  const x1 = (b.hi.x - r.o.x) * r.inv.x;
  const y0 = (b.lo.y - r.o.y) * r.inv.y;
  const y1 = (b.hi.y - r.o.y) * r.inv.y;
  const z0 = (b.lo.z - r.o.z) * r.inv.z;
  const z1 = (b.hi.z - r.o.z) * r.inv.z;
  const near = max(max(min(x0, x1), min(y0, y1)), max(min(z0, z1), 0.));
  const far = min(min(max(x0, x1), max(y0, y1)), max(z0, z1)) * SLAB_SLACK;
  return near <= min(far, limit);
}

/**
 * Where the ray meets the triangle `p0 p1 p2` (either face), before `limit`: (t, b1, b2), with b1
 * and b2 the weights of p1 and p2. t is -1 when it does not meet it.
 */
export function hitTriangle(r: Ray, p0: vec3, p1: vec3, p2: vec3, limit: f32): vec3 {
  const miss = vec3(-1., 0., 0.);
  const kx = r.k.x;
  const ky = r.k.y;
  const kz = r.k.z;
  // Each vertex from the ray's origin, its axes permuted to (kx, ky, kz).
  const ox = pick(r.o, kx);
  const oy = pick(r.o, ky);
  const oz = pick(r.o, kz);
  const az = pick(p0, kz) - oz;
  const bz = pick(p1, kz) - oz;
  const cz = pick(p2, kz) - oz;
  const ax = pick(p0, kx) - ox - r.shear.x * az;
  const ay = pick(p0, ky) - oy - r.shear.y * az;
  const bx = pick(p1, kx) - ox - r.shear.x * bz;
  const by = pick(p1, ky) - oy - r.shear.y * bz;
  const cx = pick(p2, kx) - ox - r.shear.x * cz;
  const cy = pick(p2, ky) - oy - r.shear.y * cz;
  // The edge functions: u for the edge opposite p0, v opposite p1, w opposite p2.
  const u = cx * by - cy * bx;
  const v = ax * cy - ay * cx;
  const w = bx * ay - by * ax;
  if ((u < 0. || v < 0. || w < 0.) && (u > 0. || v > 0. || w > 0.)) {
    return miss;
  }
  const det = u + v + w;
  if (det === 0.) {
    return miss;
  }
  const t = u * (r.shear.z * az) + v * (r.shear.z * bz) + w * (r.shear.z * cz);
  // t / det must be above 0: t has det's sign.
  if ((det < 0. && t >= 0.) || (det > 0. && t <= 0.)) {
    return miss;
  }
  const inv = 1. / det;
  const at = t * inv;
  if (at >= limit) {
    return miss;
  }
  return vec3(at, v * inv, w * inv);
}

/** The ray from `origin` along `dir` moved into instance `i`'s space and made ready. */
function rayIn(i: u32, origin: vec3, dir: vec3): Ray {
  return prepare(instanceToObject(i, vec4(origin, 1.)), instanceToObject(i, vec4(dir, 0.)));
}

/** The nearest surface the ray meets before `limit`. `instance` is NONE when it meets none. */
export function nearest(origin: vec3, dir: vec3, limit: f32): Hit {
  let hit: Hit = { t: limit, instance: NONE, triangle: NONE, b1: 0., b2: 0. };
  if (params.scene.y === 0) {
    return hit;
  }
  const tlas = params.scene.x;
  const r = prepare(origin, dir);
  // The two stacks, of the TLAS and of the BLAS being walked, each made once for the ray. The
  // TLAS's starts with its root, node 0. WGSL zeroes an array declared with no value, but
  // TypeScript calls it unassigned, so the zeros are written out.
  let stack: array<u32, 32> = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  let inner: array<u32, 32> = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  let top: u32 = 1;
  while (top > 0) {
    top -= 1;
    const node = tlas + stack[top];
    if (!enters(r, nodeBounds(node), hit.t)) {
      continue;
    }
    const w = nodeWords(node);
    if (w.count === 0) {
      // The farther child first: the one on the side the direction points toward.
      if (pick(dir, w.axis) >= 0.) {
        stack[top] = w.a + 1;
        stack[top + 1] = w.a;
      } else {
        stack[top] = w.a;
        stack[top + 1] = w.a + 1;
      }
      top += 2;
      continue;
    }
    // A TLAS leaf's `a` is its first instance's slot, which the packer made its index.
    for (let k: u32 = 0; k < w.count; k++) {
      const i = w.a + k;
      const bases = instanceBases(i);
      const ri = rayIn(i, origin, dir);
      inner[0] = 0;
      let innerTop: u32 = 1;
      while (innerTop > 0) {
        innerTop -= 1;
        const at = bases.x + inner[innerTop];
        if (!enters(ri, nodeBounds(at), hit.t)) {
          continue;
        }
        const v = nodeWords(at);
        if (v.count === 0) {
          if (pick(ri.d, v.axis) >= 0.) {
            inner[innerTop] = v.a + 1;
            inner[innerTop + 1] = v.a;
          } else {
            inner[innerTop] = v.a;
            inner[innerTop + 1] = v.a + 1;
          }
          innerTop += 2;
          continue;
        }
        for (let j: u32 = 0; j < v.count; j++) {
          const triangle = bases.y + v.a + j;
          const tw = triangleWords(triangle);
          const h = hitTriangle(
            ri,
            vertexPosition(bases.z, tw.x),
            vertexPosition(bases.z, tw.y),
            vertexPosition(bases.z, tw.z),
            hit.t,
          );
          if (h.x >= 0.) {
            hit = { t: h.x, instance: i, triangle: triangle, b1: h.y, b2: h.z };
          }
        }
      }
    }
  }
  return hit;
}

/** Whether the ray meets any surface before `limit`: the shadow ray's test. It is `nearest`'s
 *  walk, and it stops at the first triangle it meets. */
export function occluded(origin: vec3, dir: vec3, limit: f32): bool {
  if (params.scene.y === 0) {
    return false;
  }
  const tlas = params.scene.x;
  const r = prepare(origin, dir);
  let stack: array<u32, 32> = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  let inner: array<u32, 32> = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  let top: u32 = 1;
  while (top > 0) {
    top -= 1;
    const node = tlas + stack[top];
    if (!enters(r, nodeBounds(node), limit)) {
      continue;
    }
    const w = nodeWords(node);
    if (w.count === 0) {
      if (pick(dir, w.axis) >= 0.) {
        stack[top] = w.a + 1;
        stack[top + 1] = w.a;
      } else {
        stack[top] = w.a;
        stack[top + 1] = w.a + 1;
      }
      top += 2;
      continue;
    }
    for (let k: u32 = 0; k < w.count; k++) {
      const i = w.a + k;
      const bases = instanceBases(i);
      const ri = rayIn(i, origin, dir);
      inner[0] = 0;
      let innerTop: u32 = 1;
      while (innerTop > 0) {
        innerTop -= 1;
        const at = bases.x + inner[innerTop];
        if (!enters(ri, nodeBounds(at), limit)) {
          continue;
        }
        const v = nodeWords(at);
        if (v.count === 0) {
          if (pick(ri.d, v.axis) >= 0.) {
            inner[innerTop] = v.a + 1;
            inner[innerTop + 1] = v.a;
          } else {
            inner[innerTop] = v.a;
            inner[innerTop + 1] = v.a + 1;
          }
          innerTop += 2;
          continue;
        }
        for (let j: u32 = 0; j < v.count; j++) {
          const tw = triangleWords(bases.y + v.a + j);
          const h = hitTriangle(
            ri,
            vertexPosition(bases.z, tw.x),
            vertexPosition(bases.z, tw.y),
            vertexPosition(bases.z, tw.z),
            limit,
          );
          if (h.x >= 0.) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * The surface of triangle `triangle` of instance `instance` at the barycentric weights `b1` and
 * `b2`, met by a ray along `dir`. `surface` gives a hit's. Next-event estimation gives a point it
 * sampled on a light.
 */
export function surfaceAt(instance: u32, triangle: u32, b1: f32, b2: f32, dir: vec3): Surface {
  const bases = instanceBases(instance);
  const tw = triangleWords(triangle);
  const b0 = 1. - b1 - b2;
  const p0 = vertexPosition(bases.z, tw.x);
  const p1 = vertexPosition(bases.z, tw.y);
  const p2 = vertexPosition(bases.z, tw.z);
  const p = instanceToWorld(instance, vec4(p0 * b0 + p1 * b1 + p2 * b2, 1.));
  // The geometric normal: outward for a counter-clockwise triangle, moved to world space as the
  // shading normal is, so a mirrored instance keeps its outside.
  const outward = normalize(instanceNormalToWorld(instance, cross(p1 - p0, p2 - p0)));
  const front = dot(outward, dir) < 0.;
  const ng = select(-outward, outward, front);
  // The shading normal: the vertices' normals, interpolated, on the side of ng.
  const n =
    vertexNormal(bases.z, tw.x) * b0 + vertexNormal(bases.z, tw.y) * b1 + vertexNormal(bases.z, tw.z) * b2;
  const nw = instanceNormalToWorld(instance, n);
  let ns = ng;
  const nl = length(nw);
  if (nl > 0.) {
    ns = select(-nw, nw, front) / nl;
    if (dot(ns, ng) <= 0.) {
      ns = ng;
    }
  }
  const uv0 = vertexUv(bases.z, tw.x);
  const uv1 = vertexUv(bases.z, tw.y);
  const uv2 = vertexUv(bases.z, tw.z);
  // dp/du from the edges and the uv differences, or a tangent about ns when the uvs are degenerate.
  const e1 = instanceToWorld(instance, vec4(p1 - p0, 0.));
  const e2 = instanceToWorld(instance, vec4(p2 - p0, 0.));
  const d1 = uv1 - uv0;
  const d2 = uv2 - uv0;
  const det = d1.x * d2.y - d2.x * d1.y;
  let dpdu = tangentOf(ns);
  if (det !== 0.) {
    dpdu = (e1 * d2.y - e2 * d1.y) / det;
  }
  const a = abs(p);
  const offset = OFFSET * max(1., max(a.x, max(a.y, a.z)));
  return {
    p: p + ng * offset,
    ng: ng,
    ns: ns,
    uv: uv0 * b0 + uv1 * b1 + uv2 * b2,
    dpdu: dpdu,
    material: bases.w,
    front: front,
  };
}

/** The surface a ray along `dir` met at `hit` (record 0004, `Surface`). */
export function surface(hit: Hit, dir: vec3): Surface {
  return surfaceAt(hit.instance, hit.triangle, hit.b1, hit.b2, dir);
}
