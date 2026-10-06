// === The geometry of Sponza as a .glb ===
//
// `node scripts/assets/sponza.mjs` (or `bun scripts/assets/sponza.mjs`) writes
// `site/public/assets/sponza.glb` from the public source below. `--check` builds the .glb in
// memory and fails when it differs from the committed file. `--source <dir>` reads `Sponza.gltf`
// and `Sponza.bin` from a directory, in place of the download. The script uses no library: only
// `node:` modules and `fetch`.
//
// Source:   The Khronos glTF-Sample-Assets repository, model "Sponza", at the commit named by
//           SOURCE_COMMIT below. The two files are Models/Sponza/glTF/Sponza.gltf and
//           Models/Sponza/glTF/Sponza.bin. The model is 103 primitives, 262,267 triangles and
//           192,496 vertices, with 25 materials.
// Licence:  NOT Creative Commons. The model's README and LICENSE.md in that repository give
//           "(c) 2016, Crytek" under the "Cryengine Limited License Agreement"
//           (LicenseRef-CRYENGINE-Agreement, https://www.cryengine.com/ce-terms). The agreement is
//           a licence for the CRYENGINE and for games made with it. It does not say that a copy of
//           the model may be redistributed on its own. The credit the README keeps: the Atrium
//           Sponza Palace, Dubrovnik, by Frank Meinl (Crytek), after the model of Marko Dabrovic
//           (RNA Studio, 2002), modified by Morgan McGuire in 2011, and prepared as glTF by the
//           Khronos Group. site/public/assets/LICENSES.md records this, and it is an open point for
//           the owner before the file is published.
// SHA-256 of Sponza.gltf:
//   646c10cbc8fab990ca29f363e90e2d65155f3a3569506852eb1434a9465b9501
// SHA-256 of Sponza.bin:
//   fdbdbfb6a76edeb6626f28a1401bc1536bb1c864131a64e90fbc3df2d2d191bd
// SHA-256 of the result, site/public/assets/sponza.glb:
//   162a13362fdd4d624e381555f2785004b2d617f90666350facf422a907ff6486
//
// What the conversion does. The result is the geometry of the model without a texture, because the
// engine draws no texture before milestone M3 (design record 0004).
//
// 1. It leaves out each primitive whose material has alphaMode MASK: three materials, the plants,
//    the chains and the flag. A leaf is a cut-out of a texture. Without the texture it is a solid
//    card. That is 3 materials, 14 primitives and 34,940 triangles of the model.
// 2. It joins the primitives that share a material into one primitive, in the order of the file.
//    One material is then one primitive, and the path tracer draws one instance for each. Vertex
//    positions and normals are copied as the file has them: no vertex moves. The indices of a
//    joined primitive are unsigned shorts, or unsigned integers when it has over 65,535 vertices.
//    The texture coordinates and the tangents are not copied.
// 3. It gives each material a flat colour. The colour is the mean of the material's diffuse
//    texture, measured once with ImageMagick (`convert <texture> -resize 1x1!`, in sRGB), turned to
//    linear, and multiplied by the model's own constant diffuse factor (0.588, in every
//    baseColorFactor of the file). The means are the table MEAN_SRGB below. The material is matte:
//    metallicFactor 0 and roughnessFactor 0.85.
// 4. It writes one scene with one node, "sponza", with one mesh. The node has the scale 0.008 that
//    the source's node has (the model is in centimetres, and this puts it in metres), and a
//    translation that puts the middle of the box of the kept geometry on the y axis and its
//    lowest point on y = 0.
//
// The result has the same normals and positions as the source. It is not the whole model: the
// owner and the record know it as "part of Sponza" (design record 0001, step 5).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_COMMIT = 'edc7c9e67c639d230715049ee31f9a96a6babbbe';
const BASE = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${SOURCE_COMMIT}/Models/Sponza/glTF/`;
export const SOURCES = {
  'Sponza.gltf': '646c10cbc8fab990ca29f363e90e2d65155f3a3569506852eb1434a9465b9501',
  'Sponza.bin': 'fdbdbfb6a76edeb6626f28a1401bc1536bb1c864131a64e90fbc3df2d2d191bd',
};
export const SPONZA_GLB_SHA256 = '162a13362fdd4d624e381555f2785004b2d617f90666350facf422a907ff6486';
const OUTPUT = fileURLToPath(new URL('../../site/public/assets/sponza.glb', import.meta.url));

/** The mean sRGB colour of the diffuse texture of each material of the source, by its index in
 *  `materials`. Measured on the textures of SOURCE_COMMIT. Material 2 has no texture but a white
 *  pixel. Materials 0, 3 and 20 are alpha-masked and the conversion leaves them out. */
export const MEAN_SRGB = [
  [61, 58, 45],
  [98, 86, 88],
  [197, 197, 197],
  [125, 130, 50],
  [92, 83, 68],
  [151, 143, 126],
  [118, 109, 95],
  [170, 152, 121],
  [155, 145, 128],
  [179, 163, 137],
  [162, 154, 137],
  [92, 88, 82],
  [138, 128, 110],
  [124, 113, 107],
  [27, 103, 30],
  [33, 77, 124],
  [113, 39, 28],
  [46, 87, 142],
  [130, 29, 19],
  [37, 90, 14],
  [151, 70, 28],
  [34, 37, 37],
  [162, 146, 121],
  [101, 90, 69],
  [107, 102, 104],
];

const SCALE = 0.008;
const ROUGHNESS = 0.85;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const srgbToLinear = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const round = (x) => Number(x.toFixed(6));

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const WIDTH = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };

/** The elements of accessor `index` of `gltf`, read from `bin`, as a typed array of its type. */
function readAccessor(gltf, bin, index) {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const width = WIDTH[a.componentType];
  const stride = view.byteStride ?? n * width;
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const Out = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[
    a.componentType
  ];
  const out = new Out(a.count * n);
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) {
      const at = start + i * stride + k * width;
      out[i * n + k] =
        a.componentType === 5126
          ? data.getFloat32(at, true)
          : a.componentType === 5125
            ? data.getUint32(at, true)
            : a.componentType === 5123
              ? data.getUint16(at, true)
              : data.getUint8(at);
    }
  }
  return out;
}

/**
 * What the conversion keeps of the source: `groups`, one for each kept material in the order of
 * `materials`, each `{ material, position, normal, index }` (typed arrays), and the counts of what
 * it left out. `gltf` is the parsed `Sponza.gltf`, `bin` the bytes of `Sponza.bin`.
 */
export function selectGeometry(gltf, bin) {
  const masked = new Set(gltf.materials.flatMap((m, i) => (m.alphaMode === 'MASK' ? [i] : [])));
  const parts = new Map();
  const dropped = { materials: masked.size, primitives: 0, triangles: 0 };
  for (const p of gltf.meshes[0].primitives) {
    if (p.mode !== undefined && p.mode !== 4) throw new Error('a primitive is not a triangle list');
    const index = readAccessor(gltf, bin, p.indices);
    if (masked.has(p.material)) {
      dropped.primitives++;
      dropped.triangles += index.length / 3;
      continue;
    }
    if (!parts.has(p.material)) parts.set(p.material, []);
    parts.get(p.material).push({
      position: readAccessor(gltf, bin, p.attributes.POSITION),
      normal: readAccessor(gltf, bin, p.attributes.NORMAL),
      index,
    });
  }
  const groups = [...parts.keys()]
    .sort((a, b) => a - b)
    .map((material) => {
      const list = parts.get(material);
      const vertices = list.reduce((n, q) => n + q.position.length / 3, 0);
      const triangles = list.reduce((n, q) => n + q.index.length, 0);
      const position = new Float32Array(vertices * 3);
      const normal = new Float32Array(vertices * 3);
      const index = new Uint32Array(triangles);
      let v = 0;
      let t = 0;
      for (const q of list) {
        position.set(q.position, v * 3);
        normal.set(q.normal, v * 3);
        for (let i = 0; i < q.index.length; i++) index[t + i] = q.index[i] + v;
        v += q.position.length / 3;
        t += q.index.length;
      }
      return { material, position, normal, index };
    });
  return { groups, dropped };
}

/** The .glb of `groups`, as `Uint8Array`. `factor` is the source's diffuse factor. */
export function buildGlb(groups, factor) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const g of groups) {
    for (let v = 0; v < g.position.length; v += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], g.position[v + k]);
        max[k] = Math.max(max[k], g.position[v + k]);
      }
    }
  }
  const translation = [
    round((-SCALE * (min[0] + max[0])) / 2),
    round(-SCALE * min[1]),
    round((-SCALE * (min[2] + max[2])) / 2),
  ];

  const chunks = [];
  let length = 0;
  const view = (array, target) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const at = length;
    chunks.push([at, bytes]);
    length += Math.ceil(bytes.length / 4) * 4;
    return { buffer: 0, byteOffset: at, byteLength: bytes.length, target };
  };

  const accessors = [];
  const bufferViews = [];
  const primitives = [];
  const materials = [];
  for (const g of groups) {
    const vertices = g.position.length / 3;
    const gmin = [Infinity, Infinity, Infinity];
    const gmax = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < g.position.length; v += 3) {
      for (let k = 0; k < 3; k++) {
        gmin[k] = Math.min(gmin[k], g.position[v + k]);
        gmax[k] = Math.max(gmax[k], g.position[v + k]);
      }
    }
    const wide = vertices > 65535;
    const index = wide ? g.index : Uint16Array.from(g.index);
    const first = accessors.length;
    bufferViews.push(view(g.position, 34962), view(g.normal, 34962), view(index, 34963));
    accessors.push(
      {
        bufferView: bufferViews.length - 3,
        componentType: 5126,
        count: vertices,
        type: 'VEC3',
        min: gmin,
        max: gmax,
      },
      { bufferView: bufferViews.length - 2, componentType: 5126, count: vertices, type: 'VEC3' },
      {
        bufferView: bufferViews.length - 1,
        componentType: wide ? 5125 : 5123,
        count: index.length,
        type: 'SCALAR',
      },
    );
    primitives.push({
      attributes: { POSITION: first, NORMAL: first + 1 },
      indices: first + 2,
      material: materials.length,
    });
    materials.push({
      name: `material-${g.material}`,
      pbrMetallicRoughness: {
        baseColorFactor: [...MEAN_SRGB[g.material].map((c) => round(srgbToLinear(c) * factor)), 1],
        metallicFactor: 0,
        roughnessFactor: ROUGHNESS,
      },
    });
  }
  const bin = new Uint8Array(length);
  for (const [at, bytes] of chunks) bin.set(bytes, at);

  const json = {
    asset: {
      version: '2.0',
      generator: 'scripts/assets/sponza.mjs',
      copyright: 'Crytek, Frank Meinl, Marko Dabrovic, Morgan McGuire, Khronos Group',
    },
    scene: 0,
    scenes: [{ name: 'sponza', nodes: [0] }],
    nodes: [{ name: 'sponza', mesh: 0, scale: [SCALE, SCALE, SCALE], translation }],
    meshes: [{ name: 'sponza', primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLength, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  dv.setUint32(20 + jsonLength, bin.length, true);
  dv.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}

/** The bytes of each source file: from `dir` when it names a directory, else downloaded. Each is
 *  checked against its SHA-256. */
async function sources(dir) {
  const out = {};
  for (const [name, expected] of Object.entries(SOURCES)) {
    const bytes = dir
      ? readFileSync(join(dir, name))
      : new Uint8Array(await (await fetch(BASE + name)).arrayBuffer());
    const sum = sha256(bytes);
    if (sum !== expected) throw new Error(`the SHA-256 of ${name} is ${sum}, not ${expected}`);
    out[name] = bytes;
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const dir = args.includes('--source') ? args[args.indexOf('--source') + 1] : undefined;
  const files = await sources(dir);
  const gltf = JSON.parse(Buffer.from(files['Sponza.gltf']).toString('utf8'));
  const { groups, dropped } = selectGeometry(gltf, files['Sponza.bin']);
  const factor = gltf.materials[groups[0].material].pbrMetallicRoughness.baseColorFactor[0];
  const glb = buildGlb(groups, factor);
  const sum = sha256(glb);
  const triangles = groups.reduce((n, g) => n + g.index.length / 3, 0);
  const vertices = groups.reduce((n, g) => n + g.position.length / 3, 0);
  console.log(
    `kept ${triangles} triangles and ${vertices} vertices in ${groups.length} primitives, left out ${dropped.triangles} triangles of ${dropped.primitives} primitives (${dropped.materials} masked materials)`,
  );
  if (check) {
    if (!existsSync(OUTPUT) || sha256(readFileSync(OUTPUT)) !== sum) {
      console.error(`${OUTPUT} differs from the build of the source (SHA-256 ${sum})`);
      process.exit(1);
    }
    console.log(`sponza.glb matches the source: ${glb.length} bytes, SHA-256 ${sum}`);
  } else {
    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, glb);
    console.log(`wrote ${OUTPUT}: ${glb.length} bytes, SHA-256 ${sum}`);
  }
  if (sum !== SPONZA_GLB_SHA256) {
    console.error(`the result's SHA-256 is ${sum}, and the header records ${SPONZA_GLB_SHA256}`);
    process.exit(1);
  }
}
