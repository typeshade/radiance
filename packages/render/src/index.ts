// === @typeshade/radiance-render: the progressive renderer (plan L3) ===
//
// Every package above the compiler is written on the public exports of `typeshade/runtime` and
// nothing else: it imports no other subpath of the compiler and calls nothing on a WebGPU object.
// `scripts/boundary.mjs` holds that in CI, the way the compiler's engine journey holds its host.
//
// M1 renders a scene of spheres and quads progressively: each `frame()` is one dispatch of the
// path tracer (`@typeshade/radiance-kernels/trace`) that adds `samplesPerFrame` samples to every
// pixel's sum, and waits for the GPU, so no more than one frame is ever in flight (plan 8). The
// sums stay on the device; `readRadiance()` reads their mean, `read()` the tone-mapped image.

import { createRuntime, resident } from 'typeshade/runtime';
import trace from '@typeshade/radiance-kernels/trace';
import { cameraParams, packScene, type Camera, type Scene } from '@typeshade/radiance-scene';

export interface RendererOptions {
  /** The host's `GPUDevice`. Omitted, the runtime requests one. */
  readonly device?: object;
  /** The frame in pixels, `[width, height]`. */
  readonly size: readonly [number, number];
  readonly scene: Scene;
  /** One seed, one image. Default 0. */
  readonly seed?: number;
  /**
   * The samples each `frame()` adds to every pixel, in one dispatch. A dispatch must stay under
   * the GPU watchdog (about two seconds on Windows; plan 3.1), so this is the budget. Default 1.
   */
  readonly samplesPerFrame?: number;
  /** The bounces a path may take after the camera ray. Default 8. */
  readonly bounces?: number;
  /** The bounce from which Russian roulette may end a path. Default 3. */
  readonly rouletteFrom?: number;
  /** The exposure of the displayed image, in stops. Default 0. */
  readonly exposure?: number;
}

export interface Renderer {
  /** How many samples every pixel has. */
  readonly samples: number;
  /** Add `samplesPerFrame` samples to every pixel, and resolve once the GPU has run them. */
  frame(): Promise<void>;
  /** Start the accumulation over, with another camera when one is given. */
  reset(camera?: Camera): void;
  /** Every pixel's mean radiance, RGB and the sample count, top row first. */
  readRadiance(): Promise<Float32Array>;
  /** The displayed image: the mean tone-mapped, RGBA, top row first. */
  read(): Promise<Float32Array>;
  destroy(): void;
}

/** The displayed image's format: half floats, so a read gives numbers rather than bytes. */
export const TARGET_FORMAT = 'rgba16float';

/** The path tracer's workgroup size (`@compute([64])` in trace.shade.ts). */
const WORKGROUP = 64;

/** The renderer on `options.device`, or on a device the runtime requests. */
export async function createRenderer(options: RendererOptions): Promise<Renderer> {
  const [width, height] = options.size;
  const perFrame = options.samplesPerFrame ?? 1;
  if (!Number.isInteger(perFrame) || perFrame < 1)
    throw new RangeError(`samplesPerFrame must be a whole number from 1, not ${perFrame}`);
  const rt = await createRuntime(options.device !== undefined ? { device: options.device } : {});
  const program = rt.load(trace);
  const tracer = await program.compute('trace');
  const show = await program.render({
    vertex: 'presentVs',
    fragment: 'show',
    targets: [TARGET_FORMAT],
  });
  const target = rt.texture({ size: options.size, format: TARGET_FORMAT });

  const packed = packScene(options.scene);
  const scene = {
    spheres: resident(packed.spheres),
    quads: resident(packed.quads),
    materials: resident(packed.materials),
    lights: resident(packed.lights),
  };
  const accum = resident(new Float32Array(width * height * 4));
  let camera = cameraParams(options.scene.camera, width, height);
  let samples = 0;
  const counts = [...packed.counts, (options.seed ?? 0) >>> 0];
  const path = [options.bounces ?? 8, options.rouletteFrom ?? 3, 0, 0];
  const present = { view: [options.exposure ?? 0, width, 0, 0] };

  return {
    get samples() {
      return samples;
    },
    async frame() {
      const f = rt.frame();
      const params = { ...camera, frame: [width, height, samples, perFrame], counts, path };
      f.dispatch(tracer, { params, ...scene, accum }, Math.ceil((width * height) / WORKGROUP));
      await f.submit();
      samples += perFrame;
    },
    reset(next) {
      if (next !== undefined) camera = cameraParams(next, width, height);
      accum.write(new Float32Array(width * height * 4));
      samples = 0;
    },
    async readRadiance() {
      const sums = await accum.read();
      const out = new Float32Array(sums.length);
      for (let i = 0; i < sums.length; i += 4) {
        const n = sums[i + 3]!;
        out[i] = n > 0 ? sums[i]! / n : 0;
        out[i + 1] = n > 0 ? sums[i + 1]! / n : 0;
        out[i + 2] = n > 0 ? sums[i + 2]! / n : 0;
        out[i + 3] = n;
      }
      return out;
    },
    async read() {
      const f = rt.frame();
      f.pass({ color: [{ target, clear: [0, 0, 0, 0] }] }, (pass) =>
        pass.draw(show, { present, accum }, { count: 3 }),
      );
      await f.submit();
      return target.readFloats();
    },
    destroy() {
      for (const r of [...Object.values(scene), accum]) r.destroy();
      rt.destroy();
    },
  };
}
