// The entry `radiance/test`: what a test of a game imports. Design record 0100, section 3.

import type { Scene } from './node.ts';
import { createWorld, type World, type WorldOptions } from './world.ts';

/** The options of `simulate`. */
export interface SimulateOptions extends WorldOptions {
  /** How many ticks to run, an integer from 0. */
  readonly ticks: number;
}

/** Builds a world from a scene, runs `ticks` ticks on the CPU tier and returns the world. */
export function simulate(scene: Scene, options: SimulateOptions): World {
  const world = createWorld(scene, options);
  world.step(options.ticks);
  return world;
}
