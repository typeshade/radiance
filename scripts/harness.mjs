// === The harness: the path tracer on a real WebGPU device, held to its gates ===
//
// The compiler's user journeys run in headless Chromium through Playwright, on SwiftShader, so
// CI has a WebGPU device without a GPU (`journeys/_harness.mjs`). This file runs the renderer's
// gates on the same kind of device: scripts/gates/_browser.mjs bundles `@typeshade/radiance` with
// bun for the browser and serves it from 127.0.0.1 (a secure context, which WebGPU needs), and
// the harness holds the Cornell box to M1's acceptance (docs/plan.md, section 4):
//
//   1. Determinism (scripts/gates/determinism.mjs): two renders of one seed are bit-identical,
//      and another seed differs.
//   2. The oracle (scripts/gates/differential.mjs): the GPU's 1024 spp render is within
//      tolerance of the CPU oracle's render of the same kernel, seed and samples
//      (scripts/oracle.ts; the tolerance is `ORACLE` in scripts/gates.mjs, which the site
//      prints).
//   3. The display: the tone-mapped image is the tone map of the mean radiance.
//   4. The render gate (scripts/gates/render.mjs): each example of the site, run at 96 x 64 and
//      64 spp, is within tolerance of its golden in scripts/__goldens__.
//   5. The probes: each gate runs once wrong on purpose and must fail. A gate that does not fail
//      there cannot be trusted to pass.
//   6. The site (dist/site) runs its Cornell box example, and the camera answers the mouse.
//
// It also writes a larger render to .harness/cornell.png, to look at; nothing holds that one.
//
// Env: RADIANCE_CHROMIUM names a Chromium executable (the browsers Playwright installs are used
// otherwise); RADIANCE_HEADED=1 shows the window; RADIANCE_PREVIEW=<side>,<samples> sizes the
// preview (default 128,64).

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HALF } from './gates.mjs';
import { openRenderPage, outDir } from './gates/_browser.mjs';
import { encodePng } from './gates/_png.mjs';
import * as determinism from './gates/determinism.mjs';
import * as differential from './gates/differential.mjs';
import * as render from './gates/render.mjs';

const OUT = outDir();

/** The render written to look at; RADIANCE_PREVIEW=<side>,<samples> sets its size. */
const [side, previewSamples] = (process.env.RADIANCE_PREVIEW ?? '128,64').split(',').map(Number);
const PREVIEW = { size: [side, side], samples: previewSamples, perFrame: 16, seed: 1 };

// ---- 1: the site the last section runs, built as it is deployed -------------------------------
const build = spawnSync('bun', ['run', 'site'], { encoding: 'utf8' });
if (build.status !== 0) {
  process.stderr.write(`the site build failed:\n${build.stdout}${build.stderr}`);
  process.exit(1);
}

// ---- 2: the device: the bundle the page runs, the server and the browser ----------------------
const session = await openRenderPage();
const { browser, origin, errors } = session;

// ---- 3: the gates, and the display ------------------------------------------------------------
let failures = 0;
const fail = (message) => {
  console.error(message);
  failures++;
};
/** A gate's result: its message to the output when the gate holds, to the failures when not. */
const report = (result) => (result.ok ? console.log(result.message) : fail(result.message));

/** What `tonemap` in trace.shade.ts computes, written again here as an independent check. */
const tonemap = (c) => {
  const x = c;
  const m = Math.min(1, Math.max(0, (x * (x * 2.51 + 0.03)) / (x * (x * 2.43 + 0.59) + 0.14)));
  return m <= 0.0031308 ? m * 12.92 : 1.055 * Math.pow(m, 1 / 2.4) - 0.055;
};

try {
  const scenes = Object.keys(differential.SCENES);
  for (const scene of scenes) {
    // 1 and 2: the oracle (which renders while the GPU does) and determinism.
    const compared = await differential.run({ scene, session });
    report(compared);
    report(await determinism.run({ scene, session }));

    // 3: the display.
    const { gate } = differential.gatedScene(scene);
    const { radiance, image } = compared.render;
    for (let i = 0; i < gate.size[0] * gate.size[1] * 4; i++) {
      const want = i % 4 === 3 ? 1 : tonemap(radiance[i]);
      if (Math.abs(image[i] - want) > HALF) {
        fail(
          `displayed texel ${Math.floor(i / 4)} channel ${i % 4}: ${image[i]}, expected ${want}`,
        );
        break;
      }
    }
  }

  // 4: the render gate. Every example of the site is held to its golden.
  report(await render.run({ session }));

  // 5: the probes. A gate runs once wrong on purpose, and a gate that does not fail is blind.
  for (const [name, gate] of [
    ['differential', differential],
    ['determinism', determinism],
  ]) {
    for (const scene of scenes) {
      try {
        console.log(`probe ${name} (${scene}): ${(await gate.probe({ scene, session })).message}`);
      } catch (e) {
        fail(`probe ${name} (${scene}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  try {
    console.log(`probe render: ${(await render.probe()).message}`);
  } catch (e) {
    fail(`probe render: ${e instanceof Error ? e.message : String(e)}`);
  }

  // The preview, to look at.
  const preview = await session.render(PREVIEW);
  writeFileSync(
    join(OUT, 'cornell.png'),
    encodePng(PREVIEW.size[0], PREVIEW.size[1], preview.image),
  );
  console.log(
    `preview: ${PREVIEW.size.join('x')} at ${PREVIEW.samples} spp in ${(preview.ms / 1000).toFixed(1)} s, .harness/cornell.png`,
  );

  // 6: the site (radiance.typeshade.dev, built to dist/site) runs the Cornell box example on its
  // page and counts samples in the stage's toolbar, and its camera answers the mouse: a drag
  // starts a preview and the render again from another view, and a wheel turn dollies without
  // scrolling the page.
  const site = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  site.on('pageerror', (e) => errors.push(`site: ${e.message}`));
  site.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      errors.push(`site: console.${m.type()}: ${m.text()}`);
  });
  await site.goto(`${origin}/examples/cornell-box/`);
  const TOOLBAR = '[data-stage-toolbar]';
  const status = () => site.evaluate((q) => document.querySelector(q)?.dataset.status, TOOLBAR);
  // On SwiftShader a full frame of the triangle kernel (design record 0001) at the stage's size
  // takes about ten seconds, and the page answers the mouse at the frame after the one in
  // flight. So each wait allows several frames: a frame that takes longer is a failure.
  const FRAME = 20_000;
  const waitFor = (test, arg, timeout = 4 * FRAME) =>
    site.waitForFunction(test, [TOOLBAR, arg], { timeout });
  const waitSamples = (n) =>
    waitFor(([q, k]) => Number(document.querySelector(q)?.dataset.samples) >= k, n);
  await waitSamples(2);
  // The canvas fades in over the still on its first frame; let the fade finish.
  await site.waitForSelector('[data-stage] [data-drawn]');
  await site.waitForTimeout(300);
  if ((await site.locator('[data-stage] [role=status]').count()) > 0)
    fail(`site: the stage shows: ${await site.textContent('[data-stage] [role=status]')}`);
  const canvas = site.locator('[data-stage] [data-running] canvas');
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await site.mouse.move(cx, cy);
  await site.mouse.down();
  for (let i = 1; i <= 10; i++) await site.mouse.move(cx + i * 15, cy + i * 3);
  await waitFor(([q]) => document.querySelector(q)?.dataset.status === 'Preview', null, 2 * FRAME);
  const during = await status();
  await site.mouse.up();
  await waitFor(([q]) => document.querySelector(q)?.dataset.status !== 'Preview', null, 2 * FRAME);
  await waitSamples(2);
  const after = await canvas.screenshot();
  if (before.equals(after)) fail('site: the view is the same after a drag');
  // A wheel turn over the canvas dollies: the samples start again from fewer than they were.
  await waitSamples(4);
  await site.mouse.move(cx, cy);
  const scrolled = await site.evaluate(() => window.scrollY);
  await site.mouse.wheel(0, -400);
  await waitFor(([q]) => Number(document.querySelector(q)?.dataset.samples) < 4, null, 2 * FRAME);
  if ((await site.evaluate(() => window.scrollY)) !== scrolled)
    fail('site: a wheel turn over the canvas scrolled the page');
  await waitSamples(2);
  await site.screenshot({ path: join(OUT, 'site.png'), fullPage: true });
  console.log(
    `site: the Cornell box example renders, ${during} while dragged, a new view after it, and a wheel turn dollies; .harness/site.png`,
  );
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
for (const e of errors) fail(e);
await session.close();
if (failures > 0) {
  console.error(`harness: ${failures} failure(s)`);
  process.exit(1);
}
console.log(
  'harness: the Cornell box is deterministic, matches the oracle, and displays, each example matches its golden, and each probe fails its gate',
);
