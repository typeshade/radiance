import type { PathTracer } from '@typeshade/radiance';
import type { FlyControls, OrbitControls } from '@typeshade/radiance-addons';

/** What an example hands the page: its renderer, its controls, and how to stop it. */
export interface ExampleRun {
  /** The path tracer. When the example leaves `maxSamples` infinite, the stage sets a cap on it,
   *  so the tracer stops at the cap. */
  readonly renderer: PathTracer;
  readonly controls?: OrbitControls | FlyControls;
  /** Set by an example that moves its scene: whether it moves now. The stage's Pause sets it to
   *  false, and the path tracer goes on refining the frame the motion stopped on. When the canvas
   *  is off screen, the stage also stops the motion and pauses the tracer. */
  playing?: boolean;
  /** What the controls do, when the stage's default sentence (orbit, pan, zoom, reset) is false for
   *  this example. The stage puts the title before it and sets the result as the canvas label. */
  readonly controlsLabel?: string;
  /** An element the example fills, for an example that has more to show than its canvas. The
   *  stage puts it under the canvas and over the toolbar, once the example runs. An example
   *  that sets the attribute `data-done` on the panel tells the stage, which then shows Done, and
   *  scripts/capture-stills.mjs that its work is finished and its canvas holds the still. */
  readonly panel?: HTMLElement;
  dispose(): void;
}

/** An example: a function that sets a scene up on `canvas` and starts its loop. */
export type Example = (canvas: HTMLCanvasElement) => Promise<ExampleRun>;
