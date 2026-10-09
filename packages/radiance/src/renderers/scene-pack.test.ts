// The scene pack (design record 0001, "Change tracking and upload", with record 0004's material
// record): the words of each buffer against the records' tables, the light table's cdf, the
// instances in the TLAS's leaf order, the buffers each kind of change writes, and the limits'
// refusals. The kernel reads these words on the oracle in intersect.test.ts and
// materials.test.ts.
//
// The `Sphere` (record 0001, "The analytic sphere", step 7) is held at the end of the file: its
// words, its refusals, what a change to it writes, and a sphere and a mesh walked on the oracle.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileModuleJs, type CpuModule, type CpuValue } from 'typeshade';
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
  INSTANCE_SPHERE,
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
import { Object3D } from '../core/Object3D.ts';
import { Mesh } from '../objects/Mesh.ts';
import { Sphere } from '../objects/Sphere.ts';
import { Scene } from '../scenes/Scene.ts';
import { checkStorageBinding, maxStorageBufferBindingSize } from './limits.ts';
import { SCENE_BUFFERS, ScenePack, packMaterial, type SceneBuffer } from './scene-pack.ts';

const bitsOf = (a: Float32Array): Uint32Array => new Uint32Array(a.buffer, a.byteOffset, a.length);
const f32 = (xs: number[]): number[] => xs.map(Math.fround);
/** The vec4 `k` of element `i` of a buffer whose element is `stride` vec4s. */
const word = (a: Float32Array | Uint32Array, stride: number, i: number, k: number): number[] =>
  Array.from(a.subarray((i * stride + k) * 4, (i * stride + k) * 4 + 4));

/** A scene of `meshes`, its matrices updated. */
function sceneOf(...meshes: Object3D[]): Scene {
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
  it("writes record 0010's 128-byte material record: the words of Part 1, integers as values", () => {
    const words = pack.arrays.materials.subarray(MATERIAL_STRIDE * 4, MATERIAL_STRIDE * 8);
    expect(MATERIAL_STRIDE * 16).toBe(128);
    expect(Array.from(words.subarray(0, 4))).toEqual(f32([0.9, 0.8, 0.7, 0.3]));
    // The emissive colour times emissiveIntensity, and the roughness.
    expect(Array.from(words.subarray(4, 8))).toEqual(f32([2, 4, 6, 0.7]));
    expect(Array.from(words.subarray(8, 11))).toEqual(f32([1.4, 0.2, 0.9]));
    // Type 2 (physical), bit 8 (emits), bit 9 (double sided) and bit 13 (thin walled: thickness 0).
    expect(words[11]).toBe(2 | 0x100 | 0x200 | 0x2000);
    // Four texture ids, each none (0).
    expect(Array.from(words.subarray(12, 16))).toEqual([0, 0, 0, 0]);
    // [4] to [7]: the physical parameters of record 0010, Part 1. This material sets none of them,
    // so each takes its default. Thin walled (0x2000) is set because thickness is 0.
    expect(Array.from(words.subarray(16, 20))).toEqual([0, 0, 0, 0]); // anisotropy, rotation, coat
    expect(Array.from(words.subarray(20, 24))).toEqual([0, 0, 0, 1]); // sheen 0; sheen roughness 1
    expect(Array.from(words.subarray(24, 28))).toEqual([0, 0, 0, 1]); // absorption 0; alpha 1
    expect(Array.from(words.subarray(28, 32))).toEqual([0, 1, 0.5, 0]); // emissiveMap none, normalScale 1, alphaCutoff 0.5, lightGroup 0
    // The diffuse one: its colour, no emission, type 0 and no flag.
    const diffuse = pack.arrays.materials.subarray(0, MATERIAL_STRIDE * 4);
    expect(Array.from(diffuse.subarray(0, 3))).toEqual(f32([0.5, 0.25, 0.125]));
    expect(Array.from(diffuse.subarray(4, 7))).toEqual([0, 0, 0]);
    expect(diffuse[11]).toBe(0);
  });

  // Verifies: Design 0010.5
  it('reads each word of a material with every parameter set, as record 0010, Part 1 gives it', () => {
    const m = new PhysicalMaterial({
      color: new Color(0.1, 0.2, 0.3),
      metalness: 0.4,
      roughness: 0.5,
      ior: 1.33,
      transmission: 0.6,
      specularIntensity: 0.7,
      emissive: new Color(0.25, 0.5, 0.75),
      emissiveIntensity: 2,
      anisotropy: 0.8,
      anisotropyRotation: 0.9,
      clearcoat: 0.11,
      clearcoatRoughness: 0.12,
      sheen: 0.13,
      sheenColor: new Color(0.14, 0.15, 0.16),
      sheenRoughness: 0.17,
      thickness: 2,
      attenuationColor: new Color(0.5, 0.5, 0.5),
      attenuationDistance: 4,
      multipleScattering: false,
    });
    m.flatShading = true;
    const w = packMaterial(m);
    expect(Array.from(w.subarray(0, 4))).toEqual(f32([0.1, 0.2, 0.3, 0.4]));
    expect(Array.from(w.subarray(4, 8))).toEqual(f32([0.5, 1, 1.5, 0.5]));
    // Type 2 | emits (the emissive colour is above 0) | flat shading | no multiple scattering.
    // Thickness is not 0, so the material is not thin walled.
    expect(Array.from(w.subarray(8, 12))).toEqual(
      f32([1.33, 0.6, 0.7, 2 | 0x100 | 0x800 | 0x1000]),
    );
    expect(Array.from(w.subarray(12, 16))).toEqual([0, 0, 0, 0]);
    expect(Array.from(w.subarray(16, 20))).toEqual(f32([0.8, 0.9, 0.11, 0.12]));
    expect(Array.from(w.subarray(20, 24))).toEqual(f32([0.14, 0.15, 0.16, 0.17]));
    // sigma = -ln(0.5) / 4 per channel, and the alpha of the base colour (1).
    const sigma = -Math.log(0.5) / 4;
    expect(Array.from(w.subarray(24, 28))).toEqual(f32([sigma, sigma, sigma, 1]));
    expect(Array.from(w.subarray(28, 32))).toEqual(f32([0, 1, 0.5, 0]));
  });

  // Verifies: Design 0010.5
  it('sets thin walled (bit 13) when thickness is 0, and not otherwise', () => {
    const thin = packMaterial(new PhysicalMaterial({ thickness: 0 }));
    const thick = packMaterial(new PhysicalMaterial({ thickness: 0.5 }));
    expect(thin[11]! & 0x2000).toBe(0x2000);
    expect(thick[11]! & 0x2000).toBe(0);
  });

  it('writes the type of each material class', () => {
    const type = (m: DiffuseMaterial | MirrorMaterial | EmissiveMaterial | PhysicalMaterial) =>
      packMaterial(m)[11]! & 0xff;
    expect(type(new DiffuseMaterial())).toBe(0);
    expect(type(new MirrorMaterial())).toBe(1);
    expect(type(new PhysicalMaterial())).toBe(2);
    expect(type(new EmissiveMaterial())).toBe(0);
    expect(packMaterial(new EmissiveMaterial())[11]).toBe(0x100);
  });

  // Verifies: Design 0004.10
  it('clears the flatShading flag by default: 3 of 3 material classes', () => {
    const fresh = [new DiffuseMaterial(), new MirrorMaterial(), new PhysicalMaterial()];
    const clear = fresh.filter((m) => !m.flatShading && (packMaterial(m)[11]! & 0x800) === 0);
    expect(clear.length).toBe(3);
  });

  // Verifies: Design 0004.10
  it('sets the flatShading flag in the type and flags word alone, as 0x800, and the setter adds 1 to version', () => {
    for (const make of [
      () => new DiffuseMaterial({ color: 0x336699 }),
      () => new MirrorMaterial(),
      () => new PhysicalMaterial({ roughness: 0.3 }),
    ]) {
      const smooth = packMaterial(make());
      const m = make();
      const version = m.version;
      m.flatShading = true;
      expect(m.flatShading).toBe(true);
      expect(m.version).toBe(version + 1);
      const flat = packMaterial(m);
      expect(flat.length).toBe(32);
      const differ = [...flat.keys()].filter((i) => flat[i] !== smooth[i]);
      expect(differ).toEqual([11]);
      expect(flat[11]).toBe(smooth[11]! | 0x800);
    }
  });

  // Verifies: Design 0004.10
  it('takes flatShading from the parameters, with no change to version', () => {
    for (const m of [
      new DiffuseMaterial({ flatShading: true }),
      new MirrorMaterial({ flatShading: true }),
    ]) {
      expect(m.flatShading).toBe(true);
      expect(m.version).toBe(0);
      expect(packMaterial(m)[11]! & 0x800).toBe(0x800);
    }
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
    // The lamp's two triangles have one area, so their cdf is 0.5 and 1 whatever the power:
    // only the words moved.
    lampMaterial.emissive = new Color(0, 0, 0);
    expect(update()).toEqual(['lights', 'materials']);
    expect(pack.counts.lights).toBe(0);
  });

  it('writes the materials and the instances when a mesh takes another material', () => {
    sphere.material = new MirrorMaterial();
    expect(update()).toEqual(['instances', 'lights', 'materials', 'nodes']);
  });

  it('drops the BLAS of a geometry whose index is emptied in place, and draws nothing of it', () => {
    const pebble = new SphereGeometry(1, 8, 4);
    const pebbles = sceneOf(new Mesh(pebble, grey), new Mesh(new PlaneGeometry(1, 1), grey));
    const own = new ScenePack();
    own.update(pebbles);
    expect(own.counts).toMatchObject({ instances: 2, triangles: pebble.index.length / 3 + 2 });
    pebble.index = new Uint32Array(0);
    expect([...own.update(pebbles)].sort()).toEqual([
      'instances',
      'lights',
      'nodes',
      'triangles',
      'vertices',
    ]);
    expect(own.counts).toMatchObject({ instances: 1, triangles: 2 });
    expect([...own.update(pebbles)]).toEqual([]);
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

// ---- The analytic sphere (record 0001, "The analytic sphere", step 7) ----------------------

type Vec = [number, number, number];

/** A `Sphere` of `radius` at `centre`, of a diffuse material unless one is given. */
function sphereAt(centre: Vec, radius: number, material = new DiffuseMaterial()): Sphere {
  const s = new Sphere(radius, material);
  s.position.set(...centre);
  return s;
}

/** The instance words of slot 0, as numbers and as bits. */
const slot0 = (pack: ScenePack) => ({
  words: (k: number) => word(pack.arrays.instances, INSTANCE_STRIDE, 0, k),
  bits: (k: number) => word(bitsOf(pack.arrays.instances), INSTANCE_STRIDE, 0, k),
});

describe('ScenePack: the words of a Sphere (record 0001, "What stores it")', () => {
  // Verifies: Design 0001.11
  it('packs one sphere as 1 instance, 1 node, 0 triangles, 0 vertices and 0 lights', () => {
    const pack = new ScenePack();
    pack.update(sceneOf(sphereAt([1, 2, 3], 2)));
    expect(pack.counts).toMatchObject({
      tlasBase: 0,
      instances: 1,
      nodes: 1,
      triangles: 0,
      vertices: 0,
      lights: 0,
    });
    const { words, bits } = slot0(pack);
    expect(words(INSTANCE_MATRIX)).toEqual([1, 2, 3, 2]);
    expect(words(1)).toEqual([0, 0, 0, 0]);
    expect(words(2)).toEqual([0, 0, 0, 0]);
    expect([0, 1, 2].map((r) => words(INSTANCE_INVERSE + r))).toEqual([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ]);
    expect(bits(INSTANCE_BASES)).toEqual([0, 0, 0, 0]);
    expect(bits(INSTANCE_FLAGS)).toEqual([INSTANCE_SPHERE, 0xffffffff, 0, 0]);
    expect(INSTANCE_SPHERE).toBe(1);
  });

  // Verifies: Design 0001.11
  it('gives its node the box (-1, 0, 1) to (3, 4, 5), widened by at most 1e-6 on each side', () => {
    const pack = new ScenePack();
    pack.update(sceneOf(sphereAt([1, 2, 3], 2)));
    const lo = Array.from(pack.arrays.nodes.subarray(0, 3));
    const hi = Array.from(pack.arrays.nodes.subarray(4, 7));
    [-1, 0, 1].forEach((x, k) => {
      expect(lo[k]!).toBeLessThanOrEqual(x);
      expect(x - lo[k]!).toBeLessThanOrEqual(1e-6);
    });
    [3, 4, 5].forEach((x, k) => {
      expect(hi[k]!).toBeGreaterThanOrEqual(x);
      expect(hi[k]! - x).toBeLessThanOrEqual(1e-6);
    });
    // A leaf of one instance, the first.
    expect(bitsOf(pack.arrays.nodes)[3]).toBe(0);
    expect(bitsOf(pack.arrays.nodes)[7]! & NODE_COUNT_MASK).toBe(1);
  });

  // Verifies: Design 0001.12
  it('gives a sphere of radius 1 under a uniform scale of 2 the same words', () => {
    const a = new ScenePack();
    a.update(sceneOf(sphereAt([1, 2, 3], 2)));
    const scaled = sphereAt([1, 2, 3], 1);
    scaled.scale.set(2, 2, 2);
    const b = new ScenePack();
    b.update(sceneOf(scaled));
    expect(Array.from(bitsOf(b.arrays.instances))).toEqual(Array.from(bitsOf(a.arrays.instances)));
    expect(Array.from(bitsOf(b.arrays.nodes))).toEqual(Array.from(bitsOf(a.arrays.nodes)));
  });

  // Verifies: Design 0001.12
  it('gives a scale of (-1, 1, 1) the first row (-1, 0, 0, 0): a mirror passes', () => {
    const mirrored = sphereAt([1, 2, 3], 2);
    mirrored.scale.set(-1, 1, 1);
    const pack = new ScenePack();
    pack.update(sceneOf(mirrored));
    const { words } = slot0(pack);
    expect(words(INSTANCE_INVERSE)).toEqual([-1, 0, 0, 0]);
    expect(words(INSTANCE_MATRIX)).toEqual([1, 2, 3, 2]);
  });

  it('writes the rows of R^T for a turned sphere: the world axes over the scale', () => {
    const turned = sphereAt([0, 0, 0], 1);
    turned.rotation.set(0.3, -0.7, 1.1);
    turned.scale.set(3, 3, 3);
    const pack = new ScenePack();
    pack.update(sceneOf(turned));
    const e = turned.matrixWorld.elements;
    const { words } = slot0(pack);
    for (let r = 0; r < 3; r++)
      expect(words(INSTANCE_INVERSE + r)).toEqual(
        f32([e[r * 4]! / 3, e[r * 4 + 1]! / 3, e[r * 4 + 2]! / 3, 0]),
      );
    expect(words(INSTANCE_MATRIX)[3]).toBe(3);
  });

  it('shares one material row between a mesh and a sphere', () => {
    const shared = new DiffuseMaterial({ color: new Color(0.2, 0.4, 0.6) });
    const pack = new ScenePack();
    pack.update(sceneOf(new Mesh(new PlaneGeometry(1, 1), shared), sphereAt([0, 2, 0], 1, shared)));
    expect(pack.counts.materials).toBe(1);
    expect(pack.counts.instances).toBe(2);
  });
});

describe('ScenePack: the refusals of a Sphere (record 0001, "The analytic sphere")', () => {
  // Verifies: Design 0001.12
  it('refuses a scale of (1, 2, 3) with a RangeError that names 1, 2 and 3', () => {
    const stretched = sphereAt([0, 0, 0], 1);
    stretched.scale.set(1, 2, 3);
    const pack = new ScenePack();
    expect(() => pack.update(sceneOf(stretched))).toThrow(
      new RangeError(
        'a Sphere needs a uniform scale and no shear: its world axes have lengths 1, 2 and 3',
      ),
    );
  });

  // Verifies: Design 0001.12
  it('refuses a shear: a parent scaled (1, 2, 1) over a child turned 0.5 rad about z', () => {
    const parent = new Object3D();
    parent.scale.set(1, 2, 1);
    const child = sphereAt([0, 0, 0], 1);
    child.rotation.z = 0.5;
    parent.add(child);
    const pack = new ScenePack();
    let error: unknown;
    try {
      pack.update(sceneOf(parent));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toStartWith(
      'a Sphere needs a uniform scale and no shear: its world axes have lengths ',
    );
  });

  // Verifies: Design 0001.12
  it('refuses a radius of 0, -1, NaN and Infinity with a RangeError: 4 cases', () => {
    let refused = 0;
    for (const radius of [0, -1, NaN, Infinity]) {
      const pack = new ScenePack();
      try {
        pack.update(sceneOf(sphereAt([0, 0, 0], radius)));
      } catch (e) {
        if (
          e instanceof RangeError &&
          e.message === `a Sphere's radius must be above 0 and finite: ${radius}`
        )
          refused++;
      }
    }
    expect(refused).toBe(4);
  });

  // Verifies: Design 0001.13
  it('refuses a sphere whose material emits with the TypeError of the record', () => {
    const pack = new ScenePack();
    const glow = new EmissiveMaterial({ color: new Color(1, 1, 1) });
    expect(() => pack.update(sceneOf(sphereAt([0, 0, 0], 1, glow)))).toThrow(
      new TypeError('a Sphere does not emit: the light table lists triangles only'),
    );
  });

  it('draws nothing for a scale of 0: 0 instances', () => {
    const flat = sphereAt([0, 0, 0], 1);
    flat.scale.set(0, 0, 0);
    const pack = new ScenePack();
    pack.update(sceneOf(flat));
    expect(pack.counts.instances).toBe(0);
  });

  it('still refuses a mesh whose geometry is not a BufferGeometry, beside a sphere', () => {
    class Odd extends Geometry {
      readonly type = 'Odd';
    }
    const pack = new ScenePack();
    expect(() =>
      pack.update(sceneOf(sphereAt([0, 0, 0], 1), new Mesh(new Odd(), new DiffuseMaterial()))),
    ).toThrow(new TypeError('the path tracer draws a BufferGeometry, and a mesh holds a Odd'));
  });
});

// Verifies: Design 0001.5
describe('ScenePack: what a change to a Sphere writes (record 0001, "The analytic sphere")', () => {
  const ball = sphereAt([0, 0, 0], 1);
  const other = sphereAt([3, 0, 0], 0.5);
  const scene = sceneOf(ball, other);
  const pack = new ScenePack();
  pack.update(scene);
  const triangles = pack.arrays.triangles;
  const update = (): string[] => {
    scene.updateMatrixWorld();
    return [...pack.update(scene)].sort();
  };

  it('writes nothing for an unchanged scene', () => {
    expect(update()).toEqual([]);
  });

  it('writes instances and nodes when the sphere moves by 0.1, and keeps the triangles array', () => {
    ball.position.x += 0.1;
    // The light table is written with the instances (rule 3 of the upload), and holds no light.
    expect(update()).toEqual(['instances', 'lights', 'nodes']);
    expect(pack.arrays.triangles).toBe(triangles);
    expect(update()).toEqual([]);
  });

  it('writes instances and nodes when the radius changes, and keeps the triangles array', () => {
    ball.radius = 1.25;
    // The light table is written with the instances (rule 3 of the upload), and holds no light.
    expect(update()).toEqual(['instances', 'lights', 'nodes']);
    expect(pack.arrays.triangles).toBe(triangles);
    expect(update()).toEqual([]);
  });
});

/** The module of the walk, compiled for the CPU oracle at f32. */
function loadIntersect(): CpuModule {
  const path = join(import.meta.dir, '../kernels/intersect.shade.ts');
  const read = (f: string): string | undefined => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return undefined;
    }
  };
  const c = compile(readFileSync(path, 'utf8'), { fileName: path, readDocument: read });
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return compileModuleJs(c.module!, { precision: 'f32' });
}

/** Numbers in [0, 1) from a seed: mulberry32. */
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

describe('ScenePack: a Sphere and a mesh on the oracle (record 0001, step 7)', () => {
  // A sphere and a box that cut into each other, so either can be the nearer.
  const centre: Vec = [-0.3, 0.05, 0.1];
  const radius = 0.7;
  const ball = sphereAt(centre, radius);
  const boxCentre: Vec = [0.5, -0.1, -0.2];
  const half: Vec = [0.6, 0.4, 0.5];
  const box = new Mesh(
    new BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
    new DiffuseMaterial(),
  );
  box.position.set(...boxCentre);
  const pack = new ScenePack();
  pack.update(sceneOf(ball, box));

  /** The sphere in f64: the smaller root above 0, or Infinity. */
  const sphereT = (o: Vec, d: Vec): number => {
    const oc = [o[0] - centre[0], o[1] - centre[1], o[2] - centre[2]];
    const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const b = oc[0]! * d[0] + oc[1]! * d[1] + oc[2]! * d[2];
    const c = oc[0]! ** 2 + oc[1]! ** 2 + oc[2]! ** 2 - radius * radius;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const t1 = (-b - Math.sqrt(disc)) / a;
    const t2 = (-b + Math.sqrt(disc)) / a;
    return t1 > 0 ? t1 : t2 > 0 ? t2 : Infinity;
  };
  /** The box in f64, by the slab test: where the ray enters it, or Infinity. */
  const boxT = (o: Vec, d: Vec): number => {
    let near = 0;
    let far = Infinity;
    for (let k = 0; k < 3; k++) {
      const t0 = (boxCentre[k]! - half[k]! - o[k]!) / d[k]!;
      const t1 = (boxCentre[k]! + half[k]! - o[k]!) / d[k]!;
      near = Math.max(near, Math.min(t0, t1));
      far = Math.min(far, Math.max(t0, t1));
    }
    return near <= far && near > 0 ? near : Infinity;
  };

  it('packs 2 instances', () => {
    expect(pack.counts.instances).toBe(2);
  });

  // Verifies: Design 0001.11
  it('nearest finds the nearer of the two as a brute force in f64 does: 1,000 of 1,000', () => {
    const cpu = loadIntersect();
    for (const name of SCENE_BUFFERS)
      cpu.setBinding(
        name,
        Array.from({ length: pack.arrays[name].length / 4 }, (_, i) =>
          Array.from(pack.arrays[name].subarray(i * 4, i * 4 + 4)),
        ) as unknown as CpuValue,
      );
    const params = pack.params({
      camera: {
        eye: [0, 0, 0, 0],
        right: [1, 0, 0, 0],
        up: [0, 1, 0, 0],
        forward: [0, 0, -1, 0],
        lens: [1, 1, 0, 0],
      },
      frame: [1, 1, 0, 1],
      tile: [0, 0, 1, 1],
      seed: 0,
      bounces: 8,
      rouletteFrom: 3,
    });
    cpu.setBinding('params', JSON.parse(JSON.stringify(params)) as CpuValue);
    const nearest = cpu.fns['nearest']! as unknown as (...a: unknown[]) => { instance: number };
    const flags = (slot: number): number =>
      bitsOf(pack.arrays.instances)[(slot * INSTANCE_STRIDE + INSTANCE_FLAGS) * 4]!;
    const NONE = 0xffffffff;
    const next = random(81);
    let same = 0;
    const met = { sphere: 0, box: 0, none: 0 };
    for (let i = 0; i < 1000; i++) {
      const z = next() * 2 - 1;
      const phi = next() * 2 * Math.PI;
      const s = Math.sqrt(1 - z * z);
      const o = f32([5 * s * Math.cos(phi), 5 * s * Math.sin(phi), 5 * z]) as Vec;
      const to = [next() * 2.4 - 1.1, next() * 1.8 - 0.9, next() * 1.8 - 0.9];
      const l = Math.hypot(to[0]! - o[0], to[1]! - o[1], to[2]! - o[2]);
      const d = f32([(to[0]! - o[0]) / l, (to[1]! - o[1]) / l, (to[2]! - o[2]) / l]) as Vec;
      const ts = sphereT(o, d);
      const tb = boxT(o, d);
      const want = ts === Infinity && tb === Infinity ? 'none' : ts < tb ? 'sphere' : 'box';
      const hit = nearest(o, d, Math.fround(1e30));
      const got =
        hit.instance === NONE
          ? 'none'
          : (flags(hit.instance) & INSTANCE_SPHERE) !== 0
            ? 'sphere'
            : 'box';
      if (got === want) same++;
      met[want]++;
    }
    expect(same).toBe(1000);
    // The rays meet both kinds, and miss too.
    expect(met.sphere).toBeGreaterThan(50);
    expect(met.box).toBeGreaterThan(50);
    expect(met.none).toBeGreaterThan(50);
  }, 60_000);
});
