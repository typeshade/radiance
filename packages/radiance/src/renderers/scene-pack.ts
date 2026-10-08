// === The scene as the kernel reads it (design record 0001, "Change tracking and upload") ===
//
// One `ScenePack` per renderer holds the scene in the layout of record 0001: six storage buffers
// (the seventh, `accum`, is the renderer's) and the trace's uniform block. Each buffer is one
// typed array and one `Resident`, and `update(scene)` rewrites a buffer only when what it holds
// changed:
//
//   1. Each visible mesh's geometry has a BLAS, rebuilt when the geometry's `version` moved or
//      the geometry is new. Then `nodes`, `triangles` and `vertices` are written again whole.
//   2. Each material has a record (record 0004), packed again when its words changed. Then
//      `materials` is written whole.
//   3. The instance array is built again from `scene.traverseVisible` and compared with the last
//      frame's. When it differs, the TLAS is built again over the instances' world boxes and
//      appended to `nodes`, and `instances`, `nodes` and `lights` are written.
//
// Indices inside a BLAS are relative to it: a child to the BLAS's first node, a leaf's first
// triangle to its `primBase`, a triangle's vertices to its `vertexBase`. The packer writes each
// BLAS's triangles in its leaves' order, and the instances in the TLAS's leaves' order, so a TLAS
// leaf's slot is the index into `instances` (record 0001, Amendment 1).
//
// The light table lists every triangle of every instance whose material emits. A light's chance
// is its share of the scene's emitted power: its area in world space times the mean of its
// emitted colour. `cdf` is that chance added up, the last light's exactly 1.
//
// The numbers of the layout come from the kernel's modules (`kernels/layout.shade.ts` and
// `kernels/materials.shade.ts`): the host keeps no copy of a stride or a word's offset.

import { resident, type Resident } from 'typeshade/runtime';
import { buildBlas, buildTlas } from '../accel/bvh.ts';
import type { Camera } from '../cameras/Camera.ts';
import { PerspectiveCamera } from '../cameras/PerspectiveCamera.ts';
import { BufferGeometry } from '../geometries/BufferGeometry.ts';
import {
  INSTANCE_BASES,
  INSTANCE_FLAGS,
  INSTANCE_INVERSE,
  INSTANCE_MATRIX,
  INSTANCE_STRIDE,
  LIGHT_STRIDE,
  LIGHT_TRIANGLE,
  MATERIAL_STRIDE,
  NODE_STRIDE,
  TRIANGLE_STRIDE,
  VERTEX_STRIDE,
} from '../kernels/layout.shade.ts';
import {
  MATERIAL_BASE,
  MATERIAL_DOUBLE_SIDED,
  MATERIAL_EMISSIVE,
  MATERIAL_EMISSIVE_MAP,
  MATERIAL_EMITS,
  MATERIAL_FLAT_SHADING,
  MATERIAL_MAPS,
  MATERIAL_PARAMS,
  MATERIAL_TYPE_MASK,
  TEXTURE_NONE,
} from '../kernels/materials.shade.ts';
import type { Material } from '../materials/Material.ts';
import { PhysicalMaterial } from '../materials/PhysicalMaterial.ts';
import { Vector3 } from '../math/Vector3.ts';
import { Mesh } from '../objects/Mesh.ts';
import type { Scene } from '../scenes/Scene.ts';
import { checkStorageBinding, DEFAULT_LIMITS, type Limits } from './limits.ts';

/** The storage buffers a pack holds, in the order of record 0001's table. */
export const SCENE_BUFFERS = [
  'nodes',
  'triangles',
  'vertices',
  'instances',
  'materials',
  'lights',
] as const;
export type SceneBuffer = (typeof SCENE_BUFFERS)[number];

/** The typed array of each buffer. Each holds at least one element: WebGPU binds no empty
 *  buffer. The counts say how many are real. */
export interface SceneArrays {
  readonly nodes: Float32Array;
  readonly triangles: Uint32Array;
  readonly vertices: Float32Array;
  readonly instances: Float32Array;
  readonly materials: Float32Array;
  readonly lights: Float32Array;
}

/** How many of each the buffers hold. */
export interface SceneCounts {
  /** The TLAS's first node: the count of every BLAS's nodes. */
  readonly tlasBase: number;
  readonly nodes: number;
  readonly triangles: number;
  readonly vertices: number;
  readonly instances: number;
  readonly materials: number;
  readonly lights: number;
}

/** The camera's frame as the kernel reads it: four vec4 and the lens. */
export interface CameraFrame {
  readonly eye: readonly number[];
  readonly right: readonly number[];
  readonly up: readonly number[];
  readonly forward: readonly number[];
  readonly lens: readonly number[];
}

/** The trace's uniform block (`TraceParams` in kernels/layout.shade.ts), as the runtime packs it. */
export interface TraceParamsValue extends CameraFrame {
  readonly frame: readonly number[];
  readonly tile: readonly number[];
  readonly scene: readonly number[];
  readonly path: readonly number[];
}

/** The floats of one vec4. */
const VEC4 = 4;
/** The floats of one element of each buffer. */
const WIDTH: { readonly [K in SceneBuffer]: number } = {
  nodes: NODE_STRIDE * VEC4,
  triangles: TRIANGLE_STRIDE * VEC4,
  vertices: VERTEX_STRIDE * VEC4,
  instances: INSTANCE_STRIDE * VEC4,
  materials: MATERIAL_STRIDE * VEC4,
  lights: LIGHT_STRIDE * VEC4,
};

/** One geometry's BLAS and its packed arrays. */
interface Blas {
  readonly version: number;
  /** The order in which the pack first saw the geometry: the instance's `geometryId`. */
  readonly id: number;
  readonly nodes: Float32Array;
  /** TRIANGLE_STRIDE vec4u per triangle, in the leaves' order. */
  readonly triangles: Uint32Array;
  /** VERTEX_STRIDE vec4 per vertex. */
  readonly vertices: Float32Array;
  /** The root's box: min xyz, max xyz. */
  readonly box: readonly number[];
  nodeBase: number;
  primBase: number;
  vertexBase: number;
}

/** One material's record and its slot in `materials`. */
interface MaterialEntry {
  version: number;
  readonly index: number;
  readonly words: Float32Array;
}

/** One visible mesh, placed. */
interface Placed {
  readonly blas: Blas;
  readonly material: MaterialEntry;
  /** The world matrix, column-major. */
  readonly world: Float64Array;
}

const sameBits = (a: ArrayBufferView, b: ArrayBufferView): boolean => {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

/** A typed array of at least one element of `width` numbers: `n` elements, or one of zeros. */
function atLeastOne<T extends Float32Array | Uint32Array>(
  make: new (n: number) => T,
  n: number,
  width: number,
): T {
  return new make(Math.max(1, n) * width);
}

/** The inverse of the affine matrix `m` (column-major), or undefined when it has none. */
function inverseAffine(m: Float64Array): Float64Array | undefined {
  const [a, b, c] = [m[0]!, m[4]!, m[8]!];
  const [d, e, f] = [m[1]!, m[5]!, m[9]!];
  const [g, h, k] = [m[2]!, m[6]!, m[10]!];
  const A = e * k - f * h;
  const B = f * g - d * k;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det === 0 || !Number.isFinite(det)) return undefined;
  const r = 1 / det;
  // The rows of the 3x3 inverse.
  const i00 = A * r;
  const i01 = (c * h - b * k) * r;
  const i02 = (b * f - c * e) * r;
  const i10 = B * r;
  const i11 = (a * k - c * g) * r;
  const i12 = (c * d - a * f) * r;
  const i20 = C * r;
  const i21 = (b * g - a * h) * r;
  const i22 = (a * e - b * d) * r;
  const [tx, ty, tz] = [m[12]!, m[13]!, m[14]!];
  // prettier-ignore
  return Float64Array.of(
    i00, i10, i20, 0,
    i01, i11, i21, 0,
    i02, i12, i22, 0,
    -(i00 * tx + i01 * ty + i02 * tz), -(i10 * tx + i11 * ty + i12 * tz), -(i20 * tx + i21 * ty + i22 * tz), 1,
  );
}

/** The three rows of the affine matrix `m` (column-major), written at `out[at]` as three vec4. */
function writeRows(out: Float32Array, at: number, m: Float64Array): void {
  for (let r = 0; r < 3; r++) out.set([m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!], at + r * VEC4);
}

/** The world matrix `m` applied to the point `(x, y, z)`. */
function transformPoint(
  m: Float64Array,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

/** The camera's world frame and lens. Call `camera.updateMatrixWorld()` first. */
export function cameraFrame(camera: Camera): CameraFrame {
  const e = camera.matrixWorld.elements;
  const right = new Vector3(e[0], e[1], e[2]).normalize();
  const up = new Vector3(e[4], e[5], e[6]).normalize();
  const forward = new Vector3(-e[8]!, -e[9]!, -e[10]!).normalize();
  const fov = camera instanceof PerspectiveCamera ? camera.fov : 50;
  const aspect = camera instanceof PerspectiveCamera ? camera.aspect : 1;
  const tanY = Math.tan((fov * Math.PI) / 360);
  return {
    eye: [e[12]!, e[13]!, e[14]!, 0],
    right: [...right.toArray(), 0],
    up: [...up.toArray(), 0],
    forward: [...forward.toArray(), 0],
    lens: [tanY * aspect, tanY, 0, 0],
  };
}

/** Whether two camera frames are the same, number for number. */
export function sameCameraFrame(a: CameraFrame, b: CameraFrame): boolean {
  return (['eye', 'right', 'up', 'forward', 'lens'] as const).every(
    (k) => a[k].length === b[k].length && a[k].every((x, i) => x === b[k][i]),
  );
}

/**
 * Material `m`'s record (design record 0004, "The record"): 8 vec4. M2 fills [0] to [3], with
 * every texture id none, and leaves [4] to [7] zero with [7].x none. A material that is not a
 * `PhysicalMaterial` stores 0 for the physical parameters, which its type does not read.
 */
export function packMaterial(m: Material): Float32Array {
  const words = new Float32Array(MATERIAL_STRIDE * VEC4);
  const bits = new Uint32Array(words.buffer);
  const physical = m instanceof PhysicalMaterial ? m : undefined;
  const intensity = physical?.emissiveIntensity ?? 1;
  const emissive = [m.emissive.r * intensity, m.emissive.g * intensity, m.emissive.b * intensity];
  const emits = emissive.some((c) => c > 0);
  words.set([m.color.r, m.color.g, m.color.b, physical?.metalness ?? 0], MATERIAL_BASE * VEC4);
  words.set([...emissive, physical?.roughness ?? 0], MATERIAL_EMISSIVE * VEC4);
  words.set(
    [physical?.ior ?? 0, physical?.transmission ?? 0, physical?.specularIntensity ?? 0],
    MATERIAL_PARAMS * VEC4,
  );
  bits[MATERIAL_PARAMS * VEC4 + 3] =
    ((m.type & MATERIAL_TYPE_MASK) |
      (emits ? MATERIAL_EMITS : 0) |
      (m.doubleSided ? MATERIAL_DOUBLE_SIDED : 0) |
      (m.flatShading ? MATERIAL_FLAT_SHADING : 0)) >>>
    0;
  bits.fill(TEXTURE_NONE, MATERIAL_MAPS * VEC4, MATERIAL_MAPS * VEC4 + 4);
  bits[MATERIAL_EMISSIVE_MAP * VEC4] = TEXTURE_NONE;
  return words;
}

/** The scene in the kernel's buffers, kept up to date frame by frame. */
export class ScenePack {
  readonly #limits: Limits;
  readonly #geometries = new Map<BufferGeometry, Blas>();
  readonly #materials = new Map<Material, MaterialEntry>();
  #nextGeometry = 0;
  /** Every BLAS's nodes, concatenated: `nodes` without the TLAS. */
  #blasNodes = new Float32Array(0);
  /** The last frame's instance array, in the scene's order, to compare with. */
  #lastInstances = new Float32Array(0);
  #arrays: { -readonly [K in keyof SceneArrays]: SceneArrays[K] };
  #counts: SceneCounts = {
    tlasBase: 0,
    nodes: 0,
    triangles: 0,
    vertices: 0,
    instances: 0,
    materials: 0,
    lights: 0,
  };
  #residents: { [K in SceneBuffer]: Resident<SceneArrays[K]> } | undefined;

  constructor(limits: Limits = DEFAULT_LIMITS) {
    this.#limits = limits;
    this.#arrays = {
      nodes: atLeastOne(Float32Array, 0, WIDTH.nodes),
      triangles: atLeastOne(Uint32Array, 0, WIDTH.triangles),
      vertices: atLeastOne(Float32Array, 0, WIDTH.vertices),
      instances: atLeastOne(Float32Array, 0, WIDTH.instances),
      materials: atLeastOne(Float32Array, 0, WIDTH.materials),
      lights: atLeastOne(Float32Array, 0, WIDTH.lights),
    };
  }

  /** The buffers as they are after the last `update`. */
  get arrays(): SceneArrays {
    return this.#arrays;
  }

  /** How many of each the buffers hold. */
  get counts(): SceneCounts {
    return this.#counts;
  }

  /** One `Resident` per buffer, holding what `arrays` holds. Made at the first call, and written
   *  by every `update` that changes a buffer. */
  residents(): { readonly [K in SceneBuffer]: Resident<SceneArrays[K]> } {
    this.#residents ??= {
      nodes: resident(this.#arrays.nodes),
      triangles: resident(this.#arrays.triangles),
      vertices: resident(this.#arrays.vertices),
      instances: resident(this.#arrays.instances),
      materials: resident(this.#arrays.materials),
      lights: resident(this.#arrays.lights),
    };
    return this.#residents;
  }

  /**
   * Brings the buffers up to date with `scene`, whose matrices are updated (call
   * `scene.updateMatrixWorld()` first), and answers the names of the buffers it wrote. An
   * unchanged scene writes none.
   *
   * @throws `RangeError` when a buffer would be more than one storage binding covers, or a
   *   geometry's index names a vertex it does not have. The pack then forgets what it held, so the
   *   next update builds everything again.
   */
  update(scene: Scene): ReadonlySet<SceneBuffer> {
    try {
      return this.#update(scene);
    } catch (e) {
      this.#forget();
      throw e;
    }
  }

  /** The trace's uniform block for one dispatch, with this pack's counts. */
  params(o: {
    readonly camera: CameraFrame;
    /** The frame's width and height, the first sample's index, and the samples to take. */
    readonly frame: readonly [number, number, number, number];
    /** The tile's x0, y0, width and height. */
    readonly tile: readonly [number, number, number, number];
    readonly seed: number;
    readonly bounces: number;
    readonly rouletteFrom: number;
  }): TraceParamsValue {
    const c = this.#counts;
    return {
      eye: o.camera.eye,
      right: o.camera.right,
      up: o.camera.up,
      forward: o.camera.forward,
      lens: o.camera.lens,
      frame: o.frame,
      tile: o.tile,
      scene: [c.tlasBase, c.instances, c.lights, o.seed >>> 0],
      path: [o.bounces, o.rouletteFrom, 0, 0],
    };
  }

  /** Drops `geometry`'s BLAS. A geometry left out of the scene keeps it until then. */
  release(geometry: BufferGeometry): void {
    // The next update concatenates the geometries again and writes their three buffers.
    if (this.#geometries.delete(geometry)) this.#geometryMoved = true;
  }

  /** Frees the residents' device buffers. */
  dispose(): void {
    for (const r of Object.values(this.#residents ?? {})) r.destroy();
    this.#residents = undefined;
  }

  #forget(): void {
    this.#geometryMoved = true;
    this.#geometries.clear();
    this.#materials.clear();
    this.#lastInstances = new Float32Array(0);
  }

  #update(scene: Scene): ReadonlySet<SceneBuffer> {
    const written = new Set<SceneBuffer>();
    const meshes: Mesh[] = [];
    scene.traverseVisible((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });

    // 1. The geometries.
    let geometryChanged = this.#geometryMoved;
    this.#geometryMoved = false;
    for (const mesh of meshes) {
      const g = mesh.geometry;
      if (!(g instanceof BufferGeometry))
        throw new TypeError(`the path tracer draws a BufferGeometry, and a mesh holds a ${g.type}`);
      if (g.index.length === 0) {
        // A geometry emptied in place draws nothing: its old BLAS leaves the pack.
        if (this.#geometries.delete(g)) geometryChanged = true;
        continue;
      }
      if (g.normal === undefined) g.computeVertexNormals();
      const known = this.#geometries.get(g);
      if (known !== undefined && known.version === g.version) continue;
      this.#geometries.set(g, this.#blasOf(g, known?.id ?? this.#nextGeometry++));
      geometryChanged = true;
    }
    if (geometryChanged) {
      this.#concatenateGeometry();
      written.add('triangles').add('vertices').add('nodes');
    }

    // 2. The materials.
    let materialsChanged = false;
    for (const mesh of meshes) {
      const m = mesh.material;
      const words = packMaterial(m);
      const known = this.#materials.get(m);
      if (known === undefined) {
        this.#materials.set(m, { version: m.version, index: this.#materials.size, words });
        materialsChanged = true;
      } else if (known.version !== m.version || !sameBits(known.words, words)) {
        known.version = m.version;
        known.words.set(words);
        materialsChanged = true;
      }
    }
    if (materialsChanged) {
      const materials = atLeastOne(Float32Array, this.#materials.size, WIDTH.materials);
      for (const e of this.#materials.values()) materials.set(e.words, e.index * WIDTH.materials);
      this.#arrays.materials = materials;
      written.add('materials');
    }

    // 3. The instances, the TLAS and the lights.
    const placed: Placed[] = [];
    for (const mesh of meshes) {
      const blas = this.#geometries.get(mesh.geometry as BufferGeometry);
      if (blas === undefined) continue;
      placed.push({
        blas,
        material: this.#materials.get(mesh.material)!,
        world: mesh.matrixWorld.elements,
      });
    }
    const list = this.#instanceList(placed);
    const instancesChanged = !sameBits(list.words, this.#lastInstances);
    if (instancesChanged || geometryChanged) {
      this.#lastInstances = list.words;
      const kept = list.kept.map((i) => placed[i]!);
      const order = this.#placeInstances(list.words, kept, list.boxes);
      const instances = this.#arrays.instances;
      const lights = this.#arrays.lights;
      this.#arrays.instances = order.instances;
      this.#arrays.nodes = order.nodes;
      this.#arrays.lights = this.#lightTable(kept, order.slots);
      written.add('nodes');
      if (instancesChanged || !sameBits(instances, this.#arrays.instances))
        written.add('instances');
      if (instancesChanged || !sameBits(lights, this.#arrays.lights)) written.add('lights');
      this.#counts = { ...this.#counts, instances: kept.length, tlasBase: order.tlasBase };
    } else if (materialsChanged) {
      // A material that starts or stops emitting, or changes its colour, moves the light table.
      const lights = this.#arrays.lights;
      const kept = this.#lastPlaced;
      this.#arrays.lights = this.#lightTable(kept, this.#lastSlots);
      if (!sameBits(lights, this.#arrays.lights)) written.add('lights');
    }
    this.#counts = {
      ...this.#counts,
      nodes: this.#arrays.nodes.length / WIDTH.nodes,
      materials: this.#materials.size,
      lights: this.#lightCount,
    };

    // The limits, before any buffer reaches the device.
    for (const name of SCENE_BUFFERS)
      checkStorageBinding(name, this.#arrays[name].byteLength, this.#limits);
    if (this.#residents !== undefined)
      for (const name of written) this.#residents[name].write(this.#arrays[name] as never);
    return written;
  }

  /** Set when a geometry left the pack, so the next update writes the geometry buffers. */
  #geometryMoved = false;
  #lastPlaced: Placed[] = [];
  #lastSlots: number[] = [];
  #lightCount = 0;

  /** `g`'s BLAS and its packed triangles and vertices. */
  #blasOf(g: BufferGeometry, id: number): Blas {
    const bvh = buildBlas(g);
    const count = g.index.length / 3;
    const triangles = new Uint32Array(count * WIDTH.triangles);
    for (let s = 0; s < count; s++) {
      const t = bvh.order[s]!;
      triangles.set(g.index.subarray(t * 3, t * 3 + 3), s * WIDTH.triangles);
    }
    const n = g.position.length / 3;
    const vertices = new Float32Array(n * WIDTH.vertices);
    const normal = g.normal!;
    const uv = g.uv;
    for (let v = 0; v < n; v++) {
      const at = v * WIDTH.vertices;
      vertices.set(g.position.subarray(v * 3, v * 3 + 3), at);
      vertices.set(normal.subarray(v * 3, v * 3 + 3), at + VEC4);
      if (uv !== undefined) {
        vertices[at + 3] = uv[v * 2]!;
        vertices[at + VEC4 + 3] = uv[v * 2 + 1]!;
      }
    }
    return {
      version: g.version,
      id,
      nodes: bvh.nodes,
      triangles,
      vertices,
      box: [...bvh.box.min.toArray(), ...bvh.box.max.toArray()],
      nodeBase: 0,
      primBase: 0,
      vertexBase: 0,
    };
  }

  /** Every BLAS's nodes, triangles and vertices, concatenated, and each BLAS's bases. */
  #concatenateGeometry(): void {
    let nodes = 0;
    let prims = 0;
    let verts = 0;
    for (const b of this.#geometries.values()) {
      b.nodeBase = nodes;
      b.primBase = prims;
      b.vertexBase = verts;
      nodes += b.nodes.length / WIDTH.nodes;
      prims += b.triangles.length / WIDTH.triangles;
      verts += b.vertices.length / WIDTH.vertices;
    }
    const blasNodes = new Float32Array(nodes * WIDTH.nodes);
    const triangles = atLeastOne(Uint32Array, prims, WIDTH.triangles);
    const vertices = atLeastOne(Float32Array, verts, WIDTH.vertices);
    for (const b of this.#geometries.values()) {
      blasNodes.set(b.nodes, b.nodeBase * WIDTH.nodes);
      triangles.set(b.triangles, b.primBase * WIDTH.triangles);
      vertices.set(b.vertices, b.vertexBase * WIDTH.vertices);
    }
    this.#blasNodes = blasNodes;
    this.#arrays.triangles = triangles;
    this.#arrays.vertices = vertices;
    this.#counts = { ...this.#counts, triangles: prims, vertices: verts, tlasBase: nodes };
  }

  /**
   * The instance array in the scene's order, one INSTANCE_STRIDE record per placed mesh whose
   * matrix has an inverse, with each one's world box. `kept` lists the placed meshes it holds.
   */
  #instanceList(placed: readonly Placed[]): {
    words: Float32Array;
    boxes: Float64Array;
    kept: number[];
  } {
    const kept: number[] = [];
    const inverses: Float64Array[] = [];
    placed.forEach((p, i) => {
      const inverse = inverseAffine(p.world);
      if (inverse === undefined) return;
      kept.push(i);
      inverses.push(inverse);
    });
    const words = new Float32Array(kept.length * WIDTH.instances);
    const bits = new Uint32Array(words.buffer);
    const boxes = new Float64Array(kept.length * 6);
    kept.forEach((index, i) => {
      const p = placed[index]!;
      const at = i * WIDTH.instances;
      writeRows(words, at + INSTANCE_MATRIX * VEC4, p.world);
      writeRows(words, at + INSTANCE_INVERSE * VEC4, inverses[i]!);
      bits.set(
        [p.blas.nodeBase, p.blas.primBase, p.blas.vertexBase, p.material.index],
        at + INSTANCE_BASES * VEC4,
      );
      bits.set([0, p.blas.id, 0, 0], at + INSTANCE_FLAGS * VEC4);
      // The world box: the BLAS's box with its eight corners moved.
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let c = 0; c < 8; c++) {
        const q = transformPoint(
          p.world,
          p.blas.box[c & 1 ? 3 : 0]!,
          p.blas.box[c & 2 ? 4 : 1]!,
          p.blas.box[c & 4 ? 5 : 2]!,
        );
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, q[k]!);
          hi[k] = Math.max(hi[k]!, q[k]!);
        }
      }
      boxes.set([...lo, ...hi], i * 6);
    });
    return { words, boxes, kept };
  }

  /** The TLAS over the instances' boxes, `nodes` with it appended, and the instances in its
   *  leaves' order. `slots[i]` is the slot of the scene's i-th kept instance. */
  #placeInstances(
    words: Float32Array,
    kept: readonly Placed[],
    boxes: Float64Array,
  ): { nodes: Float32Array; instances: Float32Array; tlasBase: number; slots: number[] } {
    const tlasBase = this.#blasNodes.length / WIDTH.nodes;
    const slots: number[] = [];
    let nodes: Float32Array;
    let instances: Float32Array;
    if (kept.length === 0) {
      nodes = atLeastOne(Float32Array, tlasBase, WIDTH.nodes);
      nodes.set(this.#blasNodes);
      instances = atLeastOne(Float32Array, 0, WIDTH.instances);
    } else {
      const tlas = buildTlas(boxes);
      nodes = new Float32Array(this.#blasNodes.length + tlas.nodes.length);
      nodes.set(this.#blasNodes);
      nodes.set(tlas.nodes, this.#blasNodes.length);
      instances = new Float32Array(kept.length * WIDTH.instances);
      for (let s = 0; s < kept.length; s++) {
        const i = tlas.order[s]!;
        slots[i] = s;
        instances.set(
          words.subarray(i * WIDTH.instances, (i + 1) * WIDTH.instances),
          s * WIDTH.instances,
        );
      }
    }
    this.#lastPlaced = [...kept];
    this.#lastSlots = slots;
    return { nodes, instances, tlasBase, slots };
  }

  /** The light table over the instances whose material emits, by slot, each triangle's chance
   *  its share of the emitted power. */
  #lightTable(kept: readonly Placed[], slots: readonly number[]): Float32Array {
    const rows: { slot: number; triangle: number; power: number }[] = [];
    kept.forEach((p, i) => {
      const words = p.material.words;
      const e = words.subarray(MATERIAL_EMISSIVE * VEC4, MATERIAL_EMISSIVE * VEC4 + 3);
      const mean = (e[0]! + e[1]! + e[2]!) / 3;
      if (!(mean > 0)) return;
      const tris = p.blas.triangles;
      const verts = p.blas.vertices;
      const corner = (s: number, k: number): [number, number, number] => {
        const v = tris[s * WIDTH.triangles + k]! * WIDTH.vertices;
        return transformPoint(p.world, verts[v]!, verts[v + 1]!, verts[v + 2]!);
      };
      for (let s = 0; s < tris.length / WIDTH.triangles; s++) {
        const [a, b, c] = [corner(s, 0), corner(s, 1), corner(s, 2)];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const area =
          Math.hypot(
            u[1]! * v[2]! - u[2]! * v[1]!,
            u[2]! * v[0]! - u[0]! * v[2]!,
            u[0]! * v[1]! - u[1]! * v[0]!,
          ) / 2;
        if (area > 0)
          rows.push({ slot: slots[i]!, triangle: p.blas.primBase + s, power: area * mean });
      }
    });
    // By slot, then by triangle, so the table does not depend on the scene's order.
    rows.sort((x, y) => x.slot - y.slot || x.triangle - y.triangle);
    const total = rows.reduce((sum, r) => sum + r.power, 0);
    const out = atLeastOne(Float32Array, rows.length, WIDTH.lights);
    const bits = new Uint32Array(out.buffer);
    let sum = 0;
    rows.forEach((r, i) => {
      sum += r.power;
      const at = i * WIDTH.lights;
      bits.set([LIGHT_TRIANGLE, r.slot, r.triangle], at);
      out[at + 3] = i === rows.length - 1 ? 1 : Math.min(1, sum / total);
    });
    this.#lightCount = rows.length;
    return out;
  }
}
