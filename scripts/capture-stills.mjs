// Captures the still of every example: builds nothing itself (`bun run capture:stills` builds
// the site first with STILLS_REBASELINE=1), opens each example's page in Chromium on
// SwiftShader, waits for STILL_SAMPLES samples a pixel, and writes the canvas to
// site/public/stills/<id>.webp with a .sha256 of its bytes. An example that fills a panel under
// its canvas (`ExampleRun.panel`) runs passes of its own, with its own sample count: the capture
// waits for the `data-done` mark the example sets in the panel, and not for STILL_SAMPLES. Commit
// both files: the build checks the hash (scripts/stills.mjs), so a still changes only by a
// deliberate capture.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { launchBrowser, serve } from './gates/_browser.mjs';
import { exampleIds, sha256, stillPath } from './stills.mjs';

/** The samples a pixel a still is taken at. */
const STILL_SAMPLES = Number(process.env.STILL_SAMPLES ?? 256);
/** The size a still is rendered at, in CSS pixels at a device pixel ratio of 1. */
const VIEWPORT = { width: 1280, height: 900 };

const siteRoot = join(process.cwd(), 'site');
const only = process.argv.slice(2);
const ids = only.length > 0 ? only : exampleIds(siteRoot);
const { server, origin } = await serve(join(process.cwd(), 'dist/site'));
const browser = await launchBrowser();
let failures = 0;
try {
  for (const id of ids) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const t0 = Date.now();
    await page.goto(`${origin}/examples/${id}/`);
    const pause = page.locator(`[data-stage-toolbar] button[aria-label="Pause"]`);
    // An example that moves its scene is paused first: its motion stops, and the frame it
    // stopped on adds up samples. Any other is paused after, to stop on a finished frame.
    await page.waitForSelector('[data-stage] [data-running]');
    const animated = (await page.locator('[data-stage-toolbar][data-animated]').count()) > 0;
    const panel = (await page.locator('[data-stage-panel][data-filled]').count()) > 0;
    if (panel) {
      // Four renders of the stage's size at RENDER.samples (site/examples/determinism.ts).
      await page.waitForSelector('[data-stage-panel] [data-done]', { timeout: 120 * 60_000 });
    } else {
      if (animated) await pause.click();
      await page.waitForFunction(
        (n) => Number(document.querySelector('[data-stage-toolbar]')?.dataset.samples) >= n,
        STILL_SAMPLES,
        // On SwiftShader the triangle kernel (design record 0001) traces about 30,000 paths a
        // second, so a still of 718 x 450 pixels at 256 samples takes about 45 minutes.
        { timeout: 120 * 60_000, polling: 500 },
      );
      if (!animated) await pause.click();
    }
    const samples = await page.evaluate(
      () => document.querySelector('[data-stage-toolbar]')?.dataset.samples,
    );
    // Take the pointer off the toolbar, so its tooltip is not in the picture.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    const png = await page.locator('[data-stage] [data-running] canvas').screenshot();
    const file = stillPath(siteRoot, id);
    mkdirSync(dirname(file), { recursive: true });
    await sharp(png).webp({ quality: 88, effort: 6 }).toFile(file);
    writeFileSync(`${file}.sha256`, `${sha256(file)}\n`);
    for (const e of errors) {
      console.error(`${id}: ${e}`);
      failures++;
    }
    console.log(`${id}: ${samples} spp in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${file}`);
    await page.close();
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  failures++;
} finally {
  await browser.close();
  server.close();
}
if (failures > 0) process.exit(1);
