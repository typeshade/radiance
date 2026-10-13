// === EXRExporter: a scanline OpenEXR file, written on the host ===
//
// Design record 0010, Part 5 ('The EXR file', decision 25). The package writes the file itself,
// because the boundary allows no library. The layout follows the OpenEXR file layout: a magic
// number, a version field of 2, a header, an offset table of one 64-bit offset for each block,
// and the blocks. A block holds one scan line for `none` and 16 scan lines for `zip`. The
// channels are in alphabetical order, and each block stores a channel after another.
//
// The header holds the attributes the file needs (`channels`, `compression`, `dataWindow`,
// `displayWindow`, `lineOrder`, `pixelAspectRatio`, `screenWindowCenter`, `screenWindowWidth`),
// `chromaticities` for the Rec. 709 primaries, and the caller's `attributes`.

import { zipCompressBlock } from './exr-zip.ts';
import { floatToHalf } from './half.ts';

/** The image an `EXRExporter` writes. Row 0 is the top row. */
export interface ExrImage {
  width: number;
  height: number;
  /** One entry for each channel. Each `data` holds `width * height` values, row by row. */
  channels: { name: string; data: Float32Array }[];
  /**
   * Header attributes. A number is a `float`, a string is a `string`, and an array of 2, 3, 9 or
   * 16 numbers is a `v2f`, `v3f`, `m33f` or `m44f`. The names the exporter writes itself are not
   * allowed here.
   */
  attributes?: Record<string, number | string | number[]>;
}

/** The options of `EXRExporter.parse`. Each one defaults as shown. */
export interface ExrOptions {
  /** `none` writes one scan line for each block. `zip` writes 16 scan lines for each block. */
  compression?: 'none' | 'zip';
  /** `float` writes 32-bit values. `half` writes IEEE binary16 values, rounded to nearest even. */
  type?: 'half' | 'float';
}

/** The header attributes the exporter writes itself. A caller may not pass one of these. */
const OWN = new Set([
  'channels',
  'compression',
  'dataWindow',
  'displayWindow',
  'lineOrder',
  'pixelAspectRatio',
  'screenWindowCenter',
  'screenWindowWidth',
  'chromaticities',
]);

/** The chromaticities of Rec. 709 with the D65 white point, in the order the standard lists. */
const REC709 = [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329];

/** Little-endian bytes, grown as the header and the blocks are written. */
class ByteSink {
  private buf = new Uint8Array(4096);
  private n = 0;
  private view = new DataView(this.buf.buffer);

  get length(): number {
    return this.n;
  }

  private room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.room(1);
    this.buf[this.n++] = v;
  }

  i32(v: number): void {
    this.room(4);
    this.view.setInt32(this.n, v, true);
    this.n += 4;
  }

  f32(v: number): void {
    this.room(4);
    this.view.setFloat32(this.n, v, true);
    this.n += 4;
  }

  u64(v: number): void {
    this.room(8);
    this.view.setBigUint64(this.n, BigInt(v), true);
    this.n += 8;
  }

  /** A zero-terminated string. */
  cstr(s: string): void {
    this.bytes(new TextEncoder().encode(s));
    this.u8(0);
  }

  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }

  /** The bytes written so far, as a copy. */
  finish(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

/** The type name and the bytes of a header attribute. */
function encodeAttribute(name: string, value: number | string | number[]): [string, Uint8Array] {
  if (typeof value === 'number') {
    const b = new ByteSink();
    b.f32(value);
    return ['float', b.finish()];
  }
  if (typeof value === 'string') return ['string', new TextEncoder().encode(value)];
  const type = { 2: 'v2f', 3: 'v3f', 9: 'm33f', 16: 'm44f' }[value.length];
  if (type === undefined) {
    throw new Error(
      `EXRExporter: attribute "${name}" is an array of ${value.length} numbers, and only 2, 3, 9 or 16 have a type`,
    );
  }
  const b = new ByteSink();
  for (const v of value) b.f32(v);
  return [type, b.finish()];
}

/** Checks the image. Answers the channel names in the order of the file. */
function checkImage(image: ExrImage): string[] {
  const { width, height, channels } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`EXRExporter: the size ${width} by ${height} is not a positive integer size`);
  }
  if (channels.length === 0) throw new Error('EXRExporter: the image has no channel');
  const seen = new Set<string>();
  for (const { name, data } of channels) {
    if (name.length === 0 || name.length > 31) {
      throw new Error(`EXRExporter: channel name "${name}" must be 1 to 31 bytes long`);
    }
    if (seen.has(name)) throw new Error(`EXRExporter: channel "${name}" is named twice`);
    seen.add(name);
    if (data.length !== width * height) {
      throw new Error(
        `EXRExporter: channel "${name}" holds ${data.length} values, the size needs ${width * height}`,
      );
    }
  }
  for (const key of Object.keys(image.attributes ?? {})) {
    if (OWN.has(key)) throw new Error(`EXRExporter: attribute "${key}" is written by the exporter`);
  }
  return channels.map((c) => c.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export class EXRExporter {
  /**
   * The bytes of the file. `zip` compresses each block, and a block is stored compressed only
   * when the compressed form is shorter, as OpenEXR does.
   */
  async parse(image: ExrImage, options: ExrOptions = {}): Promise<Uint8Array> {
    const compression = options.compression ?? 'none';
    const type = options.type ?? 'float';
    if (compression !== 'none' && compression !== 'zip') {
      throw new Error(
        `EXRExporter: compression "${compression}" is not supported, use none or zip`,
      );
    }
    if (type !== 'half' && type !== 'float') {
      throw new Error(`EXRExporter: type "${type}" is not supported, use half or float`);
    }
    const names = checkImage(image);
    const { width, height } = image;
    const byName = new Map(image.channels.map((c) => [c.name, c.data] as const));
    const bytesPer = type === 'half' ? 2 : 4;
    const linesPerBlock = compression === 'zip' ? 16 : 1;
    const lineBytes = width * names.length * bytesPer;
    const blocks = Math.ceil(height / linesPerBlock);

    // The blocks, each as the file stores it. Within a block the channels of a line are contiguous.
    const stored: Uint8Array[] = [];
    for (let b = 0; b < blocks; b++) {
      const y0 = b * linesPerBlock;
      const lines = Math.min(linesPerBlock, height - y0);
      const raw = new Uint8Array(lines * lineBytes);
      const view = new DataView(raw.buffer);
      for (let r = 0; r < lines; r++) {
        const rowBase = (y0 + r) * width;
        names.forEach((name, c) => {
          const data = byName.get(name)!;
          let at = r * lineBytes + c * width * bytesPer;
          for (let x = 0; x < width; x++) {
            const v = data[rowBase + x]!;
            if (type === 'float') view.setFloat32(at, v, true);
            else view.setUint16(at, floatToHalf(v), true);
            at += bytesPer;
          }
        });
      }
      stored.push(compression === 'zip' ? await zipCompressBlock(raw) : raw);
    }

    // The header.
    const h = new ByteSink();
    h.bytes(new Uint8Array([0x76, 0x2f, 0x31, 0x01]));
    h.i32(2); // version 2, no flag bit: a single-part scan line file
    const put = (name: string, attrType: string, body: Uint8Array) => {
      h.cstr(name);
      h.cstr(attrType);
      h.i32(body.length);
      h.bytes(body);
    };
    const chlist = new ByteSink();
    for (const name of names) {
      chlist.cstr(name);
      chlist.i32(type === 'half' ? 1 : 2);
      chlist.u8(0); // pLinear
      chlist.bytes(new Uint8Array(3)); // reserved
      chlist.i32(1); // xSampling
      chlist.i32(1); // ySampling
    }
    chlist.u8(0);
    put('channels', 'chlist', chlist.finish());
    put('compression', 'compression', new Uint8Array([compression === 'zip' ? 3 : 0]));
    const box = new ByteSink();
    box.i32(0);
    box.i32(0);
    box.i32(width - 1);
    box.i32(height - 1);
    put('dataWindow', 'box2i', box.finish());
    put('displayWindow', 'box2i', box.finish());
    put('lineOrder', 'lineOrder', new Uint8Array([0])); // INCREASING_Y
    const single = (v: number) => {
      const b = new ByteSink();
      b.f32(v);
      return b.finish();
    };
    put('pixelAspectRatio', 'float', single(1));
    const center = new ByteSink();
    center.f32(0);
    center.f32(0);
    put('screenWindowCenter', 'v2f', center.finish());
    put('screenWindowWidth', 'float', single(1));
    const chroma = new ByteSink();
    for (const v of REC709) chroma.f32(v);
    put('chromaticities', 'chromaticities', chroma.finish());
    for (const [name, value] of Object.entries(image.attributes ?? {})) {
      const [attrType, body] = encodeAttribute(name, value);
      put(name, attrType, body);
    }
    h.u8(0); // the end of the header

    // The offset table, then the blocks.
    let at = h.length + blocks * 8;
    const offsets: number[] = [];
    for (const data of stored) {
      offsets.push(at);
      at += 8 + data.length;
    }
    const out = new ByteSink();
    out.bytes(h.finish());
    for (const o of offsets) out.u64(o);
    stored.forEach((data, b) => {
      out.i32(b * linesPerBlock);
      out.i32(data.length);
      out.bytes(data);
    });
    return out.finish();
  }
}
