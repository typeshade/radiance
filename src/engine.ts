// Design: 0108, sections 5, 6 and 9. The engine is a class and the runtime. A game is a class
// that extends it: `tables` declares its memory, and `systems` the steps of a tick.
// The engine opens no device itself: `start` of `radiance/test` and `run` of `radiance/page`
// give it one, and from then on the engine owns every array of the game.

import type { Device, Resident } from 'typeshade/runtime';
import type { Drawing, Layer, Place, ViewOptions } from './draw.ts';
import type { InputObject } from './input.ts';
import { createSim, type Sim, type SimRecord, type SimSnapshot } from './sim.ts';

/** The kinds of memory a game declares. */
export type MemoryKind = 'table' | 'pool' | 'scratch';

/** One line of `game.memory()`. */
export interface MemoryLine {
  /** The name of the field that declares the table. */
  readonly name: string;
  readonly kind: MemoryKind;
  /** The number of rows. */
  readonly rows: number;
  /** The arrays the device holds for the table: 2 for a buffered table, and 1 for any other. */
  readonly arrays: number;
}

/** The options of a table of the game's state. */
export interface TableOptions {
  /** True when a tick reads the table through `rows` and writes it through `next`. */
  readonly buffered?: boolean;
}

/** The options of a table with free slots (design record 0107). It is buffered. */
export interface PoolOptions<R> {
  /** The number of rows. */
  readonly size: number;
  /** True when the row is a free slot. When not given, the engine calls `row.free()`. */
  readonly free?: (row: R) => boolean;
}

/** The options of a table that is no state: the name of the state table it follows, or a number. */
export type ScratchOptions = { readonly like: string } | { readonly size: number };

const BIND = Symbol('radiance.bind');

/** What the engine gives a handle when the game starts. */
interface Binding {
  readonly name: string;
  rows(): Resident<object[]>;
  next(): Resident<object[]>;
  read(): Promise<object[]>;
  input(index: number, fields: InputObject): void;
  size(): number;
}

/** A table of a game: what a field of the game's class holds. */
export class Rows<R> {
  /** @internal */
  readonly kind: MemoryKind;
  /** @internal */
  readonly cls: new () => R;
  /** @internal */
  readonly options: TableOptions | PoolOptions<R> | ScratchOptions;
  /** @internal */
  [BIND]: Binding | undefined;

  /** @internal Use `this.table`, `this.pool` or `this.scratch` of the game's class. */
  constructor(
    kind: MemoryKind,
    cls: new () => R,
    options: TableOptions | PoolOptions<R> | ScratchOptions,
  ) {
    this.kind = kind;
    this.cls = cls;
    this.options = options;
  }

  #bound(member: string): Binding {
    const binding = this[BIND];
    if (binding === undefined) {
      throw new Error(
        `${member}: the game has not started, so the table has no array yet. Read a table in a system or after the start.`,
      );
    }
    return binding;
  }

  /** The name of the field that declares the table. */
  get name(): string {
    return this.#bound('Rows.name').name;
  }

  /** The number of rows. */
  get size(): number {
    return this.#bound('Rows.size').size();
  }

  /** The table on the device, as the systems before this one left it. */
  get rows(): Resident<R[]> {
    return this.#bound('Rows.rows').rows() as Resident<R[]>;
  }

  /** The array a tick writes. After the last system of the tick it is `rows`. */
  get next(): Resident<R[]> {
    return this.#bound('Rows.next').next() as Resident<R[]>;
  }

  /** A copy of the rows. */
  read(): Promise<R[]> {
    return this.#bound('Rows.read()').read() as Promise<R[]>;
  }

  /** An input: a write of field values to one row, applied before the next tick and recorded. */
  input(index: number, fields: InputObject): void {
    this.#bound('Rows.input()').input(index, fields);
  }
}

/** The events of a page that a game can take as inputs. */
export type InputEvent = 'pointerdown' | 'pointermove' | 'pointerup' | 'keydown' | 'keyup';

/** What a method with `@input` gets for a pointer event: the place in the canvas, from 0 to 1. */
export interface PointerInput {
  readonly x: number;
  readonly y: number;
  /** True while a button is down. */
  readonly down: boolean;
}

/** What a method with `@input` gets for a key event. */
export interface KeyInput {
  readonly key: string;
}

/**
 * The inputs of a game: for each event of the page, the function that takes its data. The loop
 * of `radiance/page` calls it. The function gives the game an input with `table.input`, so the
 * event is in the record of the run.
 */
export interface Inputs {
  pointerdown?(data: PointerInput): unknown;
  pointermove?(data: PointerInput): unknown;
  pointerup?(data: PointerInput): unknown;
  keydown?(data: KeyInput): unknown;
  keyup?(data: KeyInput): unknown;
}

/** What `start` gives a game: the run's seed, its tick rate, its first rows and its values. */
export interface StartOptions {
  /** The seed of the run, a `u32`. */
  readonly seed: number;
  /** The tick rate, an integer from 1. 60 when it is not given. */
  readonly hz?: number;
  /** The first rows of each table, by the name of its field. */
  readonly rows?: { readonly [table: string]: readonly object[] };
  /** The values of the run, by name. */
  readonly values?: { readonly [name: string]: number };
  /** What the game draws to, when it runs in a page. The engine does not read it. */
  readonly surface?: unknown;
  /**
   * The drawing of a game with layers (design record 0111). `run` of `radiance/page` makes it, and
   * the engine calls its `frame` and `toWorld`.
   */
  readonly drawing?: Drawing;
}

const SIM = Symbol('radiance.sim');
const LOOP_BLEND = Symbol('radiance.blend');

/** What `drawLayers` takes (design record 0111, section 6). */
export interface DrawOptions {
  /**
   * How far the frame is from the last tick to the tick after it, from 0 to 1. When it is not
   * given, the frame uses the value of the loop of `radiance/page`: 0 before the loop gave one.
   */
  readonly blend?: number;
}

/** @internal The loop of a page gives the game the `blend` of its frame. */
export function setLoopBlend(game: Engine, blend: number): void {
  (game as unknown as { [LOOP_BLEND]: number })[LOOP_BLEND] = blend;
}

/** @internal The simulation inside a started game, for the engine's own tools. */
export function simOf(game: Engine): Sim<Record<string, object[]>, string> {
  return (game as unknown as { [SIM]: () => Sim<Record<string, object[]>, string> })[SIM]();
}

/**
 * The engine. A game is a class that extends it. The game's own names live in `tables`,
 * `systems` and `inputs`, so that no name of a game meets a member of the engine. `startGame` gives the game its device and
 * its first rows. From then on the engine owns every array of the game, runs its ticks, and
 * frees everything in `dispose()`.
 */
export abstract class Engine {
  /**
   * The tables of the game, by name: each is `this.table`, `this.pool` or `this.scratch`. The
   * names are the game's own, apart from the engine's members.
   */
  abstract readonly tables: { readonly [name: string]: Rows<any> };
  /**
   * The systems of the game, by name: the steps of a tick, in the order they run. A system can
   * return a promise, and the engine waits for it.
   */
  abstract readonly systems: { readonly [name: string]: () => unknown };
  /** The functions that take an event of the page, when the game takes inputs. */
  readonly inputs?: Inputs;
  /** `'input'` for a game with turns: the loop of a page runs one tick for each frame with an input. */
  readonly stepOn?: 'input';
  /**
   * The layers of the picture, from the back to the front, when the game draws in layers
   * (design record 0111, section 2). The class that `radiance sync` writes gives them.
   */
  readonly layers?: readonly Layer[];
  /** The view of the layers: the rectangle of the world that the screen shows (record 0111, section 3). */
  readonly view?: ViewOptions;
  /** The `blend` that the loop of a page gave. 0 before the loop gave one. */
  [LOOP_BLEND] = 0;
  #surface: unknown;
  #stops: (() => void)[] = [];
  #sim: Sim<Record<string, object[]>, string> | undefined;
  #device: Device | undefined;
  #drawing: Drawing | undefined;
  /** True after the engine waited for the device once, after the first tick of a run. */
  #waited = false;
  #disposed = false;
  #inTick = false;
  #frame: Record<string, unknown> = {};
  #tables: { name: string; handle: Rows<unknown> }[] = [];
  #scratch = new Map<string, Resident<object[]>>();
  #values: { readonly [name: string]: number } = {};

  /** Declares a table of the game's state. */
  protected table<R>(cls: new () => R, options: TableOptions = {}): Rows<R> {
    return new Rows('table', cls, options);
  }

  /** Declares a table with free slots. Its class has a method `free()`, or `options.free` says. */
  protected pool<R>(cls: new () => R, options: PoolOptions<R>): Rows<R> {
    return new Rows('pool', cls, options);
  }

  /** Declares a table that is no state: it is in no dump, no snapshot and no record. */
  protected scratch<R>(cls: new () => R, options: ScratchOptions): Rows<R> {
    return new Rows('scratch', cls, options);
  }

  #live(member: string): Sim<Record<string, object[]>, string> {
    const name = this.constructor.name;
    if (this.#disposed) {
      throw new Error(`${name}.${member}: the game is disposed. Start a new game to run it again.`);
    }
    if (this.#sim === undefined) {
      throw new Error(
        `${name}.${member}: the game has not started. Start it with start() of radiance/test or run() of radiance/page.`,
      );
    }
    return this.#sim;
  }

  /** @internal */
  [SIM](): Sim<Record<string, object[]>, string> {
    return this.#live('simOf()');
  }

  /** The seed of the run. */
  get seed(): number {
    return this.#live('seed').seed;
  }
  /** The tick rate. */
  get hz(): number {
    return this.#live('hz').hz;
  }
  /** `1 / hz` rounded to `f32`. */
  get dt(): number {
    return this.#live('dt').dt;
  }
  /** The number of ticks run. In a system it is the number of the tick that runs. */
  get tick(): number {
    return this.#live('tick').tick;
  }
  /** The tier of the device: `cpu`, `webgpu` or `webgl2`. */
  get tier(): string {
    this.#live('tier');
    return this.#device!.tier;
  }
  /** The values of the run, by name. */
  get values(): { readonly [name: string]: number } {
    return this.#values;
  }

  /** What the game draws to, or `undefined` in a test. The page gives it. */
  get surface(): unknown {
    return this.#surface;
  }
  /** The number of inputs that wait for the next tick. */
  get pending(): number {
    return this.#live('pending').pending;
  }

  /** @internal Asks the engine to call `stop` when the game is disposed. */
  onDispose(stop: () => void): void {
    this.#stops.push(stop);
  }

  /**
   * Runs `n` ticks, 1 when `n` is not given. A game with layers waits for the device once, after
   * its first tick: a draw before that wait shows an empty picture, with no error (design record
   * 0111, section 4).
   */
  step(n = 1): Promise<void> {
    const sim = this.#live('step()');
    const ran = sim.step(n);
    if (this.#drawing === undefined) return ran;
    return ran.then(() => {
      if (this.#waited || !(n > 0)) return;
      this.#waited = true;
      return sim.wait();
    });
  }
  /**
   * The `blend` of the loop's latest frame: how far the frame is from the last tick to the tick
   * after it, from 0 to 1 (design record 0111, section 6). It is 0 before the loop gave one, and
   * in a game that no loop runs.
   */
  get blend(): number {
    return this[LOOP_BLEND];
  }
  /**
   * Draws the layers of the game into one texture, and shows the texture on the surface (design
   * record 0111, section 4). The loop of `radiance/page` calls it for each frame. With
   * `{ blend }` it draws the frame for that `blend`, as a browser check needs.
   */
  async drawLayers(options: DrawOptions = {}): Promise<void> {
    this.#live('drawLayers()');
    if (this.#drawing === undefined) {
      throw new Error(
        `${this.constructor.name}.drawLayers(): the game has no layers on a device. Add "draw" and "view" to radiance.config.ts, and run the game with run() of radiance/page.`,
      );
    }
    const blend = options.blend ?? this[LOOP_BLEND];
    if (typeof blend !== 'number' || !(blend >= 0 && blend <= 1)) {
      throw new RangeError(
        `${this.constructor.name}.drawLayers(): blend is ${String(blend)}. Give a number from 0 to 1, for example drawLayers({ blend: 0.5 }).`,
      );
    }
    await this.#drawing.frame(blend);
  }
  /**
   * The place in the world of a place of the surface, through the view (design record 0111,
   * section 3). `at.x` and `at.y` are from 0 to 1 of the surface, as the pointer gives them. A
   * place outside the rectangle of the world gives a number below 0 or from the rectangle's size.
   */
  toWorld(at: Place): Place {
    this.#live('toWorld()');
    if (this.#drawing === undefined) {
      throw new Error(
        `${this.constructor.name}.toWorld(): the game has no layers on a device, so it has no view. Add "draw" and "view" to radiance.config.ts, and run the game with run() of radiance/page.`,
      );
    }
    return this.#drawing.toWorld(at);
  }
  /** Resolves when the device has run the ticks. */
  wait(): Promise<void> {
    return this.#live('wait()').wait();
  }
  /** The state as text: each state table, and no scratch table. */
  dump(): Promise<string> {
    return this.#live('dump()').dump();
  }
  /** The state as a plain object that JSON holds. */
  snapshot(): Promise<SimSnapshot> {
    return this.#live('snapshot()').snapshot();
  }
  /** The record of the run so far. */
  record(): SimRecord {
    return this.#live('record()').record();
  }

  /** One line of data for each table of the game, in the order of the class. */
  memory(): MemoryLine[] {
    this.#live('memory()');
    return this.#tables.map(({ name, handle }) => ({
      name,
      kind: handle.kind,
      rows: handle.size,
      arrays: handle.kind === 'pool' || (handle.options as TableOptions).buffered === true ? 2 : 1,
    }));
  }

  /** Frees every array of the game and closes the device. A call after it is an error. */
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#live('dispose()');
    this.#disposed = true;
    for (const stop of this.#stops) stop();
    await this.#device!.dispose();
    this.#drawing?.dispose();
  }

  /** @internal Use `start` of `radiance/test` or `run` of `radiance/page`. */
  static start<G extends Engine>(game: G, device: Device, options: StartOptions): G {
    game.#start(device, options);
    return game;
  }

  #start(device: Device, options: StartOptions): void {
    const game = this.constructor.name;
    if (this.#sim !== undefined || this.#disposed) {
      throw new Error(`${game}: the game started before. Make a new game for a new run.`);
    }
    const systems = Object.entries(this.systems ?? {});
    if (systems.length === 0) {
      throw new TypeError(
        `${game}: the game has no system. Give each step of a tick a name in "systems", for example "readonly systems = { move: () => move(this.tables.cells.rows) };".`,
      );
    }
    for (const [name, handle] of Object.entries(this.tables ?? {})) {
      if (!(handle instanceof Rows)) {
        throw new TypeError(
          `${game}.tables.${name}: the value is no table. Declare it with this.table, this.pool or this.scratch.`,
        );
      }
      this.#tables.push({ name, handle: handle as Rows<unknown> });
    }
    const given = options.rows ?? {};
    for (const name of Object.keys(given)) {
      if (!this.#tables.some((t) => t.name === name && t.handle.kind !== 'scratch')) {
        const names = this.#tables.filter((t) => t.handle.kind !== 'scratch').map((t) => t.name);
        throw new TypeError(
          `${game}: the first rows name ${JSON.stringify(name)}, which is no table of the game's state. The tables are ${names.join(', ')}.`,
        );
      }
    }

    const tables: Record<string, object[]> = {};
    const buffered: string[] = [];
    const slots: Record<string, { size: number; free: (row: object) => boolean }> = {};
    for (const { name, handle } of this.#tables) {
      if (handle.kind === 'scratch') continue;
      const rows = [...(given[name] ?? [])];
      if (handle.kind === 'pool') {
        const pool = handle.options as PoolOptions<object>;
        if (rows.length > pool.size) {
          throw new RangeError(
            `${game}.tables.${name}: the first rows are ${rows.length}, and the pool has ${pool.size} slots. Give more slots or fewer rows.`,
          );
        }
        // A pool with no first row starts from one free row, and the simulation adds the rest.
        if (rows.length === 0) rows.push(new handle.cls() as object);
        slots[name] = {
          size: pool.size,
          free: pool.free ?? ((row) => (row as { free(): boolean }).free()),
        };
        buffered.push(name);
      } else {
        if (rows.length === 0) {
          throw new RangeError(
            `${game}.tables.${name}: the table has no first row. Give its rows at the start, for example { rows: { ${name}: [...] } }.`,
          );
        }
        if ((handle.options as TableOptions).buffered === true) buffered.push(name);
      }
      tables[name] = rows;
    }

    this.#device = device;
    this.#surface = options.surface;
    this.#drawing = options.drawing;
    this.#values = Object.freeze({ ...(options.values ?? {}) });
    const sim = createSim(tables, {
      device,
      seed: options.seed,
      hz: options.hz,
      buffered,
      slots,
      tick: async (frame) => {
        this.#frame = frame as Record<string, unknown>;
        this.#inTick = true;
        try {
          for (const [, run] of systems) {
            await run.call(this);
          }
        } finally {
          this.#inTick = false;
        }
      },
    }) as Sim<Record<string, object[]>, string>;
    this.#sim = sim;

    // The number of rows of each state table, known before any handle is bound.
    const sizes = new Map<string, number>();
    for (const { name, handle } of this.#tables) {
      if (handle.kind === 'pool') sizes.set(name, slots[name].size);
      else if (handle.kind === 'table') sizes.set(name, tables[name].length);
    }
    for (const { name, handle } of this.#tables) {
      if (handle.kind === 'scratch') {
        const options = handle.options as ScratchOptions;
        const size = 'like' in options ? sizes.get(options.like) : options.size;
        if (size === undefined || !Number.isInteger(size) || size < 1) {
          throw new TypeError(
            `${game}.tables.${name}: a scratch table takes { like: the name of a table of the game's state } or { size: an integer from 1 }.`,
          );
        }
        const array = device.array(
          Array.from({ length: size }, () => new handle.cls() as object),
        ) as Resident<object[]>;
        this.#scratch.set(name, array);
        handle[BIND] = {
          name,
          rows: () => array,
          next: () => {
            throw new Error(
              `${game}.tables.${name}.next: a scratch table has one array. Read and write it through "rows".`,
            );
          },
          read: () => array.read(),
          input: () => {
            throw new Error(
              `${game}.tables.${name}.input(): a scratch table is no state, so it takes no input. Give the input to a table of the game's state.`,
            );
          },
          size: () => size,
        };
        continue;
      }
      const isBuffered = buffered.includes(name);
      const size = sizes.get(name)!;
      handle[BIND] = {
        name,
        rows: () => {
          this.#live(`tables.${name}.rows`);
          if (!this.#inTick) return sim.table(name) as Resident<object[]>;
          const entry = this.#frame[name];
          return (isBuffered ? (entry as { read: unknown }).read : entry) as Resident<object[]>;
        },
        next: () => {
          this.#live(`tables.${name}.next`);
          if (!isBuffered) {
            throw new Error(
              `${game}.tables.${name}.next: the table is not buffered, so it has one array. Declare it with { buffered: true }, or write it through "rows".`,
            );
          }
          if (!this.#inTick) {
            throw new Error(
              `${game}.tables.${name}.next: "next" is the array a tick writes. Read it in a system.`,
            );
          }
          return (this.#frame[name] as { write: Resident<object[]> }).write;
        },
        read: () => this.#live(`tables.${name}.read()`).read(name),
        input: (index, fields) => this.#live(`tables.${name}.input()`).input(name, index, fields),
        size: () => size,
      };
    }
  }
}
