// The entry `radiance/test`: what a test of a game imports. Design record 0100, section 3.

import type { RunRecord } from './input.ts';
import type { Scene } from './node.ts';
import { createSim, type Sim, type SimOptions, type SimRecord, type SimTables } from './sim.ts';
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

/** What `replaySim` gives the function that builds a simulation: the record's seed and tick rate. */
export interface ReplayRun {
  readonly seed: number;
  readonly hz: number;
}

/**
 * Runs a record of a simulation again. It gives the simulation each input at the input's tick
 * and runs the record's ticks. Its dump equals the dump of the run that made the record.
 *
 * `replaySim(build, record)` calls the function that builds the game with the record's seed and
 * tick rate (design record 0106, section 2). `replaySim(tables, options, record)` builds the
 * simulation from the same first rows and options (design record 0102, section 4).
 */
export async function replaySim<T extends SimTables, B extends keyof T = never>(
  build: (run: ReplayRun) => Sim<T, B>,
  record: SimRecord,
): Promise<Sim<T, B>>;
export async function replaySim<T extends SimTables, B extends keyof T = never>(
  tables: T,
  options: Omit<SimOptions<T, B>, 'seed' | 'hz'>,
  record: SimRecord,
): Promise<Sim<T, B>>;
export async function replaySim<T extends SimTables, B extends keyof T = never>(
  first: T | ((run: ReplayRun) => Sim<T, B>),
  second: Omit<SimOptions<T, B>, 'seed' | 'hz'> | SimRecord,
  third?: SimRecord,
): Promise<Sim<T, B>> {
  const build = typeof first === 'function' ? first : undefined;
  const record = (build === undefined ? third : second) as SimRecord;
  if (typeof record !== 'object' || record === null || record.version !== 1) {
    const version = (record as { version?: unknown } | null)?.version;
    throw new TypeError(
      `replaySim(): the record's version is ${String(version)}. This engine reads version 1, which sim.record() writes.`,
    );
  }
  const { ticks, inputs } = record;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError(
      `replaySim(): the record's ticks is ${String(ticks)}. Give an integer from 0.`,
    );
  }
  let last = 0;
  inputs.forEach((input, index) => {
    if (!Number.isInteger(input.tick) || input.tick < 0 || input.tick >= ticks) {
      throw new RangeError(
        `replaySim(): input ${index} has the tick ${String(input.tick)}, and the record has ${ticks} ticks. An input's tick is an integer from 0 to ${ticks - 1}.`,
      );
    }
    if (input.tick < last) {
      throw new RangeError(
        `replaySim(): input ${index} has the tick ${input.tick} after an input of tick ${last}. Give the inputs in the order of their ticks.`,
      );
    }
    last = input.tick;
  });
  let sim: Sim<T, B>;
  if (build === undefined) {
    sim = createSim(
      first as T,
      { ...second, seed: record.seed, hz: record.hz } as SimOptions<T, B>,
    );
  } else {
    sim = build({ seed: record.seed, hz: record.hz });
    if (typeof sim !== 'object' || sim === null || typeof sim.step !== 'function') {
      throw new TypeError(
        `replaySim(): the function returned no simulation. Return the simulation that createSim() gives, for example (run) => createGame({ seed: run.seed }).sim.`,
      );
    }
    if (sim.tick !== 0) {
      throw new RangeError(
        `replaySim(): the simulation is at tick ${sim.tick}. Return a simulation at tick 0.`,
      );
    }
    if (sim.seed !== record.seed || sim.hz !== record.hz) {
      throw new RangeError(
        `replaySim(): the simulation has the seed ${sim.seed} and ${sim.hz} hz, and the record has the seed ${record.seed} and ${record.hz} hz. Build the simulation with the seed and the hz that the function gets.`,
      );
    }
  }
  let next = 0;
  for (let tick = 0; tick < ticks; tick++) {
    while (next < inputs.length && inputs[next].tick === tick) {
      sim.input(inputs[next].table as keyof T & string, inputs[next].index, inputs[next].fields);
      next++;
    }
    await sim.step();
  }
  return sim;
}
