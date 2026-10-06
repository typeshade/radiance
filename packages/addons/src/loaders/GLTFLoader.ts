// === GLTFLoader: glTF 2.0 into the engine's classes ===
//
// `GLTFLoader` reads a `.gltf` file (JSON, with buffers in files or in data URIs) or a `.glb`
// file (the binary container) and builds what design record 0001 ("The host model") and record
// 0004 describe:
//
// - The node tree becomes `Object3D`s. A node's `translation`, `rotation` and `scale`, or its
//   `matrix`, become the object's `position`, `rotation` and `scale`. The engine keeps a rotation
//   as an `Euler`, so the loader turns a quaternion or a matrix into one. A `matrix` that has a
//   shear has no `Euler` form. The loader keeps its rotation and scale and drops the shear.
// - A mesh primitive becomes a `Mesh` with a `BufferGeometry` (`position`, `normal`, `uv`,
//   `index`) and a `PhysicalMaterial`. A mesh of one primitive makes its node a `Mesh`. A mesh of
//   several primitives makes the node an `Object3D` with one `Mesh` child for each primitive. Two
//   nodes that use one mesh share its geometries and its materials, so the path tracer builds
//   one BLAS and draws two instances of it.
// - The geometry is triangles with a `Uint32Array` index. A primitive with no `indices` is
//   indexed 0, 1, 2 and so on. A strip and a fan become triangle lists. A primitive with no
//   `NORMAL` gets flat normals, as glTF 2.0 requires: each triangle gets its own three vertices
//   and the unit normal of its face (a triangle of no area gets +z). `TEXCOORD_0` is stored as
//   the file has it, with v pointing down (record 0001, "The host model"). The texture upload
//   of record 0004 (M3) sets the orientation. Colours and other attributes are not read.
// - The material is `pbrMetallicRoughness`'s `baseColorFactor` (its alpha is dropped),
//   `metallicFactor` and `roughnessFactor`, with `emissiveFactor`, `KHR_materials_emissive_strength`
//   and `doubleSided`. A primitive with no material gets glTF's default material: white, metallic
//   1, rough 1. A glTF material used by several primitives is one `PhysicalMaterial`.
//
// What the loader does with each feature it does not support:
//
// - Textures and samplers: ignored with no error. The material keeps its factors. Record 0004's
//   texture plan (M3) reads them. `alphaMode` is ignored with them.
// - Skins, animations and morph targets: skipped. The mesh draws in its rest pose. M2a reads
//   them.
// - A primitive whose mode is `POINTS`, `LINES`, `LINE_LOOP` or `LINE_STRIP`: skipped.
// - Cameras, `KHR_lights_punctual` and any extension the file only lists in `extensionsUsed`:
//   ignored.
// - A sparse accessor: an error. The loader cannot draw the geometry without it.
// - An extension in `extensionsRequired` that the loader does not know: an error. The loader
//   knows `KHR_materials_emissive_strength`, `KHR_mesh_quantization` and `KHR_texture_transform`
//   (it ignores textures). Draco and meshopt compression are errors, as the others are.
//
// Each skip adds one sentence to `warnings` of the result, so a caller can show it. Every error
// is an `Error` whose message starts with `GLTFLoader:` and names the field of the file that is
// wrong.

import { BufferGeometry, Color, Mesh, Object3D, PhysicalMaterial } from '@typeshade/radiance';

/** What `GLTFLoader` gives back. */
export interface GLTF {
  /** The scene the file names as its default, else its first one, else an empty `Object3D`. */
  scene: Object3D;
  /** Every scene of the file, in order. Each one is an `Object3D` that holds the scene's roots. */
  scenes: Object3D[];
  /** The file's `asset` record. */
  asset: { version: string; generator?: string; copyright?: string };
  /** One sentence for each feature of the file that the loader skipped or ignored. */
  warnings: string[];
}

/** What a progress callback of `load` receives. `total` is 0 when the server gives no length. */
export interface GLTFProgress {
  loaded: number;
  total: number;
}

// --- The file's shape -----------------------------------------------------------------------

interface Document {
  asset?: { version?: string; generator?: string; copyright?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  scene?: number;
  scenes?: { name?: string; nodes?: number[] }[];
  nodes?: Node[];
  meshes?: { name?: string; primitives?: Primitive[] }[];
  materials?: GltfMaterial[];
  accessors?: Accessor[];
  bufferViews?: BufferView[];
  buffers?: { uri?: string; byteLength: number }[];
  skins?: unknown[];
  animations?: unknown[];
  cameras?: unknown[];
}

interface Node {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  camera?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface Primitive {
  attributes?: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  targets?: unknown[];
}

interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    metallicFactor?: number;
    roughnessFactor?: number;
    baseColorTexture?: unknown;
    metallicRoughnessTexture?: unknown;
  };
  emissiveFactor?: number[];
  doubleSided?: boolean;
  normalTexture?: unknown;
  occlusionTexture?: unknown;
  emissiveTexture?: unknown;
  extensions?: { KHR_materials_emissive_strength?: { emissiveStrength?: number } };
}

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  normalized?: boolean;
  count?: number;
  type?: string;
  sparse?: unknown;
}

interface BufferView {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
  extensions?: Record<string, unknown>;
}

const SUPPORTED_EXTENSIONS = new Set([
  'KHR_materials_emissive_strength',
  'KHR_mesh_quantization',
  'KHR_texture_transform',
]);

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const FLOAT = 5126;

const MODE_TRIANGLES = 4;
const MODE_STRIP = 5;
const MODE_FAN = 6;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;

const fail = (message: string): never => {
  throw new Error(`GLTFLoader: ${message}`);
};

/** The element `index` of `list`, or an error that names `what` and the number of `label`s. */
function ref<T>(list: T[] | undefined, index: unknown, what: string, label: string): T {
  const count = list?.length ?? 0;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count) {
    return fail(`${what} is ${String(index)}, and the file has ${count} ${label}`);
  }
  return list![index]!;
}

// --- Bytes ----------------------------------------------------------------------------------

const toBytes = (data: ArrayBuffer | ArrayBufferView): Uint8Array =>
  data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

/** The directory part of `url`, with its last `/`, and nothing when `url` has none. */
function directoryOf(url: string): string {
  const clean = url.split(/[?#]/)[0]!;
  return clean.slice(0, clean.lastIndexOf('/') + 1);
}

/** `uri` as the file names it, made absolute against the `base` directory. */
function resolve(base: string, uri: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('/') || base === '') return uri;
  return base.endsWith('/') ? base + uri : `${base}/${uri}`;
}

function decodeDataUri(uri: string, what: string): Uint8Array {
  const comma = uri.indexOf(',');
  if (comma < 0) return fail(`${what} is a data URI with no comma`);
  const head = uri.slice(5, comma);
  const body = uri.slice(comma + 1);
  if (!/;base64$/i.test(head)) return fail(`${what} is a data URI that is not base64`);
  const text = atob(body);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

async function fetchBytes(
  url: string,
  onProgress?: (event: GLTFProgress) => void,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) return fail(`${url} answered ${response.status} ${response.statusText}`);
  if (response.body === null || onProgress === undefined) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ loaded, total });
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The JSON text and the binary chunk of a `.glb`. */
function splitGlb(bytes: Uint8Array): { json: string; bin: Uint8Array | undefined } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20) return fail('the .glb is shorter than its header and first chunk');
  if (view.getUint32(4, true) !== 2) {
    return fail(`the .glb is container version ${view.getUint32(4, true)}, and only 2 is read`);
  }
  const length = view.getUint32(8, true);
  if (length > bytes.length) {
    return fail(`the .glb header says ${length} bytes, and the file has ${bytes.length}`);
  }
  let json: string | undefined;
  let bin: Uint8Array | undefined;
  for (let at = 12; at + 8 <= length;) {
    const size = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + size > length) return fail(`a chunk of the .glb runs past the end of the file`);
    if (type === GLB_JSON && json === undefined) {
      json = new TextDecoder().decode(bytes.subarray(start, start + size));
    } else if (type === GLB_BIN && bin === undefined) {
      bin = bytes.subarray(start, start + size);
    }
    at = start + size;
  }
  if (json === undefined) return fail('the .glb has no JSON chunk');
  return { json, bin };
}

// --- The conversion -------------------------------------------------------------------------

/** What one parse carries from step to step. */
interface Context {
  readonly doc: Document;
  readonly buffers: Uint8Array[];
  readonly warnings: Set<string>;
  readonly geometries: Map<string, BufferGeometry | undefined>;
  readonly materials: Map<number, PhysicalMaterial>;
  defaultMaterial: PhysicalMaterial | undefined;
}

/** Where an accessor's elements are, in the file's bytes. */
interface Located {
  readonly count: number;
  readonly size: number;
  readonly componentType: number;
  readonly normalized: boolean;
  readonly stride: number;
  /** The first byte, in `bytes`. -1 when the accessor has no buffer view: all its values are 0. */
  readonly start: number;
  readonly bytes: Uint8Array;
}

function locate(ctx: Context, index: unknown, what: string, type: string): Located {
  const a = ref(ctx.doc.accessors, index, what, 'accessors');
  const here = `${what} (accessors[${String(index)}])`;
  if (a.sparse !== undefined) return fail(`${here} is sparse, and sparse accessors are not read`);
  const size = COMPONENTS[a.type ?? ''];
  if (size === undefined) return fail(`${here} has the type ${String(a.type)}`);
  if (a.type !== type) return fail(`${here} has the type ${a.type}, and ${what} needs ${type}`);
  const componentType = a.componentType ?? 0;
  const width = BYTES[componentType];
  if (width === undefined) return fail(`${here} has the component type ${componentType}`);
  const count = a.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    return fail(`${here} has the count ${String(count)}`);
  }
  if (a.bufferView === undefined) {
    return {
      count,
      size,
      componentType,
      normalized: false,
      stride: 0,
      start: -1,
      bytes: new Uint8Array(0),
    };
  }
  const view = ref(ctx.doc.bufferViews, a.bufferView, `${here} bufferView`, 'bufferViews');
  if (view.extensions !== undefined && Object.keys(view.extensions).length > 0) {
    return fail(`the bufferView of ${here} uses the extension ${Object.keys(view.extensions)[0]}`);
  }
  const bytes = ctx.buffers[view.buffer ?? -1];
  if (bytes === undefined) return fail(`the bufferView of ${here} names no buffer`);
  const element = size * width;
  const stride = view.byteStride ?? element;
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const end = count === 0 ? start : start + stride * (count - 1) + element;
  if (
    stride < element ||
    end > bytes.length ||
    (view.byteOffset ?? 0) + (view.byteLength ?? 0) > bytes.length
  ) {
    return fail(`${here} reads bytes ${start} to ${end}, and its buffer has ${bytes.length}`);
  }
  return {
    count,
    size,
    componentType,
    normalized: a.normalized === true,
    stride,
    start,
    bytes,
  };
}

/** The numbers of an accessor, as floats. A normalized integer is mapped to [-1, 1] or [0, 1]. */
function readFloats(ctx: Context, index: unknown, what: string, type: string): Float32Array {
  const at = locate(ctx, index, what, type);
  const out = new Float32Array(at.count * at.size);
  if (at.start < 0 || out.length === 0) return out;
  const width = BYTES[at.componentType]!;
  // The fast path: floats packed with no gap, on a 4-byte boundary, in a little-endian host.
  if (
    at.componentType === FLOAT &&
    at.stride === at.size * width &&
    (at.bytes.byteOffset + at.start) % 4 === 0
  ) {
    out.set(new Float32Array(at.bytes.buffer, at.bytes.byteOffset + at.start, out.length));
    return out;
  }
  const view = new DataView(at.bytes.buffer, at.bytes.byteOffset, at.bytes.byteLength);
  for (let i = 0; i < at.count; i++) {
    for (let c = 0; c < at.size; c++) {
      const o = at.start + i * at.stride + c * width;
      let v: number;
      switch (at.componentType) {
        case 5120:
          v = view.getInt8(o);
          if (at.normalized) v = Math.max(v / 127, -1);
          break;
        case 5121:
          v = view.getUint8(o);
          if (at.normalized) v /= 255;
          break;
        case 5122:
          v = view.getInt16(o, true);
          if (at.normalized) v = Math.max(v / 32767, -1);
          break;
        case 5123:
          v = view.getUint16(o, true);
          if (at.normalized) v /= 65535;
          break;
        case 5125:
          v = view.getUint32(o, true);
          if (at.normalized) v /= 4294967295;
          break;
        default:
          v = view.getFloat32(o, true);
      }
      out[i * at.size + c] = v;
    }
  }
  return out;
}

/** The indices of an accessor of unsigned bytes, shorts or ints. */
function readIndices(ctx: Context, index: unknown, what: string): Uint32Array {
  const at = locate(ctx, index, what, 'SCALAR');
  if (at.componentType !== 5121 && at.componentType !== 5123 && at.componentType !== 5125) {
    return fail(`${what} has the component type ${at.componentType}, not an unsigned integer`);
  }
  const out = new Uint32Array(at.count);
  if (at.start < 0) return out;
  const width = BYTES[at.componentType]!;
  const view = new DataView(at.bytes.buffer, at.bytes.byteOffset, at.bytes.byteLength);
  for (let i = 0; i < at.count; i++) {
    const o = at.start + i * at.stride;
    out[i] =
      width === 1
        ? view.getUint8(o)
        : width === 2
          ? view.getUint16(o, true)
          : view.getUint32(o, true);
  }
  return out;
}

/** The triangle list that `mode` and the primitive's indices name. */
function triangles(list: Uint32Array, mode: number, what: string): Uint32Array {
  if (mode === MODE_TRIANGLES) {
    if (list.length % 3 !== 0) {
      return fail(`${what} has ${list.length} indices, which is not a multiple of 3`);
    }
    return list;
  }
  // A strip or a fan of n indices is n - 2 triangles.
  const count = Math.max(0, list.length - 2);
  const out = new Uint32Array(count * 3);
  for (let i = 0; i < count; i++) {
    if (mode === MODE_STRIP) {
      // Every second triangle is turned over, so that all of them face the same way.
      out[i * 3] = list[i % 2 === 0 ? i : i + 1]!;
      out[i * 3 + 1] = list[i % 2 === 0 ? i + 1 : i]!;
      out[i * 3 + 2] = list[i + 2]!;
    } else if (mode === MODE_FAN) {
      out[i * 3] = list[0]!;
      out[i * 3 + 1] = list[i + 1]!;
      out[i * 3 + 2] = list[i + 2]!;
    }
  }
  return out;
}

/** Scales each xyz of `normal` to unit length. A vector of length 0 stays as it is. */
function normalise(normal: Float32Array): void {
  for (let i = 0; i + 2 < normal.length; i += 3) {
    const length = Math.hypot(normal[i]!, normal[i + 1]!, normal[i + 2]!);
    if (length > 0 && length !== 1) {
      normal[i] = normal[i]! / length + 0;
      normal[i + 1] = normal[i + 1]! / length + 0;
      normal[i + 2] = normal[i + 2]! / length + 0;
    }
  }
}

/** Gives each triangle its own three vertices and the unit normal of its face. */
function flatShaded(
  position: Float32Array,
  uv: Float32Array | undefined,
  index: Uint32Array,
): {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array | undefined;
  index: Uint32Array;
} {
  const n = index.length;
  const p = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const t = uv === undefined ? undefined : new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const v = index[k]!;
    p.set(position.subarray(v * 3, v * 3 + 3), k * 3);
    if (t !== undefined) t.set(uv!.subarray(v * 2, v * 2 + 2), k * 2);
  }
  for (let k = 0; k + 2 < n; k += 3) {
    const o = k * 3;
    const ax = p[o + 3]! - p[o]!;
    const ay = p[o + 4]! - p[o + 1]!;
    const az = p[o + 5]! - p[o + 2]!;
    const bx = p[o + 6]! - p[o]!;
    const by = p[o + 7]! - p[o + 1]!;
    const bz = p[o + 8]! - p[o + 2]!;
    let x = ay * bz - az * by;
    let y = az * bx - ax * bz;
    let z = ax * by - ay * bx;
    const length = Math.hypot(x, y, z);
    if (length > 0) {
      // Adding 0 turns a -0 into 0, so a normal never carries a negative zero.
      x = x / length + 0;
      y = y / length + 0;
      z = z / length + 0;
    } else {
      x = 0;
      y = 0;
      z = 1;
    }
    for (let j = 0; j < 3; j++) normal.set([x, y, z], o + j * 3);
  }
  const flat = new Uint32Array(n);
  for (let k = 0; k < n; k++) flat[k] = k;
  return { position: p, normal, uv: t, index: flat };
}

/** The geometry of one primitive, or undefined when the loader skips the primitive. */
function buildGeometry(ctx: Context, prim: Primitive, where: string): BufferGeometry | undefined {
  const mode = prim.mode ?? MODE_TRIANGLES;
  if (mode < 0 || mode > 6 || !Number.isInteger(mode)) return fail(`${where}.mode is ${mode}`);
  if (mode < MODE_TRIANGLES) {
    ctx.warnings.add('A primitive of points or lines is skipped: the path tracer draws triangles.');
    return undefined;
  }
  if (prim.targets !== undefined && prim.targets.length > 0) {
    ctx.warnings.add('Morph targets are skipped: a mesh draws in its rest pose.');
  }
  const attributes = prim.attributes ?? {};
  if (attributes.POSITION === undefined) return fail(`${where}.attributes has no POSITION`);
  const position = readFloats(ctx, attributes.POSITION, `${where}.attributes.POSITION`, 'VEC3');
  const vertices = position.length / 3;
  const normal =
    attributes.NORMAL === undefined
      ? undefined
      : readFloats(ctx, attributes.NORMAL, `${where}.attributes.NORMAL`, 'VEC3');
  const uv =
    attributes.TEXCOORD_0 === undefined
      ? undefined
      : readFloats(ctx, attributes.TEXCOORD_0, `${where}.attributes.TEXCOORD_0`, 'VEC2');
  if (normal !== undefined && normal.length !== position.length) {
    return fail(
      `${where}.attributes.NORMAL has ${normal.length / 3} entries, POSITION ${vertices}`,
    );
  }
  if (uv !== undefined && uv.length / 2 !== vertices) {
    return fail(
      `${where}.attributes.TEXCOORD_0 has ${uv.length / 2} entries, POSITION ${vertices}`,
    );
  }
  let list: Uint32Array;
  if (prim.indices === undefined) {
    list = new Uint32Array(vertices);
    for (let i = 0; i < vertices; i++) list[i] = i;
  } else {
    list = readIndices(ctx, prim.indices, `${where}.indices`);
  }
  for (const v of list) {
    if (v >= vertices)
      return fail(`${where}.indices names vertex ${v}, and the primitive has ${vertices}`);
  }
  const index = triangles(list, mode, `${where}.indices`);

  const geometry = new BufferGeometry();
  if (normal === undefined) {
    const flat = flatShaded(position, uv, index);
    geometry.position = flat.position;
    geometry.normal = flat.normal;
    if (flat.uv !== undefined) geometry.uv = flat.uv;
    geometry.index = flat.index;
  } else {
    normalise(normal);
    geometry.position = position;
    geometry.normal = normal;
    if (uv !== undefined) geometry.uv = uv;
    geometry.index = index;
  }
  return geometry;
}

function colour(values: number[] | undefined, fallback: number[], what: string): Color {
  const v = values ?? fallback;
  if (!Array.isArray(v) || v.length < 3 || !v.every((x) => typeof x === 'number')) {
    return fail(`${what} is not an array of numbers`);
  }
  return new Color(v[0], v[1], v[2]);
}

function buildMaterial(ctx: Context, index: number | undefined, where: string): PhysicalMaterial {
  if (index === undefined) {
    // glTF's default material: every property at its default.
    ctx.defaultMaterial ??= new PhysicalMaterial({
      color: new Color(1, 1, 1),
      metalness: 1,
      roughness: 1,
    });
    return ctx.defaultMaterial;
  }
  const known = ctx.materials.get(index);
  if (known !== undefined) return known;
  const m = ref(ctx.doc.materials, index, `${where}.material`, 'materials');
  const pbr = m.pbrMetallicRoughness ?? {};
  const textured = [
    pbr.baseColorTexture,
    pbr.metallicRoughnessTexture,
    m.normalTexture,
    m.occlusionTexture,
    m.emissiveTexture,
  ].some((t) => t !== undefined);
  if (textured) ctx.warnings.add('Textures are ignored: a material keeps its factors.');
  const material = new PhysicalMaterial({
    color: colour(pbr.baseColorFactor, [1, 1, 1], `materials[${index}] baseColorFactor`),
    metalness: pbr.metallicFactor ?? 1,
    roughness: pbr.roughnessFactor ?? 1,
    emissive: colour(m.emissiveFactor, [0, 0, 0], `materials[${index}] emissiveFactor`),
    emissiveIntensity: m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
  });
  material.name = m.name ?? '';
  material.doubleSided = m.doubleSided === true;
  ctx.materials.set(index, material);
  return material;
}

// --- Transforms -----------------------------------------------------------------------------

/**
 * Sets `object`'s rotation to the Euler angles of the matrix with rows `r`, the engine's order
 * (`R = Rz * Ry * Rx`, as `Matrix4.compose` builds it).
 */
function setRotation(
  object: Object3D,
  r00: number,
  r10: number,
  r20: number,
  r11: number,
  r12: number,
  r21: number,
  r22: number,
): void {
  // cos(y) is never below 0, so atan2 gives y without the loss that asin has near +-1.
  const cy = Math.hypot(r00, r10);
  const y = Math.atan2(-r20, cy);
  if (cy > 1e-7) {
    object.rotation.set(Math.atan2(r21, r22), y, Math.atan2(r10, r00));
  } else {
    // Looking along the y axis: x and z turn about one line, so z is 0 and x takes both.
    object.rotation.set(Math.atan2(-r12, r11), y, 0);
  }
}

function transform(node: Node, object: Object3D, where: string): void {
  const numbers = (v: number[] | undefined, length: number, name: string): number[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length !== length || !v.every((x) => typeof x === 'number')) {
      return fail(`${where}.${name} is not an array of ${length} numbers`);
    }
    return v;
  };
  const matrix = numbers(node.matrix, 16, 'matrix');
  if (matrix !== undefined) {
    // Column-major: the columns of the upper 3 x 3 are the axes, and their lengths the scale.
    const e = matrix;
    let sx = Math.hypot(e[0]!, e[1]!, e[2]!);
    const sy = Math.hypot(e[4]!, e[5]!, e[6]!);
    const sz = Math.hypot(e[8]!, e[9]!, e[10]!);
    const det =
      e[0]! * (e[5]! * e[10]! - e[6]! * e[9]!) -
      e[4]! * (e[1]! * e[10]! - e[2]! * e[9]!) +
      e[8]! * (e[1]! * e[6]! - e[2]! * e[5]!);
    // A matrix that turns the handedness has a scale of one axis below 0.
    if (det < 0) sx = -sx;
    object.position.set(e[12]!, e[13]!, e[14]!);
    object.scale.set(sx, sy, sz);
    const kx = sx || 1;
    const ky = sy || 1;
    const kz = sz || 1;
    setRotation(
      object,
      e[0]! / kx,
      e[1]! / kx,
      e[2]! / kx,
      e[5]! / ky,
      e[9]! / kz,
      e[6]! / ky,
      e[10]! / kz,
    );
    return;
  }
  const t = numbers(node.translation, 3, 'translation');
  if (t !== undefined) object.position.set(t[0]!, t[1]!, t[2]!);
  const s = numbers(node.scale, 3, 'scale');
  if (s !== undefined) object.scale.set(s[0]!, s[1]!, s[2]!);
  const q = numbers(node.rotation, 4, 'rotation');
  if (q !== undefined) {
    const length = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1;
    const x = q[0]! / length;
    const y = q[1]! / length;
    const z = q[2]! / length;
    const w = q[3]! / length;
    setRotation(
      object,
      1 - 2 * (y * y + z * z),
      2 * (x * y + z * w),
      2 * (x * z - y * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z - x * w),
      2 * (y * z + x * w),
      1 - 2 * (x * x + y * y),
    );
  }
}

// --- The tree -------------------------------------------------------------------------------

function geometryOf(ctx: Context, meshIndex: number, primIndex: number, prim: Primitive) {
  const key = `${meshIndex}:${primIndex}`;
  if (!ctx.geometries.has(key)) {
    ctx.geometries.set(
      key,
      buildGeometry(ctx, prim, `meshes[${meshIndex}].primitives[${primIndex}]`),
    );
  }
  return ctx.geometries.get(key);
}

function buildNode(ctx: Context, index: number, above: Set<number>): Object3D {
  const node = ref(ctx.doc.nodes, index, 'a node index', 'nodes');
  const where = `nodes[${index}]`;
  if (above.has(index)) return fail(`${where} is its own ancestor`);

  if (node.skin !== undefined) {
    ctx.warnings.add('Skins are skipped: a skinned mesh draws in its rest pose.');
  }
  if (node.camera !== undefined) ctx.warnings.add('Cameras are ignored.');

  // The primitives of the node's mesh, with the geometry and the material of each.
  const parts: { geometry: BufferGeometry; material: PhysicalMaterial }[] = [];
  let meshName = '';
  if (node.mesh !== undefined) {
    const mesh = ref(ctx.doc.meshes, node.mesh, `${where}.mesh`, 'meshes');
    meshName = mesh.name ?? '';
    (mesh.primitives ?? []).forEach((prim, i) => {
      const geometry = geometryOf(ctx, node.mesh!, i, prim);
      if (geometry === undefined) return;
      parts.push({
        geometry,
        material: buildMaterial(ctx, prim.material, `meshes[${node.mesh}].primitives[${i}]`),
      });
    });
  }

  let object: Object3D;
  if (parts.length === 1) {
    object = new Mesh(parts[0]!.geometry, parts[0]!.material);
  } else {
    object = new Object3D();
    parts.forEach((part, i) => {
      const child = new Mesh(part.geometry, part.material);
      child.name = meshName === '' ? '' : `${meshName}_${i}`;
      object.add(child);
    });
  }
  object.name = node.name ?? (parts.length === 1 ? meshName : '');
  transform(node, object, where);

  above.add(index);
  for (const child of node.children ?? []) object.add(buildNode(ctx, child, above));
  above.delete(index);
  return object;
}

/** Throws when a node has two parents: a glTF node tree is a tree. */
function checkTree(doc: Document): void {
  const parents = new Map<number, number>();
  (doc.nodes ?? []).forEach((node, i) => {
    for (const child of node.children ?? []) {
      ref(doc.nodes, child, `nodes[${i}].children`, 'nodes');
      const other = parents.get(child);
      if (other !== undefined) {
        fail(`nodes[${child}] is a child of nodes[${other}] and of nodes[${i}]`);
      }
      parents.set(child, i);
    }
  });
}

async function convert(doc: Document, bin: Uint8Array | undefined, base: string): Promise<GLTF> {
  const version = doc.asset?.version;
  if (typeof version !== 'string' || !version.startsWith('2.')) {
    return fail(`asset.version is ${JSON.stringify(version)}, and only glTF 2.x is read`);
  }
  for (const name of doc.extensionsRequired ?? []) {
    if (!SUPPORTED_EXTENSIONS.has(name)) {
      return fail(`the file requires the extension ${name}, which the loader does not support`);
    }
  }
  checkTree(doc);

  const buffers = await Promise.all(
    (doc.buffers ?? []).map(async (buffer, i) => {
      let bytes: Uint8Array;
      if (buffer.uri === undefined) {
        if (i !== 0 || bin === undefined) {
          return fail(`buffers[${i}] has no uri, and the file has no binary chunk for it`);
        }
        bytes = bin;
      } else if (buffer.uri.startsWith('data:')) {
        bytes = decodeDataUri(buffer.uri, `buffers[${i}].uri`);
      } else {
        bytes = await fetchBytes(resolve(base, buffer.uri));
      }
      if (typeof buffer.byteLength !== 'number' || bytes.length < buffer.byteLength) {
        return fail(
          `buffers[${i}] says ${buffer.byteLength} bytes, and its data has ${bytes.length}`,
        );
      }
      return bytes.subarray(0, buffer.byteLength);
    }),
  );

  const ctx: Context = {
    doc,
    buffers,
    warnings: new Set(),
    geometries: new Map(),
    materials: new Map(),
    defaultMaterial: undefined,
  };
  if ((doc.animations ?? []).length > 0) {
    ctx.warnings.add('Animations are skipped: every node keeps its rest transform.');
  }

  const scenes = (doc.scenes ?? []).map((s) => {
    const root = new Object3D();
    root.name = s.name ?? '';
    for (const n of s.nodes ?? []) root.add(buildNode(ctx, n, new Set()));
    return root;
  });
  let scene: Object3D;
  if (scenes.length === 0) {
    scene = new Object3D();
  } else {
    const wanted = doc.scene ?? 0;
    scene = ref(scenes, wanted, 'scene', 'scenes');
  }
  const asset: GLTF['asset'] = { version };
  if (doc.asset?.generator !== undefined) asset.generator = doc.asset.generator;
  if (doc.asset?.copyright !== undefined) asset.copyright = doc.asset.copyright;
  return { scene, scenes, asset, warnings: [...ctx.warnings] };
}

/**
 * Reads glTF 2.0 files into the engine's classes, with the methods of three.js's `GLTFLoader`
 * that a page needs: `load`, `loadAsync`, `parse` and `parseAsync`.
 *
 * The node tree becomes `Object3D`s. Each mesh primitive becomes a `Mesh` with a
 * `BufferGeometry` and a `PhysicalMaterial` made from the factors of `pbrMetallicRoughness`.
 * Textures, skins, animations and morph targets are skipped, and each skip is a sentence in the
 * result's `warnings`. A sparse accessor, a compressed buffer and an extension the file requires
 * and the loader does not know are errors.
 *
 * ```ts
 * const gltf = await new GLTFLoader().loadAsync('/assets/bunny.glb');
 * scene.add(gltf.scene);
 * ```
 */
export class GLTFLoader {
  /**
   * Fetches `url` and parses it. Calls `onLoad` with the result, or `onError` with the error (the
   * error goes to the console when there is no `onError`). `onProgress` gets the bytes loaded
   * while the file comes in.
   */
  load(
    url: string,
    onLoad: (gltf: GLTF) => void,
    onProgress?: (event: GLTFProgress) => void,
    onError?: (error: unknown) => void,
  ): void {
    this.loadAsync(url, onProgress).then(onLoad, onError ?? ((e) => console.error(e)));
  }

  /** Fetches `url` and parses it. Rejects with an `Error` that starts with `GLTFLoader:`. */
  async loadAsync(url: string, onProgress?: (event: GLTFProgress) => void): Promise<GLTF> {
    return this.parseAsync(await fetchBytes(url, onProgress), directoryOf(url));
  }

  /**
   * Parses `data`: the text of a `.gltf`, the bytes of a `.gltf` or the bytes of a `.glb`. `path`
   * is the directory that the file's relative buffer URIs are read from, with or without its last
   * `/`. Calls `onLoad` or `onError`, as `load` does.
   */
  parse(
    data: ArrayBuffer | ArrayBufferView | string,
    path: string,
    onLoad: (gltf: GLTF) => void,
    onError?: (error: unknown) => void,
  ): void {
    this.parseAsync(data, path).then(onLoad, onError ?? ((e) => console.error(e)));
  }

  /** Parses `data` as `parse` does and resolves to the result. */
  async parseAsync(data: ArrayBuffer | ArrayBufferView | string, path = ''): Promise<GLTF> {
    let text: string;
    let bin: Uint8Array | undefined;
    if (typeof data === 'string') {
      text = data;
    } else {
      const bytes = toBytes(data);
      const magic =
        bytes.length >= 4
          ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
          : 0;
      if (magic === GLB_MAGIC) {
        ({ json: text, bin } = splitGlb(bytes));
      } else {
        text = new TextDecoder().decode(bytes);
      }
    }
    let doc: Document;
    try {
      doc = JSON.parse(text) as Document;
    } catch (e) {
      return fail(`the file is not JSON or a .glb (${e instanceof Error ? e.message : String(e)})`);
    }
    if (doc === null || typeof doc !== 'object') return fail('the JSON is not an object');
    return convert(doc, bin, path);
  }
}
