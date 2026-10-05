// === What the gates share: the browser, the server and the page ===
//
// The compiler's user journeys run in headless Chromium through Playwright, on SwiftShader, so
// CI has a WebGPU device without a GPU (`journeys/_harness.mjs`). The gates do the same for the
// renderer. This file holds the three parts every gate that needs a device uses:
//
//   1. `serve`: a static server on 127.0.0.1 (a secure context, which WebGPU needs), as the
//      deployed site is served: a directory answers with its index.html.
//   2. `launchBrowser`: Chromium with a WebGPU device on SwiftShader.
//   3. `openRenderPage`: the engine bundled for the browser (its shader modules compiled by
//      scripts/shade-plugin.ts), a page that renders a named scene with it, and the browser that
//      runs the page.
//
// Env: RADIANCE_CHROMIUM names a Chromium executable (the browsers Playwright installs are used
// otherwise); RADIANCE_HEADED=1 shows the window.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** The directory the gates write to look at: renders, the oracle's images, the site's picture. */
export function outDir() {
  const dir = join(process.cwd(), '.harness');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Serves `root`; resolves to the server and its origin. `extra(url)` returns
 *  `{ type, body }` for a path it answers, or undefined to fall through to the files. */
export async function serve(root, extra = () => undefined) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost').pathname;
    const own = extra(url);
    if (own) {
      res.setHeader('content-type', own.type);
      res.end(own.body);
      return;
    }
    let file = join(root, normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, ''));
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.end(readFileSync(file));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

/** Chromium with a WebGPU device on SwiftShader, as the compiler's user journeys run it.
 *  RADIANCE_CHROMIUM names the executable; RADIANCE_HEADED=1 shows the window. */
export function launchBrowser() {
  return chromium.launch({
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
}

/** Bundles the engine and the gate scenes for the browser into `.harness/render.js`, and throws
 *  when `bun` cannot. The page imports that file. */
export function bundleRenderer() {
  const file = join(outDir(), 'render.js');
  const build = spawnSync('bun', ['scripts/bundle.ts', 'scripts/harness-entry.ts', file], {
    encoding: 'utf8',
  });
  if (build.status !== 0) throw new Error(`bundling failed:\n${build.stdout}${build.stderr}`);
  return file;
}

/** The page that renders. `window.run` renders the named scene (`cornell` when none is named)
 *  at the given size and samples, and answers the mean radiance and the displayed image. */
const PAGE = `<!doctype html><title>radiance harness</title><link rel="icon" href="data:,"><script type="module">
import { PathTracer, scenes } from '/__harness/render.js';
window.run = async ({ scene: name = 'cornell', size, samples, perFrame, seed }) => {
  const make = scenes[name];
  if (make === undefined) throw new Error('no scene is named ' + name);
  const { scene, camera } = make();
  camera.aspect = size[0] / size[1];
  const r = await new PathTracer({ seed, samplesPerFrame: perFrame }).init();
  r.setSize(size[0], size[1]);
  r.maxSamples = samples;
  const t0 = performance.now();
  while (r.samples < samples) await r.render(scene, camera);
  const ms = performance.now() - t0;
  const radiance = [...(await r.readRadiance())];
  const image = [...(await r.readPixels())];
  r.dispose();
  return { radiance, image, ms };
};
</script>`;

/**
 * Opens the render page in a new browser. Resolves to:
 *
 * - `render(options)`: renders `{ scene, size, samples, perFrame, seed }` on the page's device.
 * - `browser` and `origin`: for a caller that opens more pages. The server answers `root` (the
 *   built site, `dist/site` by default) at `/` and the render page under `/__harness/`.
 * - `errors`: the page errors and console errors and warnings, so far. A caller that opens a
 *   page of its own pushes that page's messages here, and the gate that owns the session reports
 *   them.
 * - `close()`.
 */
export async function openRenderPage({ root = join(process.cwd(), 'dist/site') } = {}) {
  const bundle = readFileSync(bundleRenderer(), 'utf8');
  const { server, origin } = await serve(root, (url) => {
    if (url === '/__harness/render.js')
      return { type: 'text/javascript; charset=utf-8', body: bundle };
    if (url === '/__harness/') return { type: 'text/html; charset=utf-8', body: PAGE };
    return undefined;
  });
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        errors.push(`console.${m.type()}: ${m.text()}`);
    });
    await page.goto(`${origin}/__harness/`);
    await page.waitForFunction(() => typeof window.run === 'function');
    return {
      browser,
      origin,
      errors,
      render: (options) => page.evaluate((o) => window.run(o), options),
      close: async () => {
        await browser.close();
        server.close();
      },
    };
  } catch (e) {
    await browser?.close();
    server.close();
    throw e;
  }
}

/**
 * Runs `use(session)` on `options.session` when the caller passes one, so several gates share one
 * browser. Otherwise it opens a session and closes it after `use`, and the page's errors fail
 * the result: nobody else is left to report them. `use` resolves to a gate's result.
 */
export async function withRenderPage(options, use) {
  if (options.session) return use(options.session);
  const session = await openRenderPage();
  try {
    const result = await use(session);
    if (session.errors.length === 0) return result;
    return { ...result, ok: false, message: [result.message, ...session.errors].join('\n') };
  } finally {
    await session.close();
  }
}
