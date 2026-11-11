// The browser check of the reference game. The engine builds the page. The check opens it in
// headless Chromium with WebGPU, drives it as a player does, holds the cells the GPU computed to
// the cells the CPU tier computes, and measures the picture from a screenshot (design record 0111).

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { chromium, devices, type Browser, type Page } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { buildProject, devProject, viteConfig, type BuildResult } from '../../../src/build.ts';
import { loadConfig } from '../../../src/cli.ts';
import { load } from '../../../src/test.ts';
import type { Game } from '../.radiance/game.ts';
import { putCell } from '../cells.ts';
import { BELT, MACHINE } from '../kinds.shade.ts';
import { Cell } from '../state/cells.shade.ts';

const here = new URL('..', import.meta.url).pathname;

let server: PreviewServer;
let browser: Browser;
let page: Page;
const requested: string[] = [];

let result: BuildResult;

/** The screenshot of a page, decoded in the page: the colours at the points, and the size. */
async function pixelsAt(view: Page, shot: Buffer, points: readonly (readonly [number, number])[]) {
  return view.evaluate(
    async ([data, at]) => {
      const bytes = Uint8Array.from(atob(data as string), (ch) => ch.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const copy = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
      copy.drawImage(bitmap, 0, 0);
      return (at as unknown as number[][]).map(([x, y]) =>
        Array.from(copy.getImageData(x, y, 1, 1).data),
      );
    },
    [shot.toString('base64'), points] as const,
  );
}

/**
 * Measures the first source of the factory, the cell (0, 0), in a screenshot: the green region
 * that starts at the first green pixel in reading order. A source is green, and the cells next
 * to it are not. It returns the corners of the region's box and the size of the canvas.
 */
async function measureCell(view: Page, shot: Buffer) {
  return view.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const { width, height } = bitmap;
    const copy = new OffscreenCanvas(width, height).getContext('2d')!;
    copy.drawImage(bitmap, 0, 0);
    const pixels = copy.getImageData(0, 0, width, height).data;
    const green = (i: number) => {
      const index = i * 4;
      return pixels[index + 1] > pixels[index] + 40 && pixels[index + 1] > pixels[index + 2] + 30;
    };
    let start = -1;
    for (let i = 0; i < width * height && start < 0; i++) if (green(i)) start = i;
    if (start < 0) return undefined;
    // The region of the green pixels that touch each other.
    const seen = new Uint8Array(width * height);
    const stack = [start];
    seen[start] = 1;
    let [left, top, right, bottom] = [width, height, 0, 0];
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!seen[next] && green(next)) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    return {
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1,
      screen: [width, height],
    };
  }, shot.toString('base64'));
}

/** What the drawing must show for a screen of `screen` pixels: the cell's side and its corner. */
const expected = (screen: number[]) => {
  const side = Math.min(screen[0] / 10, screen[1] / 6);
  return { side, left: (screen[0] - 10 * side) / 2, top: (screen[1] - 6 * side) / 2 };
};

/** Draws one frame of a game in a page, after `ticks` ticks, and waits for the device. */
const frame = (view: Page, ticks = 0) =>
  view.evaluate(async (n) => {
    const game = await (globalThis as any).game;
    if (n > 0) await game.step(n);
    await game.drawLayers();
    await game.wait();
  }, ticks);

beforeAll(async () => {
  // The engine builds the page, with the hook of a browser check (design record 0109).
  const dir = here.replace(/\/$/, '');
  const config = await loadConfig(dir);
  result = await buildProject(dir, config, { hook: true, readout: true, commit: 'abc1234' });
  server = await preview({
    ...viteConfig(dir, config),
    preview: { port: 4317, strictPort: true },
  });
  // The installed browser of this machine, where there is one. CI installs Playwright's own.
  const local = '/opt/pw-browsers/chromium';
  browser = await chromium.launch({
    executablePath: existsSync(local) ? local : undefined,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      '--use-vulkan=swiftshader',
      '--use-angle=swiftshader',
      '--enable-features=Vulkan',
    ],
  });
  page = await browser.newPage({ viewport: { width: 800, height: 480 } });
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  await page.goto('http://localhost:4317/?manual');
  await page.evaluate(
    async () => void (await (globalThis as unknown as { game: Promise<unknown> }).game),
  );
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => server?.httpServer.close(() => done()));
});

test('the page opens a WebGPU device', async () => {
  const tier = await page.evaluate(async () => (await (globalThis as any).game).tier);
  expect(tier).toBe('webgpu');
});

test('the cells the GPU computes equal the cells of the CPU tier, with an input on the way', async () => {
  // In the browser: 50 ticks, a belt in the cell (3, 3) that sends its item north, 150 ticks.
  // The grid is 10 by 6 on a canvas of 800 by 480, so a cell is 80 pixels. The drag starts in
  // the cell (3, 3) and goes north, as a player's does.
  const step = (n: number) =>
    page.evaluate(async (ticks) => {
      const game = await (globalThis as any).game;
      await game.step(ticks);
      await game.drawLayers();
      await game.wait();
    }, n);
  await step(50);
  await page.mouse.move(3 * 80 + 40, 3 * 80 + 40);
  await page.mouse.down();
  await page.mouse.move(3 * 80 + 40, 2 * 80 + 40, { steps: 4 });
  await page.mouse.up();
  await step(150);
  const gpu = await page.evaluate(async () =>
    JSON.stringify(await (await (globalThis as any).game).tables.cells.read()),
  );

  // On the CPU tier: the same project, the same level, the same `putCell` at the same tick.
  const cpu = await load<Game>('examples/factory', { seed: 1, level: 'demo' });
  await cpu.step(50);
  putCell(cpu, 3, 3, BELT, 0);
  await cpu.step(150);

  expect(JSON.parse(gpu)).toEqual(JSON.parse(JSON.stringify(await cpu.tables.cells.read())));
  await cpu.dispose();
});

test('the picture shows the cells', async () => {
  await frame(page);
  // A screenshot of the page is what a person sees. The page decodes it to read a pixel.
  const shot = await page.screenshot({ path: `${here}dist/shot.png` });
  // The grid is 10 by 6 on a canvas of 800 by 480, so a cell is 80 pixels. The cell (0, 0) is a
  // source, and a source is green. The cell (0, 3) is empty, and an empty cell is dark.
  const [source, empty] = await pixelsAt(page, shot, [
    [20, 20],
    [20, 3 * 80 + 20],
  ]);
  expect(source[1]).toBeGreaterThan(source[0]);
  expect(source[1]).toBeGreaterThan(source[2]);
  expect(Math.max(empty[0], empty[1], empty[2])).toBeLessThan(40);
});

// Verifies: Design 0111.3
test('the cells are squares on a wide screen', async () => {
  const view = await browser.newPage({ viewport: { width: 800, height: 480 } });
  try {
    await view.goto('http://localhost:4317/?manual');
    await frame(view);
    const cell = (await measureCell(view, await view.screenshot()))!;
    const want = expected(cell.screen);
    console.log(
      `factory: on ${cell.screen.join(' by ')} a cell is ${cell.width} by ${cell.height}`,
    );
    // The grid fills the width: 10 cells of 80 pixels. The width and the height of a cell match.
    expect(cell.screen).toEqual([800, 480]);
    expect(Math.abs(cell.width - cell.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.width - want.side)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.left - want.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.top - want.top)).toBeLessThanOrEqual(1);
  } finally {
    await view.close();
  }
});

// Verifies: Design 0111.3
test("the cells are squares on a phone's upright screen, and the grid is in the middle", async () => {
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const view = await phone.newPage();
  try {
    await view.goto('http://localhost:4317/?manual');
    await frame(view);
    const cell = (await measureCell(view, await view.screenshot()))!;
    const want = expected(cell.screen);
    console.log(
      `factory: on ${cell.screen.join(' by ')} a cell is ${cell.width} by ${cell.height}`,
    );
    // The screen is taller than it is wide, so the grid fills the width and has a bar above it
    // and a bar below it of the same height.
    expect(cell.screen[1]).toBeGreaterThan(cell.screen[0]);
    expect(Math.abs(cell.width - cell.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.width - want.side)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.left - want.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.top - want.top)).toBeLessThanOrEqual(1);
    expect(cell.top).toBeGreaterThan(cell.screen[1] / 4);
  } finally {
    await phone.close();
  }
});

// Verifies: Design 0111.3
test('the surface changes its size, and the cells stay squares in the middle', async () => {
  const view = await browser.newPage({ viewport: { width: 800, height: 480 } });
  try {
    await view.goto('http://localhost:4317/?manual');
    await frame(view);
    await view.setViewportSize({ width: 300, height: 700 });
    await view.waitForFunction(() => document.querySelector('canvas')!.width === 300);
    await frame(view);
    const cell = (await measureCell(view, await view.screenshot()))!;
    const want = expected(cell.screen);
    expect(cell.screen).toEqual([300, 700]);
    expect(Math.abs(cell.width - cell.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.width - want.side)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.top - want.top)).toBeLessThanOrEqual(1);
  } finally {
    await view.close();
  }
});

// Verifies: Design 0111.4
test('the picture shows the table after a tick, and no read of the table reaches the host', async () => {
  const view = await browser.newPage({ viewport: { width: 800, height: 480 } });
  try {
    await view.goto('http://localhost:4317/?manual');
    await view.evaluate(async () => void (await (globalThis as any).game));
    // A read of a table to the host maps a buffer. The page counts the maps from here on.
    await view.evaluate(() => {
      const w = globalThis as any;
      w.maps = 0;
      const map = w.GPUBuffer.prototype.mapAsync;
      w.GPUBuffer.prototype.mapAsync = function (...args: unknown[]) {
        w.maps++;
        return map.apply(this, args);
      };
    });
    const centers: [number, number][] = [];
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 10; x++) centers.push([x * 80 + 40, y * 80 + 40]);
    await frame(view);
    const before = await pixelsAt(view, await view.screenshot(), centers);
    await frame(view, 12);
    const after = await pixelsAt(view, await view.screenshot(), centers);
    const maps = await view.evaluate(() => (globalThis as any).maps as number);
    expect(maps).toBe(0);
    expect(after).not.toEqual(before);

    // The colour of each cell is what the CPU tier's `color` says of the cell after 12 ticks.
    const cpu = await load<Game>('examples/factory', { seed: 1, level: 'demo' });
    await cpu.step(12);
    const rows = await cpu.tables.cells.read();
    await cpu.dispose();
    rows.forEach((row, i) => {
      const cell = Object.assign(new Cell(), row);
      const colour = cell.color([0, 0]).map((c) => Math.round(c * 255));
      colour.forEach((c, k) =>
        expect(Math.abs(after[i][k] - c), `cell ${i}`).toBeLessThanOrEqual(2),
      );
    });
  } finally {
    await view.close();
  }
});

test('the page loads its script within the budget, and no script of a tier it did not open', () => {
  const { bytes, gzip } = result.loaded;
  console.log(`factory: the page loads ${bytes} bytes of script at its start, ${gzip} with gzip`);
  expect(result.over).toBe(false);
  expect(bytes).toBeLessThanOrEqual(result.budget!);
  // The browser asked for the entry script only: the WebGL2 runtime and the planner stayed.
  const scripts = requested.filter((path) => path.endsWith('.js'));
  expect(scripts.length).toBe(1);
  expect(statSync(`${here}dist/${scripts[0].replace(/^\//, '')}`).size).toBe(bytes);
});

// Verifies: Design 0109.4
test('the development server serves the page, and runs the sync again for a new file', async () => {
  const dir = here.replace(/\/$/, '');
  const dev = await devProject(dir, await loadConfig(dir));
  const added = `${dir}/input/keys.ts`;
  const game = () => readFileSync(`${dir}/.radiance/game.ts`, 'utf8');
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 100 && !done(); i++) await new Promise((r) => setTimeout(r, 100));
    return done();
  };
  const view = await browser.newPage({ viewport: { width: 800, height: 480 } });
  try {
    const errors: string[] = [];
    view.on('pageerror', (error) => errors.push(error.message));
    await view.goto(dev.resolvedUrls!.local[0]);
    // The page draws the factory: the pixels at the middle of the cells are not all one colour.
    await view.waitForFunction(() => document.querySelector('canvas')!.width === 800);
    await view.waitForTimeout(1500);
    const pixels = new Set<string>();
    for (let x = 40; x < 800; x += 80) {
      for (let y = 40; y < 480; y += 80) {
        const pixel = await view.screenshot({ clip: { x, y, width: 1, height: 1 } });
        pixels.add(pixel.toString('base64'));
      }
    }
    expect(errors).toEqual([]);
    expect(pixels.size).toBeGreaterThan(1);

    expect(game()).not.toContain('keydown');
    writeFileSync(added, 'export function keydown(): void {}\n');
    expect(await until(() => game().includes('keydown'))).toBe(true);
    rmSync(added);
    expect(await until(() => !game().includes('keydown'))).toBe(true);
  } finally {
    rmSync(added, { force: true });
    await view.close();
    await dev.close();
  }
});

// Verifies: Design 0110.1
test('the readout shows the tier, three numbers and the commit', async () => {
  const view = await browser.newPage({ viewport: { width: 800, height: 480 } });
  try {
    await view.goto('http://localhost:4317/');
    const line = view.locator('#readout');
    await expect
      .poll(() => line.textContent(), { timeout: 20_000 })
      .toMatch(/^webgpu  tick \d+\.\d ms  frame \d+\.\d ms  \d+(\.\d)? tick\/frame  abc1234$/);
    console.log(`factory: the readout says "${await line.textContent()}"`);
  } finally {
    await view.close();
  }
});

// Verifies: Design 0110.1
// Verifies: Design 0111.5
test('a page with no device shows the reason', async () => {
  const view = await browser.newPage({ viewport: { width: 800, height: 480 } });
  try {
    // A browser with no WebGPU and no WebGL2.
    await view.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { value: undefined });
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await view.goto('http://localhost:4317/');
    const line = view.locator('#readout');
    await expect.poll(() => line.textContent(), { timeout: 20_000 }).not.toBe('');
    const text = (await line.textContent())!;
    console.log(`factory: with no device the readout says "${text}"`);
    expect(text.startsWith('webgpu')).toBe(false);
    expect(text).toContain('run(): the game draws in layers (cells), and layers need WebGPU.');
    expect(text).toContain('typeshade/typeshade#1249');
    expect(text).toContain('typeshade/typeshade#1263');
  } finally {
    await view.close();
  }
});

// Verifies: Design 0110.3
// Verifies: Design 0111.3
test("on a phone's screen, a drag of a touch puts a belt", async () => {
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const view = await phone.newPage();
  try {
    await view.goto('http://localhost:4317/?manual');
    await view.evaluate(async () => void (await (globalThis as any).game));
    // The canvas fills the screen of the phone. The grid is 10 by 6 cells in the middle of it,
    // as large as it can be, so a cell is as long as the width of the screen divided by 10.
    const box = (await view.locator('canvas').boundingBox())!;
    const size = view.viewportSize()!;
    expect([box.width, box.height]).toEqual([size.width, size.height]);
    const side = Math.min(box.width / 10, box.height / 6);
    const at = (x: number, y: number) => ({
      x: (box.width - 10 * side) / 2 + (x + 0.5) * side,
      y: (box.height - 6 * side) / 2 + (y + 0.5) * side,
    });
    const touch = await phone.newCDPSession(view);
    const send = (type: string, points: { x: number; y: number }[]) =>
      touch.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: points });
    const from = at(3, 3);
    const to = at(3, 2);
    await send('touchStart', [from]);
    for (let i = 1; i <= 4; i++) {
      await send('touchMove', [{ x: from.x, y: from.y + ((to.y - from.y) * i) / 4 }]);
    }
    await send('touchEnd', []);
    const kinds = await view.evaluate(async () => {
      const game = await (globalThis as any).game;
      await game.step(1);
      const cells = await game.tables.cells.read();
      return [cells[3 * 10 + 3].kind, cells[4 * 10 + 3].kind];
    });
    // The belt is in the cell under the touch, and the machine in the cell below is still there.
    expect(kinds).toEqual([BELT, MACHINE]);
  } finally {
    await phone.close();
  }
});
