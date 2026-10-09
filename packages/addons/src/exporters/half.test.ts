// The half float, held to every code and to a reference rounding of a million random floats.
// Verifies: Design 0010.25

import { describe, expect, it } from 'bun:test';
import { floatToHalf, halfToFloat } from './half.ts';

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

const f32 = new Float32Array(1);
const toF32 = (v: number) => {
  f32[0] = v;
  return f32[0]!;
};

/**
 * The reference: the half code nearest to `|v|`, ties to the even code, by a binary search on the
 * sorted values of the codes. The table holds the codes 0 to 0x7bff, and 65536 for infinity, so a
 * value from 65520 up rounds to infinity. The sign is applied after, as IEEE 754 has it.
 */
const TABLE: number[] = (() => {
  const t: number[] = [];
  for (let c = 0; c <= 0x7bff; c++) t.push(c === 0 ? 0 : halfToFloat(c));
  t.push(65536);
  return t;
})();

function referenceHalf(v: number): number {
  if (Number.isNaN(v)) return 0x7e00;
  const sign = v < 0 || Object.is(v, -0) ? 0x8000 : 0;
  const a = Math.abs(v);
  if (a === Infinity) return sign | 0x7c00;
  let lo = 0;
  let hi = TABLE.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (TABLE[mid]! <= a) lo = mid;
    else hi = mid;
  }
  const dLo = a - TABLE[lo]!;
  const dHi = TABLE[hi]! - a;
  const code = dLo < dHi ? lo : dHi < dLo ? hi : lo % 2 === 0 ? lo : hi;
  return sign | code; // the index of a value is its code, and index 31744 holds infinity
}

describe('half', () => {
  it('round-trips every half code that is not a NaN', () => {
    let checked = 0;
    for (let code = 0; code <= 0xffff; code++) {
      const e = (code >>> 10) & 0x1f;
      const m = code & 0x3ff;
      if (e === 31 && m !== 0) continue; // a NaN has no single code of its own, see below
      const back = floatToHalf(halfToFloat(code));
      if (back !== code)
        throw new Error(`code 0x${code.toString(16)} came back as 0x${back.toString(16)}`);
      checked++;
    }
    expect(checked).toBe(65536 - 2046);
  });

  it('maps every NaN code to a NaN code, and a NaN float to a quiet half NaN', () => {
    // A JavaScript number does not keep the payload bits of a NaN, so each NaN code is read as a
    // NaN and written back as a NaN with exponent 31 and a non-zero fraction. The payload is not
    // kept. That is a deviation from the all-codes round trip, and the PR states it.
    let checked = 0;
    for (let code = 0; code <= 0xffff; code++) {
      const e = (code >>> 10) & 0x1f;
      const m = code & 0x3ff;
      if (e !== 31 || m === 0) continue;
      const back = floatToHalf(halfToFloat(code));
      if (((back >>> 10) & 0x1f) !== 31 || (back & 0x3ff) === 0) {
        throw new Error(`NaN code 0x${code.toString(16)} came back as 0x${back.toString(16)}`);
      }
      checked++;
    }
    expect(checked).toBe(2046);
  });

  it('converts 10^6 random floats to the half a reference rounding gives', () => {
    const next = rng(0x0010);
    let mismatches = 0;
    let first = '';
    for (let i = 0; i < 1_000_000; i++) {
      // Sample the exponent across the half range and past it, so the subnormal, the overflow and
      // the carry cases all occur. The mantissa is uniform.
      const expo = Math.floor(next() * 50) - 30; // 2^-30 .. 2^19
      const mant = 1 + next();
      const sign = next() < 0.5 ? -1 : 1;
      const v = toF32(sign * mant * 2 ** expo);
      const got = floatToHalf(v);
      const want = referenceHalf(v);
      if (got !== want) {
        mismatches++;
        if (first === '') first = `${v} -> got 0x${got.toString(16)}, want 0x${want.toString(16)}`;
      }
    }
    expect(first).toBe('');
    expect(mismatches).toBe(0);
  });

  it('rounds the ties to the even code and carries into the exponent', () => {
    expect(floatToHalf(1 + 2 ** -11)).toBe(0x3c00); // tie, 1.0 is even
    expect(floatToHalf(1 + 3 * 2 ** -11)).toBe(0x3c02); // tie, 1 + 2^-10 * 2 is even
    expect(floatToHalf(65504)).toBe(0x7bff);
    expect(floatToHalf(65520)).toBe(0x7c00); // the midpoint of 65504 and 65536 goes to infinity
    expect(floatToHalf(2 ** -25)).toBe(0); // the midpoint of 0 and 2^-24, ties to zero
    expect(floatToHalf(2 ** -24)).toBe(1);
    expect(floatToHalf(-0)).toBe(0x8000);
  });
});
