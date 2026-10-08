// The glTF loader, held to small files built by hand: a triangle as a .gltf with a data URI and
// as a .glb, a node tree with each form of transform, the primitives the loader reshapes
// (unindexed, no normal, strip, fan), the features it skips, and the files it refuses. The two
// files with an external buffer are served by a local HTTP server, so `load` runs its fetch.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { BufferGeometry, Mesh, Object3D, PhysicalMaterial } from '@typeshade/radiance';
import { GLTFLoader } from './GLTFLoader.ts';

// --- Fixtures -------------------------------------------------------------------------------

/** Typed arrays laid end to end, each on a 4-byte boundary, as a glTF buffer holds them. */
class Bin {
  readonly parts: Uint8Array[] = [];
  length = 0;
  /** Adds `data`. Answers its byte offset. */
  add(data: ArrayBufferView): number {
    const at = this.length;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.parts.push(bytes);
    this.length += Math.ceil(bytes.length / 4) * 4;
    this.parts.push(new Uint8Array(Math.ceil(bytes.length / 4) * 4 - bytes.length));
    return at;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

const FLOAT = 5126;
const USHORT = 5123;
const UBYTE = 5121;
const SHORT = 5122;
const BYTE = 5120;

type Json = Record<string, unknown>;

/** A `.glb`: the JSON, then the binary chunk, each padded to 4 bytes. */
function glb(json: Json, bin?: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = bin === undefined ? 0 : Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + jsonLength + (bin === undefined ? 0 : 8 + binLength);
  const out = new Uint8Array(total).fill(0x20);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  if (bin !== undefined) {
    const at = 20 + jsonLength;
    out.fill(0, at);
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, 0x004e4942, true);
    out.set(bin, at + 8);
  }
  return out.buffer as ArrayBuffer;
}

const dataUri = (bin: Uint8Array): string =>
  `data:application/octet-stream;base64,${Buffer.from(bin).toString('base64')}`;

/** One triangle with a normal and a uv at each vertex, an index of unsigned shorts and a material. */
function triangle(): { json: Json; bin: Uint8Array } {
  const bin = new Bin();
  const position = bin.add(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0));
  const normal = bin.add(Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1));
  const uv = bin.add(Float32Array.of(0, 0, 1, 0, 0, 1));
  const index = bin.add(Uint16Array.of(0, 1, 2));
  const bytes = bin.bytes();
  return {
    bin: bytes,
    json: {
      asset: { version: '2.0', generator: 'GLTFLoader.test.ts' },
      scene: 0,
      scenes: [{ name: 'main', nodes: [0] }],
      nodes: [{ name: 'tri', mesh: 0 }],
      meshes: [
        {
          name: 'Triangle',
          primitives: [
            { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
          ],
        },
      ],
      materials: [
        {
          name: 'orange',
          doubleSided: true,
          pbrMetallicRoughness: {
            baseColorFactor: [0.8, 0.4, 0.1, 0.5],
            metallicFactor: 0.25,
            roughnessFactor: 0.75,
          },
          emissiveFactor: [0.1, 0.2, 0.3],
        },
      ],
      accessors: [
        { bufferView: 0, byteOffset: position, componentType: FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 0, byteOffset: normal, componentType: FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 0, byteOffset: uv, componentType: FLOAT, count: 3, type: 'VEC2' },
        { bufferView: 0, byteOffset: index, componentType: USHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bytes.length }],
      buffers: [{ byteLength: bytes.length }],
    },
  };
}

/** A file of one mesh node with one primitive over the given vertices and indices. */
function onePrimitive(
  positions: number[],
  primitive: Json,
  indices?: { data: Uint16Array | Uint32Array | Uint8Array; componentType: number },
): Json {
  const bin = new Bin();
  const position = bin.add(Float32Array.from(positions));
  const index = indices === undefined ? 0 : bin.add(indices.data);
  const bytes = bin.bytes();
  const accessors: Json[] = [
    {
      bufferView: 0,
      byteOffset: position,
      componentType: FLOAT,
      count: positions.length / 3,
      type: 'VEC3',
    },
  ];
  const attributes = { POSITION: 0 };
  const prim: Json = { attributes, ...primitive };
  if (indices !== undefined) {
    accessors.push({
      bufferView: 0,
      byteOffset: index,
      componentType: indices.componentType,
      count: indices.data.length,
      type: 'SCALAR',
    });
    prim.indices = 1;
  }
  return {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [prim] }],
    accessors,
    bufferViews: [{ buffer: 0, byteLength: bytes.length }],
    buffers: [{ byteLength: bytes.length, uri: dataUri(bytes) }],
  };
}

const load = (json: Json | string) =>
  new GLTFLoader().parseAsync(typeof json === 'string' ? json : JSON.stringify(json));

const mesh = (o: Object3D): Mesh<BufferGeometry, PhysicalMaterial> => {
  expect(o).toBeInstanceOf(Mesh);
  return o as Mesh<BufferGeometry, PhysicalMaterial>;
};

/** The error a load rejects with. */
async function failure(json: Json | string | ArrayBuffer): Promise<string> {
  try {
    await new GLTFLoader().parseAsync(
      json instanceof ArrayBuffer || typeof json === 'string' ? json : JSON.stringify(json),
    );
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return '';
}

// --- A triangle -----------------------------------------------------------------------------

describe('a triangle', () => {
  // Verifies: Design 0001.3
  it('becomes a mesh with its position, normal, uv and index from a .gltf with a data URI', async () => {
    const { json, bin } = triangle();
    (json.buffers as Json[])[0]!.uri = dataUri(bin);
    const gltf = await load(json);
    expect(gltf.warnings).toEqual([]);
    expect(gltf.asset).toEqual({ version: '2.0', generator: 'GLTFLoader.test.ts' });
    expect(gltf.scenes).toHaveLength(1);
    expect(gltf.scene).toBe(gltf.scenes[0]!);
    expect(gltf.scene.name).toBe('main');
    expect(gltf.scene.children).toHaveLength(1);

    const tri = mesh(gltf.scene.children[0]!);
    expect(tri.name).toBe('tri');
    expect(tri.geometry).toBeInstanceOf(BufferGeometry);
    expect([...tri.geometry.position]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect([...tri.geometry.normal!]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect([...tri.geometry.uv!]).toEqual([0, 0, 1, 0, 0, 1]);
    expect(tri.geometry.index).toBeInstanceOf(Uint32Array);
    expect([...tri.geometry.index]).toEqual([0, 1, 2]);
  });

  it('becomes a PhysicalMaterial of the factors of pbrMetallicRoughness', async () => {
    const { json, bin } = triangle();
    (json.buffers as Json[])[0]!.uri = dataUri(bin);
    const { material } = mesh((await load(json)).scene.children[0]!);
    expect(material).toBeInstanceOf(PhysicalMaterial);
    expect(material.name).toBe('orange');
    expect(material.color.toArray().map((c) => Math.fround(c))).toEqual(
      [0.8, 0.4, 0.1].map((c) => Math.fround(c)),
    );
    expect(material.metalness).toBe(0.25);
    expect(material.roughness).toBe(0.75);
    expect(material.emissive.toArray().map((c) => Math.fround(c))).toEqual(
      [0.1, 0.2, 0.3].map((c) => Math.fround(c)),
    );
    expect(material.emissiveIntensity).toBe(1);
    expect(material.doubleSided).toBe(true);
  });

  // Verifies: Design 0004.10
  it('makes a material whose flatShading is false, and keeps the normals of the file', async () => {
    const { json, bin } = triangle();
    (json.buffers as Json[])[0]!.uri = dataUri(bin);
    const tri = mesh((await load(json)).scene.children[0]!);
    expect(tri.material.flatShading).toBe(false);
    expect([...tri.geometry.normal!]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it('is the same from a .glb whose buffer is the binary chunk', async () => {
    const { json, bin } = triangle();
    const gltf = await new GLTFLoader().parseAsync(glb(json, bin));
    const tri = mesh(gltf.scene.children[0]!);
    expect([...tri.geometry.position]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect([...tri.geometry.index]).toEqual([0, 1, 2]);
    expect(tri.material.metalness).toBe(0.25);
  });

  it('is read from bytes, from a typed array and from text', async () => {
    const { json, bin } = triangle();
    (json.buffers as Json[])[0]!.uri = dataUri(bin);
    const text = JSON.stringify(json);
    const bytes = new TextEncoder().encode(text);
    for (const data of [text, bytes.buffer as ArrayBuffer, bytes]) {
      const gltf = await new GLTFLoader().parseAsync(data);
      expect(mesh(gltf.scene.children[0]!).geometry.index).toHaveLength(3);
    }
  });

  it('calls onLoad of parse, and onError for a file it refuses', async () => {
    const { json, bin } = triangle();
    const loaded = await new Promise<number>((resolve, reject) => {
      new GLTFLoader().parse(glb(json, bin), '', (g) => resolve(g.scene.children.length), reject);
    });
    expect(loaded).toBe(1);
    const error = await new Promise<unknown>((resolve) => {
      new GLTFLoader().parse('{', '', () => resolve(undefined), resolve);
    });
    expect((error as Error).message).toStartWith('GLTFLoader: the file is not JSON or a .glb');
  });
});

// --- The node tree --------------------------------------------------------------------------

type Mat = number[];

/** The column-major matrix of translation `t`, unit quaternion `q` and scale `s`. */
function trs(t: number[], q: number[], s: number[]): Mat {
  const [x, y, z, w] = q as [number, number, number, number];
  const r = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  ];
  return [
    r[0]! * s[0]!,
    r[1]! * s[0]!,
    r[2]! * s[0]!,
    0,
    r[3]! * s[1]!,
    r[4]! * s[1]!,
    r[5]! * s[1]!,
    0,
    r[6]! * s[2]!,
    r[7]! * s[2]!,
    r[8]! * s[2]!,
    0,
    t[0]!,
    t[1]!,
    t[2]!,
    1,
  ];
}

/** `a * b`, column-major. */
function mul(a: Mat, b: Mat): Mat {
  const out: Mat = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return out;
}

const close = (actual: ArrayLike<number>, expected: number[], digits = 9): void => {
  expect(actual.length).toBe(expected.length);
  expected.forEach((v, i) => expect(actual[i]!).toBeCloseTo(v, digits));
};

const half = Math.SQRT1_2;

describe('the node tree', () => {
  /** Nodes with no mesh: only their transforms. */
  const tree = (nodes: Json[], roots = [0]): Json => ({
    asset: { version: '2.0' },
    scenes: [{ nodes: roots }],
    nodes,
  });

  it('keeps the parent and child of each node, and the name', async () => {
    const gltf = await load(
      tree([
        { name: 'a', children: [1, 2] },
        { name: 'b', children: [3] },
        { name: 'c' },
        { name: 'd' },
      ]),
    );
    const a = gltf.scene.children[0]!;
    expect(a.name).toBe('a');
    expect(a.parent).toBe(gltf.scene);
    expect(a.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(a.children[0]!.children.map((c) => c.name)).toEqual(['d']);
    expect(a.children[0]!.children[0]!.parent).toBe(a.children[0]!);
    expect(a).not.toBeInstanceOf(Mesh);
  });

  it('puts translation, rotation and scale into position, rotation and scale', async () => {
    const q = [0, half, 0, half]; // a quarter turn about y
    const gltf = await load(tree([{ translation: [1, 2, 3], rotation: q, scale: [2, 3, 4] }]));
    const node = gltf.scene.children[0]!;
    expect(
      node.position.toArray?.() ?? [node.position.x, node.position.y, node.position.z],
    ).toEqual([1, 2, 3]);
    expect([node.scale.x, node.scale.y, node.scale.z]).toEqual([2, 3, 4]);
    expect(node.rotation.x).toBeCloseTo(0, 9);
    expect(node.rotation.y).toBeCloseTo(Math.PI / 2, 9);
    expect(node.rotation.z).toBeCloseTo(0, 9);
  });

  it('composes the world matrix of a child as glTF does: parent, then child', async () => {
    const parent = { t: [1, 2, 3], q: [0, half, 0, half], s: [2, 2, 2] };
    // 30 degrees about x, then 40 about z, with a non-uniform scale.
    const qx = [Math.sin(Math.PI / 12), 0, 0, Math.cos(Math.PI / 12)];
    const qz = [0, 0, Math.sin(Math.PI / 9), Math.cos(Math.PI / 9)];
    const q = [qz[3]! * qx[0]! + qz[2]! * 0, -qz[2]! * qx[0]!, qz[2]! * qx[3]!, qz[3]! * qx[3]!];
    const child = { t: [-0.5, 0.25, 4], q, s: [1, 2, 3] };
    const gltf = await load(
      tree([
        { translation: parent.t, rotation: parent.q, scale: parent.s, children: [1] },
        { translation: child.t, rotation: child.q, scale: child.s },
      ]),
    );
    gltf.scene.updateMatrixWorld();
    const [p, c] = [gltf.scene.children[0]!, gltf.scene.children[0]!.children[0]!];
    close(p.matrixWorld.elements, trs(parent.t, parent.q, parent.s));
    close(
      c.matrixWorld.elements,
      mul(trs(parent.t, parent.q, parent.s), trs(child.t, child.q, child.s)),
    );
  });

  it('reads a matrix as its translation, rotation and scale', async () => {
    const m = trs([4, -5, 6], [0.5, 0.5, 0.5, 0.5], [1.5, 2, 0.5]);
    const gltf = await load(tree([{ matrix: m }]));
    gltf.scene.updateMatrixWorld();
    close(gltf.scene.children[0]!.matrixWorld.elements, m);
  });

  it('reads a matrix that turns the handedness', async () => {
    const m = trs([0, 1, 0], [0, Math.sin(0.3), 0, Math.cos(0.3)], [-2, 3, 1]);
    const gltf = await load(tree([{ matrix: m }]));
    gltf.scene.updateMatrixWorld();
    close(gltf.scene.children[0]!.matrixWorld.elements, m);
  });

  it('reads a rotation that looks straight up or down', async () => {
    for (const angle of [Math.PI / 2, -Math.PI / 2]) {
      // A quarter turn about z, then a quarter turn about y: the gimbal lock of this Euler order.
      const qy = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
      const m = trs([0, 0, 0], qy, [1, 1, 1]);
      const turned = mul(trs([0, 0, 0], [0, 0, half, half], [1, 1, 1]), m);
      const gltf = await load(
        tree([{ matrix: turned }, { rotation: [0.5, 0.5, -0.5, 0.5] }], [0, 1]),
      );
      gltf.scene.updateMatrixWorld();
      close(gltf.scene.children[0]!.matrixWorld.elements, turned);
      close(
        gltf.scene.children[1]!.matrixWorld.elements,
        trs([0, 0, 0], [0.5, 0.5, -0.5, 0.5], [1, 1, 1]),
      );
    }
  });

  it('makes the node a mesh, and gives it the transform', async () => {
    const { json, bin } = triangle();
    (json.buffers as Json[])[0]!.uri = dataUri(bin);
    (json.nodes as Json[])[0]!.translation = [0, 5, 0];
    const gltf = await load(json);
    gltf.scene.updateMatrixWorld();
    const tri = mesh(gltf.scene.children[0]!);
    expect(tri.matrixWorld.elements[13]).toBe(5);
  });

  it('shares the geometry and the material of one mesh between its nodes', async () => {
    const { json, bin } = triangle();
    (json.buffers as Json[])[0]!.uri = dataUri(bin);
    json.nodes = [
      { children: [1, 2] },
      { mesh: 0, translation: [1, 0, 0] },
      { mesh: 0, translation: [-1, 0, 0] },
    ];
    const gltf = await load(json);
    const [a, b] = gltf.scene.children[0]!.children.map(mesh) as unknown as [Mesh, Mesh];
    expect(a).not.toBe(b);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
  });

  it('makes a mesh of several primitives a node with one mesh for each', async () => {
    const bin = new Bin();
    const position = bin.add(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0));
    const bytes = bin.bytes();
    const gltf = await load({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'pair', mesh: 0 }],
      meshes: [
        {
          name: 'Pair',
          primitives: [
            { attributes: { POSITION: 0 }, material: 0 },
            { attributes: { POSITION: 0 }, material: 1 },
          ],
        },
      ],
      materials: [
        { name: 'red', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
        { name: 'blue', pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1] } },
      ],
      accessors: [
        { bufferView: 0, byteOffset: position, componentType: FLOAT, count: 3, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteLength: bytes.length }],
      buffers: [{ byteLength: bytes.length, uri: dataUri(bytes) }],
    });
    const node = gltf.scene.children[0]!;
    expect(node).not.toBeInstanceOf(Mesh);
    expect(node.name).toBe('pair');
    const [red, blue] = node.children.map(mesh) as [
      Mesh<BufferGeometry, PhysicalMaterial>,
      Mesh<BufferGeometry, PhysicalMaterial>,
    ];
    expect(red.material.name).toBe('red');
    expect(blue.material.name).toBe('blue');
    expect(red.name).toBe('Pair_0');
    expect(blue.name).toBe('Pair_1');
    expect(red.material.color.r).toBe(1);
    expect(blue.material.color.b).toBe(1);
  });

  it('chooses the scene the file names, and any scene by index', async () => {
    const gltf = await load({
      asset: { version: '2.0' },
      scene: 1,
      scenes: [
        { name: 'first', nodes: [0] },
        { name: 'second', nodes: [1] },
      ],
      nodes: [{ name: 'x' }, { name: 'y' }],
    });
    expect(gltf.scenes.map((s) => s.name)).toEqual(['first', 'second']);
    expect(gltf.scene).toBe(gltf.scenes[1]!);
    expect(gltf.scene.children[0]!.name).toBe('y');
  });

  it('gives an empty scene to a file with no scene', async () => {
    const gltf = await load({ asset: { version: '2.0' }, nodes: [{}] });
    expect(gltf.scenes).toEqual([]);
    expect(gltf.scene.children).toEqual([]);
  });
});

// --- The primitives the loader reshapes -----------------------------------------------------

describe('a primitive', () => {
  it('with no indices gets the indices 0, 1, 2 and so on', async () => {
    const json = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0], {
      attributes: { POSITION: 0 },
    });
    // The attribute is read without a normal, so the loader flat-shades it.
    const geometry = mesh((await load(json)).scene.children[0]!).geometry;
    expect([...geometry.index]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(geometry.position).toHaveLength(18);
  });

  it('with no normal gets the unit normal of its face at each vertex, as glTF requires', async () => {
    // A square of two triangles that share two vertices, in the plane x = 0, facing +x.
    const json = onePrimitive(
      [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1],
      {},
      { data: Uint16Array.of(0, 1, 2, 2, 1, 3), componentType: USHORT },
    );
    const geometry = mesh((await load(json)).scene.children[0]!).geometry;
    // Each triangle has its own three vertices.
    expect(geometry.position).toHaveLength(18);
    expect([...geometry.index]).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...geometry.position.subarray(9, 18)]).toEqual([0, 0, 1, 0, 1, 0, 0, 1, 1]);
    expect([...geometry.normal!]).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
    expect(geometry.uv).toBeUndefined();
  });

  it('with no normal keeps its uv for each vertex it copies, and a triangle of no area faces +z', async () => {
    const bin = new Bin();
    const position = bin.add(Float32Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0));
    const uv = bin.add(Float32Array.of(0.1, 0.2, 0.3, 0.4, 0.5, 0.6));
    const bytes = bin.bytes();
    const gltf = await load({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] }],
      accessors: [
        { bufferView: 0, byteOffset: position, componentType: FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 0, byteOffset: uv, componentType: FLOAT, count: 3, type: 'VEC2' },
      ],
      bufferViews: [{ buffer: 0, byteLength: bytes.length }],
      buffers: [{ byteLength: bytes.length, uri: dataUri(bytes) }],
    });
    const geometry = mesh(gltf.scene.children[0]!).geometry;
    expect([...geometry.normal!]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    close(geometry.uv!, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 6);
  });

  it('as a triangle strip becomes triangles that all face one way', async () => {
    // A strip over a square in the xy plane: the vertices 0 1 2 3 are bottom left, top left, bottom right, top right.
    const json = onePrimitive(
      [0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0],
      { mode: 5 },
      { data: Uint16Array.of(0, 2, 1, 3), componentType: USHORT },
    );
    const geometry = mesh((await load(json)).scene.children[0]!).geometry;
    // Flat shading copies the vertices: read the faces from the normals.
    expect(geometry.index).toHaveLength(6);
    expect([...geometry.normal!]).toEqual(Array(6).fill([0, 0, 1]).flat());
  });

  it('as a triangle fan becomes triangles around its first vertex', async () => {
    const json = onePrimitive(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      { mode: 6 },
      { data: Uint8Array.of(0, 1, 2, 3), componentType: UBYTE },
    );
    const geometry = mesh((await load(json)).scene.children[0]!).geometry;
    expect(geometry.index).toHaveLength(6);
    // The second triangle is (0, 2, 3).
    expect([...geometry.position.subarray(9, 18)]).toEqual([0, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect([...geometry.normal!]).toEqual(Array(6).fill([0, 0, 1]).flat());
  });

  it('of points or lines is skipped, and the node stays', async () => {
    for (const mode of [0, 1, 2, 3]) {
      const gltf = await load(onePrimitive([0, 0, 0, 1, 0, 0], { mode }));
      expect(gltf.scene.children).toHaveLength(1);
      expect(gltf.scene.children[0]).not.toBeInstanceOf(Mesh);
      expect(gltf.scene.children[0]!.children).toHaveLength(0);
      expect(gltf.warnings).toEqual([
        'A primitive of points or lines is skipped: the path tracer draws triangles.',
      ]);
    }
  });

  it('with no material gets the default material of glTF', async () => {
    const gltf = await load(onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], {}));
    const material = mesh(gltf.scene.children[0]!).material;
    expect(material.color.toArray()).toEqual([1, 1, 1]);
    expect(material.metalness).toBe(1);
    expect(material.roughness).toBe(1);
    expect(material.emissive.toArray()).toEqual([0, 0, 0]);
  });

  it('reads an index that is not tightly packed', async () => {
    const bin = new Bin();
    const position = bin.add(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0));
    // Each index is a short followed by a short of padding: a stride of 4.
    const index = bin.add(Uint16Array.of(2, 0, 1, 0, 0, 0));
    const bytes = bin.bytes();
    const gltf = await load({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        { bufferView: 0, byteOffset: position, componentType: FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 1, byteOffset: index, componentType: USHORT, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteLength: bytes.length },
        { buffer: 0, byteLength: bytes.length, byteStride: 4 },
      ],
      buffers: [{ byteLength: bytes.length, uri: dataUri(bytes) }],
    });
    // The shorts are 2, 0, 1, 0, 0, 0 and the stride is 4 bytes, so the indices are 2, 1, 0.
    // The primitive has no normal, so the loader copies the vertices in that order.
    const geometry = mesh(gltf.scene.children[0]!).geometry;
    expect([...geometry.position]).toEqual([0, 1, 0, 1, 0, 0, 0, 0, 0]);
  });

  it('reads interleaved floats, and normalized integers for the normal and the uv', async () => {
    // Vertex: position as 3 shorts and 2 bytes of padding (8 bytes), normal as 3 normalized
    // signed bytes and 1 of padding (4 bytes), uv as 2 normalized unsigned shorts (4 bytes).
    const stride = 16;
    const data = new DataView(new ArrayBuffer(stride * 3));
    const vertices = [
      { p: [0, 0, 0], n: [0, 0, 127], uv: [0, 0] },
      { p: [100, 0, 0], n: [0, 0, 127], uv: [65535, 0] },
      { p: [0, 100, 0], n: [0, 0, 127], uv: [0, 65535] },
    ];
    vertices.forEach((v, i) => {
      v.p.forEach((c, k) => data.setInt16(i * stride + k * 2, c, true));
      v.n.forEach((c, k) => data.setInt8(i * stride + 8 + k, c));
      v.uv.forEach((c, k) => data.setUint16(i * stride + 12 + k * 2, c, true));
    });
    const bytes = new Uint8Array(data.buffer);
    const gltf = await load({
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_mesh_quantization'],
      extensionsRequired: ['KHR_mesh_quantization'],
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, scale: [0.01, 0.01, 0.01] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 } }] }],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: SHORT, count: 3, type: 'VEC3' },
        {
          bufferView: 0,
          byteOffset: 8,
          componentType: BYTE,
          normalized: true,
          count: 3,
          type: 'VEC3',
        },
        {
          bufferView: 0,
          byteOffset: 12,
          componentType: USHORT,
          normalized: true,
          count: 3,
          type: 'VEC2',
        },
      ],
      bufferViews: [{ buffer: 0, byteLength: bytes.length, byteStride: stride }],
      buffers: [{ byteLength: bytes.length, uri: dataUri(bytes) }],
    });
    const geometry = mesh(gltf.scene.children[0]!).geometry;
    expect([...geometry.position]).toEqual([0, 0, 0, 100, 0, 0, 0, 100, 0]);
    // The normal is scaled to unit length: 127 / 127 is 1.
    expect([...geometry.normal!]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect([...geometry.uv!]).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it('has a normal of unit length even when the file says otherwise', async () => {
    const bin = new Bin();
    const position = bin.add(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0));
    const normal = bin.add(Float32Array.of(0, 0, 5, 0, 3, 4, 0, 0, 0));
    const bytes = bin.bytes();
    const gltf = await load({
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
      accessors: [
        { bufferView: 0, byteOffset: position, componentType: FLOAT, count: 3, type: 'VEC3' },
        { bufferView: 0, byteOffset: normal, componentType: FLOAT, count: 3, type: 'VEC3' },
      ],
      bufferViews: [{ buffer: 0, byteLength: bytes.length }],
      buffers: [{ byteLength: bytes.length, uri: dataUri(bytes) }],
    });
    close(mesh(gltf.scene.children[0]!).geometry.normal!, [0, 0, 1, 0, 0.6, 0.8, 0, 0, 0], 6);
  });

  it('reads the emissive strength of KHR_materials_emissive_strength', async () => {
    const json = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], { material: 0 });
    json.materials = [
      {
        emissiveFactor: [1, 0.5, 0],
        extensions: { KHR_materials_emissive_strength: { emissiveStrength: 20 } },
      },
    ];
    json.extensionsUsed = ['KHR_materials_emissive_strength'];
    json.extensionsRequired = ['KHR_materials_emissive_strength'];
    const { material } = mesh((await load(json)).scene.children[0]!);
    expect(material.emissive.toArray()).toEqual([1, 0.5, 0]);
    expect(material.emissiveIntensity).toBe(20);
    expect(material.metalness).toBe(1);
  });
});

// --- What the loader skips ------------------------------------------------------------------

describe('a feature the loader skips', () => {
  it('leaves the tree whole, and says so in warnings', async () => {
    const { json, bin } = triangle();
    (json.buffers as Json[])[0]!.uri = dataUri(bin);
    (json.nodes as Json[])[0]!.skin = 0;
    (json.nodes as Json[])[0]!.camera = 0;
    json.skins = [{ joints: [0] }];
    json.cameras = [{ type: 'perspective' }];
    json.animations = [{ channels: [], samplers: [] }];
    json.textures = [{ source: 0 }];
    json.images = [{ uri: 'not-fetched.png' }];
    const material = (json.materials as Json[])[0]!;
    (material.pbrMetallicRoughness as Json).baseColorTexture = { index: 0 };
    material.normalTexture = { index: 0 };
    (json.meshes as Json[])[0]!.primitives = [
      {
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
        targets: [{ POSITION: 0 }],
      },
    ];
    const gltf = await load(json);
    expect(gltf.scene.children).toHaveLength(1);
    expect(mesh(gltf.scene.children[0]!).geometry.index).toHaveLength(3);
    expect([...gltf.warnings].sort()).toEqual(
      [
        'Animations are skipped: every node keeps its rest transform.',
        'Cameras are ignored.',
        'Morph targets are skipped: a mesh draws in its rest pose.',
        'Skins are skipped: a skinned mesh draws in its rest pose.',
        'Textures are ignored: a material keeps its factors.',
      ].sort(),
    );
  });

  it('ignores an extension that the file lists and does not require', async () => {
    const json = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], {});
    json.extensionsUsed = ['KHR_lights_punctual', 'KHR_materials_clearcoat'];
    expect((await load(json)).warnings).toEqual([]);
  });
});

// --- What the loader refuses ----------------------------------------------------------------

describe('a file the loader refuses', () => {
  it('uses a sparse accessor', async () => {
    const json = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], {});
    (json.accessors as Json[])[0]!.sparse = { count: 1, indices: {}, values: {} };
    expect(await failure(json)).toBe(
      'GLTFLoader: meshes[0].primitives[0].attributes.POSITION (accessors[0]) is sparse, and sparse accessors are not read',
    );
  });

  it('requires an extension the loader does not know', async () => {
    const json = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], {});
    json.extensionsRequired = ['KHR_draco_mesh_compression'];
    expect(await failure(json)).toBe(
      'GLTFLoader: the file requires the extension KHR_draco_mesh_compression, which the loader does not support',
    );
  });

  it('is not glTF 2', async () => {
    expect(await failure({ asset: { version: '1.0' } })).toBe(
      'GLTFLoader: asset.version is "1.0", and only glTF 2.x is read',
    );
    expect(await failure({})).toContain('asset.version is undefined');
  });

  it('is not JSON, or is JSON that is not an object', async () => {
    expect(await failure('not json')).toStartWith('GLTFLoader: the file is not JSON or a .glb');
    expect(await failure('null')).toBe('GLTFLoader: the JSON is not an object');
  });

  it('names a vertex that the primitive does not have', async () => {
    const json = onePrimitive(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      {},
      { data: Uint16Array.of(0, 1, 3), componentType: USHORT },
    );
    expect(await failure(json)).toBe(
      'GLTFLoader: meshes[0].primitives[0].indices names vertex 3, and the primitive has 3',
    );
  });

  it('has indices that are not a whole number of triangles', async () => {
    const json = onePrimitive(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      {},
      { data: Uint16Array.of(0, 1), componentType: USHORT },
    );
    expect(await failure(json)).toBe(
      'GLTFLoader: meshes[0].primitives[0].indices has 2 indices, which is not a multiple of 3',
    );
  });

  it('has a primitive with no POSITION', async () => {
    const json = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], {});
    ((json.meshes as Json[])[0]!.primitives as Json[])[0]!.attributes = {};
    expect(await failure(json)).toBe(
      'GLTFLoader: meshes[0].primitives[0].attributes has no POSITION',
    );
  });

  it('names a node, a mesh, a material or an accessor that does not exist', async () => {
    const base = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], { material: 4 });
    expect(await failure(base)).toBe(
      'GLTFLoader: meshes[0].primitives[0].material is 4, and the file has 0 materials',
    );
    expect(
      await failure({ asset: { version: '2.0' }, scenes: [{ nodes: [2] }], nodes: [{}] }),
    ).toBe('GLTFLoader: a node index is 2, and the file has 1 nodes');
    expect(
      await failure({
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 1 }],
        meshes: [],
      }),
    ).toBe('GLTFLoader: nodes[0].mesh is 1, and the file has 0 meshes');
    expect(await failure({ asset: { version: '2.0' }, scene: 3, scenes: [{ nodes: [] }] })).toBe(
      'GLTFLoader: scene is 3, and the file has 1 scenes',
    );
  });

  it('reads past the end of its buffer', async () => {
    const json = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], {});
    (json.accessors as Json[])[0]!.count = 4;
    expect(await failure(json)).toContain('reads bytes 0 to 48, and its buffer has 36');
  });

  it('has a buffer shorter than it says', async () => {
    const json = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], {});
    (json.buffers as Json[])[0]!.byteLength = 400;
    expect(await failure(json)).toBe('GLTFLoader: buffers[0] says 400 bytes, and its data has 36');
  });

  it('has a buffer with no uri and no binary chunk', async () => {
    const json = onePrimitive([0, 0, 0, 1, 0, 0, 0, 1, 0], {});
    delete (json.buffers as Json[])[0]!.uri;
    expect(await failure(json)).toBe(
      'GLTFLoader: buffers[0] has no uri, and the file has no binary chunk for it',
    );
  });

  it('has a node with two parents, or a node that is its own ancestor', async () => {
    expect(
      await failure({
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ children: [2] }, { children: [2] }, {}],
      }),
    ).toBe('GLTFLoader: nodes[2] is a child of nodes[0] and of nodes[1]');
    expect(
      await failure({
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ children: [1] }, { children: [0] }],
      }),
    ).toBe('GLTFLoader: nodes[0] is its own ancestor');
  });

  it('has a transform of the wrong length', async () => {
    expect(
      await failure({
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ translation: [1, 2] }],
      }),
    ).toBe('GLTFLoader: nodes[0].translation is not an array of 3 numbers');
  });

  it('is a .glb that is cut short, or has no JSON chunk, or is another version', async () => {
    const { json, bin } = triangle();
    const whole = glb(json, bin);
    expect(await failure(whole.slice(0, 16))).toBe(
      'GLTFLoader: the .glb is shorter than its header and first chunk',
    );
    expect(await failure(whole.slice(0, whole.byteLength - 8))).toContain(
      'bytes, and the file has',
    );
    const version = new Uint8Array(whole.slice(0));
    new DataView(version.buffer).setUint32(4, 1, true);
    expect(await failure(version.buffer as ArrayBuffer)).toBe(
      'GLTFLoader: the .glb is container version 1, and only 2 is read',
    );
    const noJson = new Uint8Array(whole.slice(0));
    new DataView(noJson.buffer).setUint32(16, 0x004e4942, true);
    expect(await failure(noJson.buffer as ArrayBuffer)).toBe(
      'GLTFLoader: the .glb has no JSON chunk',
    );
  });
});

// --- Files over HTTP ------------------------------------------------------------------------

describe('a file over HTTP', () => {
  const files = new Map<string, { type: string; body: Uint8Array | string }>();
  let server: ReturnType<typeof Bun.serve>;
  let origin = '';

  beforeAll(() => {
    const { json, bin } = triangle();
    (json.buffers as Json[])[0]!.uri = 'tri.bin';
    files.set('/models/tri.gltf', { type: 'model/gltf+json', body: JSON.stringify(json) });
    files.set('/models/tri.bin', { type: 'application/octet-stream', body: bin });
    const { json: glbJson, bin: glbBin } = triangle();
    files.set('/models/tri.glb', {
      type: 'model/gltf-binary',
      body: new Uint8Array(glb(glbJson, glbBin)),
    });
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const file = files.get(new URL(request.url).pathname);
        if (file === undefined) return new Response('no', { status: 404, statusText: 'Not Found' });
        return new Response(file.body, { headers: { 'content-type': file.type } });
      },
    });
    origin = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  it('loadAsync reads a .gltf and the .bin that its uri names, next to it', async () => {
    const gltf = await new GLTFLoader().loadAsync(`${origin}/models/tri.gltf?v=1#top`);
    expect([...mesh(gltf.scene.children[0]!).geometry.index]).toEqual([0, 1, 2]);
  });

  it('loadAsync reads a .glb, and reports its progress', async () => {
    const progress: number[] = [];
    const gltf = await new GLTFLoader().loadAsync(`${origin}/models/tri.glb`, (e) =>
      progress.push(e.loaded),
    );
    expect(mesh(gltf.scene.children[0]!).material.name).toBe('orange');
    const size = (files.get('/models/tri.glb')!.body as Uint8Array).length;
    expect(progress.at(-1)).toBe(size);
  });

  it('load calls onLoad, and onError when the server answers 404', async () => {
    const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => {
      new GLTFLoader().load(`${origin}/models/tri.glb`, resolve, undefined, reject);
    });
    expect(gltf.scene.children).toHaveLength(1);
    const error = await new Promise<unknown>((resolve) => {
      new GLTFLoader().load(
        `${origin}/models/none.glb`,
        () => resolve(undefined),
        undefined,
        resolve,
      );
    });
    expect((error as Error).message).toBe(
      `GLTFLoader: ${origin}/models/none.glb answered 404 Not Found`,
    );
  });

  it('parseAsync reads the buffer next to a file that it was given as bytes', async () => {
    const bytes = new TextEncoder().encode(files.get('/models/tri.gltf')!.body as string);
    const gltf = await new GLTFLoader().parseAsync(bytes, `${origin}/models/`);
    expect([...mesh(gltf.scene.children[0]!).geometry.index]).toEqual([0, 1, 2]);
    expect(await failure(JSON.stringify({}))).not.toBe('');
  });
});
