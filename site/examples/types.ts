import type { PathTracer } from '@typeshade/radiance';
import type { OrbitControls } from '@typeshade/radiance-addons';

/** What an example hands the page: its renderer, its controls, and how to stop it. */
export interface ExampleRun {
  readonly renderer: PathTracer;
  readonly controls?: OrbitControls;
  /** Set by an example that moves its scene: whether it moves now. The stage's Pause sets it to
   *  false, and the path tracer goes on refining the frame the motion stopped on. */
  playing?: boolean;
  /** An element the example fills, for an example that has more to show than its canvas. The
   *  stage puts it under the canvas and over the toolbar, once the example runs. An example
   *  that sets the attribute `data-done` on the panel tells the stage, which then shows Done, and
   *  scripts/capture-stills.mjs that its work is finished and its canvas holds the still. */
  readonly panel?: HTMLElement;
  dispose(): void;
}

/** An example: a function that sets a scene up on `canvas` and starts its loop. */
export type Example = (canvas: HTMLCanvasElement) => Promise<ExampleRun>;
