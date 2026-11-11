// Design: 0101, section 4. A node's seed comes from the world's seed and the node's path, so it
// does not move when another node is added to the scene.

import { hash32 } from 'typeshade/random';

/** The 32-bit FNV-1a hash of a string's UTF-16 code units. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    hash = Math.imul(hash ^ (unit & 0xff), 0x01000193);
    hash = Math.imul(hash ^ (unit >>> 8), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The seed of the node at `path` in a world with the seed `worldSeed`:
 * `hash32(worldSeed ^ fnv1a(path))`, where 0 becomes 1 because a zero state of `xorshift32`
 * stays zero. `hash32` is the compiler's, the same word on every tier.
 */
export function nodeSeed(worldSeed: number, path: string): number {
  const seed = hash32((worldSeed ^ fnv1a(path)) >>> 0) >>> 0;
  return seed === 0 ? 1 : seed;
}
