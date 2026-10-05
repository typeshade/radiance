// The pure parts of the render gate, held in `bun run check` and needing no browser: the PNG
// decoder, the tolerance rule, the probe, and the committed goldens. The gate itself renders the
// examples on WebGPU and runs in the harness (`bun run harness`), with its probe. These tests
// show that each part sees a planted fault, before the gate is trusted to see none.
//
// Verifies: Design 0002.2
// This file holds the goldens' size (96 x 64), their samples (64 a pixel) and the tolerance they
// are compared within. It does not hold the rule that a pull request shows both pictures of an
// update. That rule is a procedure in README.md.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { RENDER } from '../gates.mjs';
import { exampleIds } from '../stills.mjs';
import { decodePng, encodePng, encodePngBytes, toBytes } from './_png.mjs';
import {
  GOLDENS,
  channelBoundOnly,
  comparePictures,
  goldenPath,
  orphans,
  probe,
} from './render.mjs';

/** A picture of 8-bit RGBA from `fill(pixel, channel)`, with every alpha at 255. */
const picture = (width: number, height: number, fill: (p: number, c: number) => number) => {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++)
    for (let c = 0; c < 4; c++) data[p * 4 + c] = c === 3 ? 255 : fill(p, c);
  return { width, height, data };
};

/** A deterministic byte sequence: a linear congruential generator, so a test fails the same way. */
const noise = (length: number, seed = 12345) => {
  const out = new Uint8Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (s >> 16) & 255;
  }
  return out;
};

/** The chunks of a PNG, by type, with each chunk's checksum checked. */
const chunksOf = (png: Buffer) => {
  const chunks: [string, Buffer][] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    chunks.push([type, Buffer.from(png.subarray(at + 8, at + 8 + length))]);
    at += 12 + length;
  }
  return chunks;
};

/** A PNG chunk, written for these tests apart from the encoder under test. */
const chunk = (type: string, body: Buffer) => {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
};
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const header = (width: number, height: number, tail = [8, 6, 0, 0, 0]) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set(tail, 8);
  return chunk('IHDR', ihdr);
};
const assemble = (ihdr: Buffer, raw: Buffer) =>
  Buffer.concat([SIGNATURE, ihdr, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

/**
 * `data` with row filter `kinds[y]` applied to each row, as the PNG specification defines the
 * filters: each byte minus a prediction from the unfiltered bytes to its left, above and upper
 * left, three bytes of a pixel back. This is the encoder side the decoder undoes.
 */
const filtered = (width: number, height: number, data: Uint8Array, kinds: number[]) => {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const at = (x: number, y: number) => (x < 0 || y < 0 ? 0 : data[y * stride + x]!);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = kinds[y % kinds.length]!;
    for (let x = 0; x < stride; x++) {
      const a = at(x - 4, y);
      const b = at(x, y - 1);
      const c = at(x - 4, y - 1);
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth][kinds[y % kinds.length]!]!;
      raw[y * (stride + 1) + 1 + x] = (at(x, y) - prediction + 256) % 256;
    }
  }
  return raw;
};

describe('the PNG decoder', () => {
  test('a picture the encoder wrote is read back as its 8-bit channels', () => {
    const image = [0, 0.5, 1, 1, 1, 0.25, -1, 1, 0.2, 0.4, 0.6, 2, 0, 0, 0, 0];
    const back = decodePng(encodePng(2, 2, image));
    expect(back.width).toBe(2);
    expect(back.height).toBe(2);
    expect([...back.data]).toEqual([
      0, 128, 255, 255, 255, 64, 0, 255, 51, 102, 153, 255, 0, 0, 0, 0,
    ]);
    expect([...back.data]).toEqual([...toBytes(image)]);
  });
  test('every byte value survives the encoder and the decoder, in a picture of 96 x 64', () => {
    const data = noise(96 * 64 * 4);
    const back = decodePng(encodePngBytes(96, 64, data));
    expect([back.width, back.height]).toEqual([96, 64]);
    expect(Buffer.from(back.data).equals(Buffer.from(data))).toBe(true);
  });
  test('the encoder refuses bytes that are not a picture of the size', () => {
    expect(() => encodePngBytes(2, 2, new Uint8Array(15))).toThrow(/not a 2 x 2/);
  });
  test('the encoder writes the same bytes for the same picture', () => {
    const data = noise(16 * 16 * 4);
    expect(encodePngBytes(16, 16, data).equals(encodePngBytes(16, 16, data))).toBe(true);
  });
  test('each of the five row filters is undone', () => {
    const [width, height] = [13, 7];
    const data = noise(width * height * 4, 99);
    for (const kind of [0, 1, 2, 3, 4]) {
      const png = assemble(header(width, height), filtered(width, height, data, [kind]));
      const back = decodePng(png);
      expect(`filter ${kind}: ${Buffer.from(back.data).equals(Buffer.from(data))}`).toBe(
        `filter ${kind}: true`,
      );
    }
  });
  test('a picture with another filter on each row is undone', () => {
    const [width, height] = [9, 10];
    const data = noise(width * height * 4, 7);
    const png = assemble(header(width, height), filtered(width, height, data, [4, 3, 0, 2, 1]));
    expect(Buffer.from(decodePng(png).data).equals(Buffer.from(data))).toBe(true);
  });
  test('the filters differ from none on this data, so the test above can fail', () => {
    const data = noise(13 * 7 * 4, 99);
    const none = filtered(13, 7, data, [0]);
    for (const kind of [1, 2, 3, 4]) expect(filtered(13, 7, data, [kind]).equals(none)).toBe(false);
  });
  test('a picture another encoder wrote, with every filter, is read back', async () => {
    // libpng, through sharp, chooses a filter for each row. It is not the encoder of this file.
    const [width, height] = [40, 30];
    const pictures = [
      noise(width * height * 4),
      Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 3 + (i >> 5)) & 255),
      Uint8Array.from(
        { length: width * height * 4 },
        (_, i) => (Math.floor(i / 160) % 2 ? 200 : 20) + (i & 3),
      ),
    ];
    const used = new Set<number>();
    for (const data of pictures) {
      const png = await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
        .png({ adaptiveFiltering: true, compressionLevel: 9 })
        .toBuffer();
      const back = decodePng(png);
      expect([back.width, back.height]).toEqual([width, height]);
      expect(Buffer.from(back.data).equals(Buffer.from(data))).toBe(true);
      const raw = inflateSync(
        Buffer.concat(
          chunksOf(png)
            .filter(([t]) => t === 'IDAT')
            .map(([, b]) => b),
        ),
      );
      for (let y = 0; y < height; y++) used.add(raw[y * (width * 4 + 1)]!);
    }
    // The pictures are read back whatever the filters are. This checks that the check is a check.
    expect(used.size).toBeGreaterThanOrEqual(3);
  });
  test('a wrong signature, a wrong checksum and a cut file are refused', () => {
    const png = encodePngBytes(4, 4, noise(64));
    const wrongSignature = Buffer.from(png);
    wrongSignature[1] = 0;
    expect(() => decodePng(wrongSignature)).toThrow(/signature/);
    const wrongChecksum = Buffer.from(png);
    wrongChecksum[wrongChecksum.length - 20] ^= 1;
    expect(() => decodePng(wrongChecksum)).toThrow(/checksum/);
    expect(() => decodePng(png.subarray(0, png.length - 5))).toThrow(/cut short/);
    expect(() => decodePng(png.subarray(0, 40))).toThrow(/cut short|IEND/);
    expect(() => decodePng(Buffer.alloc(0))).toThrow(/signature/);
  });
  test('a picture that is not 8-bit RGBA without interlace is refused, not misread', () => {
    const rows = (bytes: number, height: number) => Buffer.alloc((bytes + 1) * height);
    const rgb = assemble(header(2, 2, [8, 2, 0, 0, 0]), rows(6, 2));
    expect(() => decodePng(rgb)).toThrow(/not 8-bit RGBA.*colour type 2/);
    const sixteen = assemble(header(2, 2, [16, 6, 0, 0, 0]), rows(16, 2));
    expect(() => decodePng(sixteen)).toThrow(/depth 16/);
    const interlaced = assemble(header(2, 2, [8, 6, 0, 0, 1]), rows(8, 2));
    expect(() => decodePng(interlaced)).toThrow(/interlace 1/);
  });
  test('rows of the wrong length and a filter that does not exist are refused', () => {
    expect(() => decodePng(assemble(header(2, 2), Buffer.alloc(10)))).toThrow(
      /hold 10 bytes, expected 18/,
    );
    const raw = Buffer.alloc(18);
    raw[9] = 5;
    expect(() => decodePng(assemble(header(2, 2), raw))).toThrow(/row 1.*unknown filter 5/);
  });
  test('a file with no header or no end is refused', () => {
    const idat = chunk('IDAT', deflateSync(Buffer.alloc(10)));
    expect(() =>
      decodePng(Buffer.concat([SIGNATURE, idat, chunk('IEND', Buffer.alloc(0))])),
    ).toThrow(/no IHDR/);
    expect(() => decodePng(Buffer.concat([SIGNATURE, header(1, 1), idat]))).toThrow(/no IEND/);
  });
});

describe('the tolerance rule', () => {
  const W = 96;
  const H = 64;
  const PIXELS = W * H;
  // Values in the middle of the range, so a shift of a few units is never clamped.
  const base = () => picture(W, H, (p, c) => 40 + ((p * 7 + c * 31) % 160));
  /** `base()` with `shift(pixel, channel)` added to the channels of the pixels `which` names. */
  const shifted = (
    which: (p: number) => boolean,
    shift: (p: number, c: number) => number,
    channels = [0, 1, 2],
  ) => {
    const out = base();
    for (let p = 0; p < PIXELS; p++)
      if (which(p)) for (const c of channels) out.data[p * 4 + c]! += shift(p, c);
    return out;
  };

  test('the tolerance is the record: 4/255 on 99.9 % of pixels, and a mean of 1/255', () => {
    expect(RENDER.size).toEqual([96, 64]);
    expect(RENDER.samples).toBe(64);
    expect(RENDER.seed).toBe(1);
    expect(RENDER.channel).toBe(4);
    expect(RENDER.outside).toBe(0.001);
    expect(RENDER.mean).toBe(1);
  });
  test('a picture equals itself', () => {
    const result = comparePictures(base(), base());
    expect(result.ok).toBe(true);
    expect(result.numbers).toEqual({ mean: 0, worst: 0, outside: 0, pixels: PIXELS });
  });
  test('4/255 in a channel is within, and 5/255 is beyond', () => {
    const four = comparePictures(
      shifted(
        (p) => p === 100,
        () => 4,
      ),
      base(),
    );
    expect(four.numbers.outside).toBe(0);
    expect(four.numbers.worst).toBe(4);
    const five = comparePictures(
      shifted(
        (p) => p === 100,
        () => 5,
      ),
      base(),
    );
    expect(five.numbers.outside).toBe(1);
    expect(five.numbers.worst).toBe(5);
  });
  test('a render darker by 5/255 is beyond as a render lighter is', () => {
    const result = comparePictures(
      shifted(
        (p) => p === 100,
        () => -5,
      ),
      base(),
    );
    expect(result.numbers).toMatchObject({ outside: 1, worst: 5 });
  });
  test('4/255 on a fifth of the pixels passes: every channel is within, and the mean is 0.8', () => {
    const result = comparePictures(
      shifted(
        (p) => p % 5 === 0,
        () => 4,
      ),
      base(),
    );
    expect(result.numbers.outside).toBe(0);
    expect(result.numbers.mean).toBeCloseTo((4 * Math.ceil(PIXELS / 5)) / PIXELS, 6);
    expect(result.ok).toBe(true);
  });
  test('4/255 on every pixel fails by the mean alone, with every channel within', () => {
    const result = comparePictures(
      shifted(
        () => true,
        () => 4,
      ),
      base(),
    );
    expect(result.numbers).toMatchObject({ outside: 0, worst: 4, mean: 4 });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/mean absolute difference 4\.000\/255 is over 1\/255/);
  });
  test('99.9 % of pixels within passes: one pixel of a thousand may be beyond', () => {
    const golden = picture(40, 25, (p, c) => 60 + ((p + c) % 100));
    const moved = (count: number) => {
      const out = { ...golden, data: Uint8Array.from(golden.data) };
      for (let p = 0; p < count; p++) out.data[p * 4 + 1]! += 5;
      return out;
    };
    expect(comparePictures(moved(1), golden).ok).toBe(true);
    const two = comparePictures(moved(2), golden);
    expect(two.ok).toBe(false);
    expect(two.problems[0]).toMatch(/2 of 1000 pixels differ by more than 4\/255.*over the 0\.1 %/);
  });
  test('a 5/255 shift on 0.2 % of the pixels fails, and on the 0.1 % the rule admits it passes', () => {
    const allowed = Math.floor(PIXELS * RENDER.outside);
    expect(allowed).toBe(6);
    const admitted = comparePictures(
      shifted(
        (p) => p < allowed,
        () => 5,
      ),
      base(),
    );
    expect(admitted.numbers.outside).toBe(6);
    expect(admitted.ok).toBe(true);
    const over = Math.ceil(PIXELS * 0.002);
    const result = comparePictures(
      shifted(
        (p) => p < over,
        () => 5,
      ),
      base(),
    );
    expect(result.numbers.outside).toBe(over);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/13 of 6144 pixels/);
    expect(
      comparePictures(
        shifted(
          (p) => p < allowed + 1,
          () => 5,
        ),
        base(),
      ).ok,
    ).toBe(false);
  });
  test('a mean of 1.5/255 fails with every channel within 2/255, and a mean of 1/255 passes', () => {
    const one = comparePictures(
      shifted(
        () => true,
        () => 1,
      ),
      base(),
    );
    expect(one.numbers.mean).toBe(1);
    expect(one.ok).toBe(true);
    const half = comparePictures(
      shifted(
        () => true,
        (p) => (p % 2 === 0 ? 1 : 2),
      ),
      base(),
    );
    expect(half.numbers).toMatchObject({ mean: 1.5, worst: 2, outside: 0 });
    expect(half.ok).toBe(false);
    expect(half.problems).toHaveLength(1);
    expect(half.problems[0]).toMatch(/mean absolute difference 1\.500\/255 is over 1\/255/);
  });
  test('the alpha channel is held to the channel bound and is not in the mean', () => {
    const golden = base();
    const moved = { ...golden, data: Uint8Array.from(golden.data) };
    moved.data[3 * 4 + 3] = 250;
    const result = comparePictures(moved, golden);
    expect(result.numbers).toMatchObject({ outside: 1, worst: 5, mean: 0 });
  });
  test('a picture of another size, a cut picture and an empty one fail', () => {
    const wide = picture(97, 64, () => 100);
    expect(comparePictures(wide, base()).ok).toBe(false);
    expect(comparePictures(wide, base()).message).toMatch(/97 x 64, the golden 96 x 64/);
    expect(comparePictures({ ...base(), data: new Uint8Array(40) }, base()).ok).toBe(false);
    const empty = { width: 0, height: 0, data: new Uint8Array(0) };
    expect(comparePictures(empty, empty).ok).toBe(false);
  });
  test('the channel bound alone fails one pixel that the tolerance admits', () => {
    const one = shifted(
      (p) => p === 100,
      () => 8,
    );
    expect(comparePictures(one, base()).ok).toBe(true);
    const alone = comparePictures(one, base(), channelBoundOnly(RENDER));
    expect(alone.ok).toBe(false);
    expect(alone.numbers).toMatchObject({ outside: 1, worst: 8 });
  });
});

describe('the probe and the goldens', () => {
  const SITE = join(import.meta.dir, '../../site');
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), 'goldens-'));
    dirs.push(dir);
    return dir;
  };
  const writeGolden = (dir: string, name: string, centreRed: number) => {
    const golden = picture(96, 64, (p, c) => 30 + ((p * 5 + c * 17) % 190));
    golden.data[(32 * 96 + 48) * 4] = centreRed;
    writeFileSync(join(dir, `${name}.png`), encodePngBytes(96, 64, golden.data));
  };
  test('a golden with one channel of one pixel moved by 8/255 is seen, and 13 pixels fail the gate', async () => {
    const dir = scratch();
    writeGolden(dir, 'a', 100);
    const result = await probe({ dir });
    expect(result.ok).toBe(true);
    expect(result.numbers).toEqual({ goldens: 1, worst: 8, outside: 1, spread: 13 });
  });
  test('a golden whose centre red is near white is moved down, and is seen as well', async () => {
    const dir = scratch();
    writeGolden(dir, 'light', 255);
    writeGolden(dir, 'dark', 0);
    expect((await probe({ dir })).numbers).toMatchObject({ goldens: 2, worst: 8, outside: 1 });
  });
  test('no golden, or a file that is not a PNG, fails the probe', async () => {
    const empty = scratch();
    await expect(probe({ dir: empty })).rejects.toThrow(/no golden is in/);
    await expect(probe({ dir: join(empty, 'missing') })).rejects.toThrow(/no golden is in/);
    const broken = scratch();
    writeFileSync(join(broken, 'x.png'), 'not a png');
    await expect(probe({ dir: broken })).rejects.toThrow(/signature/);
  });
  test('the probe passes on the committed goldens', async () => {
    const result = await probe();
    expect(result.ok).toBe(true);
    expect(result.numbers.worst).toBe(8);
    expect(result.numbers.outside).toBe(1);
    expect(result.numbers.goldens).toBe(exampleIds(SITE).length);
  });
  test('each example has a golden of 96 x 64, and no golden is left over', () => {
    const ids = exampleIds(SITE);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) {
      const golden = decodePng(readFileSync(goldenPath(id)));
      expect([id, golden.width, golden.height]).toEqual([id, RENDER.size[0], RENDER.size[1]]);
    }
    expect(orphans(ids)).toEqual([]);
    expect(orphans(ids.slice(1))).toEqual([`${ids[0]}.png`]);
    expect(GOLDENS.endsWith('scripts/__goldens__/')).toBe(true);
  });
});
