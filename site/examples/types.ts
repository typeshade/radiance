import type { PathTracer } from '@typeshade/radiance';
import type { OrbitControls } from '@typeshade/radiance-addons';

/** What an example hands the page: its renderer, its controls, and how to stop it. */
export interface ExampleRun {
  readonly renderer: PathTracer;
  readonly controls?: OrbitControls;
  /** Set by an example that moves its scene: whether it moves now. The stage's Pause sets it to
   *  false, and the path tracer goes on refining the frame the motion stopped on. */
  playing?: boolean;
  dispose(): void;
}

/** An example: a function that sets a scene up on `canvas` and starts its loop. */
export type Example = (canvas: HTMLCanvasElement) => Promise<ExampleRun>;
