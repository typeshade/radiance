// Design: 0108, sections 5, 6 and 9. The engine is a class and the runtime. A game is a class
// that extends it: a field declares memory, and a method with `@system()` is a step of a tick.
// The engine opens no device itself: `start` of `radiance/test` and `run` of `radiance/page`
// give it one, and from then on the engine owns every array of the game.

import type { Device, Resident } from 'typeshade/runtime';
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

/** The options of a table that is no state: the rows of another table, or a number. */
export type ScratchOptions = { readonly like: Rows<unknown> } | { readonly size: number };

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

const SYSTEMS = Symbol('radiance.systems');

/**
 * Marks a method of a game's class as a step of a tick. The systems run in the order the class
 * declares them. A system can return a promise, and the engine waits for it.
 */
export function system() {
  return function <This extends Engine>(
    _method: (this: This) => unknown,
    context: ClassMethodDecoratorContext<This>,
  ): void {
    context.addInitializer(function (this: This) {
      (this as unknown as { [SYSTEMS]: string[] })[SYSTEMS].push(String(context.name));
    });
  };
}

const INPUTS = Symbol('radiance.inputs');

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
 * Marks a method of a game's class as the receiver of an event of the page. The loop of
 * `radiance/page` calls it with the event's data. The method gives the game an input with
 * `table.input`, so the event is in the record of the run.
 */
export function input(event: InputEvent) {
  return function <This extends Engine>(
    _method: (this: This, data: never) => unknown,
    context: ClassMethodDecoratorContext<This>,
  ): void {
    context.addInitializer(function (this: This) {
      (this as unknown as { [INPUTS]: [InputEvent, string][] })[INPUTS].push([
        event,
        String(context.name),
      ]);
    });
  };
}

/** @internal The methods of a game that take an event, for the loop of a page. */
export function inputsOf(game: Engine): readonly (readonly [InputEvent, string])[] {
  return (game as unknown as { [INPUTS]: [InputEvent, string][] })[INPUTS];
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
}

const SIM = Symbol('radiance.sim');

/** @internal The simulation inside a started game, for the engine's own tools. */
export function simOf(game: Engine): Sim<Record<string, object[]>, string> {
  return (game as unknown as { [SIM]: () => Sim<Record<string, object[]>, string> })[SIM]();
}

/**
 * The engine. A game is a class that extends it. `startGame` gives the game its device and
 * its first rows. From then on the engine owns every array of the game, runs its ticks, and
 * frees everything in `dispose()`.
 */
export abstract class Engine {
  /** @internal The names of the systems, in the order of the class. */
  readonly [SYSTEMS]: string[] = [];
  /** @internal The methods that take an event of the page. */
  readonly [INPUTS]: [InputEvent, string][] = [];
  /** `'input'` for a game with turns: the loop of a page runs one tick for each frame with an input. */
  readonly stepOn?: 'input';
  #surface: unknown;
  #stops: (() => void)[] = [];
  #sim: Sim<Record<string, object[]>, string> | undefined;
  #device: Device | undefined;
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

  /** Runs `n` ticks, 1 when `n` is not given. */
  step(n = 1): Promise<void> {
    return this.#live('step()').step(n);
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
    const systems = this[SYSTEMS];
    if (systems.length === 0) {
      throw new TypeError(
        `${game}: the class has no system. Mark each step of a tick with @system(), for example "@system() move() { return move(this.cells.rows); }".`,
      );
    }
    const fields = this as unknown as Record<string, unknown>;
    for (const name of Object.keys(fields)) {
      const handle = fields[name];
      if (handle instanceof Rows) this.#tables.push({ name, handle: handle as Rows<unknown> });
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
            `${game}.${name}: the first rows are ${rows.length}, and the pool has ${pool.size} slots. Give more slots or fewer rows.`,
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
            `${game}.${name}: the table has no first row. Give its rows at the start, for example { rows: { ${name}: [...] } }.`,
          );
        }
        if ((handle.options as TableOptions).buffered === true) buffered.push(name);
      }
      tables[name] = rows;
    }

    this.#device = device;
    this.#surface = options.surface;
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
          for (const name of systems) {
            await (fields[name] as () => unknown).call(this);
          }
        } finally {
          this.#inTick = false;
        }
      },
    }) as Sim<Record<string, object[]>, string>;
    this.#sim = sim;

    // The number of rows of each state table, known before any handle is bound.
    const sizes = new Map<Rows<unknown>, number>();
    for (const { name, handle } of this.#tables) {
      if (handle.kind === 'pool') sizes.set(handle, slots[name].size);
      else if (handle.kind === 'table') sizes.set(handle, tables[name].length);
    }
    for (const { name, handle } of this.#tables) {
      if (handle.kind === 'scratch') {
        const options = handle.options as ScratchOptions;
        const size = 'like' in options ? sizes.get(options.like) : options.size;
        if (size === undefined || !Number.isInteger(size) || size < 1) {
          throw new TypeError(
            `${game}.${name}: a scratch table takes { like: a table of the game's state } or { size: an integer from 1 }.`,
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
              `${game}.${name}.next: a scratch table has one array. Read and write it through "rows".`,
            );
          },
          read: () => array.read(),
          input: () => {
            throw new Error(
              `${game}.${name}.input(): a scratch table is no state, so it takes no input. Give the input to a table of the game's state.`,
            );
          },
          size: () => size,
        };
        continue;
      }
      const isBuffered = buffered.includes(name);
      const size = sizes.get(handle)!;
      handle[BIND] = {
        name,
        rows: () => {
          this.#live(`${name}.rows`);
          if (!this.#inTick) return sim.table(name) as Resident<object[]>;
          const entry = this.#frame[name];
          return (isBuffered ? (entry as { read: unknown }).read : entry) as Resident<object[]>;
        },
        next: () => {
          this.#live(`${name}.next`);
          if (!isBuffered) {
            throw new Error(
              `${game}.${name}.next: the table is not buffered, so it has one array. Declare it with { buffered: true }, or write it through "rows".`,
            );
          }
          if (!this.#inTick) {
            throw new Error(
              `${game}.${name}.next: "next" is the array a tick writes. Read it in a system.`,
            );
          }
          return (this.#frame[name] as { write: Resident<object[]> }).write;
        },
        read: () => this.#live(`${name}.read()`).read(name),
        input: (index, fields) => this.#live(`${name}.input()`).input(name, index, fields),
        size: () => size,
      };
    }
  }
}
