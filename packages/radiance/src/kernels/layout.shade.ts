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
// Record 0005's rules this file leans on: rule 3 (`dot` in the instance transforms).

/** vec4s in one BVH node of `nodes`: `[0] = (min, bits(a))`, `[1] = (max, bits(b))`. */
export const NODE_STRIDE: u32 = 2;
/** vec4us in one triangle of `triangles`: `(i0, i1, i2, flags)`. */
export const TRIANGLE_STRIDE: u32 = 1;
/** vec4s in one vertex of `vertices`: `[0] = (position, u)`, `[1] = (normal, v)`. */
export const VERTEX_STRIDE: u32 = 2;
/** vec4s in one instance of `instances`: two matrices as rows, the bases, the flags. */
export const INSTANCE_STRIDE: u32 = 8;
/** vec4s in one material of `materials` (record 0004). M2 fills the first four. */
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

/** The BVH nodes: every BLAS, then the TLAS at `params.scene.x`. */
declare const nodes: storage<array<vec4>>;
/** The vertices of every geometry, each BLAS's from its `vertexBase`. */
declare const vertices: storage<array<vec4>>;
/** The instances: the world matrix, its inverse, the bases and the flags of each. */
declare const instances: storage<array<vec4>>;

/** A node's box, from `lo` to `hi`. */
export class Bounds {
  lo: vec3;
  hi: vec3;
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

/** The position of vertex `i` of the geometry whose vertices start at `base`, in its own space. */
export function vertexPosition(base: u32, i: u32): vec3 {
  return vertices[(base + i) * VERTEX_STRIDE].xyz;
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
