// === PathTracer: the progressive path tracer (docs/plan.md, M1 and M2) ===
//
// Every call of `render(scene, camera)` adds `samplesPerFrame` samples to every pixel and draws
// the mean on the canvas. The frame is traced in tiles (design record 0001, "Tiles and the
// watchdog"): each tile is one dispatch of the TypeShade kernel (kernels/trace.shade.ts), sized
// so that it stays under `watchdogBudget` milliseconds by the last frame's speed, and the frame's
// dispatches go to the GPU in one submit. When the scene or the camera changed since the last
// call, the accumulation starts again first. Set `preview` above 1 while the camera moves to
// trace one pixel for each preview-by-preview block instead.
//
// The scene reaches the kernel through a `ScenePack` (scene-pack.ts): seven storage buffers in
// all, each rewritten only when what it holds changed.
//
// Everything goes through `typeshade/runtime`: the renderer makes no WebGPU call of its own
// (scripts/boundary.mjs).

import { createRuntime, resident, type Resident, type Runtime } from 'typeshade/runtime';
import trace from '../kernels/trace.shade.ts';
import type { Camera } from '../cameras/Camera.ts';
import type { Scene } from '../scenes/Scene.ts';
import { checkStorageBinding } from './limits.ts';
import { Renderer } from './Renderer.ts';
import { cameraFrame, sameCameraFrame, ScenePack, type CameraFrame } from './scene-pack.ts';
import { DEFAULT_WATCHDOG_BUDGET, tileFrame, WORKGROUP } from './tiles.ts';

export interface PathTracerParameters {
  /** The canvas to draw on. Without one, `readPixels()` and `readRadiance()` still work. */
  canvas?: HTMLCanvasElement;
  /** The host's `GPUDevice`. Omitted, the runtime requests one. */
  device?: object;
  /** One seed, one image. Default 0. */
  seed?: number;
  /** Samples each `render` adds to every pixel. Default 1. The first frame takes one, to measure
   *  the speed the tiles are sized by. */
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
  /**
   * The milliseconds one dispatch may take: the frame is traced in tiles that stay under it, by
   * the last frame's speed, so the GPU's watchdog (about two seconds on Windows) never stops
   * one. Default 50.
   */
  watchdogBudget?: number;
}

/** The displayed image's format for `readPixels()`: half floats, read back as numbers. */
export const TARGET_FORMAT = 'rgba16float';
/** The canvas's format: one every WebGPU implementation can show. */
export const CANVAS_FORMAT = 'rgba8unorm';

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
  /** The milliseconds one dispatch may take. The tiles are sized to stay under it. */
  watchdogBudget: number;
  /**
   * What the last frame cost: its time in milliseconds, the paths it traced per second, the
   * dispatches (tiles) it took, the pixels of its largest tile, and the mean time of one dispatch
   * in milliseconds. The frame's dispatches go to the GPU in one submit, so a dispatch's own time
   * is not measured: `dispatchTime` is the frame's time over its dispatches.
   */
  readonly info = {
    frameTime: 0,
    pathsPerSecond: 0,
    frames: 0,
    dispatches: 0,
    tilePixels: 0,
    dispatchTime: 0,
  };

  #device: object | undefined;
  #seed: number;
  #exposure: number;
  #width = 1;
  #height = 1;
  #p: Pipelines | undefined;
  #pack: ScenePack | undefined;
  #accum: Resident<Float32Array> | undefined;
  #target: ReturnType<Runtime['texture']> | undefined;
  #camera: CameraFrame | undefined;
  /** The last frame's nanoseconds per path, or undefined before the first frame. */
  #nsPerPath: number | undefined;
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
    this.watchdogBudget = parameters.watchdogBudget ?? DEFAULT_WATCHDOG_BUDGET;
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
    this.#pack = new ScenePack();
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
    const pack = this.#pack!;
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    if (pack.update(scene).size > 0) this.#dirty = true;
    const view = cameraFrame(camera);
    if (this.#camera === undefined || !sameCameraFrame(view, this.#camera)) {
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
      // The first frame takes one sample, to measure the speed the tiles are sized by.
      let n = 1;
      if (this.#scale === 1 && this.#nsPerPath !== undefined)
        n = Math.max(1, Math.floor(this.samplesPerFrame));
      if (this.#scale === 1 && Number.isFinite(this.maxSamples))
        n = Math.max(1, Math.min(n, this.maxSamples - this.#samples));
      const tiles = tileFrame(w, h, n, this.#nsPerPath, this.watchdogBudget);
      const t0 = performance.now();
      const f = p.rt.frame();
      for (const tile of tiles)
        f.dispatch(
          p.tracer,
          {
            params: pack.params({
              camera: this.#camera!,
              frame: [w, h, this.#samples, n],
              tile,
              seed: this.#seed,
              bounces: this.bounces,
              rouletteFrom: this.rouletteFrom,
            }),
            ...pack.residents(),
            accum: this.#accum!,
          },
          Math.ceil((tile[2] * tile[3]) / WORKGROUP),
        );
      await f.submit();
      this.#samples += n;
      this.#drawn = false;
      const ms = performance.now() - t0;
      if (ms > 0) this.#nsPerPath = (ms * 1e6) / (w * h * n);
      this.info.frameTime = ms;
      this.info.pathsPerSecond = ms > 0 ? (w * h * n) / (ms / 1000) : 0;
      this.info.frames++;
      this.info.dispatches = tiles.length;
      // A loop, not a spread: a frame may have more tiles than an engine takes arguments.
      let largest = 0;
      for (const t of tiles) largest = Math.max(largest, t[2] * t[3]);
      this.info.tilePixels = largest;
      this.info.dispatchTime = ms / tiles.length;
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

  #allocate(): void {
    // The accumulation is the seventh storage buffer: it is held to the binding limit too.
    checkStorageBinding('accum', this.#width * this.#height * 16);
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
    this.#pack?.dispose();
    this.#accum?.destroy();
    this.#target?.destroy();
    this.#pack = undefined;
    this.#camera = undefined;
  }
}
