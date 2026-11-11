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
  /**
   * A game with `save` keeps one save of its run on the device (design record 0112, section 3).
   * `version` is the version of the game's state in the save, an integer from 1.
   */
  readonly save?: { readonly version: number };
  /** The most bytes of script that the page loads at its start, before gzip. */
  readonly budget?: number;
  /** True keeps the compiler's records of fusion in the page. */
  readonly fuse?: boolean;
  /**
   * The layers of the picture, from the back to the front (design record 0111, sections 3 and
   * 6). An entry is the name of a file of `draw/` (`draw/<name>.shade.ts`), or an object that
   * names the layer and how its colour meets the colour under it.
   */
  readonly draw?: readonly (string | DrawEntry)[];
  /** The view of the layers. A game with `draw` gives it. */
  readonly view?: ViewConfig;
}

/** How the colour of a layer meets the colour under it (design record 0111, section 6). */
export type Blend = 'alpha' | 'add';

/** An entry of `draw` that gives a layer a blend. */
export interface DrawEntry {
  /** The name of the layer: a file of `draw/`. */
  readonly layer: string;
  /** `'alpha'` draws over the colour under it by its alpha. `'add'` adds its colour by its alpha. */
  readonly blend?: Blend;
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
