// === The BVH builder (design record 0001, "The build") ===
//
// One builder makes both levels of the scene's hierarchy: a BLAS over the triangles of one
// geometry, and the TLAS over the boxes of the instances. It is a binned surface area heuristic:
// 16 bins on the longest axis of the node's centroid box, the split with the least cost, a leaf
// when the node holds at most 4 primitives or no split beats the leaf's cost, and a leaf at
// depth 30 whatever the heuristic says, so a stack of 32 entries holds any walk of the tree.
//
// The output is in the kernel's layout (record 0001, "The GPU layout"), whose numbers come from
// `kernels/layout.shade.ts` alone. A node is NODE_STRIDE vec4s: `[0] = (min, bits(a))` and
// `[1] = (max, bits(b))`, with `b = count | axis << 30`. An inner node has a count of 0, its left
// child at `a` and its right child at `a + 1`. A leaf's primitives are `order[a]` to
// `order[a + count - 1]`. Every index is relative to the tree: the root is node 0 and the first
// leaf's primitives start at 0, so the tree moves in a buffer without a rewrite. The children of
// a node are written as a pair after it, depth first, so every child follows its parent.
//
// A box is stored in f32 rounded outward, so it holds its primitives whatever precision they
// came in.

import { Box3 } from '../math/Box3.ts';
import { Vector3 } from '../math/Vector3.ts';
import { NODE_AXIS_SHIFT, NODE_COUNT_MASK, NODE_STRIDE } from '../kernels/layout.shade.ts';

/** The bins of the heuristic, on the longest axis of a node's centroid box. */
export const BVH_BINS = 16;
/** A node of at most this many primitives is a leaf. */
export const BVH_LEAF_SIZE = 4;
/** The depth (the root is at 0) at which a node is a leaf, whatever the heuristic says. */
export const BVH_MAX_DEPTH = 30;
/** The heuristic's cost of one step of the walk, against a primitive test's cost of 1. */
const TRAVERSAL_COST = 1;

/** The triangles a BLAS is built over: `BufferGeometry`'s `position` and `index`. */
export interface TriangleSource {
  /** xyz per vertex. */
  readonly position: Float32Array;
  /** Three vertex indices per triangle. */
  readonly index: Uint32Array;
}

/** A tree in the kernel's layout. */
export interface Bvh {
  /** NODE_STRIDE vec4s per node, the root first, every index relative to the tree. */
  readonly nodes: Float32Array;
  /** The primitives' indices in leaf order. The packer writes the primitives in this order. */
  readonly order: Uint32Array;
  /** The root's box. */
  readonly box: Box3;
}

/** The BLAS over a triangle list. Each triangle is one primitive. */
export function buildBlas(mesh: TriangleSource): Bvh {
  const { position, index } = mesh;
  if (position.length % 3 !== 0) {
    throw new RangeError(`the position array holds ${position.length} numbers, not xyz per vertex`);
  }
  if (index.length % 3 !== 0) {
    throw new RangeError(`the index array holds ${index.length} indices, not three per triangle`);
  }
  const vertices = position.length / 3;
  const count = index.length / 3;
  const boxes = new Float64Array(count * 6);
  for (let t = 0; t < count; t++) {
    let lx = Infinity,
      ly = Infinity,
      lz = Infinity;
    let hx = -Infinity,
      hy = -Infinity,
      hz = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k]!;
      if (v >= vertices) {
        throw new RangeError(`triangle ${t} names vertex ${v}, and the geometry has ${vertices}`);
      }
      const x = position[v * 3]!,
        y = position[v * 3 + 1]!,
        z = position[v * 3 + 2]!;
      lx = Math.min(lx, x);
      ly = Math.min(ly, y);
      lz = Math.min(lz, z);
      hx = Math.max(hx, x);
      hy = Math.max(hy, y);
      hz = Math.max(hz, z);
    }
    boxes.set([lx, ly, lz, hx, hy, hz], t * 6);
  }
  return build(boxes);
}

/**
 * The TLAS over the instances' world-space boxes, six numbers per instance: min xyz, then max
 * xyz. Each instance is one primitive, so a leaf's `a` is its first instance in `order`.
 */
export function buildTlas(boxes: ArrayLike<number>): Bvh {
  if (boxes.length % 6 !== 0) {
    throw new RangeError(`the box array holds ${boxes.length} numbers, not six per instance`);
  }
  return build(Float64Array.from(boxes));
}

/** The tree over `boxes`, six numbers per primitive. */
function build(boxes: Float64Array): Bvh {
  const count = boxes.length / 6;
  if (count === 0) throw new RangeError('a BVH needs at least one primitive');
  if (count > NODE_COUNT_MASK) {
    throw new RangeError(`a BVH holds at most ${NODE_COUNT_MASK} primitives, and got ${count}`);
  }
  const centroids = new Float64Array(count * 3);
  for (let p = 0; p < count; p++) {
    for (let k = 0; k < 3; k++) {
      centroids[p * 3 + k] = (boxes[p * 6 + k]! + boxes[p * 6 + 3 + k]!) * 0.5;
    }
  }
  const order = new Uint32Array(count);
  for (let p = 0; p < count; p++) order[p] = p;

  // A tree of n leaves has 2n - 1 nodes, and a leaf holds at least one primitive.
  const floats = NODE_STRIDE * 4;
  const nodes = new Float32Array((2 * count - 1) * floats);
  const words = new Uint32Array(nodes.buffer);
  let used = 1;

  const binCount = new Uint32Array(BVH_BINS);
  const binBox = new Float64Array(BVH_BINS * 6);
  const leftArea = new Float64Array(BVH_BINS);
  const leftCount = new Uint32Array(BVH_BINS);
  const box = new Float64Array(6);
  const acc = new Float64Array(6);
  const EMPTY = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

  const write = (node: number, a: number, b: number): void => {
    const at = node * floats;
    nodes[at] = outward(box[0]!, false);
    nodes[at + 1] = outward(box[1]!, false);
    nodes[at + 2] = outward(box[2]!, false);
    words[at + 3] = a;
    nodes[at + 4] = outward(box[3]!, true);
    nodes[at + 5] = outward(box[4]!, true);
    nodes[at + 6] = outward(box[5]!, true);
    words[at + 7] = b;
  };

  const split = (node: number, start: number, end: number, depth: number): void => {
    // The node's box and its centroids' box.
    box.set(EMPTY);
    let cl0 = Infinity,
      cl1 = Infinity,
      cl2 = Infinity;
    let ch0 = -Infinity,
      ch1 = -Infinity,
      ch2 = -Infinity;
    for (let i = start; i < end; i++) {
      const p = order[i]!;
      growAt(box, 0, boxes, p * 6);
      const c0 = centroids[p * 3]!,
        c1 = centroids[p * 3 + 1]!,
        c2 = centroids[p * 3 + 2]!;
      cl0 = Math.min(cl0, c0);
      cl1 = Math.min(cl1, c1);
      cl2 = Math.min(cl2, c2);
      ch0 = Math.max(ch0, c0);
      ch1 = Math.max(ch1, c1);
      ch2 = Math.max(ch2, c2);
    }
    const n = end - start;
    const leaf = (): void => write(node, start, n);
    if (n <= BVH_LEAF_SIZE || depth >= BVH_MAX_DEPTH) return leaf();

    // The longest axis of the centroids' box. All centroids at one point: no split separates them.
    const e0 = ch0 - cl0,
      e1 = ch1 - cl1,
      e2 = ch2 - cl2;
    const axis = e0 >= e1 && e0 >= e2 ? 0 : e1 >= e2 ? 1 : 2;
    const lo = axis === 0 ? cl0 : axis === 1 ? cl1 : cl2;
    const extent = axis === 0 ? e0 : axis === 1 ? e1 : e2;
    if (!(extent > 0)) return leaf();
    const scale = BVH_BINS / extent;
    const binOf = (p: number): number =>
      Math.min(BVH_BINS - 1, Math.floor((centroids[p * 3 + axis]! - lo) * scale));

    // Bin the primitives.
    binCount.fill(0);
    for (let k = 0; k < BVH_BINS; k++) {
      binBox.set(EMPTY, k * 6);
    }
    for (let i = start; i < end; i++) {
      const p = order[i]!;
      const k = binOf(p);
      binCount[k] = binCount[k]! + 1;
      growAt(binBox, k * 6, boxes, p * 6);
    }

    // Sweep from the left, then from the right, for the cost of a split after each bin. The cost
    // is TRAVERSAL_COST + (area(L) n(L) + area(R) n(R)) / area(node), and a leaf's is n.
    acc.set(EMPTY);
    let seen = 0;
    for (let k = 0; k < BVH_BINS - 1; k++) {
      growAt(acc, 0, binBox, k * 6);
      seen += binCount[k]!;
      leftCount[k] = seen;
      leftArea[k] = area(acc);
    }
    acc.set(EMPTY);
    seen = 0;
    const parentArea = area(box);
    let best = -1;
    let bestCost = Infinity;
    for (let k = BVH_BINS - 1; k > 0; k--) {
      growAt(acc, 0, binBox, k * 6);
      seen += binCount[k]!;
      const left = leftCount[k - 1]!;
      if (left === 0 || seen === 0) continue;
      const cost = TRAVERSAL_COST + (leftArea[k - 1]! * left + area(acc) * seen) / parentArea;
      if (cost < bestCost) {
        bestCost = cost;
        best = k - 1;
      }
    }
    if (best < 0 || !(bestCost < n)) return leaf();

    // Partition in place: the bins up to `best` to the left, the others to the right.
    let i = start;
    let j = end - 1;
    while (i <= j) {
      if (binOf(order[i]!) <= best) i++;
      else {
        const t = order[i]!;
        order[i] = order[j]!;
        order[j] = t;
        j--;
      }
    }
    const left = used;
    used += 2;
    write(node, left, (axis << NODE_AXIS_SHIFT) >>> 0);
    split(left, start, i, depth + 1);
    split(left + 1, i, end, depth + 1);
  };

  split(0, 0, count, 0);
  const out = nodes.slice(0, used * floats);
  return {
    nodes: out,
    order,
    box: new Box3(new Vector3(out[0]!, out[1]!, out[2]!), new Vector3(out[4]!, out[5]!, out[6]!)),
  };
}

/** The box (min xyz, max xyz) at `dst[to]` grown to hold the box at `src[at]`. */
function growAt(dst: Float64Array, to: number, src: Float64Array, at: number): void {
  for (let k = 0; k < 3; k++) {
    dst[to + k] = Math.min(dst[to + k]!, src[at + k]!);
    dst[to + 3 + k] = Math.max(dst[to + 3 + k]!, src[at + 3 + k]!);
  }
}

/** Half the surface area of a box (min xyz, max xyz). 0 for an empty box. */
function area(b: Float64Array): number {
  const x = b[3]! - b[0]!,
    y = b[4]! - b[1]!,
    z = b[5]! - b[2]!;
  if (!(x >= 0 && y >= 0 && z >= 0)) return 0;
  return x * y + y * z + z * x;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** `x` as an f32, rounded up when `up` and down when not, so a box stays around what it holds. */
function outward(x: number, up: boolean): number {
  const f = Math.fround(x);
  if (up ? f >= x : f <= x) return f;
  if (f === 0) return up ? 2 ** -149 : -(2 ** -149);
  f32[0] = f;
  u32[0] = u32[0]! + (f > 0 === up ? 1 : -1);
  return f32[0]!;
}
