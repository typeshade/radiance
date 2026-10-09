// === half: IEEE 754 binary16, the half float that OpenEXR stores ===
//
// Design record 0010, Part 5 (decision 25). The EXR writer and reader convert on the host, and
// no kernel reads a half (record 0005, the rules of the determinism lint). A half is a 16-bit
// code: 1 sign bit, 5 exponent bits with a bias of 15, and 10 fraction bits. A code of exponent
// 0 is a subnormal, and a code of exponent 31 is an infinity or a NaN.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/**
 * The half code nearest to `value`, ties to even. `value` is a float32 value: it is read as one,
 * as a `Float32Array` element is. A value at or above 65520 becomes infinity, as IEEE 754 has it.
 */
export function floatToHalf(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const e = (x >>> 23) & 0xff;
  const m = x & 0x7fffff;
  if (e === 0xff) return sign | 0x7c00 | (m !== 0 ? 0x200 | (m >>> 13) : 0);
  const exp = e - 112; // e - 127 + 15: the exponent of the half
  if (exp >= 31) return sign | 0x7c00;
  if (exp <= 0) {
    // A subnormal half is a multiple of 2^-24. A float below 2^-25 rounds to zero. A float with
    // e of 102 or more has its significand shifted by 14 to 24 bits.
    if (e < 102) return sign;
    const full = m | 0x800000;
    const shift = 126 - e;
    let h = full >>> shift;
    const rem = full & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && (h & 1) === 1)) h++;
    return sign | h;
  }
  let h = (exp << 10) | (m >>> 13);
  const rem = m & 0x1fff;
  // A carry out of the fraction adds 1 to the exponent, as it must. The code 0x7c00 is infinity.
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1) === 1)) h++;
  return sign | h;
}

/** The float value of a half code. A NaN code gives a NaN. Its payload is not kept. */
export function halfToFloat(code: number): number {
  const sign = code & 0x8000 ? -1 : 1;
  const e = (code >>> 10) & 0x1f;
  const m = code & 0x3ff;
  if (e === 0) return sign * m * 2 ** -24;
  if (e === 31) return m !== 0 ? NaN : sign * Infinity;
  return sign * (1 + m / 1024) * 2 ** (e - 15);
}
