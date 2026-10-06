// === The Stanford bunny as a .glb ===
//
// `node scripts/assets/bunny.mjs` (or `bun scripts/assets/bunny.mjs`) writes
// `site/public/assets/bunny.glb` from the public source below. `--check` builds the .glb in memory
// and fails when it differs from the committed file. `--tarball <file>` reads a copy of the
// source archive, in place of the download. The script uses no library: only `node:` modules and
// `fetch`.
//
// Source:   The Stanford 3D Scanning Repository, "Stanford Bunny", reconstruction by zippering.
//           https://graphics.stanford.edu/pub/3Dscanrep/bunny.tar.gz
//           The archive holds bunny/reconstruction/bun_zipper.ply: 35,947 vertices and 69,451
//           triangles, an ASCII PLY file.
// Licence:  The repository's terms (https://graphics.stanford.edu/data/3Dscanrep/, "Please
//           acknowledge"): use for research, and mirror or redistribute for free, with credit to
//           the Stanford Computer Graphics Laboratory. Not for commercial use, and not in a product
//           for sale, without their permission. The terms of the model are not Apache-2.0, the
//           licence of this repository. site/public/assets/LICENSES.md records them.
// SHA-256 of the source archive:
//   a5720bd96d158df403d153381b8411a727a1d73cff2f33dc9b212d6f75455b84
// SHA-256 of the result, site/public/assets/bunny.glb:
//   c9fc2109db8f1c8c7f777a7c88c5cd5dfebca446390c096a33dec16219fbfef0
//
// What the conversion does:
//
// 1. It reads the vertices and the triangles of bun_zipper.ply. It checks that the triangles are
//    counter-clockwise seen from outside (the signed volume of the mesh is above 0). They are, so
//    it keeps the order of the file.
// 2. It computes a normal at each vertex: the sum of the cross products of the triangles at that
//    vertex (so each one counts with its area), scaled to unit length. The file has no normals.
//    1,113 of the 35,947 vertices belong to no triangle. They keep the normal (0, 0, 0).
// 3. It writes one scene with one node, "bunny", with one mesh of one primitive: POSITION and NORMAL
//    as floats, and the indices as unsigned shorts. The node has a scale of 10 and a translation
//    that puts the middle of the bunny's box on the y axis and its bottom on y = 0. The bunny is
//    then about 1.5 high, in the units of the examples.
// 4. It writes one material, a matte clay colour: pbrMetallicRoughness with a baseColorFactor,
//    metallicFactor 0 and roughnessFactor 0.6.
//
// The vertices keep the order of the file, and every number is a 32-bit float, so the same source
// gives the same bytes.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const SOURCE_URL = 'https://graphics.stanford.edu/pub/3Dscanrep/bunny.tar.gz';
export const SOURCE_SHA256 = 'a5720bd96d158df403d153381b8411a727a1d73cff2f33dc9b212d6f75455b84';
export const BUNNY_GLB_SHA256 = 'c9fc2109db8f1c8c7f777a7c88c5cd5dfebca446390c096a33dec16219fbfef0';
const MEMBER = 'bunny/reconstruction/bun_zipper.ply';
const OUTPUT = fileURLToPath(new URL('../../site/public/assets/bunny.glb', import.meta.url));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The bytes of member `name` of a tar archive, or an error when it has none. */
export function tarMember(tar, name) {
  let at = 0;
  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const text = (from, to) =>
      Buffer.from(header.subarray(from, to)).toString('latin1').split('\0')[0];
    const prefix = text(345, 500);
    const path = prefix ? `${prefix}/${text(0, 100)}` : text(0, 100);
    const size = parseInt(text(124, 136).trim(), 8);
    if (path === name) return tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`the archive has no member ${name}`);
}

/** The vertices (xyz, as a Float32Array) and the triangles (as an Int32Array) of an ASCII PLY. */
export function parsePly(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const end = text.indexOf('end_header\n');
  if (end < 0 || !text.startsWith('ply\nformat ascii 1.0\n')) throw new Error('not an ASCII PLY');
  const header = text.slice(0, end);
  const vertices = Number(/element vertex (\d+)/.exec(header)?.[1]);
  const faces = Number(/element face (\d+)/.exec(header)?.[1]);
  const lines = text.slice(end + 'end_header\n'.length).split('\n');
  const position = new Float32Array(vertices * 3);
  for (let i = 0; i < vertices; i++) {
    const [x, y, z] = lines[i].split(' ');
    position.set([Number(x), Number(y), Number(z)], i * 3);
  }
  const index = new Int32Array(faces * 3);
  for (let i = 0; i < faces; i++) {
    const [n, a, b, c] = lines[vertices + i].split(' ').map(Number);
    if (n !== 3) throw new Error(`face ${i} has ${n} vertices`);
    index.set([a, b, c], i * 3);
  }
  return { position, index };
}

/** The signed volume of a closed mesh: above 0 when its triangles face out. */
function signedVolume(position, index) {
  let volume = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [p, q, r] = [0, 1, 2].map((k) =>
      position.subarray(index[t + k] * 3, index[t + k] * 3 + 3),
    );
    volume +=
      (p[0] * (q[1] * r[2] - q[2] * r[1]) -
        p[1] * (q[0] * r[2] - q[2] * r[0]) +
        p[2] * (q[0] * r[1] - q[1] * r[0])) /
      6;
  }
  return volume;
}

/** One unit normal at each vertex: the area-weighted mean of the normals of its triangles. */
function vertexNormals(position, index) {
  const sum = new Float64Array(position.length);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => index[t + k] * 3);
    const e1 = [0, 1, 2].map((k) => position[b + k] - position[a + k]);
    const e2 = [0, 1, 2].map((k) => position[c + k] - position[a + k]);
    const face = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    for (const at of [a, b, c]) for (let k = 0; k < 3; k++) sum[at + k] += face[k];
  }
  const normal = new Float32Array(position.length);
  for (let v = 0; v < sum.length; v += 3) {
    const length = Math.hypot(sum[v], sum[v + 1], sum[v + 2]) || 1;
    for (let k = 0; k < 3; k++) normal[v + k] = sum[v + k] / length + 0;
  }
  return normal;
}

/** The .glb of `ply`'s mesh, as `Uint8Array`. */
export function buildGlb({ position, index }) {
  if (signedVolume(position, index) <= 0) throw new Error('the triangles face inward');
  const vertices = position.length / 3;
  if (vertices > 65535)
    throw new Error('an index of unsigned shorts holds at most 65,535 vertices');
  const normal = vertexNormals(position, index);
  const index16 = Uint16Array.from(index);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < position.length; v += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], position[v + k]);
      max[k] = Math.max(max[k], position[v + k]);
    }
  }
  const scale = 10;
  const round = (x) => Number(x.toFixed(6));
  const translation = [
    round((-scale * (min[0] + max[0])) / 2),
    round(-scale * min[1]),
    round((-scale * (min[2] + max[2])) / 2),
  ];

  const parts = [position, normal, index16].map(
    (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
  );
  const offsets = [];
  let length = 0;
  for (const part of parts) {
    offsets.push(length);
    length += Math.ceil(part.length / 4) * 4;
  }
  const bin = new Uint8Array(length);
  parts.forEach((part, i) => bin.set(part, offsets[i]));

  const json = {
    asset: {
      version: '2.0',
      generator: 'scripts/assets/bunny.mjs',
      copyright: 'Stanford University Computer Graphics Laboratory',
    },
    scene: 0,
    scenes: [{ name: 'bunny', nodes: [0] }],
    nodes: [{ name: 'bunny', mesh: 0, scale: [scale, scale, scale], translation }],
    meshes: [
      {
        name: 'bunny',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
      },
    ],
    materials: [
      {
        name: 'clay',
        pbrMetallicRoughness: {
          baseColorFactor: [0.7, 0.5, 0.36, 1],
          metallicFactor: 0,
          roughnessFactor: 0.6,
        },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertices, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: vertices, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: index16.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: parts[0].length, target: 34962 },
      { buffer: 0, byteOffset: offsets[1], byteLength: parts[1].length, target: 34962 },
      { buffer: 0, byteOffset: offsets[2], byteLength: parts[2].length, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  view.setUint32(20 + jsonLength, bin.length, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}

/** The archive's bytes: from `tarball` when it names a file, else downloaded and checked. */
async function source(tarball) {
  const bytes = tarball
    ? readFileSync(tarball)
    : new Uint8Array(await (await fetch(SOURCE_URL)).arrayBuffer());
  const sum = sha256(bytes);
  if (sum !== SOURCE_SHA256)
    throw new Error(`the archive's SHA-256 is ${sum}, not ${SOURCE_SHA256}`);
  return bytes;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const tarball = args.includes('--tarball') ? args[args.indexOf('--tarball') + 1] : undefined;
  const tar = gunzipSync(await source(tarball));
  const glb = buildGlb(parsePly(tarMember(tar, MEMBER)));
  const sum = sha256(glb);
  if (check) {
    if (!existsSync(OUTPUT) || sha256(readFileSync(OUTPUT)) !== sum) {
      console.error(`${OUTPUT} differs from the build of the source (SHA-256 ${sum})`);
      process.exit(1);
    }
    console.log(`bunny.glb matches the source: ${glb.length} bytes, SHA-256 ${sum}`);
  } else {
    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, glb);
    console.log(`wrote ${OUTPUT}: ${glb.length} bytes, SHA-256 ${sum}`);
  }
  if (sum !== BUNNY_GLB_SHA256) {
    console.error(`the result's SHA-256 is ${sum}, and the header records ${BUNNY_GLB_SHA256}`);
    process.exit(1);
  }
}
