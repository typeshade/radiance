'use typeshade';

// The scene's layout on the GPU (design record 0001, "The GPU layout"): the stride of each
// storage buffer in vec4 units, the offsets inside one element, and a decoder for each element
// the traversal reads. This file is the one authority for those numbers. The host imports the
// constants through the module's host view (surface §64), so it keeps no copy of a stride.
//
// Every buffer is an array of vec4 or vec4u. A word that is an integer is stored as its bits in
// an f32 and read with `bitcast<u32>` (surface §44). Indices inside a BLAS are relative: a child
// to the BLAS's first node, a leaf's first primitive to its `primBase`, and a triangle's vertex
// indices to its `vertexBase`. The caller adds the instance's bases (`instanceBases`).
//
// The trace's uniform block, `TraceParams`, is declared here too: the traversal reads the TLAS's
// first node and the counts from it, and the host builds it from the same numbers.
//
// Record 0005's rules this file leans on: rule 3 (`dot` in the instance transforms and in the
// sphere's rotation).

/** vec4s in one BVH node of `nodes`: `[0] = (min, bits(a))`, `[1] = (max, bits(b))`. */
export const NODE_STRIDE: u32 = 2;
/** vec4us in one triangle of `triangles`: `(i0, i1, i2, flags)`. */
export const TRIANGLE_STRIDE: u32 = 1;
/** vec4s in one vertex of `vertices`: `[0] = (position, u)`, `[1] = (normal, v)`. */
export const VERTEX_STRIDE: u32 = 2;
/** vec4s in one instance of `instances`: two matrices as rows, the bases, the flags. */
export const INSTANCE_STRIDE: u32 = 8;
/** vec4s in one material of `materials` (record 0004, record 0010 Part 1). Each word is a value. */
export const MATERIAL_STRIDE: u32 = 8;
/** vec4s in one light of `lights`: `(bits(type), bits(instance), bits(triangle), cdf)`. */
export const LIGHT_STRIDE: u32 = 1;
/** vec4s in one pixel of `accum`: rgb added up, and the sample count in w. */
export const ACCUM_STRIDE: u32 = 1;

/** The bits of a node's word b that hold its primitive count. A count of 0 is an inner node. */
export const NODE_COUNT_MASK: u32 = 0x3fffffff;
/** The shift that brings a node's split axis (0 x, 1 y, 2 z) down from word b's top two bits. */
export const NODE_AXIS_SHIFT: u32 = 30;

/** The offset in an instance of the world matrix's three rows, `(m00, m01, m02, tx)` first. */
export const INSTANCE_MATRIX: u32 = 0;
/** The offset in an instance of the inverse world matrix's three rows. */
export const INSTANCE_INVERSE: u32 = 3;
/** The offset in an instance of `(bits(nodeBase), bits(primBase), bits(vertexBase), bits(material))`. */
export const INSTANCE_BASES: u32 = 6;
/** The offset in an instance of `(bits(flags), bits(geometryId), 0, 0)`. */
export const INSTANCE_FLAGS: u32 = 7;

/**
 * Bit 0 of an instance's `flags`: the instance is a `Sphere` (record 0001, "The analytic sphere").
 * Its words differ from a mesh's: `[0]` holds the centre and the radius in world space, `[3]` to
 * `[5]` the rows of `R^T`, its world to object rotation, and `[6].w` its material. It has no BLAS.
 */
export const INSTANCE_SPHERE: u32 = 1;

/** The type word of a light that is an emissive triangle. M3 adds the analytic lights' types. */
export const LIGHT_TRIANGLE: u32 = 0;

/**
 * The trace's uniform block (record 0001, "The GPU layout"). The host fills it for each
 * dispatch, so that each tile reads its own `tile`.
 */
export class TraceParams {
  /** The camera's eye, and its right, up and forward axes in the world (w unused). */
  eye: vec4;
  right: vec4;
  up: vec4;
  forward: vec4;
  /** tan of half the horizontal and vertical field of view, the aperture radius and the focus
   *  distance. The last two are M3's thin lens and are 0 until then. */
  lens: vec4;
  /** The frame's width and height in pixels, the first sample's index, and how many to take. */
  frame: vec4u;
  /** The tile the dispatch covers: its x0, y0, width and height, in frame pixels. */
  tile: vec4u;
  /** The TLAS's first node (`tlasBase`), the instance count, the light count, and the seed. */
  scene: vec4u;
  /** The bounces a path may take, the bounce Russian roulette starts at, flags (0), unused. */
  path: vec4u;
}

/** The trace's uniform block. */
export declare const params: uniform<TraceParams>;

/** The BVH nodes: every BLAS, then the TLAS at `params.scene.x`. */
declare const nodes: storage<array<vec4>>;
/** The triangles of every geometry, each BLAS's from its `primBase`, in its leaves' order. */
declare const triangles: storage<array<vec4u>>;
/** The vertices of every geometry, each BLAS's from its `vertexBase`. */
declare const vertices: storage<array<vec4>>;
/** The instances: the world matrix, its inverse, the bases and the flags of each. */
declare const instances: storage<array<vec4>>;
/** The lights: `(bits(type), bits(instance), bits(triangle), cdf)` each. */
declare const lights: storage<array<vec4>>;

/** A node's box, from `lo` to `hi`. */
export class Bounds {
  lo: vec3;
  hi: vec3;
}

/** A light's words, decoded. */
export class Light {
  /** The light's type word: LIGHT_TRIANGLE at M2. (WGSL reserves the name `type`.) */
  kind: u32;
  /** The instance the light belongs to: its slot in `instances`. */
  instance: u32;
  /** The triangle that emits: its index in `triangles`, the instance's `primBase` added. */
  triangle: u32;
  /** The probability of this light and of every light before it, in [0, 1]. */
  cdf: f32;
}

/** A node's two integer words, decoded. */
export class NodeWords {
  /** An inner node's left child (the right child is `a + 1`), or a leaf's first primitive. */
  a: u32;
  /** How many primitives a leaf holds. 0 for an inner node. */
  count: u32;
  /** The axis an inner node was split on: 0 x, 1 y, 2 z. */
  axis: u32;
}

/** The box of node `i`, an absolute index into `nodes`. */
export function nodeBounds(i: u32): Bounds {
  const at = i * NODE_STRIDE;
  return { lo: nodes[at].xyz, hi: nodes[at + 1].xyz };
}

/** The integer words of node `i`, an absolute index into `nodes`. `a` stays relative. */
export function nodeWords(i: u32): NodeWords {
  const at = i * NODE_STRIDE;
  const a = bitcast<u32>(nodes[at].w);
  const b = bitcast<u32>(nodes[at + 1].w);
  return { a: a, count: b & NODE_COUNT_MASK, axis: b >> NODE_AXIS_SHIFT };
}

/** Triangle `i`'s `(i0, i1, i2, flags)`, an absolute index into `triangles`. The vertex indices
 *  are relative to the geometry's `vertexBase`. */
export function triangleWords(i: u32): vec4u {
  return triangles[i * TRIANGLE_STRIDE];
}

/** The position of vertex `i` of the geometry whose vertices start at `base`, in its own space. */
export function vertexPosition(base: u32, i: u32): vec3 {
  return vertices[(base + i) * VERTEX_STRIDE].xyz;
}

/** The shading normal of vertex `i` of the geometry whose vertices start at `base`, in its own
 *  space. */
export function vertexNormal(base: u32, i: u32): vec3 {
  return vertices[(base + i) * VERTEX_STRIDE + 1].xyz;
}

/** The uv of vertex `i` of the geometry whose vertices start at `base`: u in the first vec4's w,
 *  v in the second's. */
export function vertexUv(base: u32, i: u32): vec2 {
  const at = (base + i) * VERTEX_STRIDE;
  return vec2(vertices[at].w, vertices[at + 1].w);
}

/** Instance `i`'s `(nodeBase, primBase, vertexBase, material)`. */
export function instanceBases(i: u32): vec4u {
  const w = instances[i * INSTANCE_STRIDE + INSTANCE_BASES];
  return vec4u(bitcast<u32>(w.x), bitcast<u32>(w.y), bitcast<u32>(w.z), bitcast<u32>(w.w));
}

/**
 * `p` from world space into instance `i`'s space, by the inverse rows. Give w = 1 for a point
 * and w = 0 for a direction. A direction is not normalised, so `t` stays a world-space parameter.
 */
export function instanceToObject(i: u32, p: vec4): vec3 {
  const at = i * INSTANCE_STRIDE + INSTANCE_INVERSE;
  return vec3(dot(instances[at], p), dot(instances[at + 1], p), dot(instances[at + 2], p));
}

/** `v` from instance `i`'s space into world space. Give w = 1 for a point and w = 0 for a direction. */
export function instanceToWorld(i: u32, v: vec4): vec3 {
  const at = i * INSTANCE_STRIDE + INSTANCE_MATRIX;
  return vec3(dot(instances[at], v), dot(instances[at + 1], v), dot(instances[at + 2], v));
}

/**
 * The normal `n` from instance `i`'s space into world space, by the inverse transposed: the
 * columns of the inverse rows. Not normalised.
 */
export function instanceNormalToWorld(i: u32, n: vec3): vec3 {
  const at = i * INSTANCE_STRIDE + INSTANCE_INVERSE;
  return instances[at].xyz * n.x + instances[at + 1].xyz * n.y + instances[at + 2].xyz * n.z;
}

/** Instance `i`'s `flags` word. Bit 0 (`INSTANCE_SPHERE`) marks a `Sphere`. */
export function instanceFlags(i: u32): u32 {
  return bitcast<u32>(instances[i * INSTANCE_STRIDE + INSTANCE_FLAGS].x);
}

/** The centre of the `Sphere` of instance `i`, in world space: `[0].xyz`. */
export function sphereCentre(i: u32): vec3 {
  return instances[i * INSTANCE_STRIDE + INSTANCE_MATRIX].xyz;
}

/** The radius of the `Sphere` of instance `i`, in world space: `[0].w`. */
export function sphereRadius(i: u32): f32 {
  return instances[i * INSTANCE_STRIDE + INSTANCE_MATRIX].w;
}

/**
 * The vector `v` from world space into the own space of the `Sphere` of instance `i`: its dot
 * product with each row of `R^T`, the rows `[3]` to `[5]`.
 */
export function sphereToObject(i: u32, v: vec3): vec3 {
  const at = i * INSTANCE_STRIDE + INSTANCE_INVERSE;
  return vec3(dot(instances[at].xyz, v), dot(instances[at + 1].xyz, v), dot(instances[at + 2].xyz, v));
}

/**
 * The vector `v` from the own space of the `Sphere` of instance `i` into world space: `v.x`,
 * `v.y` and `v.z` times the rows `[3]`, `[4]` and `[5]`, added up. Sums and products only.
 */
export function sphereToWorld(i: u32, v: vec3): vec3 {
  const at = i * INSTANCE_STRIDE + INSTANCE_INVERSE;
  return instances[at].xyz * v.x + instances[at + 1].xyz * v.y + instances[at + 2].xyz * v.z;
}

/** Light `i`'s words. */
export function lightWords(i: u32): Light {
  const w = lights[i * LIGHT_STRIDE];
  return {
    kind: bitcast<u32>(w.x),
    instance: bitcast<u32>(w.y),
    triangle: bitcast<u32>(w.z),
    cdf: w.w,
  };
}

/** Light `i`'s cumulative probability alone, for the search that picks a light. */
export function lightCdf(i: u32): f32 {
  return lights[i * LIGHT_STRIDE].w;
}
