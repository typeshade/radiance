// === The geometry of Sponza as a .glb ===
//
// `node scripts/assets/sponza.mjs` (or `bun scripts/assets/sponza.mjs`) writes
// `site/public/assets/sponza.glb` from the public source below. `--check` builds the .glb in
// memory and fails when it differs from the committed file. `--source <file>` reads `sponza.zip`
// from a local file, in place of the download. The script uses no library: only `node:` modules
// and `fetch`.
//
// Source:   The Computer Graphics Archive of Morgan McGuire, model "Crytek Sponza"
//           (https://casual-effects.com/data/, the model's page is "Crytek Sponza" under
//           common/model/crytek_sponza). The archive file is
//           https://casual-effects.com/g3d/data10/common/model/crytek_sponza/sponza.zip.
//           The script reads two files of the archive: sponza.obj and sponza.mtl. The model is
//           393 usemtl blocks, 262,267 triangles (126,873 quads and 8,521 triangles), 153,635
//           positions and 147,510 normals, with 25 materials. The URL does not name a version, so
//           the SHA-256 of the archive and of the two files is the pin.
// Licence:  Creative Commons Attribution 3.0 Unported (CC BY 3.0,
//           https://creativecommons.org/licenses/by/3.0/). The archive's own description of the
//           model (https://casual-effects.com/g3d/data10/common/model/crytek_sponza/info.js,
//           read on 2026-10-06) gives it as: copyright "(c) 2010 Frank Meinl, Crytek", license
//           "CC BY 3.0". The condition of the licence is the credit, which
//           site/public/assets/LICENSES.md carries. The Khronos glTF-Sample-Assets repository
//           lists the same geometry under another licence, the Cryengine Limited License
//           Agreement, and this script does not use that source (LICENSES.md says why).
//           The credit: the Atrium Sponza Palace, Dubrovnik, by Frank Meinl (Crytek), after the
//           model of Marko Dabrovic (RNA Studio, 2002), corrected by Morgan McGuire in 2011.
// SHA-256 of sponza.zip:
//   da005cbee0be2df2abc8513f3ceb61bcb6f69aac112babcd9c00169a27c2770c
// SHA-256 of sponza.obj in the archive:
//   dc9d77fa783772e92f47e67ddef8344858fa14e224711b5dd7d39f7db7042493
// SHA-256 of sponza.mtl in the archive:
//   7e5d765a00bf2af1c0cae1696051fdf04c5bb358cf2bc5cc2634ea8715669d9b
// SHA-256 of the result, site/public/assets/sponza.glb:
//   581b0eb4817fb92223412f1be15a39557c115d6555c099ce7f114885fce7f5bd
//
// What the conversion does. The result is the geometry of the model without a texture, because the
// engine draws no texture before milestone M3 (design record 0004).
//
// 1. It leaves out each face whose material has a `map_d` (an alpha mask) in the .mtl file: three
//    materials, `leaf`, `Material__57` and `chain`, the plants and the chains. A leaf is a cut-out
//    of a texture. Without the texture it is a solid card. That is 34,940 triangles of the model.
// 2. It splits each quad into two triangles, (a, b, c) and (a, c, d), and joins the faces that
//    share a material into one primitive, in the order of the file. One material is then one
//    primitive, and the path tracer draws one instance for each. A vertex is a pair of a position
//    and a normal of the file. The pair is stored once for each primitive. No position moves.
//    The normals are scaled to length 1. The indices of a primitive are unsigned shorts, or
//    unsigned integers when it has over 65,535 vertices. The texture coordinates are not copied.
// 3. It gives each material a flat colour. The colour is the mean of the material's diffuse
//    texture (`map_Kd`), measured once with ImageMagick on the textures of the archive
//    (`convert <texture> -alpha off -colorspace sRGB -resize 1x1!`, in sRGB), turned to linear,
//    and multiplied by the `Kd` of the material (1 for every kept material). The means are the
//    table MEAN_SRGB below. A material without a texture, `Material__47`, is white. The material
//    is matte: metallicFactor 0 and roughnessFactor 0.85.
// 4. It writes one scene with one node, "sponza", with one mesh. The node has the scale 0.008
//    (the model is in centimetres, and this puts it in metres), and a translation that puts the
//    middle of the box of the kept geometry on the y axis and its lowest point on y = 0.
//
// The result has the positions of the source. It is not the whole model: the owner and the record
// know it as "part of Sponza" (design record 0001, step 5).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export const SOURCE_URL =
  'https://casual-effects.com/g3d/data10/common/model/crytek_sponza/sponza.zip';
export const ZIP_SHA256 = 'da005cbee0be2df2abc8513f3ceb61bcb6f69aac112babcd9c00169a27c2770c';
export const OBJ_SHA256 = 'dc9d77fa783772e92f47e67ddef8344858fa14e224711b5dd7d39f7db7042493';
export const MTL_SHA256 = '7e5d765a00bf2af1c0cae1696051fdf04c5bb358cf2bc5cc2634ea8715669d9b';
export const SPONZA_GLB_SHA256 = '581b0eb4817fb92223412f1be15a39557c115d6555c099ce7f114885fce7f5bd';
const OUTPUT = fileURLToPath(new URL('../../site/public/assets/sponza.glb', import.meta.url));

/** The mean sRGB colour of the diffuse texture of each kept material of the source, by the name of
 *  the material. Measured on the textures of the archive named by ZIP_SHA256. The material
 *  `Material__47` has no texture, and its entry is white. */
export const MEAN_SRGB = {
  vase_round: [98, 86, 88],
  Material__298: [92, 83, 68],
  bricks: [151, 143, 126],
  arch: [118, 109, 95],
  ceiling: [170, 152, 122],
  column_a: [155, 145, 128],
  floor: [179, 163, 137],
  column_c: [162, 154, 137],
  details: [92, 88, 82],
  column_b: [138, 128, 110],
  Material__47: [255, 255, 255],
  flagpole: [124, 113, 107],
  fabric_e: [26, 103, 30],
  fabric_d: [33, 77, 125],
  fabric_a: [113, 39, 28],
  fabric_g: [46, 87, 143],
  fabric_c: [130, 29, 19],
  fabric_f: [37, 91, 14],
  vase_hanging: [33, 37, 37],
  vase: [162, 146, 121],
  Material__25: [101, 90, 69],
  roof: [107, 102, 104],
};

const SCALE = 0.008;
const ROUGHNESS = 0.85;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const srgbToLinear = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const round = (x) => Number(x.toFixed(6));

/** The files of a .zip archive as a Map of name to bytes, for the names in `wanted`. It reads the
 *  central directory, and it handles the stored and the deflated method. */
export function readZip(bytes, wanted) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('the archive has no end-of-directory record');
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(at, true) !== 0x02014b50) throw new Error('the central directory is broken');
    const method = dv.getUint16(at + 10, true);
    const size = dv.getUint32(at + 20, true);
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = Buffer.from(bytes.subarray(at + 46, at + 46 + nameLength)).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted.includes(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(data)));
    else throw new Error(`${name} has the compression method ${method}`);
  }
  for (const name of wanted) if (!out.has(name)) throw new Error(`the archive has no ${name}`);
  return out;
}

/** The materials of a .mtl text as a Map of name to `{ kd, masked }`. `masked` is true when the
 *  material has a `map_d`, an alpha mask. */
export function parseMtl(text) {
  const materials = new Map();
  let cur;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('newmtl ')) {
      cur = { kd: [1, 1, 1], masked: false };
      materials.set(line.slice(7).trim(), cur);
    } else if (cur && /^Kd\s/.test(line)) {
      cur.kd = line.slice(3).trim().split(/\s+/).map(Number);
    } else if (cur && /^map_d\s/.test(line)) {
      cur.masked = true;
    }
  }
  return materials;
}

/**
 * What the conversion keeps of the source: `groups`, one for each kept material in the order of
 * its first face, each `{ name, kd, position, normal, index }` (typed arrays), and the counts of
 * what it left out. `objText` is the text of `sponza.obj`, `materials` the result of `parseMtl`.
 */
export function selectGeometry(objText, materials) {
  const positions = [];
  const normals = [];
  const parts = new Map();
  const dropped = { materials: 0, triangles: 0 };
  for (const m of materials.values()) if (m.masked) dropped.materials++;
  let cur;
  for (const raw of objText.split('\n')) {
    if (raw.startsWith('v ')) {
      positions.push(raw.slice(2).trim().split(/\s+/).map(Number));
    } else if (raw.startsWith('vn ')) {
      const n = raw.slice(3).trim().split(/\s+/).map(Number);
      const len = Math.hypot(n[0], n[1], n[2]);
      normals.push(n.map((c) => c / len));
    } else if (raw.startsWith('usemtl ')) {
      const name = raw.slice(7).trim();
      if (!materials.has(name)) throw new Error(`the material ${name} is not in the .mtl file`);
      if (materials.get(name).masked) {
        cur = { name, skip: true };
      } else {
        if (!parts.has(name))
          parts.set(name, { name, vertices: new Map(), pos: [], nor: [], index: [] });
        cur = parts.get(name);
      }
    } else if (raw.startsWith('f ')) {
      if (!cur) throw new Error('a face comes before any usemtl');
      const words = raw.slice(2).trim().split(/\s+/);
      if (cur.skip) {
        dropped.triangles += words.length - 2;
        continue;
      }
      const ids = words.map((w) => {
        const [v, , n] = w.split('/').map((x) => (x === '' ? NaN : Number(x)));
        if (!(v > 0) || !(n > 0)) throw new Error(`a face has no position or no normal: ${raw}`);
        const key = (v - 1) * 1_000_000 + (n - 1);
        let id = cur.vertices.get(key);
        if (id === undefined) {
          id = cur.pos.length / 3;
          cur.vertices.set(key, id);
          cur.pos.push(...positions[v - 1]);
          cur.nor.push(...normals[n - 1]);
        }
        return id;
      });
      for (let i = 1; i + 1 < ids.length; i++) cur.index.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  const groups = [...parts.values()].map((g) => ({
    name: g.name,
    kd: materials.get(g.name).kd,
    position: Float32Array.from(g.pos),
    normal: Float32Array.from(g.nor),
    index: Uint32Array.from(g.index),
  }));
  return { groups, dropped };
}

/** The .glb of `groups`, as `Uint8Array`. */
export function buildGlb(groups) {
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
      name: `material-${g.name}`,
      pbrMetallicRoughness: {
        baseColorFactor: [...MEAN_SRGB[g.name].map((c, k) => round(srgbToLinear(c) * g.kd[k])), 1],
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
      copyright:
        '(c) 2010 Frank Meinl, Crytek. CC BY 3.0. After Marko Dabrovic, corrected by Morgan McGuire.',
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

/** The two source files, from the archive in `file` when it is given, else downloaded. The archive
 *  and each file are checked against their SHA-256. */
async function sources(file) {
  const zip = file
    ? new Uint8Array(readFileSync(file))
    : new Uint8Array(await (await fetch(SOURCE_URL)).arrayBuffer());
  const zipSum = sha256(zip);
  if (zipSum !== ZIP_SHA256)
    throw new Error(`the SHA-256 of the archive is ${zipSum}, not ${ZIP_SHA256}`);
  const files = readZip(zip, ['sponza.obj', 'sponza.mtl']);
  for (const [name, expected] of [
    ['sponza.obj', OBJ_SHA256],
    ['sponza.mtl', MTL_SHA256],
  ]) {
    const sum = sha256(files.get(name));
    if (sum !== expected) throw new Error(`the SHA-256 of ${name} is ${sum}, not ${expected}`);
  }
  return {
    obj: Buffer.from(files.get('sponza.obj')).toString('utf8'),
    mtl: Buffer.from(files.get('sponza.mtl')).toString('utf8'),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const file = args.includes('--source') ? args[args.indexOf('--source') + 1] : undefined;
  const { obj, mtl } = await sources(file);
  const { groups, dropped } = selectGeometry(obj, parseMtl(mtl));
  const glb = buildGlb(groups);
  const sum = sha256(glb);
  const triangles = groups.reduce((n, g) => n + g.index.length / 3, 0);
  const vertices = groups.reduce((n, g) => n + g.position.length / 3, 0);
  console.log(
    `kept ${triangles} triangles and ${vertices} vertices in ${groups.length} primitives, left out ${dropped.triangles} triangles of ${dropped.materials} masked materials`,
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
