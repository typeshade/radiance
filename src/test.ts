// The entry `radiance/test`: what a test of a game imports. Design record 0100, section 3.

import type { RunRecord } from './input.ts';
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

/**
 * Runs a record of a run again: builds a world from the scene with the record's seed and tick
 * rate, gives it each input at the input's tick, and runs the record's ticks. The world it
 * returns has the same dump as the run that made the record (design record 0101, section 3).
 */
export function replay(scene: Scene, record: RunRecord): World {
  if (typeof record !== 'object' || record === null || record.version !== 1) {
    const version = (record as { version?: unknown } | null)?.version;
    throw new TypeError(
      `replay(): the record's version is ${String(version)}. This engine reads version 1, which world.record() writes.`,
    );
  }
  const { ticks, inputs } = record;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError(
      `replay(): the record's ticks is ${String(ticks)}. Give an integer from 0.`,
    );
  }
  let last = 0;
  inputs.forEach((input, index) => {
    if (!Number.isInteger(input.tick) || input.tick < 0 || input.tick >= ticks) {
      throw new RangeError(
        `replay(): input ${index} has the tick ${String(input.tick)}, and the record has ${ticks} ticks. An input's tick is an integer from 0 to ${ticks - 1}.`,
      );
    }
    if (input.tick < last) {
      throw new RangeError(
        `replay(): input ${index} has the tick ${input.tick} after an input of tick ${last}. Give the inputs in the order of their ticks.`,
      );
    }
    last = input.tick;
  });

  const world = createWorld(scene, { seed: record.seed, hz: record.hz });
  let next = 0;
  for (let tick = 0; tick < ticks; tick++) {
    while (next < inputs.length && inputs[next].tick === tick) {
      world.input(inputs[next].path, inputs[next].fields);
      next++;
    }
    world.step();
  }
  return world;
}
