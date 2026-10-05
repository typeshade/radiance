// A static server for dist/site on 127.0.0.1 (a secure context, which WebGPU needs), as the
// deployed site is served: a directory answers with its index.html. scripts/harness.mjs and
// scripts/capture-stills.mjs load the built pages from it; `extra` answers paths of their own.
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

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
export const CHROMIUM = {
  executablePath: process.env.RADIANCE_CHROMIUM || undefined,
  headless: process.env.RADIANCE_HEADED !== '1',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--enable-features=Vulkan',
  ],
};
