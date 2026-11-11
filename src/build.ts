// Design: 0109. The build of a project: the page's two files, the bundle, its size and its
// budget, and the development server. It runs when a game is developed and built, and never in
// a shipped game.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { typeshade } from 'typeshade/vite';
import { build, createServer, type InlineConfig, type ViteDevServer } from 'vite';
import type { GameConfig } from './config.ts';
import { syncProject } from './project.ts';

/** The options of a build. */
export interface BuildOptions {
  /** Puts the running game on `globalThis.game`, and lets `?manual` stop the loop. */
  readonly hook?: boolean;
}

/** One script of a built page. */
export interface Script {
  readonly file: string;
  readonly bytes: number;
  readonly gzip: number;
}

/** What a build gives. */
export interface BuildResult {
  /** Each script the build wrote. */
  readonly scripts: readonly Script[];
  /** The scripts that the page loads at its start, together. */
  readonly loaded: { readonly bytes: number; readonly gzip: number };
  /** The budget of the config, in bytes before gzip, when it has one. */
  readonly budget: number | undefined;
  /** True when the page loads more than the budget. */
  readonly over: boolean;
}

/** What the size of a page needs of one built script. */
export interface Chunk {
  readonly fileName: string;
  readonly isEntry: boolean;
  /** The scripts this one imports with a static import. */
  readonly imports: readonly string[];
  readonly code: string;
}

/**
 * The scripts that a page loads at its start: the entry script and each script it imports
 * with a static import. A script that the page imports later is not one of them.
 */
export function loadedAtStart(chunks: readonly Chunk[]): readonly Chunk[] {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set<string>();
  const visit = (name: string) => {
    const chunk = byName.get(name);
    if (chunk === undefined || seen.has(name)) return;
    seen.add(name);
    chunk.imports.forEach(visit);
  };
  chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => visit(chunk.fileName));
  return chunks.filter((chunk) => seen.has(chunk.fileName));
}

const size = (code: string) => ({
  bytes: Buffer.byteLength(code),
  gzip: gzipSync(code).length,
});

/** The size of a built page, held to a budget in bytes before gzip. */
export function measure(chunks: readonly Chunk[], budget: number | undefined): BuildResult {
  const scripts = chunks.map((chunk) => ({ file: chunk.fileName, ...size(chunk.code) }));
  const start = loadedAtStart(chunks);
  const loaded = {
    bytes: start.reduce((sum, chunk) => sum + size(chunk.code).bytes, 0),
    gzip: start.reduce((sum, chunk) => sum + size(chunk.code).gzip, 0),
  };
  return { scripts, loaded, budget, over: budget !== undefined && loaded.bytes > budget };
}

/** The text of the page's two files: `.radiance/main.ts` and `.radiance/index.html`. */
export function pageFiles(
  dir: string,
  config: GameConfig,
  options: BuildOptions = {},
): { readonly main: string; readonly html: string } {
  if (config.start === undefined || typeof config.start.level !== 'string') {
    throw new TypeError(
      `radiance.config.ts: the config has no "start", so the project has no page. Name the level the page starts with, for example { start: { level: 'demo' } }.`,
    );
  }
  const seed =
    config.start.seed === undefined
      ? '// The run takes its seed from the clock.\nconst seed = Date.now() >>> 0;'
      : `const seed = ${config.start.seed};`;
  const main = [
    '// Written by "radiance build" from the project. Do not change this file: change the',
    '// project, and build again.',
    '',
    "import { run } from 'radiance/page';",
    `import level from '../levels/${config.start.level}.ts';`,
    "import { Game } from './game.ts';",
    '',
    "const canvas = document.querySelector('canvas')!;",
    '// The canvas has one pixel for each pixel of its place on the page.',
    'const fit = () => {',
    '  const ratio = window.devicePixelRatio || 1;',
    '  canvas.width = Math.round(canvas.clientWidth * ratio);',
    '  canvas.height = Math.round(canvas.clientHeight * ratio);',
    '};',
    'fit();',
    "addEventListener('resize', fit);",
    '',
    seed,
    ...(options.hook === true
      ? [
          '// The hook of a browser check: "?manual" stops the loop, and the check steps the game.',
          "const manual = new URLSearchParams(location.search).has('manual');",
          'const game = run(Game, {',
          '  seed,',
          '  canvas,',
          '  rows: level.rows,',
          '  values: level.values,',
          '  ...(manual ? { schedule: () => {} } : {}),',
          '});',
          '(globalThis as { game?: unknown }).game = game;',
        ]
      : ['void run(Game, { seed, canvas, rows: level.rows, values: level.values });']),
    '',
  ].join('\n');
  const title = (config.name ?? basename(dir)).replace(/[<>&]/g, '');
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${title}</title>`,
    '    <style>',
    '      html, body { margin: 0; height: 100%; background: #111317; }',
    '      canvas { display: block; width: 100vw; height: 100vh; touch-action: none; }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <canvas></canvas>',
    '    <script type="module" src="./main.ts"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
  return { main, html };
}

/** Writes the game's class and the page's two files into `.radiance/`. */
export function writePage(dir: string, config: GameConfig, options: BuildOptions = {}): void {
  const files = pageFiles(dir, config, options);
  syncProject(dir, config);
  mkdirSync(join(dir, '.radiance'), { recursive: true });
  writeFileSync(join(dir, '.radiance', 'main.ts'), files.main);
  writeFileSync(join(dir, '.radiance', 'index.html'), files.html);
}

/** The configuration of Vite for a project. The game gives no file of Vite. */
export function viteConfig(dir: string, config: GameConfig): InlineConfig {
  const engine = (file: string) => fileURLToPath(new URL(file, import.meta.url));
  return {
    configFile: false,
    root: join(dir, '.radiance'),
    base: './',
    logLevel: 'error',
    plugins: [typeshade({ fuse: config.fuse === true })],
    resolve: {
      alias: [
        { find: /^radiance\/page$/, replacement: engine('./page.ts') },
        { find: /^radiance$/, replacement: engine('./index.ts') },
      ],
    },
    server: { fs: { allow: [dir, engine('..')] } },
    build: { outDir: join(dir, 'dist'), emptyOutDir: true, target: 'es2022' },
  };
}

/** Builds the page of a project into `<project>/dist`, and holds its size to the budget. */
export async function buildProject(
  dir: string,
  config: GameConfig,
  options: BuildOptions = {},
): Promise<BuildResult> {
  writePage(dir, config, options);
  const built = await build(viteConfig(dir, config));
  const outputs = (Array.isArray(built) ? built : [built]) as { output: unknown[] }[];
  const chunks = outputs
    .flatMap((result) => result.output as (Chunk & { type: string })[])
    .filter((item) => item.type === 'chunk');
  const result = measure(chunks, config.budget);
  writeFileSync(join(dir, 'dist', 'size.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

/** Starts the development server of a project. */
export async function devProject(dir: string, config: GameConfig): Promise<ViteDevServer> {
  writePage(dir, config);
  const server = await createServer(viteConfig(dir, config));
  const places = ['state', 'scratch', 'systems', 'draw', 'input'].map((sub) => join(dir, sub));
  server.watcher.add([...places, join(dir, 'radiance.config.ts')]);
  const resync = (path: string) => {
    if (path === join(dir, 'radiance.config.ts')) {
      console.log('radiance.config.ts changed. Start "radiance dev" again to read it.');
      return;
    }
    if (!places.some((place) => path.startsWith(place))) return;
    try {
      if (syncProject(dir, config).stale) server.ws.send({ type: 'full-reload' });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  };
  server.watcher
    .on('add', resync)
    .on('unlink', resync)
    .on('change', (path) => {
      if (path === join(dir, 'radiance.config.ts')) resync(path);
    });
  await server.listen();
  return server;
}
