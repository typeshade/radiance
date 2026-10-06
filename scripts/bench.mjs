// === The benchmark: how fast each scene renders, recorded and not held ===
//
// Design record 0002, "The benchmark", step 7 and Amendment 4. The script renders the Cornell box and each
// site example at a fixed size and a fixed number of samples a pixel, in headless Chromium, and
// prints one row of a Markdown table for each scene and size:
//
//   date, commit, scene, size, spp, triangles, BVH ms, frame ms, paths/s, spp/s, device, browser
//
// Nothing here holds a bound: speed is a recorded row (record 0002, decision 3). The rows go to
// docs/benchmarks.md by hand, with the procedure that file states.
//
//   node scripts/bench.mjs [--gpu] [--smoke] [--size WxH[,WxH]] [--samples N] [--per-frame N]
//                          [--scene a,b] [--timeout S]
//
//   --gpu       Drop the SwiftShader flags the gates use (scripts/gates/_browser.mjs), so Chromium
//               takes the machine's GPU. The run fails when the adapter is a software one.
//   --smoke     A tiny run (SMOKE below) that shows every scene still renders. CI is to run it as
//               a smoke test and to record nothing: its rows are not a measurement.
//   --size      The frame sizes in pixels. Default 512x512 and 1920x1080.
//   --samples   The samples a pixel of each render. Default 16.
//   --per-frame The samples one frame adds. Default 4.
//   --scene     The scenes to run, by name: `cornell` (the gate scene) and the site examples' ids.
//   --timeout   Seconds one render may take before the run fails. Default 1800.
//
// Env: RADIANCE_CHROMIUM names a Chromium executable (the browsers Playwright installs are used
// otherwise); RADIANCE_HEADED=1 shows the window.
//
// What each column is:
//
//   triangles  The triangles the scene draws: each visible mesh counts, so an instance counts
//              again.
//   BVH ms     The median of five builds of the bottom-level BVH (`buildBlas`) of every distinct
//              geometry of the scene, on the page's main thread. A build that takes over a second
//              is timed once. The top-level BVH and the packing are not in it.
//   frame ms   The mean time of one frame (`PathTracer.info.frameTime`). The first frame adds one
//              sample, to measure the speed the tiles are sized by, and is left out of the mean
//              and of paths/s when the render has a second frame.
//   paths/s    The paths the counted frames traced, over their time.
//   spp/s      paths/s over the pixels of the frame.
//   device     The adapter's description as the browser reports it (`GPUAdapter.info`).

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, outDir, serve } from './gates/_browser.mjs';

/** The run without flags. 512 x 512 is record 0002's smaller size, and 1920 x 1080 its larger. */
export const DEFAULTS = {
  sizes: [
    [512, 512],
    [1920, 1080],
  ],
  samples: 16,
  perFrame: 4,
  seed: 1,
  timeout: 1800,
};

/** `--smoke`: small enough that SwiftShader finishes every scene in seconds. */
export const SMOKE = { sizes: [[32, 32]], samples: 2, perFrame: 1 };

export const COLUMNS = [
  'date',
  'commit',
  'scene',
  'size',
  'spp',
  'triangles',
  'BVH ms',
  'frame ms',
  'paths/s',
  'spp/s',
  'device',
  'browser',
];

/** `WxH` as `[w, h]`, or an error that names the text. */
export function parseSize(text) {
  const m = /^(\d+)x(\d+)$/.exec(text);
  if (m === null || Number(m[1]) < 1 || Number(m[2]) < 1)
    throw new Error(`a size is WxH in pixels, such as 512x512, and not '${text}'`);
  return [Number(m[1]), Number(m[2])];
}

const whole = (flag, text) => {
  if (!/^\d+$/.test(text ?? '') || Number(text) < 1)
    throw new Error(`${flag} takes a whole number from 1, and not '${text}'`);
  return Number(text);
};

/** The options of `argv` (the words after the script's name), over DEFAULTS or SMOKE. */
export function parseArgs(argv) {
  /** @type {{ gpu: boolean, smoke: boolean, scenes: string[] | undefined } & typeof DEFAULTS} */
  const out = { gpu: false, smoke: false, scenes: undefined, ...DEFAULTS };
  const given = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--gpu') out.gpu = true;
    else if (flag === '--smoke') out.smoke = true;
    else if (flag === '--size') given.sizes = value().split(',').map(parseSize);
    else if (flag === '--samples') given.samples = whole(flag, value());
    else if (flag === '--per-frame') given.perFrame = whole(flag, value());
    else if (flag === '--timeout') given.timeout = whole(flag, value());
    else if (flag === '--scene') out.scenes = value().split(',').filter(Boolean);
    else throw new Error(`no option is named ${flag}`);
  }
  return { ...out, ...(out.smoke ? SMOKE : {}), ...given };
}

/**
 * The speed of a render from its frames, `{ paths, ms }` each, in order. The first frame is left
 * out when a second one exists (see the header). Answers `{ frames, frameMs, pathsPerSecond }`.
 */
export function summarize(frames) {
  const counted = frames.length > 1 ? frames.slice(1) : frames;
  if (counted.length === 0) throw new Error('the render drew no frame');
  const paths = counted.reduce((a, f) => a + f.paths, 0);
  const ms = counted.reduce((a, f) => a + f.ms, 0);
  return {
    frames: counted.length,
    frameMs: ms / counted.length,
    pathsPerSecond: ms > 0 ? (paths / ms) * 1000 : 0,
  };
}

/** A cell of the table: the `|` of a device name would end it. */
const cell = (text) => String(text).replaceAll('|', '/').trim();

/** The row of one render. `r` holds the fields of COLUMNS' names: see `measureRow`. */
export function formatRow(r) {
  return `| ${[
    r.date,
    r.commit,
    r.scene,
    `${r.width}x${r.height}`,
    r.samples,
    r.triangles,
    r.bvhMs.toFixed(1),
    r.frameMs.toFixed(1),
    Math.round(r.pathsPerSecond),
    (r.pathsPerSecond / (r.width * r.height)).toFixed(2),
    r.device,
    r.browser,
  ]
    .map(cell)
    .join(' | ')} |`;
}

/** The header and the rule under it. */
export const header = () =>
  `| ${COLUMNS.join(' | ')} |\n| ${COLUMNS.map(() => '---').join(' | ')} |`;

/** The name the adapter's `info` gives itself: its description, else the parts it lists. */
export function deviceName(info) {
  if (info === undefined || info === null) return 'unknown';
  const d = (info.description ?? '').trim();
  if (d !== '') return d;
  const parts = [info.vendor, info.architecture, info.device].filter((p) => p);
  return parts.length > 0 ? parts.join(' ') : 'unknown';
}

/** True when the adapter is software: SwiftShader, llvmpipe or a fallback adapter. */
export const isSoftware = (info, name) =>
  info?.isFallbackAdapter === true || /swiftshader|llvmpipe|software/i.test(name);

/** The page. `window.sceneNames()` lists the scenes: `cornell`, then every site example's id.
 *  `window.adapter()` answers the adapter. `window.bench(options)` renders the named
 *  scene (the gate's `cornell`, or a site example's id) and answers the frames, the triangles and
 *  the BVH time. `PathTracer.prototype.render` is wrapped to note each frame and the scene it
 *  draws, so an example needs no change: its own loop does the rendering. */
const PAGE = `<!doctype html><title>radiance bench</title><link rel="icon" href="data:,"><script type="module">
import { BufferGeometry, EXAMPLES, Mesh, PathTracer, buildBlas, scenes } from '/__bench/bench.js';
let frames = [];
let drawn;
const render = PathTracer.prototype.render;
PathTracer.prototype.render = async function (scene, camera) {
  drawn = scene;
  const before = this.info.frames;
  await render.call(this, scene, camera);
  if (this.info.frames > before && this.scale === 1)
    frames.push({
      paths: (this.info.pathsPerSecond * this.info.frameTime) / 1000,
      ms: this.info.frameTime,
      width: this.width,
      height: this.height,
    });
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function describe(scene) {
  const geometries = new Set();
  let triangles = 0;
  scene.traverseVisible((o) => {
    if (!(o instanceof Mesh) || !(o.geometry instanceof BufferGeometry)) return;
    triangles += o.geometry.index.length / 3;
    if (o.geometry.index.length > 0) geometries.add(o.geometry);
  });
  const sources = [...geometries].map((g) => ({ position: g.position, index: g.index }));
  const once = () => {
    const t = performance.now();
    for (const s of sources) buildBlas(s);
    return performance.now() - t;
  };
  const first = once();
  return { triangles, bvhMs: first > 1000 ? first : median(Array.from({ length: 5 }, once)) };
}
window.sceneNames = () => ['cornell', ...EXAMPLES.map((e) => e.id)];
window.adapter = async () => {
  const a = await navigator.gpu?.requestAdapter();
  if (!a) return null;
  const { vendor, architecture, device, description } = a.info;
  return { info: { vendor, architecture, device, description, isFallbackAdapter: a.isFallbackAdapter ?? a.info.isFallbackAdapter }, version: navigator.userAgent };
};
window.bench = async ({ scene: name, size, samples, perFrame, seed, timeout }) => {
  frames = [];
  drawn = undefined;
  const limit = timeout * 1000;
  let finish;
  if (name === 'cornell') {
    const { scene, camera } = scenes.cornell();
    camera.aspect = size[0] / size[1];
    const r = await new PathTracer({ seed, samplesPerFrame: perFrame }).init();
    r.setSize(size[0], size[1]);
    r.maxSamples = samples;
    const t0 = performance.now();
    while (r.samples < samples) {
      if (performance.now() - t0 > limit) throw new Error(name + ' reached ' + r.samples + ' of ' + samples + ' samples');
      await r.render(scene, camera);
    }
    finish = () => r.dispose();
  } else {
    const entry = EXAMPLES.find((e) => e.id === name);
    if (entry === undefined) throw new Error('no scene is named ' + name);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:' + size[0] + 'px;height:' + size[1] + 'px';
    document.body.replaceChildren(canvas);
    const run = await (await entry.load()).default(canvas);
    const r = run.renderer;
    // As the render gate sets an example up (scripts/gates/_browser.mjs, runExample): stop its
    // motion and its time budget, then set the samples a frame, the cap and the seed.
    r.paused = true;
    if (run.playing !== undefined) run.playing = false;
    r.targetFrameTime = undefined;
    r.samplesPerFrame = perFrame;
    r.maxSamples = samples;
    r.seed = seed;
    frames = [];
    r.paused = false;
    const t0 = performance.now();
    // An example with a panel that reports Done may finish before the cap, as determinism does.
    while (r.samples < samples && !(run.panel && run.panel.hasAttribute('data-done'))) {
      if (performance.now() - t0 > limit) throw new Error(name + ' reached ' + r.samples + ' of ' + samples + ' samples');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    r.setAnimationLoop(null);
    finish = () => {
      run.dispose();
      canvas.remove();
    };
  }
  const taken = frames.slice();
  const scene = drawn;
  finish();
  if (scene === undefined) throw new Error(name + ' drew no scene');
  return { frames: taken, ...describe(scene) };
};
</script>`;

/** Bundles the benchmark's entry for the browser into `.harness/bench.js`. */
function bundleBench() {
  const file = join(outDir(), 'bench.js');
  const build = spawnSync('bun', ['scripts/bundle.ts', 'scripts/bench-entry.ts', file], {
    encoding: 'utf8',
  });
  if (build.status !== 0) throw new Error(`bundling failed:\n${build.stdout}${build.stderr}`);
  return file;
}

/** The short hash of HEAD, with `-dirty` when the tree differs from it. */
function commitName() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  try {
    return `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') === '' ? '' : '-dirty'}`;
  } catch {
    return 'unknown';
  }
}

/** Runs the benchmark with `options` (from `parseArgs`). `write(line)` takes each line of the
 *  table as it is ready. Answers the rows. */
export async function bench(options, write = (line) => process.stdout.write(`${line}\n`)) {
  const bundle = readFileSync(bundleBench(), 'utf8');
  const { server, origin } = await serve(outDir(), (url) => {
    if (url === '/__bench/bench.js')
      return { type: 'text/javascript; charset=utf-8', body: bundle };
    if (url === '/__bench/') return { type: 'text/html; charset=utf-8', body: PAGE };
    return undefined;
  });
  let browser;
  try {
    browser = await launchBrowser({ gpu: options.gpu });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        errors.push(`console.${m.type()}: ${m.text()}`);
    });
    await page.goto(`${origin}/__bench/`);
    await page.waitForFunction(() => typeof window.bench === 'function');
    const adapter = await page.evaluate(() => window.adapter());
    if (adapter === null) throw new Error('the browser has no WebGPU adapter');
    const device = deviceName(adapter.info);
    if (options.gpu && isSoftware(adapter.info, device))
      throw new Error(
        `--gpu found a software adapter: ${device}. Run with RADIANCE_CHROMIUM naming a Chrome or Chromium with GPU access, and RADIANCE_HEADED=1 if headless gets none.`,
      );
    const browserName = `Chromium ${browser.version()}`;
    const known = await page.evaluate(() => window.sceneNames());
    const names = options.scenes ?? known;
    const unknown = names.filter((n) => !known.includes(n));
    if (unknown.length > 0)
      throw new Error(`no scene is named ${unknown.join(', ')}: ${known.join(', ')}`);
    const commit = commitName();
    const date = new Date().toISOString().slice(0, 10);
    write(header());
    const rows = [];
    for (const scene of names) {
      for (const size of options.sizes) {
        const got = await page.evaluate((o) => window.bench(o), {
          scene,
          size,
          samples: options.samples,
          perFrame: options.perFrame,
          seed: options.seed,
          timeout: options.timeout,
        });
        const s = summarize(got.frames);
        const last = got.frames.at(-1);
        const row = {
          date,
          commit,
          scene,
          width: last.width,
          height: last.height,
          samples: options.samples,
          triangles: got.triangles,
          bvhMs: got.bvhMs,
          frameMs: s.frameMs,
          pathsPerSecond: s.pathsPerSecond,
          device,
          browser: browserName,
        };
        rows.push(row);
        write(formatRow(row));
      }
    }
    if (errors.length > 0) throw new Error(`the page reported:\n${errors.join('\n')}`);
    return rows;
  } finally {
    await browser?.close();
    server.close();
  }
}

const [, self] = process.argv;
if (self !== undefined && resolve(self) === fileURLToPath(import.meta.url)) {
  try {
    await bench(parseArgs(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`bench: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
