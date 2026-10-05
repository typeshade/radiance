// === The path tracer on the CPU oracle ===
//
// The compiler's CPU oracle runs the same IR the GPU backends receive (`compileModuleJs`, at f32
// precision: every f32 operation rounded as the target rounds it). This file runs the path
// tracer's `trace` entry over a whole frame on it, with the bindings the renderer gives the GPU,
// so the harness can hold the GPU's image to the oracle's (plan 11, the compiler's
// `gate:differential` way). Scripts may import the compiler; packages may not.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileModuleJs, type CpuValue } from 'typeshade';
import { cameraParams, packScene, type Scene } from '@typeshade/radiance-scene';

export interface OracleOptions {
  readonly scene: Scene;
  readonly size: readonly [number, number];
  readonly samples: number;
  readonly seed?: number;
  readonly bounces?: number;
  readonly rouletteFrom?: number;
}

const TRACE = join(import.meta.dir, '../packages/kernels/src/trace.shade.ts');

/** `a`, four floats at a time, as the oracle takes an `array<vec4>`. `CpuValue`'s type has no
 *  array of vectors, though the oracle takes one (docs/typeshade-feedback.md), hence the cast. */
const vec4s = (a: Float32Array): CpuValue =>
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
  const packed = packScene(o.scene);
  cpu.setBinding('spheres', vec4s(packed.spheres));
  cpu.setBinding('quads', vec4s(packed.quads));
  cpu.setBinding('materials', vec4s(packed.materials));
  cpu.setBinding('lights', Array.from(packed.lights));
  const accum = Array.from({ length: width * height }, () => [0, 0, 0, 0]);
  cpu.setBinding('accum', accum as unknown as CpuValue);
  const camera = cameraParams(o.scene.camera, width, height);
  cpu.setBinding('params', {
    eye: [...camera.eye],
    right: [...camera.right],
    up: [...camera.up],
    forward: [...camera.forward],
    lens: [...camera.lens],
    frame: [width, height, 0, o.samples],
    counts: [...packed.counts, (o.seed ?? 0) >>> 0],
    path: [o.bounces ?? 8, o.rouletteFrom ?? 3, 0, 0],
  });
  // One invocation at a time through `fns`, as the oracle allows for a kernel with no barrier:
  // `dispatch` runs every entry on the interpreter, about 45 times slower (docs/typeshade-feedback.md).
  const trace = cpu.fns.trace!;
  for (let i = 0; i < width * height; i++) trace([i, 0, 0]);
  const out = new Float32Array(width * height * 4);
  accum.forEach(([r, g, b, n], i) => {
    out.set(n! > 0 ? [r! / n!, g! / n!, b! / n!, n!] : [0, 0, 0, 0], i * 4);
  });
  return out;
}

// `bun scripts/oracle.ts <width> <height> <samples> <seed> <outfile>`: the Cornell box on the
// oracle, written as JSON (the mean radiance and count of every pixel), for the harness.
if (import.meta.main) {
  const [w, h, n, seed, outfile] = process.argv.slice(2);
  if (outfile === undefined) {
    console.error('usage: bun scripts/oracle.ts <width> <height> <samples> <seed> <outfile>');
    process.exit(2);
  }
  const { cornellBox } = await import('@typeshade/radiance-scene');
  const t0 = performance.now();
  const image = renderOnCpu({
    scene: cornellBox(),
    size: [Number(w), Number(h)],
    samples: Number(n),
    seed: Number(seed),
  });
  await Bun.write(outfile, JSON.stringify(Array.from(image)));
  console.log(`oracle: ${w}x${h} at ${n} spp in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
