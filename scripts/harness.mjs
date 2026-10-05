// === The harness: the path tracer on a real WebGPU device, held to the CPU oracle ===
//
// The compiler's user journeys run in headless Chromium through Playwright, on SwiftShader, so
// CI has a WebGPU device without a GPU (`journeys/_harness.mjs`). This file does the same for the
// renderer: it bundles `@typeshade/radiance-render` with bun for the browser (its shader modules
// compiled by scripts/shade-plugin.ts), serves it from 127.0.0.1 (a secure context, which WebGPU
// needs), renders the Cornell box and holds it to M1's acceptance (docs/plan.md, section 4):
//
//   1. Determinism: two renders of one seed are bit-identical, and another seed differs.
//   2. The oracle: the GPU's 1024 spp render is within tolerance of the CPU oracle's render of
//      the same kernel, seed and samples (scripts/oracle.ts; the tolerance is `ORACLE`, below).
//   3. The display: the tone-mapped image is the tone map of the mean radiance.
//   4. The demo page (site/) renders on its canvas without an error.
//
// It also writes a larger render to .harness/cornell.png, to look at; nothing holds that one.
//
// Env: RADIANCE_CHROMIUM names a Chromium executable (the browsers Playwright installs are used
// otherwise); RADIANCE_HEADED=1 shows the window; RADIANCE_PREVIEW=<side>,<samples> sizes the
// preview (default 128,64).

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const OUT = join(process.cwd(), '.harness');
mkdirSync(OUT, { recursive: true });

/** The gated render: small, so SwiftShader and the oracle finish in CI's time. */
const GATE = { size: [16, 16], samples: 1024, perFrame: 64, seed: 1 };
/** The render written to look at; RADIANCE_PREVIEW=<side>,<samples> sets its size. */
const [side, previewSamples] = (process.env.RADIANCE_PREVIEW ?? '128,64').split(',').map(Number);
const PREVIEW = { size: [side, side], samples: previewSamples, perFrame: 16, seed: 1 };

// ---- 1: the bundle the page runs, and the oracle's render (in the background) ----------------
for (const args of [
  ['scripts/bundle.ts', 'scripts/harness-entry.ts', join(OUT, 'render.js')],
  ['scripts/build-site.ts'],
]) {
  const build = spawnSync('bun', args, { encoding: 'utf8' });
  if (build.status !== 0) {
    process.stderr.write(`bundling failed:\n${build.stdout}${build.stderr}`);
    process.exit(1);
  }
}
const oracleFile = join(OUT, 'oracle.json');
const oracle = new Promise((resolve, reject) => {
  const child = spawn(
    'bun',
    [
      'scripts/oracle.ts',
      ...GATE.size.map(String),
      String(GATE.samples),
      String(GATE.seed),
      oracleFile,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.on('exit', (code) =>
    code === 0 ? resolve(log.trim()) : reject(new Error(`the oracle exited with ${code}`)),
  );
});

// ---- 2: the page --------------------------------------------------------------------------------
const PAGE = `<!doctype html><title>radiance harness</title><script type="module">
import { createRenderer, cornellBox } from '/render.js';
window.run = async ({ size, samples, perFrame, seed }) => {
  const r = await createRenderer({ size, scene: cornellBox(), seed, samplesPerFrame: perFrame });
  const t0 = performance.now();
  while (r.samples < samples) await r.frame();
  const ms = performance.now() - t0;
  const radiance = [...(await r.readRadiance())];
  const image = [...(await r.read())];
  r.destroy();
  return { radiance, image, ms };
};
</script>`;
const SITE = join(process.cwd(), 'dist/site');
const server = createServer((req, res) => {
  if (req.url?.startsWith('/site/')) {
    const file = req.url === '/site/' ? 'index.html' : req.url.slice('/site/'.length);
    try {
      const type = file.endsWith('.js') ? 'text/javascript' : 'text/html';
      res.setHeader('content-type', `${type}; charset=utf-8`);
      res.end(readFileSync(join(SITE, file)));
    } catch {
      res.statusCode = 404;
      res.end();
    }
    return;
  }
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

// ---- 4: the renders, held to M1's acceptance ---------------------------------------------------
/**
 * How close the GPU's mean radiance must be to the oracle's, per channel: within `abs`, or within
 * `rel` of the oracle's value; and `mean`, the mean relative difference of a pixel's luminance
 * over the frame. The two run the same kernel on the same samples, and the kernel steers no
 * path by a transcendental WGSL lets a GPU round loosely (`turn` in trace.shade.ts), so
 * their paths agree and only f32 rounding is left: on SwiftShader the largest difference was
 * 2.4e-5 and the mean 1.4e-6. A path that still goes another way on another GPU moves its
 * pixel by one sample's share of 1024, which `rel` admits; many of them move `mean`, which a
 * systematic error (a lost term, a wrong sign) breaks too: a 1% change in one albedo put `mean`
 * at 1.2e-2 when the gate was proved.
 */
const ORACLE = { abs: 1e-3, rel: 0.05, mean: 1e-4 };
/** Half floats carry 11 bits of mantissa. */
const HALF = 2e-3;

let failures = 0;
const fail = (message) => {
  console.error(message);
  failures++;
};
const lum = (a, i) => (a[i] + a[i + 1] + a[i + 2]) / 3;

/** What `tonemap` in trace.shade.ts computes, written again here as an independent check. */
const tonemap = (c) => {
  const x = c;
  const m = Math.min(1, Math.max(0, (x * (x * 2.51 + 0.03)) / (x * (x * 2.43 + 0.59) + 0.14)));
  return m <= 0.0031308 ? m * 12.92 : 1.055 * Math.pow(m, 1 / 2.4) - 0.055;
};

/** `image` (RGBA floats in [0, 1], top row first) as a PNG. */
function png(width, height, image) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width * 4; x++) {
      const v = image[y * width * 4 + x];
      raw[y * (width * 4 + 1) + 1 + x] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

try {
  const run = (o) => page.evaluate((x) => window.run(x), o);
  const first = await run(GATE);
  const again = await run(GATE);
  const other = await run({ ...GATE, seed: GATE.seed + 1 });
  console.log(
    `gpu: ${GATE.size.join('x')} at ${GATE.samples} spp in ${(first.ms / 1000).toFixed(1)} s`,
  );

  // 1: determinism.
  const pixels = GATE.size[0] * GATE.size[1];
  if (first.radiance.length !== pixels * 4)
    fail(`read ${first.radiance.length} floats, expected ${pixels * 4}`);
  const unequal = first.radiance.findIndex((v, i) => !Object.is(v, again.radiance[i]));
  if (unequal >= 0)
    fail(
      `two renders of seed ${GATE.seed} differ at float ${unequal}: ${first.radiance[unequal]} and ${again.radiance[unequal]}`,
    );
  if (first.radiance.every((v, i) => v === other.radiance[i]))
    fail(`seeds ${GATE.seed} and ${GATE.seed + 1} render the same image`);
  for (let p = 0; p < pixels; p++)
    if (first.radiance[p * 4 + 3] !== GATE.samples) {
      fail(`pixel ${p} has ${first.radiance[p * 4 + 3]} samples, expected ${GATE.samples}`);
      break;
    }

  // 2: the oracle.
  console.log(await oracle);
  const cpu = JSON.parse(readFileSync(oracleFile, 'utf8'));
  let worst = { p: -1, d: 0 };
  let relSum = 0;
  let out = 0;
  for (let p = 0; p < pixels; p++) {
    for (let c = 0; c < 3; c++) {
      const g = first.radiance[p * 4 + c];
      const w = cpu[p * 4 + c];
      const d = Math.abs(g - w);
      if (d > ORACLE.abs && d > ORACLE.rel * Math.abs(w)) out++;
      if (d > worst.d) worst = { p, c, d, g, w };
    }
    relSum +=
      Math.abs(lum(first.radiance, p * 4) - lum(cpu, p * 4)) / Math.max(lum(cpu, p * 4), 1e-3);
  }
  const meanRel = relSum / pixels;
  console.log(
    `oracle: mean relative difference ${meanRel.toExponential(2)}; largest ${worst.d.toExponential(2)} at pixel ${worst.p} (gpu ${worst.g}, cpu ${worst.w}); ${out} channel(s) out of bounds`,
  );
  if (out > 0)
    fail(`${out} channel(s) differ from the oracle by more than ${JSON.stringify(ORACLE)}`);
  if (!(meanRel <= ORACLE.mean))
    fail(`the mean relative difference ${meanRel} is over ${ORACLE.mean}`);

  // 3: the display.
  for (let i = 0; i < pixels * 4; i++) {
    const want = i % 4 === 3 ? 1 : tonemap(first.radiance[i]);
    if (Math.abs(first.image[i] - want) > HALF) {
      fail(
        `displayed texel ${Math.floor(i / 4)} channel ${i % 4}: ${first.image[i]}, expected ${want}`,
      );
      break;
    }
  }

  // The preview, to look at.
  const preview = await run(PREVIEW);
  writeFileSync(join(OUT, 'cornell.png'), png(PREVIEW.size[0], PREVIEW.size[1], preview.image));
  console.log(
    `preview: ${PREVIEW.size.join('x')} at ${PREVIEW.samples} spp in ${(preview.ms / 1000).toFixed(1)} s, .harness/cornell.png`,
  );

  // 4: the demo page (site/, deployed to radiance.typeshade.dev) renders on its canvas and counts samples.
  const site = await browser.newPage();
  site.on('pageerror', (e) => errors.push(`site: ${e.message}`));
  site.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      errors.push(`site: console.${m.type()}: ${m.text()}`);
  });
  await site.goto(`http://127.0.0.1:${server.address().port}/site/`);
  await site.waitForFunction(() => Number(document.getElementById('spp')?.textContent) >= 2, null, {
    timeout: 60_000,
  });
  if (!(await site.locator('#notice').isHidden()))
    fail(`site: the notice shows: ${await site.textContent('#notice')}`);
  await site.screenshot({ path: join(OUT, 'site.png') });
  console.log(`site: the demo page shows ${await site.textContent('#spp')} spp, .harness/site.png`);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
for (const e of errors) fail(e);
await browser.close();
server.close();
if (failures > 0) {
  console.error(`harness: ${failures} failure(s)`);
  process.exit(1);
}
console.log('harness: the Cornell box is deterministic, matches the oracle, and displays');
