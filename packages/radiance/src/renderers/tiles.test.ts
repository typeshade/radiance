// The tiles of a frame (design record 0001, "Tiles and the watchdog"): each tile stays under the
// watchdog budget at the measured speed unless it is the smallest, the tiles cover every pixel
// once, and the budget is 50 ms unless the author sets another. No nominal tile is under 4,096
// pixels, and the first frame, which has no measured speed, takes that tile. kernels.test.ts holds
// the kernel to the same image whatever the tiles.

import { describe, expect, it } from 'bun:test';
import { PathTracer } from './PathTracer.ts';
import {
  DEFAULT_WATCHDOG_BUDGET,
  MAX_TILE_PIXELS,
  MIN_NOMINAL_TILE_PIXELS,
  WORKGROUP,
  nominalTile,
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

/**
 * Throws, naming the tile or the pixel, unless `tiles` cover each pixel of a `w` by `h` frame
 * once and each tile of more than the smallest nominal tile keeps pixels x samples x `ns` under
 * `budget` ms. A tile of the smallest size may pass the budget (record 0001, "Tiles and the
 * watchdog", rule 4).
 */
function checkTiles(
  tiles: readonly Tile[],
  w: number,
  h: number,
  samples: number,
  ns: number,
  budget: number,
): void {
  for (const tile of tiles) {
    const pixels = tile[2] * tile[3];
    if (pixels > MIN_NOMINAL_TILE_PIXELS && pixels * samples * ns > budget * 1e6)
      throw new Error(`tile ${tile.join(', ')} takes ${(pixels * samples * ns) / 1e6} ms`);
  }
  const seen = coverage(tiles, w, h);
  const wrong = seen.findIndex((c) => c !== 1);
  if (wrong >= 0) throw new Error(`pixel ${wrong} is covered ${seen[wrong]} times`);
}

// Verifies: Design 0001.6
describe('tileFrame', () => {
  it('keeps pixels x samples x nanoseconds per path under the budget', () => {
    const ns = 900;
    for (const samples of [1, 4])
      expect(() =>
        checkTiles(tileFrame(1920, 1080, samples, ns, 50), 1920, 1080, samples, ns, 50),
      ).not.toThrow();
    // At 1 sample the budget allows 55,555 pixels, so a tile is 28 rows of 1,920 pixels.
    expect(tileFrame(1920, 1080, 1, ns, 50)[0]).toEqual([0, 0, 1920, 28]);
  });

  it('cuts a row into parts when a row is over the nominal tile', () => {
    // The budget allows 5,000 pixels, and a row holds 20,000.
    const tiles = tileFrame(20_000, 2, 1, 10_000, 50);
    expect(tiles).toHaveLength(8);
    expect(tiles[0]).toEqual([0, 0, 5000, 1]);
    expect(tiles[3]).toEqual([15_000, 0, 5000, 1]);
    expect(coverage(tiles, 20_000, 2).every((c) => c === 1)).toBe(true);
  });

  it('never makes a tile larger than one dispatch', () => {
    const huge = tileFrame(3840 * 2, 2160 * 2, 1, 0.001, 50);
    for (const [, , tw, th] of huge) expect(tw * th).toBeLessThanOrEqual(MAX_TILE_PIXELS);
    expect(nominalTile(1, 0.001, 50)).toBe(MAX_TILE_PIXELS);
    expect(MAX_TILE_PIXELS).toBe(4_194_240);
  });

  it('can fail: tiles sized for a speed twice the real one are over the budget', () => {
    const tiles = tileFrame(1920, 1080, 4, 450, 50);
    expect(() => checkTiles(tiles, 1920, 1080, 4, 900, 50)).toThrow(/^tile 0, 0, 1920, 14 takes/);
  });

  it('can fail: tiles that leave a row out, or cover one twice, are seen', () => {
    const tiles = tileFrame(1920, 1080, 4, 900, 50);
    expect(() => checkTiles(tiles.slice(1), 1920, 1080, 4, 900, 50)).toThrow(
      'pixel 0 is covered 0 times',
    );
    expect(() => checkTiles([...tiles, tiles[0]!], 1920, 1080, 4, 900, 50)).toThrow(
      'pixel 0 is covered 2 times',
    );
  });
});

// Verifies: Design 0001.9
describe('the smallest nominal tile (record 0001, decision 9)', () => {
  /** A speed of one second a path: slower than any device. */
  const SLOWEST = 1e9;

  it('is 4,096 pixels, whole workgroups, and within one dispatch', () => {
    expect(MIN_NOMINAL_TILE_PIXELS).toBe(4096);
    expect(MIN_NOMINAL_TILE_PIXELS % WORKGROUP).toBe(0);
    expect(MIN_NOMINAL_TILE_PIXELS).toBeLessThanOrEqual(MAX_TILE_PIXELS);
  });

  it('is the nominal tile of the first frame, whatever the samples (rule 1)', () => {
    expect(nominalTile(1, undefined, 50)).toBe(4096);
    expect(nominalTile(64, undefined, 50)).toBe(4096);
    expect(nominalTile(1, undefined, 1e6)).toBe(4096);
  });

  it('cuts the first frame into tiles of 4,096 pixels or less, not one tile (rule 1)', () => {
    // 4,096 pixels hold 2 rows of 1,920 (3,840 pixels), so a 1080p frame takes 540 tiles.
    const tiles = tileFrame(1920, 1080, 1, undefined, 50);
    expect(tiles).toHaveLength(540);
    expect(tiles[0]).toEqual([0, 0, 1920, 2]);
    expect(tiles[539]).toEqual([0, 1078, 1920, 2]);
    expect(tileFrame(1920, 1080, 64, undefined, 50)).toEqual(tiles);
    expect(coverage(tiles, 1920, 1080).every((c) => c === 1)).toBe(true);
  });

  it('holds at every speed, every sample count and every budget (rule 2)', () => {
    for (const ns of [1e-3, 1, 1e3, 1e5, 1e7, SLOWEST, 1e12])
      for (const samples of [1, 4, 64, 1024])
        for (const budget of [1e-3, 1, 50, 2000])
          expect(nominalTile(samples, ns, budget)).toBeGreaterThanOrEqual(4096);
    // A budget that is not a number gives the smallest tile, not a loop that never ends.
    expect(nominalTile(1, 900, Number.NaN)).toBe(4096);
    expect(tileFrame(256, 256, 1, 900, Number.NaN)).toHaveLength(16);
  });

  it('gives a tile of exactly 4,096 pixels at a very slow speed when a row divides it', () => {
    // 128 x 32 is 4,096 pixels, so a 128 x 128 frame takes 4 tiles at any slow speed.
    for (const ns of [1e5, SLOWEST, 1e12]) {
      const tiles = tileFrame(128, 128, 64, ns, 50);
      expect(tiles).toHaveLength(4);
      for (const tile of tiles) expect(tile[2] * tile[3]).toBe(4096);
    }
  });

  it('gives a frame of fewer pixels than the nominal tile one tile of the whole frame', () => {
    expect(tileFrame(12, 9, 1, SLOWEST, 50)).toEqual([[0, 0, 12, 9]]);
    expect(tileFrame(64, 64, 1, SLOWEST, 50)).toEqual([[0, 0, 64, 64]]);
    expect(tileFrame(12, 9, 1, undefined, 50)).toEqual([[0, 0, 12, 9]]);
  });

  it('makes a tile of whole rows smaller than the nominal tile when a row does not divide it (rule 3)', () => {
    // 100 pixels a row: 40 rows are 4,000 pixels, under 4,096. The last tile is the frame's edge.
    expect(tileFrame(100, 100, 1, SLOWEST, 50)).toEqual([
      [0, 0, 100, 40],
      [0, 40, 100, 40],
      [0, 80, 100, 20],
    ]);
  });

  it('takes 2,160 tiles for a 4K frame at the slowest speed, not 129,600', () => {
    const [w, h] = [3840, 2160];
    const tiles = tileFrame(w, h, 1, SLOWEST, 50);
    // The record's "about 2,025" is the pixels over the nominal tile: 8,294,400 over 4,096. A row
    // of a 4K frame holds 3,840 pixels, and one row fits in 4,096 but two do not. So a tile is
    // one row, and the count is 2,160 (rule 3: whole rows make a tile smaller than the nominal one).
    expect(Math.ceil((w * h) / MIN_NOMINAL_TILE_PIXELS)).toBe(2025);
    expect(tiles).toHaveLength(2160);
    expect(tiles[0]).toEqual([0, 0, 3840, 1]);
    expect(tiles[2159]).toEqual([0, 2159, 3840, 1]);
    // The tiles of one workgroup (the rule before decision 9) took 129,600.
    expect((w * h) / WORKGROUP).toBe(129_600);
    expect(tiles.length).toBeLessThan((w * h) / WORKGROUP);
    expect(coverage(tiles, w, h).every((c) => c === 1)).toBe(true);
  });

  it('keeps the size of a tile that passes the budget (rule 4)', () => {
    // One millisecond a path and 4 samples: no tile of 3,840 pixels is near 50 ms.
    const ns = 1e6;
    const tiles = tileFrame(3840, 2160, 4, ns, 50);
    expect(tiles).toHaveLength(2160);
    const pixels = tiles[0]![2] * tiles[0]![3];
    expect(pixels * 4 * ns).toBeGreaterThan(50 * 1e6);
    // The check of the budget accepts a tile of the smallest size, and refuses a larger one.
    expect(() => checkTiles(tiles, 3840, 2160, 4, ns, 50)).not.toThrow();
    expect(() => checkTiles([[0, 0, 3840, 2]], 3840, 2, 4, ns, 50)).toThrow(/^tile 0, 0, 3840, 2/);
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
