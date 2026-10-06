// The benchmark records a speed and holds none (record 0002, decision 3), so these tests hold
// what it can get wrong without a browser: the options, the summary of the frames and the row. The
// run itself is `bun run bench`, and its smoke run is `node scripts/bench.mjs --smoke`. These
// tests verify none of the decisions for the owner in record 0002, so they carry no tag for one.
// Decision 3 is verified by inspection (record 0002, Amendment 4): the script holds no bound.
import { describe, expect, test } from 'bun:test';
import {
  COLUMNS,
  DEFAULTS,
  SMOKE,
  deviceName,
  formatRow,
  header,
  isSoftware,
  parseArgs,
  parseSize,
  summarize,
} from './bench.mjs';

describe('parseArgs', () => {
  test('no option gives the defaults of record 0002: 512 x 512 and 1920 x 1080', () => {
    const o = parseArgs([]);
    expect(o.sizes).toEqual([
      [512, 512],
      [1920, 1080],
    ]);
    expect(o.samples).toBe(DEFAULTS.samples);
    expect(o.gpu).toBe(false);
    expect(o.smoke).toBe(false);
    expect(o.scenes).toBeUndefined();
  });

  test('--smoke is small, and a flag after it still wins', () => {
    const o = parseArgs(['--smoke']);
    expect(o.sizes).toEqual(SMOKE.sizes);
    expect(o.samples).toBe(SMOKE.samples);
    expect(o.perFrame).toBe(SMOKE.perFrame);
    expect(parseArgs(['--smoke', '--samples', '5']).samples).toBe(5);
    expect(parseArgs(['--samples', '5', '--smoke']).samples).toBe(5);
  });

  test('--gpu, --size, --scene and --per-frame', () => {
    const o = parseArgs(['--gpu', '--size', '64x32,16x16', '--scene', 'cornell,materials']);
    expect(o.gpu).toBe(true);
    expect(o.sizes).toEqual([
      [64, 32],
      [16, 16],
    ]);
    expect(o.scenes).toEqual(['cornell', 'materials']);
    expect(parseArgs(['--per-frame', '8']).perFrame).toBe(8);
  });

  test('a wrong option fails and names it', () => {
    expect(() => parseArgs(['--fast'])).toThrow('--fast');
    expect(() => parseArgs(['--samples'])).toThrow('--samples needs a value');
    expect(() => parseArgs(['--samples', '0'])).toThrow('--samples');
    expect(() => parseArgs(['--size', '512'])).toThrow("'512'");
  });

  test('parseSize reads WxH', () => {
    expect(parseSize('1920x1080')).toEqual([1920, 1080]);
    expect(() => parseSize('0x4')).toThrow();
    expect(() => parseSize('4 x 4')).toThrow();
  });
});

describe('summarize', () => {
  test('leaves out the first frame when a second one exists', () => {
    const s = summarize([
      { paths: 100, ms: 1000 },
      { paths: 1000, ms: 100 },
      { paths: 3000, ms: 300 },
    ]);
    expect(s.frames).toBe(2);
    expect(s.frameMs).toBe(200);
    expect(s.pathsPerSecond).toBe(10000);
  });

  test('keeps a lone frame, and fails when there is none', () => {
    expect(summarize([{ paths: 50, ms: 500 }]).pathsPerSecond).toBe(100);
    expect(() => summarize([])).toThrow('no frame');
  });

  test('a render that holds no bound: a slow one is a row, not a failure', () => {
    expect(summarize([{ paths: 1, ms: 1e9 }]).pathsPerSecond).toBeGreaterThan(0);
  });
});

describe('the row', () => {
  const row = {
    date: '2026-10-06',
    commit: 'abc1234',
    scene: 'cornell',
    width: 512,
    height: 512,
    samples: 16,
    triangles: 1932,
    bvhMs: 3.456,
    frameMs: 120.04,
    pathsPerSecond: 262144.4,
    device: 'a | b',
    browser: 'Chromium 141',
  };

  test('has one cell for each column, and the header names them', () => {
    const cells = formatRow(row).slice(2, -2).split(' | ');
    expect(cells).toHaveLength(COLUMNS.length);
    expect(header().split('\n')[0]).toBe(`| ${COLUMNS.join(' | ')} |`);
    expect(cells.slice(0, 11)).toEqual([
      '2026-10-06',
      'abc1234',
      'cornell',
      '512x512',
      '16',
      '1932',
      '3.5',
      '120.0',
      '262144',
      '1.00',
      'a / b',
    ]);
  });
});

describe('the adapter', () => {
  test('is named by its description, else by its parts', () => {
    expect(deviceName({ description: 'NVIDIA GeForce RTX 4080' })).toBe('NVIDIA GeForce RTX 4080');
    expect(deviceName({ description: '', vendor: 'google', architecture: 'swiftshader' })).toBe(
      'google swiftshader',
    );
    expect(deviceName(null)).toBe('unknown');
  });

  test('a software adapter is found by the flag or by its name', () => {
    expect(isSoftware({ isFallbackAdapter: true }, 'x')).toBe(true);
    expect(isSoftware({}, 'google swiftshader')).toBe(true);
    expect(isSoftware({}, 'Microsoft Basic Render Driver')).toBe(true);
    expect(isSoftware({}, 'Microsoft WARP')).toBe(true);
    expect(isSoftware({}, 'NVIDIA GeForce RTX 4080')).toBe(false);
  });
});
