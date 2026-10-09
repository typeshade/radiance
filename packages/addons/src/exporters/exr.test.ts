// The EXR writer and reader, held to the layout of the OpenEXR file and to bit-exact round trips.
// Verifies: Design 0010.25

import { describe, expect, it } from 'bun:test';
import { EXRExporter, type ExrImage } from './EXRExporter.ts';
import { EXRLoader } from '../loaders/EXRLoader.ts';
import { floatToHalf, halfToFloat } from './half.ts';

const exporter = new EXRExporter();
const loader = new EXRLoader();

/** A seeded generator, so the test is the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A gradient that compresses, so the ZIP path stores a deflated block. */
function gradient(width: number, height: number): Float32Array {
  const d = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) d[y * width + x] = (x + y) / (width + height);
  return d;
}

function rgba(width: number, height: number): ExrImage {
  return {
    width,
    height,
    channels: ['A', 'B', 'G', 'R'].map((name, i) => ({
      name,
      data: gradient(width, height).map((v) => v * (i + 1)),
    })),
  };
}

const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
const i32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getInt32(at, true);

/** The offset of each block, read from the offset table after the header. */
function headerEnd(bytes: Uint8Array): number {
  // The header ends with a zero byte that stands for an empty attribute name.
  let at = 8;
  for (;;) {
    let end = at;
    while (bytes[end] !== 0) end++;
    if (end === at) return at + 1;
    let typeEnd = end + 1;
    while (bytes[typeEnd] !== 0) typeEnd++;
    const size = i32(bytes, typeEnd + 1);
    at = typeEnd + 1 + 4 + size;
  }
}

const hasExrheader = Bun.which('exrheader') !== null;

describe('EXRExporter and EXRLoader', () => {
  it('writes the magic, the version and the channels in alphabetical order', async () => {
    const bytes = await exporter.parse(rgba(4, 3));
    expect([...bytes.subarray(0, 8)]).toEqual([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]);
    const text = new TextDecoder('latin1').decode(bytes);
    // The channel list is the attribute named `channels`, and its names sort.
    const list = text.slice(text.indexOf('channels\0chlist\0'));
    const names = [...list.matchAll(/([ABGR])\0/g)].map((m) => m[1]);
    expect(names.slice(0, 4)).toEqual(['A', 'B', 'G', 'R']);
  });

  it('lays out the offset table and the blocks as the file layout states', async () => {
    for (const [compression, lines] of [
      ['none', 1],
      ['zip', 16],
    ] as const) {
      const height = 40; // 40 lines: 40 blocks of one line, or 3 blocks of 16, 16 and 8 lines
      const width = 6;
      const bytes = await exporter.parse(rgba(width, height), { compression, type: 'float' });
      const at0 = headerEnd(bytes);
      const blocks = Math.ceil(height / lines);
      let expectOffset = at0 + blocks * 8;
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      for (let b = 0; b < blocks; b++) {
        const offset = Number(view.getBigUint64(at0 + b * 8, true));
        expect(offset).toBe(expectOffset);
        expect(i32(bytes, offset)).toBe(b * lines);
        const size = i32(bytes, offset + 4);
        expectOffset = offset + 8 + size;
        if (compression === 'none') expect(size).toBe(width * 4 * 4); // 4 channels, 4 bytes each
      }
      expect(expectOffset).toBe(bytes.length);
    }
  });

  it('states the file size of a 1,024 by 1,024 file of four float channels, none and zip', async () => {
    const image = rgba(1024, 1024);
    const none = await exporter.parse(image, { compression: 'none', type: 'float' });
    const zip = await exporter.parse(image, { compression: 'zip', type: 'float' });
    const raw = 1024 * 1024 * 4 * 4;
    console.log(`EXR_SIZE none=${none.length} zip=${zip.length} raw=${raw}`);
    expect(none.length).toBeGreaterThan(raw);
    expect(zip.length).toBeLessThan(none.length);
    const back = await loader.parse(zip);
    expect(back.width).toBe(1024);
  });

  it('writes a float image of 10^6 values that reads back bit for bit', async () => {
    const next = rng(0x5eed);
    const n = 1000;
    const data = new Float32Array(n * n);
    const bits = new Uint32Array(data.buffer);
    for (let i = 0; i < data.length; i++) {
      // A random finite float: exponent in the normal range, any sign and mantissa.
      let b: number;
      do {
        b = Math.floor(next() * 0x100000000) >>> 0;
      } while (((b >>> 23) & 0xff) === 0xff || ((b >>> 23) & 0xff) === 0);
      bits[i] = b;
    }
    for (const compression of ['none', 'zip'] as const) {
      const image: ExrImage = { width: n, height: n, channels: [{ name: 'Y', data }] };
      const bytes = await exporter.parse(image, { compression, type: 'float' });
      const back = await loader.parse(bytes);
      const got = new Uint32Array(back.channels[0]!.data.buffer);
      let diff = 0;
      for (let i = 0; i < data.length; i++) if (got[i] !== bits[i]) diff++;
      expect(diff).toBe(0);
    }
  });

  it('round-trips a half image: each value comes back as its half', async () => {
    const image = rgba(64, 33); // 33 lines: a ZIP block of 16, 16 and 1 lines
    for (const compression of ['none', 'zip'] as const) {
      const bytes = await exporter.parse(image, { compression, type: 'half' });
      const back = await loader.parse(bytes);
      expect(back.channels.map((c) => c.name)).toEqual(['A', 'B', 'G', 'R']);
      for (let c = 0; c < 4; c++) {
        const src = image.channels[c]!.data;
        const dst = back.channels[c]!.data;
        for (let i = 0; i < src.length; i++) {
          // The half of a value, read back, is the half a float of the same code gives.
          const want = halfToFloat(floatToHalf(src[i]!));
          expect(dst[i]).toBe(want);
        }
      }
    }
  });

  it('writes the magic, the header attributes and the compression the record names', async () => {
    const bytes = await exporter.parse(rgba(8, 8), {
      compression: 'zip',
      type: 'float',
    });
    const text = new TextDecoder('latin1').decode(bytes);
    for (const name of [
      'channels\0chlist',
      'compression\0compression',
      'dataWindow\0box2i',
      'displayWindow\0box2i',
      'lineOrder\0lineOrder',
      'pixelAspectRatio\0float',
      'screenWindowCenter\0v2f',
      'screenWindowWidth\0float',
      'chromaticities\0chromaticities',
    ]) {
      expect(text.includes(name)).toBe(true);
    }
    const at = text.indexOf('compression\0compression\0');
    expect(bytes[at + 'compression\0compression\0'.length + 4]).toBe(3); // ZIP_COMPRESSION
  });

  it('states the exrheader comparison when the tool is on the PATH', async () => {
    if (!hasExrheader) {
      console.log('EXRHEADER not run: exrheader is not on the PATH');
      return;
    }
    const dir = process.env.TMPDIR ?? '.';
    const path = `${dir}/exr-5-3-probe.exr`;
    await Bun.write(path, await exporter.parse(rgba(16, 16), { compression: 'zip', type: 'half' }));
    const out = Bun.spawnSync(['exrheader', path]).stdout.toString();
    for (const name of ['A', 'B', 'G', 'R']) expect(out).toContain(name);
  });

  // Probe: one byte of the magic changed. The reader refuses the file. Verifies: Design 0010.25
  it('refuses a file with one magic byte changed', async () => {
    const bytes = await exporter.parse(rgba(4, 4));
    bytes[2] = 0x30; // 0x31 becomes 0x30
    await expect(loader.parse(bytes)).rejects.toThrow('magic number');
  });

  // Probe: a truncated file. The reader refuses it and names the length. Verifies: Design 0010.25
  it('refuses a truncated file and names the length of the file', async () => {
    const bytes = await exporter.parse(rgba(8, 8), { compression: 'none' });
    const cut = bytes.slice(0, bytes.length - 40);
    await expect(loader.parse(cut)).rejects.toThrow(`the file has ${cut.length}`);
  });

  it('refuses a compression the reader does not take, and names it', async () => {
    const bytes = await exporter.parse(rgba(4, 4));
    const at = new TextDecoder('latin1').decode(bytes).indexOf('compression\0compression\0');
    bytes[at + 'compression\0compression\0'.length + 4] = 4; // PIZ
    await expect(loader.parse(bytes)).rejects.toThrow('PIZ_COMPRESSION');
  });
});
