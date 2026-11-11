// The entry `radiance/test`: what a test of a game imports. Design record 0100, section 3.

import type { RunRecord } from './input.ts';
import type { Scene } from './node.ts';
import type { SimRecord } from './sim.ts';
import { replaySim } from './sim-replay.ts';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDevice } from 'typeshade/runtime';
import { loadConfig } from './cli.ts';
import { GAME_FILE, syncProject } from './project.ts';
import { Engine, simOf, type StartOptions } from './engine.ts';
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

/**
 * Starts a game on a device of the CPU tier and returns it: the engine opens the device, makes
 * every array of the game and gives the tables their first rows. It runs no loop (design
 * record 0108, section 5).
 */
export async function start<G extends Engine>(
  Game: new () => G,
  options: StartOptions,
): Promise<G> {
  const device = await createDevice({ prefer: ['cpu'] });
  try {
    return Engine.start(new Game(), device, options);
  } catch (error) {
    await device.dispose();
    throw error;
  }
}

/**
 * Runs a record of a game again: starts the game with the record's seed and tick rate, gives it
 * each input at the input's tick and runs the record's ticks. Its dump equals the dump of the
 * run that made the record (design record 0108, section 6).
 */
export async function replayGame<G extends Engine>(
  Game: new () => G,
  options: Omit<StartOptions, 'seed' | 'hz'>,
  record: SimRecord,
): Promise<G> {
  const game = await start(Game, { ...options, seed: record?.seed, hz: record?.hz });
  try {
    await replaySim(() => simOf(game), record);
  } catch (error) {
    await game.dispose();
    throw error;
  }
  return game;
}

/** The first rows and the values of a run: what a file of `levels/` exports. */
export interface Level {
  readonly rows: { readonly [table: string]: readonly object[] };
  readonly values?: { readonly [name: string]: number };
}

/**
 * Loads a project and starts its game on a device of the CPU tier: the engine reads the
 * project, writes the game's class, and gives the game its level. `level` is the name of a file
 * of `levels/`, or the level itself (design record 0108, section 5).
 */
export async function load<G extends Engine = Engine>(
  project: string,
  options: { readonly seed: number; readonly level: string | Level },
): Promise<G> {
  const dir = resolve(project);
  const config = await loadConfig(dir);
  syncProject(dir, config);
  const { Game } = (await import(pathToFileURL(join(dir, GAME_FILE)).href)) as {
    Game: new () => G;
  };
  let level = options.level;
  if (typeof level === 'string') {
    const file = join(dir, 'levels', `${level}.ts`);
    const module = (await import(pathToFileURL(file).href)) as { default?: Level };
    if (module.default === undefined) {
      throw new TypeError(
        `${file}: the level has no default export. Export its first rows and values, for example "export default { rows: { cells }, values: { width: 8 } };".`,
      );
    }
    level = module.default;
  }
  return start(Game, { seed: options.seed, hz: config.hz, rows: level.rows, values: level.values });
}
