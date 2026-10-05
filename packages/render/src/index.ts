// === @typeshade/radiance-render: the progressive renderer (plan M0) ===
//
// Every package above the compiler is written on the public exports of `typeshade/runtime` and
// nothing else: it imports no other subpath of the compiler and calls nothing on a WebGPU object.
// `scripts/boundary.mjs` holds that in CI, the way the compiler's engine journey holds its host.
//
// M0 draws one frame: a target cleared to `CLEAR`, read back as floats. It is the smallest thing
// the harness (`scripts/harness.mjs`) can hold to a golden on a real WebGPU device, and the shape
// every later milestone fills in: a frame, a pass, a read.

import { createRuntime } from 'typeshade/runtime';

export interface RendererOptions {
  /** The host's `GPUDevice`. Omitted, the runtime requests one. */
  readonly device?: object;
  /** The target in pixels, `[width, height]`. */
  readonly size: readonly [number, number];
}

export interface Renderer {
  /** Draw one frame, and resolve once the GPU has run it. */
  frame(): Promise<void>;
  /** The target's texels as floats, RGBA, top row first. */
  read(): Promise<Float32Array>;
  destroy(): void;
}

/** What M0's frame clears the target to: a colour no default clear produces. */
export const CLEAR: readonly [number, number, number, number] = [0.1, 0.2, 0.3, 1];

/** The target's format: half floats, so a read gives numbers rather than bytes. */
export const TARGET_FORMAT = 'rgba16float';

/** The renderer on `options.device`, or on a device the runtime requests. */
export async function createRenderer(options: RendererOptions): Promise<Renderer> {
  const rt = await createRuntime(options.device !== undefined ? { device: options.device } : {});
  const target = rt.texture({ size: options.size, format: TARGET_FORMAT });
  return {
    async frame() {
      const f = rt.frame();
      f.pass({ color: [{ target, clear: CLEAR }] }, () => {});
      await f.submit();
    },
    read: () => target.readFloats(),
    destroy: () => rt.destroy(),
  };
}
