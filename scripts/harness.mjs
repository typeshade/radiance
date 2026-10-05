// === The harness: one frame on a real WebGPU device, held to a golden ===
//
// The compiler's user journeys run in headless Chromium through Playwright, on SwiftShader, so
// CI has a WebGPU device without a GPU (`journeys/_harness.mjs`). This file does the same for the
// renderer: it bundles `@typeshade/radiance-render` with bun for the browser, serves it from
// 127.0.0.1 (a secure context, which WebGPU needs), draws two frames of the M0 renderer and holds
// every texel of the read back to `CLEAR`, to the precision of the half-float target.
//
// Two frames, not one: the second frame's shapes repeat the first's, which is the shape every
// progressive frame has, and a read after it must still give the clear.
//
// Env: RADIANCE_CHROMIUM names a Chromium executable (the browsers Playwright installs are used
// otherwise); RADIANCE_HEADED=1 shows the window.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from 'playwright';

const OUT = join(process.cwd(), '.harness');
mkdirSync(OUT, { recursive: true });

// ---- 1: the bundle the page runs -------------------------------------------------------------
const build = spawnSync(
  'bun',
  [
    'build',
    'packages/render/src/index.ts',
    '--target=browser',
    '--format=esm',
    `--outfile=${join(OUT, 'render.js')}`,
  ],
  { encoding: 'utf8' },
);
if (build.status !== 0) {
  process.stderr.write(`bun build failed:\n${build.stdout}${build.stderr}`);
  process.exit(1);
}

// ---- 2: the page --------------------------------------------------------------------------------
const PAGE = `<!doctype html><title>radiance harness</title><script type="module">
import { createRenderer, CLEAR } from '/render.js';
window.run = async (size) => {
  const r = await createRenderer({ size });
  await r.frame();
  await r.frame();
  const got = [...(await r.read())];
  r.destroy();
  return { got, clear: CLEAR };
};
</script>`;
const server = createServer((req, res) => {
  if (req.url === '/render.js') {
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    res.end(readFileSync(join(OUT, 'render.js'), 'utf8'));
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(PAGE);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

// ---- 3: the device ------------------------------------------------------------------------------
const browser = await chromium.launch({
  executablePath: process.env.RADIANCE_CHROMIUM || undefined,
  headless: process.env.RADIANCE_HEADED !== '1',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--enable-features=Vulkan',
  ],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    errors.push(`console.${m.type()}: ${m.text()}`);
});
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => typeof window.run === 'function');

// ---- 4: the frame, held to the golden -------------------------------------------------------
const SIZE = [4, 4];
/** Half floats carry 11 bits of mantissa: 0.1 is 0.0999755859375 in them. */
const TOLERANCE = 1e-3;
let failures = 0;
try {
  const { got, clear } = await page.evaluate((s) => window.run(s), SIZE);
  const want = SIZE[0] * SIZE[1] * 4;
  if (got.length !== want) {
    console.error(`read ${got.length} floats, expected ${want}`);
    failures++;
  }
  for (let i = 0; i < got.length; i++) {
    const expected = clear[i % 4];
    if (Math.abs(got[i] - expected) > TOLERANCE) {
      console.error(`texel ${Math.floor(i / 4)} channel ${i % 4}: ${got[i]}, expected ${expected}`);
      failures++;
      if (failures > 8) break;
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  failures++;
}
for (const e of errors) {
  console.error(e);
  failures++;
}
await browser.close();
server.close();
if (failures > 0) {
  console.error(`harness: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`harness: ${SIZE[0]}x${SIZE[1]} ${'rgba16float'} frame holds the clear on WebGPU`);
