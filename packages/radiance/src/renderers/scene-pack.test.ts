// The scene pack (design record 0001, "Change tracking and upload", with record 0004's material
// record): the words of each buffer against the records' tables, the light table's cdf, the
// instances in the TLAS's leaf order, the buffers each kind of change writes, and the limits'
// refusals. The kernel reads these words on the oracle in intersect.test.ts and
// materials.test.ts.

import { describe, expect, it } from 'bun:test';
import { buildBlas, buildTlas } from '../accel/bvh.ts';
import { BoxGeometry } from '../geometries/BoxGeometry.ts';
import { BufferGeometry } from '../geometries/BufferGeometry.ts';
import { Geometry } from '../geometries/Geometry.ts';
import { PlaneGeometry } from '../geometries/PlaneGeometry.ts';
import { SphereGeometry } from '../geometries/SphereGeometry.ts';
import {
  INSTANCE_BASES,
  INSTANCE_FLAGS,
  INSTANCE_INVERSE,
  INSTANCE_MATRIX,
  INSTANCE_STRIDE,
  MATERIAL_STRIDE,
  NODE_COUNT_MASK,
  NODE_STRIDE,
  TRIANGLE_STRIDE,
  VERTEX_STRIDE,
} from '../kernels/layout.shade.ts';
import { DiffuseMaterial } from '../materials/DiffuseMaterial.ts';
import { EmissiveMaterial } from '../materials/EmissiveMaterial.ts';
import { MirrorMaterial } from '../materials/MirrorMaterial.ts';
import { PhysicalMaterial } from '../materials/PhysicalMaterial.ts';
import { Color } from '../math/Color.ts';
import { Mesh } from '../objects/Mesh.ts';
import { Scene } from '../scenes/Scene.ts';
import { checkStorageBinding, maxStorageBufferBindingSize } from './limits.ts';
import { SCENE_BUFFERS, ScenePack, packMaterial, type SceneBuffer } from './scene-pack.ts';

const bitsOf = (a: Float32Array): Uint32Array => new Uint32Array(a.buffer, a.byteOffset, a.length);
const f32 = (xs: number[]): number[] => xs.map(Math.fround);
/** The vec4 `k` of element `i` of a buffer whose element is `stride` vec4s. */
const word = (a: Float32Array | Uint32Array, stride: number, i: number, k: number): number[] =>
  Array.from(a.subarray((i * stride + k) * 4, (i * stride + k) * 4 + 4));

/** A scene of `meshes`, its matrices updated. */
function sceneOf(...meshes: Mesh[]): Scene {
  const scene = new Scene();
  scene.add(...meshes);
  scene.updateMatrixWorld();
  return scene;
}

/** The slot of `mesh` in `instances`: the slot whose world rows are its matrix's. */
function slotOf(pack: ScenePack, mesh: Mesh): number {
  const e = mesh.matrixWorld.elements;
  const rows = f32([0, 1, 2].flatMap((r) => [e[r]!, e[4 + r]!, e[8 + r]!, e[12 + r]!]));
  for (let s = 0; s < pack.counts.instances; s++) {
    const at = s * INSTANCE_STRIDE * 4 + INSTANCE_MATRIX * 4;
    if (Array.from(pack.arrays.instances.subarray(at, at + 12)).every((x, k) => x === rows[k]))
      return s;
  }
  throw new Error('the mesh is in no slot');
}

describe('ScenePack: the words of each buffer (record 0001, "The GPU layout")', () => {
  const plane = new PlaneGeometry(2, 1);
  const flat = new DiffuseMaterial({ color: new Color(0.5, 0.25, 0.125) });
  const a = new Mesh(plane, flat);
  a.position.set(1, 2, 3);
  a.rotation.set(0.3, -0.2, 0.1);
  a.scale.set(2, 1, 0.5);
  const ball = new SphereGeometry(0.5, 8, 4);
  const glow = new PhysicalMaterial({
    color: new Color(0.9, 0.8, 0.7),
    metalness: 0.3,
    roughness: 0.7,
    ior: 1.4,
    transmission: 0.2,
    specularIntensity: 0.9,
    emissive: new Color(1, 2, 3),
    emissiveIntensity: 2,
  });
  glow.doubleSided = true;
  const b = new Mesh(ball, glow);
  b.position.set(-1, 0, 0);
  const scene = sceneOf(a, b);
  const pack = new ScenePack();
  const written = pack.update(scene);

  it('writes all six buffers the first time, and counts what they hold', () => {
    expect([...written].sort()).toEqual([...SCENE_BUFFERS].sort());
    const sphereTriangles = ball.index.length / 3;
    expect(pack.counts).toMatchObject({
      instances: 2,
      materials: 2,
      triangles: 2 + sphereTriangles,
      vertices: 4 + ball.position.length / 3,
    });
  });

  // Verifies: Design 0001.2
  it('lays each buffer out in its stride of vec4, as the record table says', () => {
    const c = pack.counts;
    expect(pack.arrays.nodes.length).toBe(c.nodes * NODE_STRIDE * 4);
    expect(pack.arrays.triangles.length).toBe(c.triangles * TRIANGLE_STRIDE * 4);
    expect(pack.arrays.vertices.length).toBe(c.vertices * VERTEX_STRIDE * 4);
    expect(pack.arrays.instances.length).toBe(c.instances * INSTANCE_STRIDE * 4);
    expect(pack.arrays.materials.length).toBe(c.materials * MATERIAL_STRIDE * 4);
    expect(pack.arrays.lights.length).toBe(c.lights * 4);
    expect(pack.arrays.triangles).toBeInstanceOf(Uint32Array);
  });

  // Verifies: Design 0001.3
  it('writes each vertex as (position, u) and (normal, v), and stores no tangent', () => {
    const slot = slotOf(pack, a);
    const vertexBase = bitsOf(pack.arrays.instances)[
      (slot * INSTANCE_STRIDE + INSTANCE_BASES) * 4 + 2
    ]!;
    for (let v = 0; v < 4; v++) {
      const at = vertexBase + v;
      expect(word(pack.arrays.vertices, VERTEX_STRIDE, at, 0)).toEqual(
        f32([...plane.position.subarray(v * 3, v * 3 + 3), plane.uv![v * 2]!]),
      );
      expect(word(pack.arrays.vertices, VERTEX_STRIDE, at, 1)).toEqual(
        f32([...plane.normal!.subarray(v * 3, v * 3 + 3), plane.uv![v * 2 + 1]!]),
      );
    }
    expect(VERTEX_STRIDE).toBe(2);
  });

  it("writes a geometry's triangles in its BLAS's leaf order, relative to its vertexBase", () => {
    const slot = slotOf(pack, b);
    const bases = bitsOf(pack.arrays.instances).subarray(
      (slot * INSTANCE_STRIDE + INSTANCE_BASES) * 4,
      (slot * INSTANCE_STRIDE + INSTANCE_BASES) * 4 + 4,
    );
    const bvh = buildBlas(ball);
    bvh.order.forEach((t, s) => {
      expect(word(pack.arrays.triangles, TRIANGLE_STRIDE, bases[1]! + s, 0)).toEqual([
        ...ball.index.subarray(t * 3, t * 3 + 3),
        0,
      ]);
    });
    // The BLAS's nodes, relative to the BLAS, at its nodeBase.
    const at = bases[0]! * NODE_STRIDE * 4;
    expect(Array.from(pack.arrays.nodes.subarray(at, at + bvh.nodes.length))).toEqual(
      Array.from(bvh.nodes),
    );
  });

  it('writes the world rows, the inverse rows, the bases and the flags of each instance', () => {
    for (const mesh of [a, b]) {
      const slot = slotOf(pack, mesh);
      const rows = [0, 1, 2].map((r) =>
        word(pack.arrays.instances, INSTANCE_STRIDE, slot, INSTANCE_MATRIX + r),
      );
      const inverse = [0, 1, 2].map((r) =>
        word(pack.arrays.instances, INSTANCE_STRIDE, slot, INSTANCE_INVERSE + r),
      );
      // The inverse rows times the world rows is the identity, to f32's rounding.
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 4; c++) {
          const x =
            inverse[r]![0]! * rows[0]![c]! +
            inverse[r]![1]! * rows[1]![c]! +
            inverse[r]![2]! * rows[2]![c]! +
            (c === 3 ? inverse[r]![3]! : 0);
          expect(x).toBeCloseTo(r === c ? 1 : 0, 5);
        }
      const flags = bitsOf(pack.arrays.instances).subarray(
        (slot * INSTANCE_STRIDE + INSTANCE_FLAGS) * 4,
        (slot * INSTANCE_STRIDE + INSTANCE_FLAGS) * 4 + 4,
      );
      expect(flags[0]).toBe(0);
      expect(flags[2]).toBe(0);
      expect(flags[3]).toBe(0);
    }
    const material = (m: Mesh) =>
      bitsOf(pack.arrays.instances)[(slotOf(pack, m) * INSTANCE_STRIDE + INSTANCE_BASES) * 4 + 3];
    expect([material(a), material(b)]).toEqual([0, 1]);
    const geometryId = (m: Mesh) =>
      bitsOf(pack.arrays.instances)[(slotOf(pack, m) * INSTANCE_STRIDE + INSTANCE_FLAGS) * 4 + 1];
    expect([geometryId(a), geometryId(b)]).toEqual([0, 1]);
  });

  // Verifies: Design 0004.1
  it("writes record 0004's 128-byte material record: [0] to [3] filled, [4] to [7] zero", () => {
    const words = pack.arrays.materials.subarray(MATERIAL_STRIDE * 4, MATERIAL_STRIDE * 8);
    const bits = bitsOf(words);
    expect(MATERIAL_STRIDE * 16).toBe(128);
    expect(Array.from(words.subarray(0, 4))).toEqual(f32([0.9, 0.8, 0.7, 0.3]));
    // The emissive colour times emissiveIntensity, and the roughness.
    expect(Array.from(words.subarray(4, 8))).toEqual(f32([2, 4, 6, 0.7]));
    expect(Array.from(words.subarray(8, 11))).toEqual(f32([1.4, 0.2, 0.9]));
    // Type 2 (physical), bit 8 (emits) and bit 9 (double sided).
    expect(bits[11]).toBe(2 | 0x100 | 0x200);
    expect(Array.from(bits.subarray(12, 16))).toEqual([
      0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
    ]);
    expect(Array.from(words.subarray(16, 28))).toEqual(new Array(12).fill(0));
    expect(Array.from(bits.subarray(28, 32))).toEqual([0xffffffff, 0, 0, 0]);
    // The diffuse one: its colour, no emission, type 0 and no flag.
    const diffuse = pack.arrays.materials.subarray(0, MATERIAL_STRIDE * 4);
    expect(Array.from(diffuse.subarray(0, 3))).toEqual(f32([0.5, 0.25, 0.125]));
    expect(Array.from(diffuse.subarray(4, 7))).toEqual([0, 0, 0]);
    expect(bitsOf(diffuse)[11]).toBe(0);
  });

  it('writes the type of each material class', () => {
    const type = (m: DiffuseMaterial | MirrorMaterial | EmissiveMaterial | PhysicalMaterial) =>
      bitsOf(packMaterial(m))[11]! & 0xff;
    expect(type(new DiffuseMaterial())).toBe(0);
    expect(type(new MirrorMaterial())).toBe(1);
    expect(type(new PhysicalMaterial())).toBe(2);
    expect(type(new EmissiveMaterial())).toBe(0);
    expect(bitsOf(packMaterial(new EmissiveMaterial()))[11]).toBe(0x100);
  });

  it('lists every triangle of the emissive instance as a light, with its slot and index', () => {
    const slot = slotOf(pack, b);
    const primBase = bitsOf(pack.arrays.instances)[
      (slot * INSTANCE_STRIDE + INSTANCE_BASES) * 4 + 1
    ]!;
    const lights = bitsOf(pack.arrays.lights);
    // A sphere's pole rows hold no zero-area triangle: three.js leaves those out.
    expect(pack.counts.lights).toBe(ball.index.length / 3);
    for (let i = 0; i < pack.counts.lights; i++) {
      expect(lights[i * 4]).toBe(0);
      expect(lights[i * 4 + 1]).toBe(slot);
      expect(lights[i * 4 + 2]).toBe(primBase + i);
    }
  });

  it('builds the uniform block from its counts', () => {
    const params = pack.params({
      camera: {
        eye: [0, 0, 0, 0],
        right: [1, 0, 0, 0],
        up: [0, 1, 0, 0],
        forward: [0, 0, -1, 0],
        lens: [1, 1, 0, 0],
      },
      frame: [4, 3, 0, 1],
      tile: [0, 0, 4, 3],
      seed: 7,
      bounces: 8,
      rouletteFrom: 3,
    });
    expect(params.scene).toEqual([pack.counts.tlasBase, 2, pack.counts.lights, 7]);
    expect(params.path).toEqual([8, 3, 0, 0]);
  });
});

describe("ScenePack: the light table's cdf", () => {
  // Three lights of different areas and colours, two triangles each.
  const sizes = [
    [1, 1, new Color(1, 1, 1)],
    [2, 1, new Color(3, 0, 0)],
    [0.5, 0.5, new Color(0, 6, 6)],
  ] as const;
  const meshes = sizes.map(([w, h, c], i) => {
    const m = new Mesh(new PlaneGeometry(w, h), new EmissiveMaterial({ color: c }));
    m.position.set(i * 3, 0, 0);
    return m;
  });
  const pack = new ScenePack();
  pack.update(sceneOf(...meshes, new Mesh(new PlaneGeometry(4, 4), new DiffuseMaterial())));

  it('gives each light the chance of its share of the power: area times the mean emission', () => {
    expect(pack.counts.lights).toBe(6);
    const power = (k: number): number => {
      const [w, h, c] = sizes[k]!;
      return ((w * h) / 2) * ((c.r + c.g + c.b) / 3);
    };
    // The table is in slot order; each light's slot names its plane.
    const bits = bitsOf(pack.arrays.lights);
    const planeOfSlot = new Map(meshes.map((m, k) => [slotOf(pack, m), k]));
    const total = [0, 1, 2].reduce((s, k) => s + 2 * power(k), 0);
    let sum = 0;
    for (let i = 0; i < 6; i++) {
      sum += power(planeOfSlot.get(bits[i * 4 + 1]!)!);
      expect(pack.arrays.lights[i * 4 + 3]).toBeCloseTo(sum / total, 6);
      if (i > 0)
        expect(pack.arrays.lights[i * 4 + 3]!).toBeGreaterThan(pack.arrays.lights[i * 4 - 1]!);
    }
    expect(pack.arrays.lights[5 * 4 + 3]).toBe(1);
  });
});

describe('ScenePack: instances in the TLAS leaf order (record 0001, Amendment 1)', () => {
  const ball = new SphereGeometry(0.3, 8, 4);
  const meshes = Array.from({ length: 12 }, (_, i) => {
    const m = new Mesh(ball, new DiffuseMaterial());
    m.position.set(((i * 7) % 5) - 2, ((i * 3) % 4) - 2, (i % 3) - 1);
    return m;
  });
  const pack = new ScenePack();
  pack.update(sceneOf(...meshes));

  it("writes slot s of instances from the TLAS's order[s], so a leaf's a is an index", () => {
    const boxes = meshes.flatMap((m) => {
      const p = m.position;
      return [p.x - 0.3, p.y - 0.3, p.z - 0.3, p.x + 0.3, p.y + 0.3, p.z + 0.3];
    });
    const tlas = buildTlas(boxes);
    tlas.order.forEach((i, s) => expect(slotOf(pack, meshes[i]!)).toBe(s));
  });

  it("puts every instance of a TLAS leaf inside the leaf's box", () => {
    const nodes = pack.arrays.nodes;
    const words = bitsOf(nodes);
    const base = pack.counts.tlasBase;
    let seen = 0;
    for (let n = base; n < pack.counts.nodes; n++) {
      const count = words[n * 8 + 7]! & NODE_COUNT_MASK;
      if (count === 0) continue;
      // A TLAS leaf holds up to 4 instances.
      expect(count).toBeLessThanOrEqual(4);
      for (let s = words[n * 8 + 3]!; s < words[n * 8 + 3]! + count; s++) {
        const tx = pack.arrays.instances[s * 32 + 3]!;
        expect(tx).toBeGreaterThanOrEqual(nodes[n * 8]!);
        expect(tx).toBeLessThanOrEqual(nodes[n * 8 + 4]!);
        seen++;
      }
    }
    expect(seen).toBe(12);
  });

  it('builds one BLAS for a geometry the meshes share, and gives every instance its bases', () => {
    expect(pack.counts.triangles).toBe(ball.index.length / 3);
    const bases = new Set<string>();
    for (let s = 0; s < 12; s++)
      bases.add(
        word(bitsOf(pack.arrays.instances), INSTANCE_STRIDE, s, INSTANCE_BASES).slice(0, 3).join(),
      );
    expect(bases.size).toBe(1);
  });
});

// Verifies: Design 0001.5
describe('ScenePack: what each change writes (record 0001, "Change tracking and upload")', () => {
  const ball = new SphereGeometry(0.5, 8, 4);
  const grey = new DiffuseMaterial();
  const lampMaterial = new EmissiveMaterial({ intensity: 4 });
  const sphere = new Mesh(ball, grey);
  const lamp = new Mesh(new PlaneGeometry(1, 1), lampMaterial);
  lamp.position.set(0, 2, 0);
  lamp.rotation.x = Math.PI / 2;
  const scene = sceneOf(sphere, lamp);
  const pack = new ScenePack();
  pack.update(scene);
  const update = (): string[] => {
    scene.updateMatrixWorld();
    return [...pack.update(scene)].sort();
  };

  it('writes nothing for an unchanged scene', () => {
    expect(update()).toEqual([]);
  });

  it('writes the three geometry buffers whole when a geometry changes, and no other', () => {
    ball.uv = ball.uv!.map((x) => x * 0.5);
    expect(update()).toEqual(['nodes', 'triangles', 'vertices']);
    expect(update()).toEqual([]);
  });

  it('writes instances, nodes and lights when a transform moves', () => {
    sphere.position.x += 0.25;
    expect(update()).toEqual(['instances', 'lights', 'nodes']);
    expect(update()).toEqual([]);
  });

  it('writes the materials alone when a colour changes in place', () => {
    grey.color.r = 0.1;
    expect(update()).toEqual(['materials']);
    expect(update()).toEqual([]);
  });

  it('writes the materials and the lights when an emission changes', () => {
    lampMaterial.emissive.multiplyScalar(2);
    expect(update()).toEqual(['materials']);
    // The light table's cdf of one light is 1 whatever its power: only the words moved.
    lampMaterial.emissive = new Color(0, 0, 0);
    expect(update()).toEqual(['lights', 'materials']);
    expect(pack.counts.lights).toBe(0);
  });

  it('writes the materials and the instances when a mesh takes another material', () => {
    sphere.material = new MirrorMaterial();
    expect(update()).toEqual(['instances', 'lights', 'materials', 'nodes']);
  });

  it("writes the geometry buffers again after release() drops a geometry's BLAS", () => {
    scene.remove(sphere);
    expect(update()).toEqual(['instances', 'lights', 'nodes']);
    expect(pack.counts.triangles).toBe(ball.index.length / 3 + 2);
    pack.release(ball);
    // The lamp's BLAS moves to the front, so its instance's bases move too.
    expect(update()).toEqual(['instances', 'lights', 'nodes', 'triangles', 'vertices']);
    expect(pack.counts.triangles).toBe(2);
  });
});

describe('ScenePack: what it draws', () => {
  // Verifies: Design 0001.1
  it('draws a sphere as its triangles, not as an analytic shape', () => {
    const ball = new SphereGeometry(1, 12, 6);
    const pack = new ScenePack();
    pack.update(sceneOf(new Mesh(ball, new DiffuseMaterial())));
    expect(pack.counts.triangles).toBe(ball.index.length / 3);
    expect(pack.counts.vertices).toBe(ball.position.length / 3);
    expect(SCENE_BUFFERS).not.toContain('spheres' as SceneBuffer);
  });

  // Verifies: Design 0001.7
  it('draws a PlaneGeometry and a BoxGeometry, three.js names, as triangles', () => {
    const pack = new ScenePack();
    pack.update(
      sceneOf(
        new Mesh(new PlaneGeometry(1, 1), new DiffuseMaterial()),
        new Mesh(new BoxGeometry(1, 2, 3), new DiffuseMaterial()),
      ),
    );
    expect(pack.counts.triangles).toBe(2 + 12);
    expect(pack.counts.instances).toBe(2);
  });

  it('computes the normals of a geometry that has none', () => {
    const g = new BufferGeometry();
    g.position = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0);
    g.index = Uint32Array.of(0, 1, 2);
    const pack = new ScenePack();
    pack.update(sceneOf(new Mesh(g, new DiffuseMaterial())));
    expect(word(pack.arrays.vertices, VERTEX_STRIDE, 0, 1)).toEqual([0, 0, 1, 0]);
  });

  it('refuses a mesh whose geometry is not a BufferGeometry', () => {
    class Odd extends Geometry {
      readonly type = 'Odd';
    }
    const pack = new ScenePack();
    expect(() => pack.update(sceneOf(new Mesh(new Odd(), new DiffuseMaterial())))).toThrow(
      'the path tracer draws a BufferGeometry, and a mesh holds a Odd',
    );
  });

  it('holds one element of each buffer for an empty scene: WebGPU binds no empty buffer', () => {
    const pack = new ScenePack();
    expect([...pack.update(new Scene())]).toEqual([]);
    for (const name of SCENE_BUFFERS) expect(pack.arrays[name].length).toBeGreaterThan(0);
    expect(pack.counts.instances).toBe(0);
  });
});

describe('the limits (record 0001, "Limits")', () => {
  it("refuses a buffer over WebGPU's default binding size with the record's sentence", () => {
    expect(maxStorageBufferBindingSize).toBe(134_217_728);
    expect(() => checkStorageBinding('nodes', 201_326_592)).toThrow(
      new RangeError(
        'the nodes buffer is 201,326,592 bytes; WebGPU binds at most 134,217,728 in one storage binding',
      ),
    );
    expect(() => checkStorageBinding('nodes', 134_217_728)).not.toThrow();
  });

  it('refuses a scene whose buffer passes the limit, names the buffer, and refuses it again', () => {
    // Many vertices and one triangle: only the vertices buffer is large.
    const g = new BufferGeometry();
    g.position = new Float32Array(1000 * 3).map((_, i) => i % 7);
    g.index = Uint32Array.of(0, 1, 2);
    const scene = sceneOf(new Mesh(g, new DiffuseMaterial()));
    const pack = new ScenePack({ maxStorageBufferBindingSize: 16_384 });
    const refusal =
      'the vertices buffer is 32,000 bytes; WebGPU binds at most 16,384 in one storage binding';
    expect(() => pack.update(scene)).toThrow(refusal);
    expect(() => pack.update(scene)).toThrow(refusal);
  });
});
