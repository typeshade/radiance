// === The tiles of a frame (design record 0001, "Tiles and the watchdog") ===
//
// A dispatch that runs over two seconds loses the device on Windows (plan 3.1, item 1), so the
// path tracer traces a frame in tiles, one dispatch each. A tile holds as many pixels as the
// watchdog budget allows at the last measured speed: pixels x samples x nanoseconds per path
// stays under the budget. Before any measurement the tile is the whole frame. A tile is never
// smaller than one workgroup, nor larger than one dispatch's workgroups along x allow.

import { maxComputeWorkgroupsPerDimension } from './limits.ts';

/** The kernel's workgroup size (`@compute([64])` in kernels/trace.shade.ts). */
export const WORKGROUP = 64;
/** The most pixels one tile may hold: 65,535 workgroups of 64, 4,194,240 pixels. */
export const MAX_TILE_PIXELS = maxComputeWorkgroupsPerDimension * WORKGROUP;
/** The milliseconds one dispatch may take, by default (record 0001, decision 6). */
export const DEFAULT_WATCHDOG_BUDGET = 50;

/** A tile: its x0, y0, width and height, in frame pixels. */
export type Tile = [number, number, number, number];

/**
 * The tiles of a `width` by `height` frame at `samples` samples a pixel, each of at most the
 * pixels that `budget` milliseconds allow at `nsPerPath` nanoseconds a path. `nsPerPath`
 * undefined (no frame measured yet) gives one tile of the whole frame, cut to MAX_TILE_PIXELS. A
 * tile is whole rows when a row fits in it, or part of one row when it does not. The tiles cover
 * every pixel once, in rows from the top.
 */
export function tileFrame(
  width: number,
  height: number,
  samples: number,
  nsPerPath: number | undefined,
  budget: number,
): Tile[] {
  let pixels = width * height;
  if (nsPerPath !== undefined && nsPerPath > 0)
    pixels = Math.floor((budget * 1e6) / (Math.max(1, samples) * nsPerPath));
  pixels = Math.max(WORKGROUP, Math.min(pixels, width * height, MAX_TILE_PIXELS));
  const tw = Math.min(width, pixels);
  const th = Math.max(1, Math.min(height, Math.floor(pixels / tw)));
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += th)
    for (let x = 0; x < width; x += tw)
      tiles.push([x, y, Math.min(tw, width - x), Math.min(th, height - y)]);
  return tiles;
}
