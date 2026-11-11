// Design: 0108, section 1, rule 4, and 0109, section 2. The configuration of a game's project.

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
  /** The title of the page. The name of the project's directory when it is not given. */
  readonly name?: string;
  /** The level the page starts with, a file of `levels/`, and the seed of the run. */
  readonly start?: { readonly level: string; readonly seed?: number };
  /** The most bytes of script that the page loads at its start, before gzip. */
  readonly budget?: number;
  /** True keeps the compiler's records of fusion in the page. */
  readonly fuse?: boolean;
  /**
   * The layers of the picture, by name, from the back to the front (design record 0111,
   * section 3). Each name is a file of `draw/`: `draw/<name>.shade.ts`.
   */
  readonly draw?: readonly string[];
  /** The view of the layers. A game with `draw` gives it. */
  readonly view?: ViewConfig;
}

/** The view of a game's layers (design record 0111, section 3). */
export interface ViewConfig {
  /**
   * A rectangle of the world, `[width, height]`, with its first corner at the origin. The x
   * axis goes right and the y axis goes down. The whole rectangle is on every screen.
   */
  readonly fit: readonly [number, number];
  /** The colour of the part of the screen that the rectangle does not cover, `[r, g, b]` from 0 to 1. */
  readonly clear?: readonly [number, number, number];
}

/** Gives the configuration of a game. It returns what it gets, with its type checked. */
export function defineGame(config: GameConfig): GameConfig {
  return config;
}
