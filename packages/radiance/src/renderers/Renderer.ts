import type { Camera } from '../cameras/Camera.ts';
import type { Scene } from '../scenes/Scene.ts';

/**
 * What every renderer shares: a canvas, a size, an animation loop, and `render(scene, camera)`.
 * The scene graph does not know which renderer draws it, so the path tracer today and a
 * real-time renderer later (docs/plan.md, the real-time tier) draw the same scene.
 */
export abstract class Renderer {
  /** The canvas the renderer draws on, when it has one. */
  readonly domElement: HTMLCanvasElement | undefined;
  #loop: ((time: number) => unknown) | null = null;
  #frame = 0;

  constructor(canvas?: HTMLCanvasElement) {
    this.domElement = canvas;
  }

  /** The frame's width and height in pixels. */
  abstract readonly width: number;
  abstract readonly height: number;
  /** Prepare the device and the pipelines. Resolves to the renderer, ready to `render`. */
  abstract init(): Promise<this>;
  /**
   * Change the frame's size, in CSS pixels; the frame traced is that times `getPixelRatio()`.
   * A canvas's style size is left to the page.
   */
  abstract setSize(width: number, height: number): void;

  #pixelRatio = 1;
  /** Device pixels per CSS pixel of the frame: 1 by default; below 1 renders faster, coarser. */
  getPixelRatio(): number {
    return this.#pixelRatio;
  }
  setPixelRatio(ratio: number): void {
    if (!(ratio > 0)) throw new RangeError(`the pixel ratio must be above 0, not ${ratio}`);
    this.#pixelRatio = ratio;
  }
  /** Draw `scene` as `camera` sees it; resolves once the GPU has run the frame. */
  abstract render(scene: Scene, camera: Camera): Promise<void>;
  /** Free the device's resources. The renderer cannot be used again. */
  abstract dispose(): void;

  /**
   * Call `callback` once per display frame, waiting for the one before to finish, as a game
   * loop does; `null` stops it. The callback may return a promise, such as `render`'s.
   */
  setAnimationLoop(callback: ((time: number) => unknown) | null): void {
    this.#loop = callback;
    cancelAnimationFrame(this.#frame);
    if (callback === null) return;
    const tick = (time: number): void => {
      if (this.#loop !== callback) return;
      Promise.resolve(callback(time)).then(
        () => {
          if (this.#loop === callback) this.#frame = requestAnimationFrame(tick);
        },
        (e: unknown) => {
          this.#loop = null;
          throw e;
        },
      );
    };
    this.#frame = requestAnimationFrame(tick);
  }
}
