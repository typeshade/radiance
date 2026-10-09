// === EXRLoader: a scanline OpenEXR file, read on the host ===
//
// Design record 0010, Part 5 (decision 25). The reader reads the files that `EXRExporter` writes
// and the single-part scan line files of the OpenEXR library with `none` or `zip` compression.
// Every other file is refused with an error that names what is wrong: a magic number, a version
// with a flag bit, a compression, a multi-part file, a tiled file, a truncated file.

import { halfToFloat } from '../exporters/half.ts';
import { zipDecompressBlock } from '../exporters/exr-zip.ts';
import type { ExrImage } from '../exporters/EXRExporter.ts';

const MAGIC = [0x76, 0x2f, 0x31, 0x01];

const COMPRESSION_NAMES: Record<number, string> = {
  0: 'NO_COMPRESSION',
  1: 'RLE_COMPRESSION',
  2: 'ZIPS_COMPRESSION',
  3: 'ZIP_COMPRESSION',
  4: 'PIZ_COMPRESSION',
  5: 'PXR24_COMPRESSION',
  6: 'B44_COMPRESSION',
  7: 'B44A_COMPRESSION',
  8: 'DWAA_COMPRESSION',
  9: 'DWAB_COMPRESSION',
  10: 'HTJ2K256_COMPRESSION',
  11: 'HTJ2K32_COMPRESSION',
};

/** The lines of a block for each compression the reader keeps, and the compressions it refuses. */
const LINES_PER_BLOCK: Record<number, number> = { 0: 1, 3: 16 };

/** A cursor over the bytes of a file. Every read checks the length it needs. */
class Reader {
  private view: DataView;
  pos = 0;

  constructor(
    readonly bytes: Uint8Array,
    readonly total: number,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  need(k: number, what: string): void {
    if (this.pos + k > this.total) {
      throw new Error(
        `EXRLoader: the file is truncated: ${what} needs ${k} bytes at ${this.pos}, but the file has ${this.total}`,
      );
    }
  }

  u8(what: string): number {
    this.need(1, what);
    return this.bytes[this.pos++]!;
  }

  i32(what: string): number {
    this.need(4, what);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  u32(what: string): number {
    this.need(4, what);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  u64(what: string): number {
    this.need(8, what);
    const v = Number(this.view.getBigUint64(this.pos, true));
    this.pos += 8;
    return v;
  }

  f32(what: string): number {
    this.need(4, what);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  cstr(what: string): string {
    const start = this.pos;
    for (;;) {
      if (this.u8(what) === 0) break;
    }
    return new TextDecoder().decode(this.bytes.subarray(start, this.pos - 1));
  }

  take(k: number, what: string): Uint8Array {
    this.need(k, what);
    const v = this.bytes.subarray(this.pos, this.pos + k);
    this.pos += k;
    return v;
  }
}

/** The attributes of the header, by name, as their type and their bytes. */
interface Attr {
  type: string;
  body: Uint8Array;
}

function readHeader(r: Reader): Map<string, Attr> {
  const attrs = new Map<string, Attr>();
  for (;;) {
    const name = r.cstr('an attribute name');
    if (name === '') break;
    const type = r.cstr(`the type of attribute "${name}"`);
    const size = r.i32(`the size of attribute "${name}"`);
    if (size < 0) throw new Error(`EXRLoader: attribute "${name}" has the size ${size}`);
    attrs.set(name, { type, body: r.take(size, `attribute "${name}"`) });
  }
  return attrs;
}

function need(attrs: Map<string, Attr>, name: string): Attr {
  const a = attrs.get(name);
  if (a === undefined) throw new Error(`EXRLoader: the header has no "${name}" attribute`);
  return a;
}

function asInt(body: Uint8Array, at: number): number {
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getInt32(at, true);
}

export class EXRLoader {
  /**
   * The image of an EXR file. Row 0 is the top row. Each channel is a `Float32Array`, and a half
   * is read as the float of its code. Attributes the file holds come back as numbers or strings.
   */
  async parse(bytes: Uint8Array): Promise<ExrImage> {
    const r = new Reader(bytes, bytes.length);
    for (let i = 0; i < 4; i++) {
      const b = r.u8('the magic number');
      if (b !== MAGIC[i]) {
        throw new Error(
          `EXRLoader: the magic number is not 76 2f 31 01 (byte ${i} is ${b.toString(16).padStart(2, '0')})`,
        );
      }
    }
    const version = r.u32('the version field');
    if ((version & 0xff) !== 2)
      throw new Error(`EXRLoader: the version is ${version & 0xff}, not 2`);
    if (version & 0xffffff00) {
      throw new Error(
        `EXRLoader: the version field 0x${version.toString(16)} sets a flag, and only single-part scan line files are read (tiled, multi-part and deep files are refused)`,
      );
    }

    const attrs = readHeader(r);
    const chlist = need(attrs, 'channels');
    if (chlist.type !== 'chlist') throw new Error('EXRLoader: "channels" is not a chlist');
    const compression = need(attrs, 'compression').body[0]!;
    if (!(compression in LINES_PER_BLOCK)) {
      throw new Error(
        `EXRLoader: compression ${COMPRESSION_NAMES[compression] ?? compression} is not read; the reader takes NO_COMPRESSION and ZIP_COMPRESSION`,
      );
    }
    const linesPerBlock = LINES_PER_BLOCK[compression]!;

    const dw = need(attrs, 'dataWindow').body;
    const x0 = asInt(dw, 0);
    const y0 = asInt(dw, 4);
    const width = asInt(dw, 8) - x0 + 1;
    const height = asInt(dw, 12) - y0 + 1;
    if (width < 1 || height < 1)
      throw new Error(`EXRLoader: the data window is ${width} by ${height}`);

    // The channel list: name, pixel type, pLinear, reserved, xSampling, ySampling, each channel.
    const cl = new Reader(chlist.body, chlist.body.length);
    const channels: { name: string; type: number }[] = [];
    for (;;) {
      const name = cl.cstr('a channel name');
      if (name === '') break;
      const type = cl.i32(`the pixel type of "${name}"`);
      cl.take(4, `the flags of "${name}"`);
      const xs = cl.i32(`the xSampling of "${name}"`);
      const ys = cl.i32(`the ySampling of "${name}"`);
      if (xs !== 1 || ys !== 1)
        throw new Error(`EXRLoader: channel "${name}" is sub-sampled, not read`);
      if (type !== 1 && type !== 2) {
        throw new Error(
          `EXRLoader: channel "${name}" has the pixel type ${type}, the reader takes half and float`,
        );
      }
      channels.push({ name, type });
    }

    // The offset table: one 64-bit offset for each block.
    const blocks = Math.ceil(height / linesPerBlock);
    const offsets: number[] = [];
    for (let b = 0; b < blocks; b++) offsets.push(r.u64(`the offset of block ${b}`));

    const out: ExrImage = {
      width,
      height,
      channels: channels.map((c) => ({ name: c.name, data: new Float32Array(width * height) })),
    };
    const lineBytes = channels.reduce((s, c) => s + width * (c.type === 1 ? 2 : 4), 0);

    for (let b = 0; b < blocks; b++) {
      const at = offsets[b]!;
      const first = r.pos;
      r.pos = at;
      const y = r.i32(`the y of block ${b}`);
      const size = r.i32(`the size of block ${b}`);
      const expectY = y0 + b * linesPerBlock;
      if (y !== expectY) throw new Error(`EXRLoader: block ${b} starts at y ${y}, not ${expectY}`);
      const lines = Math.min(linesPerBlock, height - b * linesPerBlock);
      const rawLength = lines * lineBytes;
      const packed = r.take(size, `the data of block ${b}`);
      const raw =
        compression === 0 || size === rawLength
          ? packed
          : await zipDecompressBlock(packed, rawLength);
      if (raw.length !== rawLength) {
        throw new Error(
          `EXRLoader: block ${b} holds ${raw.length} bytes, the header needs ${rawLength}`,
        );
      }
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let l = 0; l < lines; l++) {
        const row = (b * linesPerBlock + l) * width;
        let p = l * lineBytes;
        channels.forEach((c, ci) => {
          const data = out.channels[ci]!.data;
          for (let x = 0; x < width; x++) {
            if (c.type === 2) {
              data[row + x] = view.getFloat32(p, true);
              p += 4;
            } else {
              data[row + x] = halfToFloat(view.getUint16(p, true));
              p += 2;
            }
          }
        });
      }
      r.pos = first;
    }

    const attributes: Record<string, number | string | number[]> = {};
    for (const [name, a] of attrs) {
      if (['channels', 'compression', 'dataWindow', 'displayWindow', 'lineOrder'].includes(name))
        continue;
      if (a.type === 'float')
        attributes[name] = new DataView(a.body.buffer, a.body.byteOffset).getFloat32(0, true);
      else if (a.type === 'string') attributes[name] = new TextDecoder().decode(a.body);
      else if (a.type === 'int') attributes[name] = asInt(a.body, 0);
    }
    if (Object.keys(attributes).length > 0) out.attributes = attributes;
    return out;
  }
}
