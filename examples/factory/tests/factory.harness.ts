// The browser check of the reference game. It builds the page, opens it in headless Chromium
// with WebGPU, and holds the cells the GPU computed to the cells the CPU tier computes.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { build, preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { load } from '../../../src/test.ts';
import type { Game } from '../.radiance/game.ts';
import { putCell } from '../cells.ts';
import { BELT } from '../kinds.shade.ts';

const here = new URL('..', import.meta.url).pathname;
const config = `${here}vite.config.ts`;

let server: PreviewServer;
let browser: Browser;
let page: Page;
const requested: string[] = [];

beforeAll(async () => {
  await build({ configFile: config, logLevel: 'error' });
  server = await preview({
    configFile: config,
    preview: { port: 4317, strictPort: true },
    logLevel: 'error',
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
  const gpu = await page.evaluate(async (belt) => {
    const game = await (globalThis as any).game;
    await game.step(50);
    game.put(3, 3, belt, 0);
    await game.step(150);
    return JSON.stringify(await game.read());
  }, BELT);

  // On the CPU tier: the same project, the same level, the same `putCell` at the same tick.
  const cpu = await load<Game>('examples/factory', { seed: 1, level: 'demo' });
  await cpu.step(50);
  putCell(cpu, 3, 3, BELT, 0);
  await cpu.step(150);

  expect(JSON.parse(gpu)).toEqual(JSON.parse(JSON.stringify(await cpu.cells.read())));
  await cpu.dispose();
});

test('the picture shows the cells', async () => {
  await page.evaluate(async () => void (await (await (globalThis as any).game).step(0)));
  // A screenshot of the page is what a person sees. The page decodes it to read a pixel.
  const shot = await page.screenshot({ path: `${here}dist/shot.png` });
  const pixel = (x: number, y: number) =>
    page.evaluate(
      async ([data, px, py]) => {
        const bytes = Uint8Array.from(atob(data as string), (ch) => ch.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const copy = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        copy.drawImage(bitmap, 0, 0);
        return Array.from(copy.getImageData(px as number, py as number, 1, 1).data);
      },
      [shot.toString('base64'), x, y] as const,
    );
  // The grid is 10 by 6 on a canvas of 800 by 480, so a cell is 80 pixels. The cell (0, 0) is a
  // source, and a source is green. The cell (0, 3) is empty, and an empty cell is dark.
  const source = await pixel(20, 20);
  const empty = await pixel(20, 3 * 80 + 20);
  expect(source[1]).toBeGreaterThan(source[0]);
  expect(source[1]).toBeGreaterThan(source[2]);
  expect(Math.max(empty[0], empty[1], empty[2])).toBeLessThan(40);
});

test('the size of the shipped game is recorded', () => {
  const dir = `${here}dist/assets/`;
  const files = readdirSync(dir).filter((name) => name.endsWith('.js'));
  const sizes = Object.fromEntries(files.map((name) => [name, statSync(dir + name).size]));
  const built = Object.values(sizes).reduce((a, b) => a + b, 0);
  const loaded = requested
    .filter((path) => path.endsWith('.js'))
    .map((path) => path.split('/').pop()!)
    .reduce((sum, name) => sum + (sizes[name] ?? 0), 0);
  console.log(
    `factory size: ${built} bytes built in ${files.length} files, ${loaded} bytes loaded by the page`,
  );
  console.log(`factory files: ${JSON.stringify(sizes)}`);
  console.log(`factory requests: ${JSON.stringify(requested)}`);
  expect(loaded).toBeGreaterThan(0);
});
