// === The tiles of a frame (design record 0001, "Tiles and the watchdog", decision 9) ===
//
// A dispatch that runs over two seconds loses the device on Windows (plan 3.1, item 1), so the
// path tracer traces a frame in tiles, one dispatch each.
//
// The nominal tile is the pixel count that the budget allows: pixels x samples x nanoseconds per
// path stays under the budget at the last measured speed. Three rules bound it.
//
//   1. The first frame takes one sample, and it has no measured speed. Its nominal tile is the
//      smallest one, MIN_NOMINAL_TILE_PIXELS.
//   2. The nominal tile of any frame is never under MIN_NOMINAL_TILE_PIXELS. A very slow speed
//      does not make more and smaller dispatches. A 4K frame then takes 2,160 tiles, not the
//      129,600 that tiles of one workgroup take.
//   3. The nominal tile is never over MAX_TILE_PIXELS, the pixels that one dispatch's workgroups
//      along x allow.
//
// The nominal tile becomes whole rows when a row fits in it, and part of one row when it does
// not. Whole rows and the frame's edge make a tile smaller than the nominal tile: a 4K row holds
// 3,840 pixels, so a nominal tile of 4,096 pixels is one row. A tile of the smallest size may pass
// the budget at the last measured speed. It then keeps its size, and the dispatch passes the
// budget. Whether the renderer then takes fewer samples is an open question of the record.

import { maxComputeWorkgroupsPerDimension } from './limits.ts';

/** The kernel's workgroup size (`@compute([64])` in kernels/trace.shade.ts). */
export const WORKGROUP = 64;
/** The most pixels one tile may hold: 65,535 workgroups of 64, 4,194,240 pixels. */
export const MAX_TILE_PIXELS = maxComputeWorkgroupsPerDimension * WORKGROUP;
/** The fewest pixels of a nominal tile, and the first frame's (record 0001, decision 9). */
export const MIN_NOMINAL_TILE_PIXELS = 4096;
/** The milliseconds one dispatch may take, by default (record 0001, decision 6). */
export const DEFAULT_WATCHDOG_BUDGET = 50;

/** A tile: its x0, y0, width and height, in frame pixels. */
export type Tile = [number, number, number, number];

/**
 * The nominal tile, in pixels, of a frame of `samples` samples a pixel: the pixels that `budget`
 * milliseconds allow at `nsPerPath` nanoseconds a path, kept from MIN_NOMINAL_TILE_PIXELS to
 * MAX_TILE_PIXELS. `nsPerPath` undefined (no frame measured yet) gives MIN_NOMINAL_TILE_PIXELS.
 * The size of the frame does not change it.
 */
export function nominalTile(
  samples: number,
  nsPerPath: number | undefined,
  budget: number,
): number {
  let pixels = MIN_NOMINAL_TILE_PIXELS;
  if (nsPerPath !== undefined && nsPerPath > 0) {
    const allowed = Math.floor((budget * 1e6) / (Math.max(1, samples) * nsPerPath));
    // A comparison that is false for NaN, so a budget that is not a number gives the smallest tile.
    if (allowed > pixels) pixels = allowed;
  }
  return Math.min(pixels, MAX_TILE_PIXELS);
}

/**
 * The tiles of a `width` by `height` frame at `samples` samples a pixel, each of at most the
 * nominal tile (`nominalTile`). A tile is whole rows when a row fits in it, or part of one row
 * when it does not. A frame of fewer pixels than the nominal tile is one tile. The tiles cover
 * every pixel once, in rows from the top.
 */
export function tileFrame(
  width: number,
  height: number,
  samples: number,
  nsPerPath: number | undefined,
  budget: number,
): Tile[] {
  const pixels = nominalTile(samples, nsPerPath, budget);
  const tw = Math.min(width, pixels);
  const th = Math.max(1, Math.min(height, Math.floor(pixels / tw)));
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += th)
    for (let x = 0; x < width; x += tw)
      tiles.push([x, y, Math.min(tw, width - x), Math.min(th, height - y)]);
  return tiles;
}
