// Design: 0108, sections 5, 6 and 9. The engine is a class and the runtime. A game is a class
// that extends it: `tables` declares its memory, and `systems` the steps of a tick.
// The engine opens no device itself: `start` of `radiance/test` and `run` of `radiance/page`
// give it one, and from then on the engine owns every array of the game.

import type { Device, Resident } from 'typeshade/runtime';
import type { Drawing, Layer, Place, ViewOptions } from './draw.ts';
import type { InputObject } from './input.ts';
import {
  checkNoLevel,
  checkSave,
  restoreRows,
  saveNumber,
  type Save,
  type SaveShape,
} from './save.ts';
import { createSim, snapshotValue, type Sim, type SimRecord, type SimSnapshot } from './sim.ts';

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
  /** The seed of the run, a `u32`. A start `from` a save takes none: the save holds it. */
  readonly seed?: number;
  /** The tick rate, an integer from 1. 60 when it is not given. A save holds its own. */
  readonly hz?: number;
  /** The first rows of each table, by the name of its field. */
  readonly rows?: { readonly [table: string]: readonly object[] };
  /** The values of the run, by name. */
  readonly values?: { readonly [name: string]: number };
  /**
   * A save to start from (design record 0112, section 2): the run starts with the tables, the
   * tick, the seed, the tick rate and the values of the save. With it, `seed`, `rows` and
   * `values` are refused, and `hz` is refused when it is not the save's.
   */
  readonly from?: Save;
  /** The name of the game in its saves: the config's `name`. The name of the class when not given. */
  readonly game?: string;
  /** The version of the game's state in its saves, an integer from 1. 1 when not given. */
  readonly version?: number;
  /** What the game draws to, when it runs in a page. The engine does not read it. */
  readonly surface?: unknown;
  /**
   * The drawing of a game with layers (design record 0111). `run` of `radiance/page` makes it, and
   * the engine calls its `frame` and `toWorld`.
   */
  readonly drawing?: Drawing;
}

/** What a start from a save reads out of it. */
interface FromSave {
  readonly seed: number;
  readonly hz: number;
  readonly startTick: number;
  readonly values: { readonly [name: string]: number };
  readonly rows: { readonly [table: string]: readonly object[] };
}

/**
 * Checks `options.from` against the game's tables and reads the seed, the tick rate, the tick,
 * the values and the rows out of it (design record 0112, section 2). It throws a refusal with
 * the fact and a remedy.
 */
function readSave(
  where: string,
  game: string,
  version: number,
  tables: readonly { readonly name: string; readonly handle: Rows<unknown> }[],
  options: StartOptions,
): FromSave {
  const from = options.from!;
  checkNoLevel(
    where,
    (['seed', 'rows', 'values'] as const).filter((name) => options[name] !== undefined),
  );
  const state = tables.filter((t) => t.handle.kind !== 'scratch');
  const shape: SaveShape = {
    game,
    version,
    tables: state.map((t) => ({
      name: t.name,
      className: t.handle.cls.name,
      fields: Object.keys(new t.handle.cls() as object),
    })),
  };
  checkSave(where, from, shape);
  if (options.hz !== undefined && options.hz !== from.hz) {
    throw new RangeError(
      `${where}: the save runs at ${from.hz} hz, and the options give ${options.hz} hz. A run from a save keeps its tick rate. Leave "hz" out.`,
    );
  }
  const values = Object.fromEntries(
    Object.entries(from.values).map(([name, value]) => {
      const number = saveNumber(value);
      if (number === undefined) {
        throw new TypeError(
          `${where}: the value ${JSON.stringify(name)} of the save is ${JSON.stringify(value)}. A value is a number. Start from a save that game.save() wrote.`,
        );
      }
      return [name, number];
    }),
  );
  const rows = Object.fromEntries(
    from.tables.map((table) => {
      const handle = state.find((t) => t.name === table.name)!.handle;
      return [
        table.name,
        restoreRows(where, table.name, handle.cls as new () => object, table.rows),
      ];
    }),
  );
  return { seed: from.seed, hz: from.hz, startTick: from.tick, values, rows };
}

/**
 * @internal Checks a save against a game that has not started, as a start from it would. The
 * page uses it to choose the save to start from. It throws the refusal of the start.
 */
export function checkStartFrom(game: Engine, options: StartOptions): void {
  const where = game.constructor.name;
  const tables = Object.entries(game.tables ?? {}).flatMap(([name, handle]) =>
    handle instanceof Rows ? [{ name, handle: handle as Rows<unknown> }] : [],
  );
  readSave(where, options.game ?? where, options.version ?? 1, tables, options);
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
  #game = '';
  #version = 1;
  #systems: [string, () => unknown][] = [];
  /** What `restart()` starts from: the first rows, the values and the seed of a new run. */
  #fresh: StartOptions | undefined;
  /** Where `save()` also writes: the page's store (design record 0112, section 3). */
  #saver: ((save: Save) => Promise<void>) | undefined;

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
  /**
   * The save of the run: every table of the game's state, and no scratch table (design record
   * 0112). It waits for the tick in work and reads each table once. An input that waits for the
   * next tick is not in it. It is a plain value, and `JSON.stringify` holds it.
   */
  async save(): Promise<Save> {
    const sim = this.#live('save()');
    const snapshot = await sim.snapshot();
    const save: Save = {
      format: 1,
      game: this.#game,
      version: this.#version,
      tick: snapshot.tick,
      seed: snapshot.seed,
      hz: snapshot.hz,
      values: Object.fromEntries(
        Object.entries(this.#values).map(([name, value]) => [name, snapshotValue(value)]),
      ) as { [name: string]: number },
      tables: snapshot.tables,
    };
    // In a page with a store, the save is also written (design record 0112, section 3).
    await this.#saver?.(save);
    return save;
  }

  /**
   * Starts a new run on the same device, from the first rows, the values and the seed that the
   * game started with. In a page, these are the config's `start`, and the new state is written
   * over the save as `save()` writes it. The arrays of the run before stay on the device until
   * it closes. An input that waits, and the record of the run before, are dropped. The picture
   * and the loop go on.
   */
  async restart(): Promise<void> {
    const sim = this.#live('restart()');
    const fresh = this.#fresh;
    if (fresh === undefined) {
      throw new Error(
        `${this.constructor.name}.restart(): the game started from a save, so it has no first rows to start from. Start the game with a seed and a level, or run it with run() of radiance/page.`,
      );
    }
    // The tick in work ends first, so that no tick runs on the tables that are left.
    await sim.idle();
    this.#make(fresh);
    await this.save();
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
  static start<G extends Engine>(
    game: G,
    device: Device,
    options: StartOptions,
    fresh: StartOptions | undefined = options.from === undefined ? options : undefined,
  ): G {
    game.#start(device, options, fresh);
    return game;
  }

  /** @internal The page gives the game the function that writes each save to its store. */
  static setSaver(game: Engine, saver: (save: Save) => Promise<void>): void {
    game.#saver = saver;
  }

  #start(device: Device, options: StartOptions, fresh: StartOptions | undefined): void {
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
    this.#device = device;
    this.#surface = options.surface;
    this.#drawing = options.drawing;
    this.#systems = systems;
    this.#fresh = fresh;
    this.#make(options);
  }

  /**
   * Makes the simulation and binds each table of the game: the start of a run, and the start
   * again of `restart()`. The device, the systems and the tables of the class stay.
   */
  #make(options: StartOptions): void {
    const game = this.constructor.name;
    const device = this.#device!;
    const systems = this.#systems;
    this.#game = options.game ?? game;
    const version = options.version ?? 1;
    if (!Number.isInteger(version) || version < 1) {
      throw new RangeError(
        `${game}: the version is ${String(version)}. Give the version of the game's state as an integer from 1.`,
      );
    }
    this.#version = version;
    let given = options.rows ?? {};
    let seed = options.seed;
    let hz = options.hz;
    let values: { readonly [name: string]: number } = options.values ?? {};
    let startTick: number | undefined;
    if (options.from !== undefined) {
      const read = readSave(game, this.#game, version, this.#tables, options);
      ({ seed, hz, startTick, values } = read);
      given = read.rows;
    }
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

    this.#values = Object.freeze({ ...values });
    this.#scratch.clear();
    this.#frame = {};
    this.#waited = false;
    const sim = createSim(tables, {
      device,
      seed: seed as number,
      hz,
      startTick,
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
