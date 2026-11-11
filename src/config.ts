// Design: 0108, section 1, rule 4. The configuration of a game's project.

/** What `radiance.config.ts` gives. */
export interface GameConfig {
  /** The systems of a tick, by name, in the order they run. */
  readonly tick: readonly string[];
  /** The tick rate, an integer from 1. 60 when it is not given. */
  readonly hz?: number;
  /** `'input'` for a game with turns: one tick for each frame that has an input. */
  readonly stepOn?: 'input';
  /** The names of the values of a run. A level gives each one its number. */
  readonly values?: readonly string[];
  /** The size of each table of `scratch/`: the name of the state table it follows. */
  readonly scratch?: { readonly [table: string]: string };
}

/** Gives the configuration of a game. It returns what it gets, with its type checked. */
export function defineGame(config: GameConfig): GameConfig {
  return config;
}
