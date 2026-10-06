// === The path tracer on the CPU oracle ===
//
// The compiler's CPU oracle runs the same IR the GPU backends receive (`compileModuleJs`, at f32
// precision: every f32 operation rounded as the target rounds it). This file runs the path
// tracer's `trace` entry over a whole frame on it, with the bindings the renderer gives the GPU,
// so the harness can hold the GPU's image to the oracle's (plan 11, the compiler's
// `gate:differential` way). Scripts may import the compiler; packages may not.
//
// The oracle binds the typed arrays and the uniform block of a `ScenePack`, the class the
// renderer uploads from (design record 0001, "The oracle"), so the CPU and the GPU read one
// scene. Nothing here knows the layout. It knows the pack. The pack is not public API, so this
// script imports it from `@typeshade/radiance/internal`, the subpath of the engine's internals
// (design record 0003, "What is public").

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileModuleJs, type CpuValue } from 'typeshade';
import type { Camera, Scene } from '@typeshade/radiance';
import { cameraFrame, SCENE_BUFFERS, ScenePack } from '@typeshade/radiance/internal';
import type { SceneName } from './scenes.ts';

export interface OracleOptions {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly size: readonly [number, number];
  readonly samples: number;
  readonly seed?: number;
  readonly bounces?: number;
  readonly rouletteFrom?: number;
  /** Render only the pixels whose index is `part` modulo `parts`, and leave the others 0.
   *  Omitted: every pixel. */
  readonly part?: readonly [number, number];
}

const TRACE = join(import.meta.dir, '../packages/radiance/src/kernels/trace.shade.ts');

/** `a`, four numbers at a time, as the oracle takes an `array<vec4>` or an `array<vec4u>`.
 *  `CpuValue`'s type has no array of vectors, though the oracle takes one
 *  (docs/typeshade-feedback.md), hence the cast. */
const vec4s = (a: Float32Array | Uint32Array): CpuValue =>
  Array.from({ length: a.length / 4 }, (_, i) =>
    Array.from(a.subarray(i * 4, i * 4 + 4)),
  ) as unknown as CpuValue;

/** Every pixel's mean radiance and sample count, as `Renderer.readRadiance()` gives them. */
export function renderOnCpu(o: OracleOptions): Float32Array {
  const read = (f: string): string | undefined => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return undefined;
    }
  };
  const compiled = compile(readFileSync(TRACE, 'utf8'), { fileName: TRACE, readDocument: read });
  const errors = compiled.diagnostics.filter((d) => d.category === 'error');
  if (errors.length > 0 || compiled.module === undefined)
    throw new Error(`trace.shade.ts does not compile: ${JSON.stringify(errors)}`);
  const cpu = compileModuleJs(compiled.module, { precision: 'f32' });
  const [width, height] = o.size;
  o.scene.updateMatrixWorld();
  o.camera.updateMatrixWorld();
  const pack = new ScenePack();
  pack.update(o.scene);
  for (const name of SCENE_BUFFERS) cpu.setBinding(name, vec4s(pack.arrays[name]));
  const accum = Array.from({ length: width * height }, () => [0, 0, 0, 0]);
  cpu.setBinding('accum', accum as unknown as CpuValue);
  // One tile of the whole frame: the oracle has no watchdog.
  const params = pack.params({
    camera: cameraFrame(o.camera),
    frame: [width, height, 0, o.samples],
    tile: [0, 0, width, height],
    seed: o.seed ?? 0,
    bounces: o.bounces ?? 8,
    rouletteFrom: o.rouletteFrom ?? 3,
  });
  cpu.setBinding('params', JSON.parse(JSON.stringify(params)) as CpuValue);
  // One invocation at a time through `fns`, as the oracle allows for a kernel with no barrier:
  // `dispatch` runs every entry on the interpreter, about 45 times slower (docs/typeshade-feedback.md).
  const trace = cpu.fns.trace!;
  const [part, parts] = o.part ?? [0, 1];
  for (let i = part; i < width * height; i += parts) trace([i, 0, 0]);
  const out = new Float32Array(width * height * 4);
  accum.forEach(([r, g, b, n], i) => {
    out.set(n! > 0 ? [r! / n!, g! / n!, b! / n!, n!] : [0, 0, 0, 0], i * 4);
  });
  return out;
}

// `bun scripts/oracle.ts <width> <height> <samples> <seed> <outfile> [scene]`: a scene of
// scripts/scenes.ts (the Cornell box when none is named) on the oracle, written as JSON (the mean
// radiance and count of every pixel), for the differential gate.
//
// A pixel's value depends on nothing but the pixel, so the frame is split over child processes,
// one per processor up to RADIANCE_ORACLE_JOBS (default 4): process k renders the pixels whose
// index is k modulo the count, and the parent puts the parts together. The image is the same for
// any count. A child is the same command with `--part k/n` after it.
if (import.meta.main) {
  const { availableParallelism } = await import('node:os');
  const { spawn } = await import('node:child_process');
  const { scenes } = await import('./scenes.ts');
  const args = process.argv.slice(2);
  const at = args.indexOf('--part');
  const part =
    at >= 0 ? (args.splice(at, 2)[1]!.split('/').map(Number) as [number, number]) : undefined;
  const [w, h, n, seed, outfile, name = 'cornell'] = args;
  if (outfile === undefined || !Object.hasOwn(scenes, name)) {
    console.error(
      `usage: bun scripts/oracle.ts <width> <height> <samples> <seed> <outfile> [${Object.keys(scenes).join('|')}] [--part k/n]`,
    );
    process.exit(2);
  }
  const t0 = performance.now();
  const size = [Number(w), Number(h)] as const;
  const jobs = Math.max(
    1,
    Math.min(
      Number(process.env.RADIANCE_ORACLE_JOBS ?? 4),
      availableParallelism(),
      size[0] * size[1],
    ),
  );
  let image: Float32Array;
  if (part !== undefined || jobs === 1) {
    const box = scenes[name as SceneName]();
    image = renderOnCpu({
      scene: box.scene,
      camera: box.camera,
      size,
      samples: Number(n),
      seed: Number(seed),
      part,
    });
  } else {
    // The parts, each from its own process, merged pixel by pixel.
    const files = Array.from({ length: jobs }, (_, k) => `${outfile}.part${k}`);
    await Promise.all(
      files.map(
        (file, k) =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [import.meta.path, w!, h!, n!, seed!, file, name, '--part', `${k}/${jobs}`],
              { stdio: ['ignore', 'ignore', 'inherit'] },
            );
            child.on('error', reject);
            child.on('exit', (code) =>
              code === 0 ? resolve() : reject(new Error(`oracle part ${k} exited with ${code}`)),
            );
          }),
      ),
    );
    image = new Float32Array(size[0] * size[1] * 4);
    const { readFileSync: read, rmSync } = await import('node:fs');
    files.forEach((file, k) => {
      const piece = JSON.parse(read(file, 'utf8')) as number[];
      for (let i = k; i < size[0] * size[1]; i += jobs)
        image.set(piece.slice(i * 4, i * 4 + 4), i * 4);
      rmSync(file);
    });
  }
  await Bun.write(outfile, JSON.stringify(Array.from(image)));
  if (part === undefined)
    console.log(
      `oracle: ${w}x${h} at ${n} spp in ${((performance.now() - t0) / 1000).toFixed(1)} s (${jobs} processes)`,
    );
}
