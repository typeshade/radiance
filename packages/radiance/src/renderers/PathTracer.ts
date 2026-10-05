// === PathTracer: the progressive path tracer (docs/plan.md, M1) ===
//
// Every call of `render(scene, camera)` adds `samplesPerFrame` samples to every pixel, in one
// dispatch of the TypeShade kernel (kernels/trace.shade.ts), waits for the GPU (one frame in
// flight), and draws the mean on the canvas. When the scene or the camera changed since the
// last call, the accumulation starts again first. Set `preview` above 1 while the camera moves
// to trace one pixel for each preview-by-preview block instead.
//
// Everything goes through `typeshade/runtime`: the renderer makes no WebGPU call of its own
// (scripts/boundary.mjs).

import { createRuntime, resident, type Resident, type Runtime } from 'typeshade/runtime';
import trace from '../kernels/trace.shade.ts';
import type { Camera } from '../cameras/Camera.ts';
import type { Scene } from '../scenes/Scene.ts';
import { Renderer } from './Renderer.ts';
import {
  cameraUniforms,
  packScene,
  sameCamera,
  sameScene,
  type CameraUniforms,
  type PackedScene,
} from './pack.ts';

export interface PathTracerParameters {
  /** The canvas to draw on. Without one, `readPixels()` and `readRadiance()` still work. */
  canvas?: HTMLCanvasElement;
  /** The host's `GPUDevice`. Omitted, the runtime requests one. */
  device?: object;
  /** One seed, one image. Default 0. */
  seed?: number;
  /** Samples each `render` adds, in one dispatch: the GPU watchdog budget. Default 1. */
  samplesPerFrame?: number;
  /** The bounces a path may take after the camera ray. Default 8. */
  bounces?: number;
  /** The bounce from which Russian roulette may end a path. Default 3. */
  rouletteFrom?: number;
  /** The exposure of the displayed image, in stops. Default 0. */
  exposure?: number;
  /**
   * Keep a full-resolution frame near this many milliseconds by changing `samplesPerFrame`
   * after each one, up to `maxSamplesPerFrame`. Omitted, `samplesPerFrame` stays as set.
   */
  targetFrameTime?: number;
  /** The most samples a frame may take when `targetFrameTime` adapts it. Default 64. */
  maxSamplesPerFrame?: number;
}

/** The displayed image's format for `readPixels()`: half floats, read back as numbers. */
export const TARGET_FORMAT = 'rgba16float';
/** The canvas's format: one every WebGPU implementation can show. */
export const CANVAS_FORMAT = 'rgba8unorm';
/** The kernel's workgroup size (`@compute([64])` in trace.shade.ts). */
const WORKGROUP = 64;

type Pipelines = {
  rt: Runtime;
  tracer: Awaited<ReturnType<ReturnType<Runtime['load']>['compute']>>;
  show: Awaited<ReturnType<ReturnType<Runtime['load']>['render']>>;
  showOnCanvas: Awaited<ReturnType<ReturnType<Runtime['load']>['render']>> | undefined;
  context: object | undefined;
};

export class PathTracer extends Renderer {
  /** Samples each `render` adds. Change it between frames to keep a frame near a time budget. */
  samplesPerFrame: number;
  /** `render` adds no samples once every pixel has this many. Default unlimited. */
  maxSamples = Infinity;
  /** While true, `render` adds no samples; it still draws when the exposure changes. */
  paused = false;
  /** Above 1, trace one pixel for each `preview` by `preview` block: for a moving camera. */
  preview = 1;
  readonly bounces: number;
  readonly rouletteFrom: number;
  targetFrameTime: number | undefined;
  maxSamplesPerFrame: number;
  /** What the last frame cost: its time in milliseconds and the paths it traced per second. */
  readonly info = { frameTime: 0, pathsPerSecond: 0, frames: 0 };

  #device: object | undefined;
  #seed: number;
  #exposure: number;
  #width = 1;
  #height = 1;
  #p: Pipelines | undefined;
  #buffers: { [K in 'spheres' | 'quads' | 'materials' | 'lights']: Resident<unknown> } | undefined;
  #accum: Resident<Float32Array> | undefined;
  #target: ReturnType<Runtime['texture']> | undefined;
  #scene: PackedScene | undefined;
  #camera: CameraUniforms | undefined;
  #samples = 0;
  #scale = 1;
  #dirty = true;
  #drawn = false;

  constructor(parameters: PathTracerParameters = {}) {
    super(parameters.canvas);
    this.#device = parameters.device;
    this.#seed = (parameters.seed ?? 0) >>> 0;
    this.#exposure = parameters.exposure ?? 0;
    this.samplesPerFrame = parameters.samplesPerFrame ?? 1;
    this.bounces = parameters.bounces ?? 8;
    this.rouletteFrom = parameters.rouletteFrom ?? 3;
    this.targetFrameTime = parameters.targetFrameTime;
    this.maxSamplesPerFrame = parameters.maxSamplesPerFrame ?? 64;
    if (parameters.canvas !== undefined)
      [this.#width, this.#height] = [parameters.canvas.width, parameters.canvas.height];
  }

  get width(): number {
    return this.#width;
  }
  get height(): number {
    return this.#height;
  }
  /** How many samples every pixel has. */
  get samples(): number {
    return this.#samples;
  }
  /** The scale of the frame being traced: 1, or the preview's. */
  get scale(): number {
    return this.#scale;
  }
  get seed(): number {
    return this.#seed;
  }
  /** A new seed starts the accumulation again. */
  set seed(value: number) {
    this.#seed = value >>> 0;
    this.reset();
  }
  get exposure(): number {
    return this.#exposure;
  }
  set exposure(stops: number) {
    this.#exposure = stops;
    this.#drawn = false;
  }

  async init(): Promise<this> {
    if (this.#p !== undefined) return this;
    const rt = await createRuntime(this.#device !== undefined ? { device: this.#device } : {});
    const program = rt.load(trace);
    const tracer = await program.compute('trace');
    const show = await program.render({
      vertex: 'presentVs',
      fragment: 'show',
      targets: [TARGET_FORMAT],
    });
    let context: object | undefined;
    let showOnCanvas: Pipelines['showOnCanvas'];
    if (this.domElement !== undefined) {
      const ctx = this.domElement.getContext('webgpu') as {
        configure(c: { device: object; format: string; alphaMode: string }): void;
      } | null;
      if (ctx === null) throw new Error('the canvas has no webgpu context');
      ctx.configure({ device: rt.device, format: CANVAS_FORMAT, alphaMode: 'opaque' });
      context = ctx;
      showOnCanvas = await program.render({
        vertex: 'presentVs',
        fragment: 'show',
        targets: [CANVAS_FORMAT],
      });
    }
    this.#p = { rt, tracer, show, showOnCanvas, context };
    this.#allocate();
    return this;
  }

  #css: [number, number] | undefined;

  setSize(width: number, height: number): void {
    this.#css = [width, height];
    const w = Math.max(1, Math.floor(width * this.getPixelRatio()));
    const h = Math.max(1, Math.floor(height * this.getPixelRatio()));
    if (w === this.#width && h === this.#height) return;
    this.#width = w;
    this.#height = h;
    if (this.domElement !== undefined) {
      this.domElement.width = this.#width;
      this.domElement.height = this.#height;
    }
    if (this.#p !== undefined) this.#allocate();
  }

  override setPixelRatio(ratio: number): void {
    super.setPixelRatio(ratio);
    if (this.#css !== undefined) this.setSize(...this.#css);
  }

  /** Start the accumulation again on the next `render`. */
  reset(): void {
    this.#dirty = true;
  }

  async render(scene: Scene, camera: Camera): Promise<void> {
    const p = this.#need();
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    const packed = packScene(scene);
    const view = cameraUniforms(camera);
    if (this.#scene === undefined || !sameScene(packed, this.#scene)) {
      this.#upload(packed);
      this.#dirty = true;
    }
    if (this.#camera === undefined || !sameCamera(view, this.#camera)) {
      this.#camera = view;
      this.#dirty = true;
    }
    const scale = Math.max(1, Math.floor(this.preview));
    if (scale !== this.#scale) this.#dirty = true;
    if (this.#dirty) {
      this.#scale = scale;
      this.#accum!.write(new Float32Array(this.#width * this.#height * 4));
      this.#samples = 0;
      this.#dirty = false;
    }
    const working = !this.paused && (this.#scale !== 1 || this.#samples < this.maxSamples);
    if (working) {
      const [w, h] = this.#traced();
      const n = this.#scale === 1 ? Math.max(1, Math.floor(this.samplesPerFrame)) : 1;
      const t0 = performance.now();
      const f = p.rt.frame();
      f.dispatch(
        p.tracer,
        {
          params: {
            ...this.#camera!,
            frame: [w, h, this.#samples, n],
            counts: [...this.#scene!.counts, this.#seed],
            path: [this.bounces, this.rouletteFrom, 0, 0],
          },
          ...this.#buffers!,
          accum: this.#accum!,
        },
        Math.ceil((w * h) / WORKGROUP),
      );
      await f.submit();
      this.#samples += n;
      this.#drawn = false;
      const ms = performance.now() - t0;
      this.info.frameTime = ms;
      this.info.pathsPerSecond = ms > 0 ? (w * h * n) / (ms / 1000) : 0;
      this.info.frames++;
      if (this.targetFrameTime !== undefined && this.#scale === 1 && ms > 0)
        this.samplesPerFrame = Math.max(
          1,
          Math.min(this.maxSamplesPerFrame, Math.round((n * this.targetFrameTime) / ms) || 1),
        );
    }
    if (!this.#drawn && p.context !== undefined) {
      const f = p.rt.frame();
      f.pass({ color: [{ target: p.context, clear: [0, 0, 0, 1] }] }, (pass) =>
        pass.draw(p.showOnCanvas!, { present: this.#present(), accum: this.#accum! }, { count: 3 }),
      );
      await f.submit();
      this.#drawn = true;
    }
  }

  /** Every pixel's mean radiance (RGB) and its sample count, top row first; full frames only. */
  async readRadiance(): Promise<Float32Array> {
    this.#need();
    const sums = await this.#accum!.read();
    const out = new Float32Array(sums.length);
    for (let i = 0; i < sums.length; i += 4) {
      const n = sums[i + 3]!;
      for (let c = 0; c < 3; c++) out[i + c] = n > 0 ? sums[i + c]! / n : 0;
      out[i + 3] = n;
    }
    return out;
  }

  /** The displayed image, tone-mapped, as RGBA floats in [0, 1], top row first. */
  async readPixels(): Promise<Float32Array> {
    const p = this.#need();
    const f = p.rt.frame();
    f.pass({ color: [{ target: this.#target!, clear: [0, 0, 0, 0] }] }, (pass) =>
      pass.draw(p.show, { present: this.#present(), accum: this.#accum! }, { count: 3 }),
    );
    await f.submit();
    return this.#target!.readFloats();
  }

  dispose(): void {
    this.setAnimationLoop(null);
    this.#free();
    this.#p?.rt.destroy();
    this.#p = undefined;
  }

  #need(): Pipelines {
    if (this.#p === undefined) throw new Error('call init() and wait for it before rendering');
    return this.#p;
  }

  #traced(): [number, number] {
    return [Math.ceil(this.#width / this.#scale), Math.ceil(this.#height / this.#scale)];
  }

  #present(): { view: number[] } {
    return { view: [this.#exposure, this.#traced()[0], this.#scale, 0] };
  }

  #upload(packed: PackedScene): void {
    for (const b of Object.values(this.#buffers ?? {})) b.destroy();
    this.#buffers = {
      spheres: resident(packed.spheres),
      quads: resident(packed.quads),
      materials: resident(packed.materials),
      lights: resident(packed.lights),
    };
    this.#scene = packed;
  }

  #allocate(): void {
    this.#accum?.destroy();
    this.#target?.destroy();
    this.#accum = resident(new Float32Array(this.#width * this.#height * 4));
    this.#target = this.#p!.rt.texture({
      size: [this.#width, this.#height],
      format: TARGET_FORMAT,
    });
    this.#dirty = true;
  }

  #free(): void {
    for (const b of Object.values(this.#buffers ?? {})) b.destroy();
    this.#accum?.destroy();
    this.#target?.destroy();
    this.#buffers = undefined;
    this.#scene = undefined;
  }
}
