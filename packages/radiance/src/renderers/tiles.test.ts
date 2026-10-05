// The tiles of a frame (design record 0001, "Tiles and the watchdog"): each tile stays under the
// watchdog budget at the measured speed, the tiles cover every pixel once, and the budget is 50 ms
// unless the author sets another. kernels.test.ts holds the kernel to the same image whatever the
// tiles.

import { describe, expect, it } from 'bun:test';
import { PathTracer } from './PathTracer.ts';
import {
  DEFAULT_WATCHDOG_BUDGET,
  MAX_TILE_PIXELS,
  WORKGROUP,
  tileFrame,
  type Tile,
} from './tiles.ts';

/** How many tiles cover each pixel of a `w` by `h` frame. */
function coverage(tiles: readonly Tile[], w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  for (const [x0, y0, tw, th] of tiles)
    for (let y = y0; y < y0 + th; y++) for (let x = x0; x < x0 + tw; x++) seen[y * w + x]!++;
  return seen;
}

// Verifies: Design 0001.6
describe('tileFrame', () => {
  it('is one tile of the whole frame before any frame is measured', () => {
    expect(tileFrame(1920, 1080, 1, undefined, 50)).toEqual([[0, 0, 1920, 1080]]);
  });

  it('keeps pixels x samples x nanoseconds per path under the budget', () => {
    const ns = 900;
    for (const samples of [1, 4, 64]) {
      const tiles = tileFrame(1920, 1080, samples, ns, 50);
      for (const [, , tw, th] of tiles) {
        if (tw * th > WORKGROUP) expect(tw * th * samples * ns).toBeLessThanOrEqual(50e6);
      }
      expect(coverage(tiles, 1920, 1080).every((c) => c === 1)).toBe(true);
    }
  });

  it('cuts a row into parts when a row is over the budget', () => {
    const tiles = tileFrame(3840, 4, 1, 50e6 / 1000, 50);
    expect(tiles[0]).toEqual([0, 0, 1000, 1]);
    expect(coverage(tiles, 3840, 4).every((c) => c === 1)).toBe(true);
  });

  it('never makes a tile smaller than a workgroup or larger than one dispatch', () => {
    expect(tileFrame(100, 100, 1, 1e9, 50)[0]).toEqual([0, 0, 64, 1]);
    const huge = tileFrame(3840 * 2, 2160 * 2, 1, 0.001, 50);
    for (const [, , tw, th] of huge) expect(tw * th).toBeLessThanOrEqual(MAX_TILE_PIXELS);
    expect(MAX_TILE_PIXELS).toBe(4_194_240);
  });

  it('can fail: a budget the tiles do not keep is seen', () => {
    const [[, , tw, th]] = tileFrame(1920, 1080, 1, undefined, 50) as [Tile];
    expect(tw * th * 1 * 900).toBeGreaterThan(50e6);
  });
});

// Verifies: Design 0001.6
describe("PathTracer's watchdog budget", () => {
  it('is 50 ms by default, and takes another from its parameters', () => {
    expect(DEFAULT_WATCHDOG_BUDGET).toBe(50);
    expect(new PathTracer().watchdogBudget).toBe(50);
    expect(new PathTracer({ watchdogBudget: 20 }).watchdogBudget).toBe(20);
  });
});
