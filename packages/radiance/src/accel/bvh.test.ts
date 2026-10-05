// The BVH builder (design record 0001, "The build"), held to what the kernel's walk relies on:
// every primitive in exactly one leaf, every box around what it holds, children after their
// parent, the depth and the node count inside the record's limits, and a walk of the tree that
// finds the same nearest triangle as a test of every triangle, on 1,000 seeded random rays.
//
// The walk here is TypeScript over the packed words, as the kernel will read them (record 0001,
// "Traversal"). The kernel's own walk on the oracle is step 3's (intersect.shade.ts).

import { describe, expect, it } from 'bun:test';
import {
  BVH_LEAF_SIZE,
  BVH_MAX_DEPTH,
  buildBlas,
  buildTlas,
  type Bvh,
  type TriangleSource,
} from './bvh.ts';
import { NODE_AXIS_SHIFT, NODE_COUNT_MASK, NODE_STRIDE } from '../kernels/layout.shade.ts';

/** WebGPU's default `maxStorageBufferBindingSize` (record 0001, "Limits"). */
const MAX_BINDING_BYTES = 134_217_728;
/** The most nodes one binding holds: 4,194,304 (record 0001, "Sizes under the limits"). */
const MAX_NODES = MAX_BINDING_BYTES / (NODE_STRIDE * 16);
/** The entries of the kernel's stack (record 0001, "Traversal"). */
const STACK = 32;
const FLOATS = NODE_STRIDE * 4;

// --- Inputs ---------------------------------------------------------------------------------

/** Numbers in [0, 1) from a seed: mulberry32, so every run draws the same rays. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sphere tessellated as three.js's `SphereGeometry` is: rings of quads, one triangle at a pole. */
function sphere(radius: number, widthSegments: number, heightSegments: number): TriangleSource {
  const position: number[] = [];
  const index: number[] = [];
  for (let iy = 0; iy <= heightSegments; iy++) {
    const v = iy / heightSegments;
    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;
      position.push(
        -radius * Math.cos(u * 2 * Math.PI) * Math.sin(v * Math.PI),
        radius * Math.cos(v * Math.PI),
        radius * Math.sin(u * 2 * Math.PI) * Math.sin(v * Math.PI),
      );
    }
  }
  const row = widthSegments + 1;
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * row + ix + 1;
      const b = iy * row + ix;
      const c = (iy + 1) * row + ix;
      const d = (iy + 1) * row + ix + 1;
      if (iy !== 0) index.push(a, b, d);
      if (iy !== heightSegments - 1) index.push(b, c, d);
    }
  }
  return { position: new Float32Array(position), index: new Uint32Array(index) };
}

/** `count` triangles of random size and place in the cube from -1 to 1. */
function randomMesh(count: number, seed: number): TriangleSource {
  const r = random(seed);
  const position = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const c = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    const size = 0.02 + r() * 0.3;
    for (let k = 0; k < 9; k++) position[t * 9 + k] = c[k % 3]! + (r() - 0.5) * size;
  }
  return { position, index: Uint32Array.from({ length: count * 3 }, (_, i) => i) };
}

/** Each triangle's box, six numbers: min xyz, max xyz. */
function triangleBoxes(m: TriangleSource): Float64Array {
  const n = m.index.length / 3;
  const out = new Float64Array(n * 6);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const vs = [0, 1, 2].map((j) => m.position[m.index[t * 3 + j]! * 3 + k]!);
      out[t * 6 + k] = Math.min(...vs);
      out[t * 6 + 3 + k] = Math.max(...vs);
    }
  }
  return out;
}

// --- Reading the packed words, as the kernel does ------------------------------------------

interface Node {
  lo: number[];
  hi: number[];
  a: number;
  count: number;
  axis: number;
}

function node(nodes: Float32Array, i: number): Node {
  const words = new Uint32Array(nodes.buffer, nodes.byteOffset, nodes.length);
  const at = i * FLOATS;
  const b = words[at + 7]!;
  return {
    lo: [nodes[at]!, nodes[at + 1]!, nodes[at + 2]!],
    hi: [nodes[at + 4]!, nodes[at + 5]!, nodes[at + 6]!],
    a: words[at + 3]!,
    count: b & NODE_COUNT_MASK,
    axis: b >>> NODE_AXIS_SHIFT,
  };
}

const inside = (lo: number[], hi: number[], b: ArrayLike<number>, at: number): boolean =>
  [0, 1, 2].every((k) => lo[k]! <= b[at + k]! && b[at + 3 + k]! <= hi[k]!);

interface TreeStats {
  nodes: number;
  leaves: number;
  depth: number;
  largestLeaf: number;
}

/**
 * Throws, naming the node, unless the tree holds every invariant the walk relies on. `boxes` are
 * the primitives' boxes, six numbers each.
 */
function checkTree(bvh: Bvh, boxes: Float64Array): TreeStats {
  const prims = boxes.length / 6;
  const count = bvh.nodes.length / FLOATS;
  if (!Number.isInteger(count)) throw new Error(`nodes is not ${FLOATS} floats per node`);
  if (count > 2 * prims - 1) throw new Error(`${count} nodes for ${prims} primitives`);
  if (bvh.order.length !== prims) throw new Error(`order holds ${bvh.order.length}`);
  const visited = new Uint8Array(count);
  const slots = new Uint8Array(prims);
  const seen = new Uint8Array(prims);
  const stats: TreeStats = { nodes: count, leaves: 0, depth: 0, largestLeaf: 0 };
  const visit = (i: number, depth: number): void => {
    if (visited[i]) throw new Error(`node ${i} is reached twice`);
    visited[i] = 1;
    if (depth > BVH_MAX_DEPTH) throw new Error(`node ${i} is at depth ${depth}`);
    stats.depth = Math.max(stats.depth, depth);
    const n = node(bvh.nodes, i);
    if (n.count === 0) {
      if (n.a <= i || n.a + 1 >= count)
        throw new Error(`node ${i}: children at ${n.a} of ${count}`);
      if (n.axis > 2) throw new Error(`node ${i}: axis ${n.axis}`);
      for (const c of [n.a, n.a + 1]) {
        const child = node(bvh.nodes, c);
        if (!inside(n.lo, n.hi, [...child.lo, ...child.hi], 0)) {
          throw new Error(`node ${i} does not hold its child ${c}`);
        }
        visit(c, depth + 1);
      }
      return;
    }
    stats.leaves++;
    stats.largestLeaf = Math.max(stats.largestLeaf, n.count);
    if (n.a + n.count > prims) throw new Error(`leaf ${i}: primitives ${n.a} + ${n.count}`);
    for (let s = n.a; s < n.a + n.count; s++) {
      const p = bvh.order[s]!;
      if (slots[s]) throw new Error(`slot ${s} of order is in two leaves`);
      if (seen[p]) throw new Error(`primitive ${p} is in two leaves`);
      slots[s] = 1;
      seen[p] = 1;
      if (!inside(n.lo, n.hi, boxes, p * 6)) throw new Error(`leaf ${i} does not hold ${p}`);
    }
  };
  visit(0, 0);
  const orphan = visited.indexOf(0);
  if (orphan >= 0) throw new Error(`node ${orphan} is not reached from the root`);
  const lost = seen.indexOf(0);
  if (lost >= 0) throw new Error(`primitive ${lost} is in no leaf`);
  return stats;
}

// --- Rays -----------------------------------------------------------------------------------

type Vec = [number, number, number];

/** Möller and Trumbore: how far along the ray the triangle is met, or Infinity. */
function hitTriangle(o: Vec, d: Vec, p0: Vec, p1: Vec, p2: Vec): number {
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const p = [
    d[1] * e2[2]! - d[2] * e2[1]!,
    d[2] * e2[0]! - d[0] * e2[2]!,
    d[0] * e2[1]! - d[1] * e2[0]!,
  ];
  const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!;
  if (det === 0) return Infinity;
  const inv = 1 / det;
  const s = [o[0] - p0[0], o[1] - p0[1], o[2] - p0[2]];
  const u = (s[0]! * p[0]! + s[1]! * p[1]! + s[2]! * p[2]!) * inv;
  if (u < 0 || u > 1) return Infinity;
  const q = [
    s[1]! * e1[2]! - s[2]! * e1[1]!,
    s[2]! * e1[0]! - s[0]! * e1[2]!,
    s[0]! * e1[1]! - s[1]! * e1[0]!,
  ];
  const v = (d[0] * q[0]! + d[1] * q[1]! + d[2] * q[2]!) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const t = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) * inv;
  return t > 0 ? t : Infinity;
}

/** The slab test: where the ray enters the box, or Infinity when it misses it before `limit`. */
function enterBox(o: Vec, inv: Vec, lo: number[], hi: number[], limit: number): number {
  let near = 0;
  let far = limit;
  for (let k = 0; k < 3; k++) {
    const t0 = (lo[k]! - o[k]!) * inv[k]!;
    const t1 = (hi[k]! - o[k]!) * inv[k]!;
    near = Math.max(near, Math.min(t0, t1));
    // A little slack, so a hit the triangle test rounds onto the box's face is not culled.
    far = Math.min(far, Math.max(t0, t1) * (1 + 1e-9));
  }
  return near <= far ? near : Infinity;
}

interface Hit {
  t: number;
  /** -1 for a miss. */
  instance: number;
  triangle: number;
}

const MISS: Hit = { t: Infinity, instance: -1, triangle: -1 };
/** Nearer first. At one distance, the lower instance and then the lower triangle win. */
const better = (a: Hit, b: Hit): boolean =>
  a.t < b.t ||
  (a.t === b.t &&
    (a.instance < b.instance || (a.instance === b.instance && a.triangle < b.triangle)));

/**
 * The walk of one tree in `nodes` from `base`, nearer child first, with a stack of STACK entries.
 * `leaf(s)` tests the primitive in slot `s` of the leaves' order (relative to the tree).
 */
function walk(
  nodes: Float32Array,
  base: number,
  o: Vec,
  d: Vec,
  best: () => number,
  leaf: (s: number) => void,
): void {
  const inv: Vec = [1 / d[0], 1 / d[1], 1 / d[2]];
  const stack = new Uint32Array(STACK);
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const n = node(nodes, base + stack[--top]!);
    if (enterBox(o, inv, n.lo, n.hi, best()) === Infinity) continue;
    if (n.count > 0) {
      for (let s = n.a; s < n.a + n.count; s++) leaf(s);
      continue;
    }
    if (top + 2 > STACK) throw new Error('the walk needs more than 32 stack entries');
    // The child on the side the ray comes from is the nearer one, and it is popped first.
    const nearIsLeft = d[n.axis]! >= 0;
    stack[top++] = nearIsLeft ? n.a + 1 : n.a;
    stack[top++] = nearIsLeft ? n.a : n.a + 1;
  }
}

function vertex(m: TriangleSource, t: number, k: number): Vec {
  const v = m.index[t * 3 + k]!;
  return [m.position[v * 3]!, m.position[v * 3 + 1]!, m.position[v * 3 + 2]!];
}

function nearestInMesh(m: TriangleSource, o: Vec, d: Vec, instance: number, best: Hit): Hit {
  for (let t = 0; t < m.index.length / 3; t++) {
    const h = {
      t: hitTriangle(o, d, vertex(m, t, 0), vertex(m, t, 1), vertex(m, t, 2)),
      instance,
      triangle: t,
    };
    if (h.t < Infinity && better(h, best)) best = h;
  }
  return best;
}

function nearestInBlas(m: TriangleSource, bvh: Bvh, o: Vec, d: Vec): Hit {
  let best = MISS;
  walk(
    bvh.nodes,
    0,
    o,
    d,
    () => best.t,
    (s) => {
      const t = bvh.order[s]!;
      const h = {
        t: hitTriangle(o, d, vertex(m, t, 0), vertex(m, t, 1), vertex(m, t, 2)),
        instance: 0,
        triangle: t,
      };
      if (h.t < Infinity && better(h, best)) best = h;
    },
  );
  return best;
}

/** A ray from a point on a sphere of radius `r` toward a point in the box `lo` to `hi`. */
function ray(next: () => number, r: number, lo: Vec, hi: Vec): [Vec, Vec] {
  const z = next() * 2 - 1;
  const phi = next() * 2 * Math.PI;
  const s = Math.sqrt(1 - z * z);
  const o: Vec = [r * s * Math.cos(phi), r * s * Math.sin(phi), r * z];
  const to = [0, 1, 2].map((k) => lo[k]! + next() * (hi[k]! - lo[k]!));
  return [o, [to[0]! - o[0], to[1]! - o[1], to[2]! - o[2]]];
}

/** How many of `rays` seeded rays find another nearest triangle through the BLAS than by testing all. */
function blasMismatches(m: TriangleSource, bvh: Bvh, seed: number, rays: number): number {
  const next = random(seed);
  let wrong = 0;
  let hits = 0;
  for (let i = 0; i < rays; i++) {
    const [o, d] = ray(next, 3, [-1.2, -1.2, -1.2], [1.2, 1.2, 1.2]);
    const a = nearestInBlas(m, bvh, o, d);
    const b = nearestInMesh(m, o, d, 0, MISS);
    if (a.triangle !== b.triangle || a.t !== b.t) wrong++;
    if (b.triangle >= 0) hits++;
  }
  // Rays that all miss would prove nothing.
  expect(hits).toBeGreaterThan(rays / 4);
  return wrong;
}

// --- The BLAS -------------------------------------------------------------------------------

describe('buildBlas', () => {
  const ball = sphere(1, 32, 16);
  const soup = randomMesh(2000, 7);

  for (const [name, mesh] of [
    ['a tessellated sphere (32 x 16, 960 triangles)', ball],
    ['a random mesh (2,000 triangles)', soup],
  ] as const) {
    it(`over ${name}: every primitive in one leaf, every box around what it holds`, () => {
      const bvh = buildBlas(mesh);
      const stats = checkTree(bvh, triangleBoxes(mesh));
      expect(stats.depth).toBeLessThanOrEqual(BVH_MAX_DEPTH);
      expect(stats.nodes).toBeLessThanOrEqual(MAX_NODES);
      expect(stats.nodes).toBe(2 * stats.leaves - 1);
      expect(stats.leaves).toBeGreaterThan(1);
    });

    it(`over ${name}: the root's box is the geometry's`, () => {
      const bvh = buildBlas(mesh);
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      mesh.position.forEach((x, i) => {
        lo[i % 3] = Math.min(lo[i % 3]!, x);
        hi[i % 3] = Math.max(hi[i % 3]!, x);
      });
      expect(bvh.box.min.toArray()).toEqual(lo as Vec);
      expect(bvh.box.max.toArray()).toEqual(hi as Vec);
      expect(node(bvh.nodes, 0).lo).toEqual(lo);
      expect(node(bvh.nodes, 0).hi).toEqual(hi);
    });

    it(`over ${name}: the walk finds the nearest triangle on 1,000 random rays`, () => {
      const bvh = buildBlas(mesh);
      expect(blasMismatches(mesh, bvh, 1234, 1000)).toBe(0);
    });
  }

  it('splits two clusters apart at the root, the lower one on the left', () => {
    const a = randomMesh(50, 1);
    const b = randomMesh(50, 2);
    const position = new Float32Array([
      ...a.position,
      ...b.position.map((x, i) => (i % 3 === 1 ? x + 10 : x)),
    ]);
    const mesh = { position, index: Uint32Array.from({ length: 300 }, (_, i) => i) };
    const bvh = buildBlas(mesh);
    const root = node(bvh.nodes, 0);
    expect(root.count).toBe(0);
    expect(root.axis).toBe(1);
    expect(node(bvh.nodes, root.a).hi[1]).toBeLessThan(2);
    expect(node(bvh.nodes, root.a + 1).lo[1]).toBeGreaterThan(8);
  });

  it('makes a node of at most four primitives a leaf', () => {
    const bvh = buildBlas(randomMesh(BVH_LEAF_SIZE, 3));
    expect(bvh.nodes.length).toBe(FLOATS);
    expect(node(bvh.nodes, 0)).toMatchObject({ a: 0, count: BVH_LEAF_SIZE, axis: 0 });
  });

  it('makes a leaf at depth 30 whatever the heuristic says', () => {
    // Cubes of side 2^-k / 2 at 2^-k: each split peels the largest few off, so the tree goes deep.
    const boxes = new Float64Array(400 * 6);
    for (let k = 0; k < 400; k++) {
      const s = 2 ** -k;
      boxes.set([s, s, s, 1.5 * s, 1.5 * s, 1.5 * s], k * 6);
    }
    const bvh = buildTlas(boxes);
    const stats = checkTree(bvh, boxes);
    expect(stats.depth).toBe(BVH_MAX_DEPTH);
    expect(stats.largestLeaf).toBeGreaterThan(BVH_LEAF_SIZE);
  });

  it('refuses an empty list and an index past the last vertex', () => {
    expect(() => buildBlas({ position: new Float32Array(0), index: new Uint32Array(0) })).toThrow(
      RangeError,
    );
    expect(() =>
      buildBlas({ position: new Float32Array(9), index: new Uint32Array([0, 1, 3]) }),
    ).toThrow('triangle 0 names vertex 3, and the geometry has 3');
  });
});

// --- The TLAS -------------------------------------------------------------------------------

/** An affine transform as the record's rows: three rows of (m0, m1, m2, t). */
type Rows = number[];

function transform(rotY: number, scale: Vec, move: Vec): Rows {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  // R_y times diag(scale), then the move.
  return [
    c * scale[0],
    0,
    s * scale[2],
    move[0],
    0,
    scale[1],
    0,
    move[1],
    -s * scale[0],
    0,
    c * scale[2],
    move[2],
  ];
}

function invert(m: Rows): Rows {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = m as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = [
    A,
    -(b * i - c * h),
    b * f - c * e,
    B,
    a * i - c * g,
    -(a * f - c * d),
    C,
    -(a * h - b * g),
    a * e - b * d,
  ].map((x) => x / det);
  const t = [0, 1, 2].map((k) => -(r[k * 3]! * tx + r[k * 3 + 1]! * ty + r[k * 3 + 2]! * tz));
  return [r[0]!, r[1]!, r[2]!, t[0]!, r[3]!, r[4]!, r[5]!, t[1]!, r[6]!, r[7]!, r[8]!, t[2]!];
}

const apply = (m: Rows, p: Vec, w: number): Vec =>
  [0, 1, 2].map(
    (k) => m[k * 4]! * p[0] + m[k * 4 + 1]! * p[1] + m[k * 4 + 2]! * p[2] + m[k * 4 + 3]! * w,
  ) as Vec;

/** The world box of an object box under `m`: its eight corners transformed. */
function worldBox(m: Rows, box: Bvh['box']): number[] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const p = apply(
      m,
      [c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z],
      1,
    );
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]);
      hi[k] = Math.max(hi[k]!, p[k]);
    }
  }
  return [...lo, ...hi];
}

interface Instance {
  mesh: number;
  matrix: Rows;
}

/**
 * The scene as the packer will lay it out (record 0001, "The GPU layout"): every BLAS one after
 * the other in one `nodes` array, then the TLAS at `tlasBase`. A BLAS keeps the relative indices
 * the builder gave it, and each instance carries the bases the walk adds.
 */
function packScene(meshes: TriangleSource[], instances: Instance[]) {
  const blases = meshes.map(buildBlas);
  const nodeBase: number[] = [];
  const primBase: number[] = [];
  let nodeCount = 0;
  let primCount = 0;
  for (const b of blases) {
    nodeBase.push(nodeCount);
    primBase.push(primCount);
    nodeCount += b.nodes.length / FLOATS;
    primCount += b.order.length;
  }
  // The triangles buffer, as the packer writes it: each BLAS's triangles in its leaf order.
  const triangles: [number, number][] = [];
  blases.forEach((b, k) => b.order.forEach((t) => triangles.push([k, t])));
  const boxes = instances.flatMap((inst) => worldBox(inst.matrix, blases[inst.mesh]!.box));
  const tlas = buildTlas(boxes);
  const nodes = new Float32Array((nodeCount + tlas.nodes.length / FLOATS) * FLOATS);
  blases.forEach((b, k) => nodes.set(b.nodes, nodeBase[k]! * FLOATS));
  nodes.set(tlas.nodes, nodeCount * FLOATS);
  return { blases, nodeBase, primBase, triangles, tlas, nodes, tlasBase: nodeCount, boxes };
}

describe('buildTlas', () => {
  const big = [sphere(1, 32, 16), randomMesh(500, 11)];
  // Coarser meshes for many instances, so testing every triangle stays fast.
  const small = [sphere(1, 8, 4), randomMesh(50, 12)];
  const three: Instance[] = [
    { mesh: 0, matrix: transform(0.3, [1, 1, 1], [-2.5, 0, 0]) },
    { mesh: 1, matrix: transform(-0.7, [1.5, 0.5, 1], [0, 0.5, 2]) },
    { mesh: 0, matrix: transform(1.1, [0.5, 2, 0.5], [2.5, 0, -0.5]) },
  ];
  const many: Instance[] = Array.from({ length: 40 }, (_, i) => ({
    mesh: i % 2,
    matrix: transform(
      i * 0.37,
      [0.3, 0.3 + (i % 3) * 0.1, 0.3],
      [((i * 7) % 10) - 5, ((i * 3) % 7) - 3, ((i * 5) % 9) - 4],
    ),
  }));

  for (const [name, meshes, instances] of [
    ['three instances', big, three],
    ['40 instances', small, many],
  ] as const) {
    it(`over ${name}: every instance in one leaf, every box around its instance`, () => {
      const scene = packScene(meshes, instances);
      checkTree(scene.tlas, Float64Array.from(scene.boxes));
      // Each instance's box holds every vertex of its mesh moved into the world.
      instances.forEach((inst, k) => {
        const m = meshes[inst.mesh]!;
        for (let v = 0; v < m.position.length / 3; v++) {
          const p = apply(
            inst.matrix,
            [m.position[v * 3]!, m.position[v * 3 + 1]!, m.position[v * 3 + 2]!],
            1,
          );
          const lo = scene.boxes.slice(k * 6, k * 6 + 3);
          const hi = scene.boxes.slice(k * 6 + 3, k * 6 + 6);
          expect(inside(lo, hi, [...p, ...p], 0)).toBe(true);
        }
      });
    });

    // Verifies: Design 0001.4
    it(`over ${name}: the two-level walk on the packed buffers finds the nearest triangle on 1,000 random rays`, () => {
      const scene = packScene(meshes, instances);
      const inverse = instances.map((inst) => invert(inst.matrix));
      const next = random(99);
      let hits = 0;
      for (let r = 0; r < 1000; r++) {
        // Toward a point in a random instance's box, so most rays meet something.
        const k = Math.floor(next() * instances.length);
        const box = scene.boxes.slice(k * 6, k * 6 + 6) as number[];
        const [o, d] = ray(next, 12, box.slice(0, 3) as Vec, box.slice(3) as Vec);
        // Through the packed buffers alone: the TLAS at tlasBase, each BLAS at its instance's bases.
        let best = MISS;
        walk(
          scene.nodes,
          scene.tlasBase,
          o,
          d,
          () => best.t,
          (s) => {
            const i = scene.tlas.order[s]!;
            const inst = instances[i]!;
            // The ray in the instance's space, its direction not normalised, so t stays the world's.
            const oo = apply(inverse[i]!, o, 1);
            const dd = apply(inverse[i]!, d, 0);
            walk(
              scene.nodes,
              scene.nodeBase[inst.mesh]!,
              oo,
              dd,
              () => best.t,
              (slot) => {
                const [mesh, t] = scene.triangles[scene.primBase[inst.mesh]! + slot]!;
                const m = meshes[mesh]!;
                const h = {
                  t: hitTriangle(oo, dd, vertex(m, t, 0), vertex(m, t, 1), vertex(m, t, 2)),
                  instance: i,
                  triangle: t,
                };
                if (h.t < Infinity && better(h, best)) best = h;
              },
            );
          },
        );
        // Every triangle of every instance, in the same instance space.
        let brute = MISS;
        instances.forEach((inst, i) => {
          brute = nearestInMesh(
            meshes[inst.mesh]!,
            apply(inverse[i]!, o, 1),
            apply(inverse[i]!, d, 0),
            i,
            brute,
          );
        });
        expect([best.instance, best.triangle, best.t]).toEqual([
          brute.instance,
          brute.triangle,
          brute.t,
        ]);
        if (brute.instance >= 0) hits++;
      }
      expect(hits).toBeGreaterThan(250);
    });
  }

  it('over three instances: the TLAS is one leaf of three', () => {
    const scene = packScene(big, three);
    expect(node(scene.tlas.nodes, 0)).toMatchObject({ a: 0, count: 3 });
  });
});

// --- The checks can fail --------------------------------------------------------------------

describe('the checks above can fail (record 0002, "The probes")', () => {
  const ball = sphere(1, 32, 16);
  const boxes = triangleBoxes(ball);

  it('checkTree refuses a leaf whose box is too small', () => {
    const bvh = buildBlas(ball);
    const nodes = bvh.nodes.slice();
    const leaf = Array.from({ length: nodes.length / FLOATS }, (_, i) => i).find(
      (i) => node(nodes, i).count > 0,
    )!;
    nodes[leaf * FLOATS + 4] = nodes[leaf * FLOATS]!;
    expect(() => checkTree({ ...bvh, nodes }, boxes)).toThrow(/does not hold/);
  });

  it('checkTree refuses a primitive in two leaves', () => {
    const bvh = buildBlas(ball);
    const order = bvh.order.slice();
    order[0] = order[1]!;
    expect(() => checkTree({ ...bvh, order }, boxes)).toThrow(/in two leaves/);
  });

  it('checkTree refuses a tree past depth 30', () => {
    const bvh = buildBlas(ball);
    // Inner nodes at 0, 2, ..., 60, each with a leaf of one triangle beside it: node 60 is at
    // depth 30, and its children 61 and 62 at depth 31.
    const deep = new Float32Array(63 * FLOATS);
    const words = new Uint32Array(deep.buffer);
    for (let i = 0; i < 63; i++) {
      deep.set([-1, -1, -1], i * FLOATS);
      deep.set([1, 1, 1], i * FLOATS + 4);
      const inner = i % 2 === 0 && i < 62;
      words[i * FLOATS + 3] = inner ? i + 1 : Math.floor(i / 2);
      words[i * FLOATS + 7] = inner ? 0 : 1;
    }
    expect(() => checkTree({ ...bvh, nodes: deep }, boxes)).toThrow('node 61 is at depth 31');
  });

  it('the ray comparison sees a tree with one box shrunk', () => {
    const bvh = buildBlas(ball);
    const nodes = bvh.nodes.slice();
    // The root's left child, made a point: half the sphere is lost to the walk.
    const left = node(nodes, 0).a;
    nodes.set([0, 0, 0], left * FLOATS);
    nodes.set([0, 0, 0], left * FLOATS + 4);
    expect(blasMismatches(ball, { ...bvh, nodes }, 1234, 1000)).toBeGreaterThan(100);
  });
});
