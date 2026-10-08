// The pure parts of the gates, held in `bun run check`: the comparison of the differential gate,
// the bit-identity of the determinism gate, and the PNG encoder. The gates themselves need a GPU
// and run in the harness (`bun run harness`), with their probes. These tests also show that each
// check sees a planted fault, before the check is trusted to see none.
import { describe, expect, test } from 'bun:test';
import { crc32, inflateSync } from 'node:zlib';
import { encodePng } from './_png.mjs';
import { bitwiseDifference, judge } from './determinism.mjs';
import {
  compareHits,
  compareImages,
  gatedScene,
  hitRays,
  HIT_RAYS,
  meanBoundOnly,
  shiftOnePixel,
} from './differential.mjs';

/** A 16 x 16 image of RGBA floats: a gradient left to right, 1024 samples in each pixel. */
const WIDTH = 16;
const HEIGHT = 16;
const gradient = () => {
  const image = new Float32Array(WIDTH * HEIGHT * 4);
  for (let p = 0; p < WIDTH * HEIGHT; p++) {
    const v = 0.1 + 0.05 * (p % WIDTH);
    image.set([v, v * 0.5, v * 0.25, 1024], p * 4);
  }
  return image;
};
const BOUNDS = { abs: 1e-3, rel: 0.05, mean: 1e-4 };

describe('differential comparison', () => {
  test('an image equals itself', () => {
    const result = compareImages(gradient(), gradient(), BOUNDS);
    expect(result.ok).toBe(true);
    expect(result.numbers).toEqual({ abs: 0, rel: 0, mean: 0, largest: 0, outOfBounds: 0 });
  });
  test('a small rounding error passes', () => {
    const gpu = gradient();
    gpu[0]! += 2e-5;
    const result = compareImages(gpu, gradient(), BOUNDS);
    expect(result.ok).toBe(true);
    expect(result.numbers.largest).toBeCloseTo(2e-5, 8);
  });
  test('a channel beyond abs and rel fails, and the numbers name it', () => {
    const gpu = gradient();
    gpu[0]! *= 1.1;
    const result = compareImages(gpu, gradient(), BOUNDS);
    expect(result.ok).toBe(false);
    expect(result.numbers.outOfBounds).toBe(1);
    expect(result.numbers.abs).toBeGreaterThan(BOUNDS.abs);
    expect(result.numbers.rel).toBeGreaterThan(BOUNDS.rel);
    expect(result.message).toMatch(/1 channel\(s\) differ from the oracle/);
  });
  test('a channel beyond abs but within rel passes', () => {
    const gpu = gradient();
    gpu[0]! *= 1.02;
    const result = compareImages(gpu, gradient(), BOUNDS);
    expect(result.ok).toBe(true);
    expect(result.numbers.outOfBounds).toBe(0);
    expect(result.numbers.abs).toBeLessThanOrEqual(BOUNDS.abs);
    expect(result.numbers.rel).toBeGreaterThan(0.01);
    expect(result.numbers.rel).toBeLessThanOrEqual(BOUNDS.rel);
  });
  test('a NaN fails', () => {
    const gpu = gradient();
    gpu[5] = NaN;
    const result = compareImages(gpu, gradient(), BOUNDS);
    expect(result.ok).toBe(false);
    expect(result.numbers.outOfBounds).toBe(1);
  });
  test('images of different lengths fail', () => {
    const result = compareImages(gradient().subarray(4), gradient(), BOUNDS);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/floats/);
  });
  test('a mean over the bound fails when every channel is within abs', () => {
    const gpu = gradient().map((v, i) => (i % 4 === 3 ? v : v + 5e-4));
    const result = compareImages(gpu, gradient(), BOUNDS);
    expect(result.numbers.outOfBounds).toBe(0);
    expect(result.numbers.mean).toBeGreaterThan(BOUNDS.mean);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/mean relative difference .* is over/);
  });
  test('the image moved one pixel fails the mean bound alone, as the probe needs', () => {
    const moved = shiftOnePixel(gradient(), WIDTH, HEIGHT);
    expect(moved[4]).toBe(gradient()[0]);
    expect(moved[0]).toBe(gradient()[0]);
    expect(compareImages(gradient(), moved, BOUNDS).ok).toBe(false);
    const alone = compareImages(gradient(), moved, meanBoundOnly(BOUNDS));
    expect(alone.numbers.outOfBounds).toBe(0);
    expect(alone.numbers.mean).toBeGreaterThan(BOUNDS.mean);
    expect(alone.ok).toBe(false);
  });
  test('the Cornell box is the scene the gates hold', () => {
    expect(gatedScene('cornell').gate.size).toEqual([16, 16]);
    expect(() => gatedScene('missing')).toThrow(/cornell/);
    expect(() => gatedScene('toString')).toThrow(/no gated scene/);
  });
  test('the scenes of M2 are gated at 16 x 16 and 256 spp, within the bounds record 0002 derives', () => {
    for (const name of ['triangles', 'instances', 'lights']) {
      const { gate, oracle } = gatedScene(name);
      expect(gate.size).toEqual([16, 16]);
      expect(gate.samples).toBe(256);
      // `abs` and `rel` stay M1's, and `mean` is ten times a measured mean of about 1e-7.
      expect(oracle.abs).toBe(1e-3);
      expect(oracle.rel).toBe(0.05);
      expect(oracle.mean).toBeGreaterThan(1e-6);
      expect(oracle.mean).toBeLessThan(3e-6);
    }
  });
});

describe('determinism bit-identity', () => {
  test('a NaN equals a NaN, and 0 differs from -0', () => {
    expect(bitwiseDifference([1, NaN, 3], [1, NaN, 3])).toEqual({ differing: 0, first: -1 });
    expect(bitwiseDifference([0], [-0])).toEqual({ differing: 1, first: 0 });
  });
  test('floats of one length differ where they differ', () => {
    expect(bitwiseDifference([1, 2, 3, 4], [1, 9, 3, 8])).toEqual({ differing: 2, first: 1 });
    expect(bitwiseDifference([1, 2], [1, 2, 3]).differing).toBe(1);
  });
  const gate = { size: [WIDTH, HEIGHT], samples: 1024, perFrame: 64, seed: 1 };
  const seed2 = () => gradient().map((v, i) => (i % 4 === 3 ? v : v * 0.9));
  test('two renders of one seed and a render of another pass', () => {
    const result = judge({ first: gradient(), again: gradient(), other: seed2() }, gate);
    expect(result.ok).toBe(true);
    expect(result.numbers.differing).toBe(0);
    expect(result.numbers.otherSeedDiffering).toBeGreaterThan(0);
  });
  test('a render of seed 2 as the second render of seed 1 fails, as the probe needs', () => {
    const result = judge({ first: gradient(), again: seed2(), other: seed2() }, gate);
    expect(result.ok).toBe(false);
    expect(result.numbers.differing).toBeGreaterThan(0);
  });
  test('a seed that renders the same image fails', () => {
    const result = judge({ first: gradient(), again: gradient(), other: gradient() }, gate);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/render the same image/);
  });
  test('a pixel with the wrong sample count fails', () => {
    const first = gradient();
    first[7] = 1023;
    const result = judge({ first, again: Float32Array.from(first), other: seed2() }, gate);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/pixel 1 has 1023 samples/);
  });
});

describe('the PNG encoder', () => {
  test('a picture is written as its 8-bit RGBA rows, with valid chunk checksums', () => {
    const image = [0, 0.5, 1, 1, 1, 0.25, -1, 1, 0.2, 0.4, 0.6, 2, 0, 0, 0, 0];
    const png = encodePng(2, 2, image);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks: Record<string, Buffer> = {};
    for (let at = 8; at < png.length;) {
      const length = png.readUInt32BE(at);
      const type = png.toString('ascii', at + 4, at + 8);
      const data = png.subarray(at + 8, at + 8 + length);
      expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
      chunks[type] = Buffer.from(data);
      at += 12 + length;
    }
    expect(Object.keys(chunks)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks.IHDR!.readUInt32BE(0)).toBe(2);
    expect(chunks.IHDR!.readUInt32BE(4)).toBe(2);
    expect([...chunks.IHDR!.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    const raw = inflateSync(chunks.IDAT!);
    expect([...raw]).toEqual([
      0, 0, 128, 255, 255, 255, 64, 0, 255, 0, 51, 102, 153, 255, 0, 0, 0, 0,
    ]);
  });
});

// The row `sphere-hit` (record 0002, "The hit probe" and "The probes"): `compareHits` sees a
// planted fault before it is trusted to count 0.
describe('the hit comparison of the row sphere-hit', () => {
  const N = 4096;
  /** Every ray from (1.5, 0, 0) toward a unit sphere at the origin, so S is 1.5 and ulp(S) is
   *  2^-23. Each hit is t = 0.5 and q = (1, 0, 0). */
  const rays = new Float32Array(N * 12);
  for (let i = 0; i < N; i++) rays.set([1.5, 0, 0, 1e30, -1, 0, 0, 0, 0, 0, 0, 1], i * 12);
  const hits = () => {
    const h = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) h.set([0.5, 1, 0, 0], i * 4);
    return h;
  };
  const ULP = 2 ** -23;

  test('4,096 pairs of equal hits: 0 of 4,096 outside', () => {
    const r = compareHits(hits(), hits(), rays);
    expect([r.ok, r.outside, r.total, r.worst]).toEqual([true, 0, 4096, 0]);
  });
  test('one t moved by 17 ulp(S), one over 16, fails: 1 of 4,096', () => {
    const gpu = hits();
    gpu[400] = 0.5 + 17 * ULP;
    const r = compareHits(gpu, hits(), rays);
    expect([r.ok, r.outside]).toEqual([false, 1]);
    expect(r.worst).toBe(17);
    expect(r.message).toMatch(/ray 100: the t error is 17.00/);
  });
  test('one t moved by 15 ulp(S) passes: 0 of 4,096', () => {
    const gpu = hits();
    gpu[400] = 0.5 + 15 * ULP;
    const r = compareHits(gpu, hits(), rays);
    expect([r.ok, r.outside, r.worst]).toEqual([true, 0, 15]);
  });
  test('one hit paired with a miss fails: 1 of 4,096', () => {
    const cpu = hits();
    cpu[8] = -1;
    const r = compareHits(hits(), cpu, rays);
    expect([r.ok, r.outside]).toEqual([false, 1]);
    expect(r.message).toMatch(/ray 2: one is a hit and the other a miss/);
  });
  test('one q moved by 1e-5 fails: 1 of 4,096', () => {
    const gpu = hits();
    gpu[4 * 7 + 2] = 1e-5;
    const r = compareHits(gpu, hits(), rays);
    expect([r.ok, r.outside]).toEqual([false, 1]);
  });
  test('two misses are inside the rule, and a NaN is not', () => {
    const gpu = hits();
    const cpu = hits();
    gpu[0] = -1;
    cpu[0] = -1;
    expect(compareHits(gpu, cpu, rays).outside).toBe(0);
    gpu[4] = NaN;
    expect(compareHits(gpu, cpu, rays).outside).toBe(1);
  });
  test('hitRays gives 4,096 rays of 3 vec4, each with limit 1e30 and a radius from 0.01 to 100', () => {
    const r = hitRays();
    expect(HIT_RAYS).toBe(4096);
    expect(r.length).toBe(4096 * 12);
    for (let i = 0; i < 4096; i++) {
      expect(r[i * 12 + 3]).toBe(Math.fround(1e30));
      expect(r[i * 12 + 11]).toBeGreaterThanOrEqual(Math.fround(0.01));
      expect(r[i * 12 + 11]).toBeLessThanOrEqual(100);
    }
  });
});
