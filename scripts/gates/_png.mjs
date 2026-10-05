// The PNG encoder and decoder the gates and the harness use. They have no dependency: a PNG is
// a signature and three chunks (IHDR, IDAT, IEND), and `node:zlib` deflates and inflates the rows.
// The encoder writes 8-bit RGBA with filter 0 on every row. The decoder reads 8-bit RGBA that is
// not interlaced, with the five standard row filters: the render gate holds a render to a golden
// it reads back (docs/design/0002-verification.md, step 4).
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

/** `image` (RGBA floats in [0, 1], top row first) as 8-bit channels: each float clamped to [0, 1],
 *  scaled by 255 and rounded. The encoder and the render gate both quantize with this. */
export function toBytes(image) {
  const bytes = new Uint8Array(image.length);
  for (let i = 0; i < image.length; i++)
    bytes[i] = Math.round(Math.min(1, Math.max(0, image[i])) * 255);
  return bytes;
}

/** `image` (RGBA floats in [0, 1], top row first) as an 8-bit RGBA PNG. */
export function encodePng(width, height, image) {
  return encodePngBytes(width, height, toBytes(image));
}

/** `bytes` (8-bit RGBA, top row first) as an 8-bit RGBA PNG. */
export function encodePngBytes(width, height, bytes) {
  if (bytes.length !== width * height * 4)
    throw new Error(`${bytes.length} bytes are not a ${width} x ${height} RGBA picture`);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width * 4; x++) raw[y * (width * 4 + 1) + 1 + x] = bytes[y * width * 4 + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The Paeth predictor of PNG's filter 4: whichever of left, above and upper left is nearest
 *  to `left + above - upperLeft`, the left one first on a tie. */
const paeth = (left, above, upperLeft) => {
  const p = left + above - upperLeft;
  const dl = Math.abs(p - left);
  const da = Math.abs(p - above);
  const du = Math.abs(p - upperLeft);
  return dl <= da && dl <= du ? left : da <= du ? above : upperLeft;
};

/**
 * Reads a PNG of 8-bit RGBA that is not interlaced, as `{ width, height, data }`: `data` holds
 * the channels as bytes, four a pixel, top row first. It checks the signature, every chunk's
 * checksum and the length of the inflated rows, and it undoes the five row filters (none, sub,
 * up, average and Paeth). It throws on anything else, a picture of another depth or colour type
 * included, so a golden of a wrong kind cannot pass as a different one.
 */
export function decodePng(buffer) {
  const png = Buffer.from(buffer);
  if (png.length < 8 || !SIGNATURE.every((b, i) => png[i] === b))
    throw new Error('the PNG signature is wrong');
  let header;
  const parts = [];
  let ended = false;
  for (let at = 8; at < png.length && !ended;) {
    if (at + 12 > png.length) throw new Error('a PNG chunk is cut short');
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    if (at + 12 + length > png.length) throw new Error(`the PNG chunk ${type} is cut short`);
    const body = png.subarray(at + 4, at + 8 + length);
    if (png.readUInt32BE(at + 8 + length) !== crc(body))
      throw new Error(`the PNG chunk ${type} has a wrong checksum`);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = data;
    else if (type === 'IDAT') parts.push(data);
    else if (type === 'IEND') ended = true;
    at += 12 + length;
  }
  if (header === undefined || header.length !== 13) throw new Error('the PNG has no IHDR chunk');
  if (!ended) throw new Error('the PNG has no IEND chunk');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [depth, colour, compression, filter, interlace] = header.subarray(8);
  if (depth !== 8 || colour !== 6 || compression !== 0 || filter !== 0 || interlace !== 0)
    throw new Error(
      `the PNG is not 8-bit RGBA without interlace (depth ${depth}, colour type ${colour}, interlace ${interlace})`,
    );
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(parts));
  if (raw.length !== (stride + 1) * height)
    throw new Error(`the PNG rows hold ${raw.length} bytes, expected ${(stride + 1) * height}`);
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const kind = raw[y * (stride + 1)];
    if (kind > 4) throw new Error(`row ${y} of the PNG has the unknown filter ${kind}`);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= 4 ? data[at - 4] : 0;
      const above = y > 0 ? data[at - stride] : 0;
      const upperLeft = x >= 4 && y > 0 ? data[at - stride - 4] : 0;
      const predicted = [0, left, above, (left + above) >> 1, paeth(left, above, upperLeft)][kind];
      data[at] = (raw[y * (stride + 1) + 1 + x] + predicted) & 255;
    }
  }
  return { width, height, data };
}
