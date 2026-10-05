'use typeshade';

// The sampler (plan 3.1, constraint 5): a two-dimensional Sobol sequence, Owen-scrambled by a
// hash, after Burley, "Practical Hash-based Owen Scrambling" (JCGT 9(4), 2020). Every pair of
// dimensions a path consumes (the lens, then each bounce's light and BSDF samples) reads the
// same two Sobol dimensions with its own shuffle of the sample index and its own scramble, so the
// pairs are decorrelated while each stays a (0, 2)-sequence in base 2.
//
// Everything here is integer arithmetic on u32, so it is exact: the GPU and the CPU oracle draw
// the same numbers for the same pixel, sample and dimension.

/** A hash of a whole number to a whole number, spread over all 32 bits (PCG). */
export function hash(x: u32): u32 {
  const state = x * 747796405 + 2891336453;
  const word = ((state >> ((state >> 28) + 4)) ^ state) * 277803737;
  return (word >> 22) ^ word;
}

/** Two numbers hashed into one, for a seed made of several parts. */
export function hash2(a: u32, b: u32): u32 {
  return hash(a ^ hash(b));
}

/** The Laine and Karras permutation of `x` keyed by `seed`, as Burley tunes it: each bit
 *  depends only on the bits below it, so on reversed bits it is a nested uniform scramble. */
export function laineKarras(x: u32, seed: u32): u32 {
  let v = x + seed;
  v = v ^ (v * 0x6c50b47c);
  v = v ^ (v * 0xb82f1e52);
  v = v ^ (v * 0xc7afe638);
  v = v ^ (v * 0x8d22f6e6);
  return v;
}

/** The nested uniform (Owen) scramble of the 32-bit fraction `x`, keyed by `seed`. */
export function owen(x: u32, seed: u32): u32 {
  return reverseBits(laineKarras(reverseBits(x), seed));
}

/** The second Sobol dimension at `index`: direction numbers v(k) = v(k-1) ^ (v(k-1) >> 1). */
export function sobol1(index: u32): u32 {
  let x: u32 = 0;
  let v: u32 = 0x80000000;
  let i = index;
  while (i !== 0) {
    if ((i & 1) !== 0) {
      x = x ^ v;
    }
    i = i >> 1;
    v = v ^ (v >> 1);
  }
  return x;
}

/** A 32-bit fraction as a number in [0, 1): its top 24 bits, so the f32 is exact. */
export function toUnit(x: u32): f32 {
  return f32(x >> 8) / 16777216;
}

/**
 * Two numbers in [0, 1) for sample `index` of the pixel keyed by `pixelSeed`, in dimension pair
 * `pair`: Burley's shuffled, scrambled Sobol (0, 2)-sequence.
 */
export function sample2(pixelSeed: u32, index: u32, pair: u32): vec2 {
  const key = hash2(pixelSeed, pair);
  const shuffled = owen(index, key);
  const x = owen(reverseBits(shuffled), hash(key ^ 1));
  const y = owen(sobol1(shuffled), hash(key ^ 2));
  return vec2(toUnit(x), toUnit(y));
}
