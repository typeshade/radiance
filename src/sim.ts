// Design: 0102 and 0104. A simulation runs a game on the raw structure of docs/vision.md (D11):
// named tables and one tick function. Its tables live on a device of the compiler's runtime, so
// a test on the CPU tier and a page on a GPU tier run the same code. It reads no clock and no
// random source.

import type { Device, Resident } from 'typeshade/runtime';

import { formatValue, type SnapshotValue } from './dump.ts';
import { applyFields, checkFields, type InputObject } from './input.ts';
import { nodeSeed } from './seed.ts';

/** The first rows of each table, by name. A row is an instance of a class. */
export type SimTables = Record<string, object[]>;

/** The two handles of a buffered table in one tick. */
export interface Buffered<R> {
  /** The rows as the last tick left them. The tick reads this handle. */
  readonly read: Resident<R>;
  /** The handle the tick writes. It becomes `read` in the next tick. */
  readonly write: Resident<R>;
}

/** What a tick gets: each table's handle by name, and `{ read, write }` for a buffered table. */
export type Frame<T extends SimTables, B extends keyof T> = {
  readonly [K in keyof T]: K extends B ? Buffered<T[K]> : Resident<T[K]>;
};

/** The time of one tick. */
export interface TickTime {
  /** `1 / hz` rounded to `f32`. The same number in every tick. */
  readonly dt: number;
  /** The number of ticks run before this one. */
  readonly tick: number;
}

/** A table with free slots: its number of rows, and what a free row is. */
export interface Slots<R> {
  /** The number of rows of the table, an integer. `createSim` adds free rows up to it. */
  readonly size: number;
  /** True when the row is a free slot. */
  free(row: R): boolean;
}

/** The options of `createSim`. */
export interface SimOptions<T extends SimTables, B extends keyof T = never> {
  /** The device that holds the tables: the CPU tier in a test, a GPU tier in a page. */
  readonly device: Device;
  /** The seed of the run, a `u32`. Required: a run always has one. */
  readonly seed: number;
  /** The tick rate, an integer from 1. 60 when it is not given. */
  readonly hz?: number;
  /** The tables that a tick reads and writes through two arrays. */
  readonly buffered?: readonly B[];
  /**
   * The tick the run starts at, an integer from 0, for a run that starts from a save (design
   * record 0112, section 2). The record of such a run says where it started.
   */
  readonly startTick?: number;
  /** The tables with free slots (design record 0107). */
  readonly slots?: { readonly [K in keyof T]?: Slots<T[K][number]> };
  /** One tick. The simulation waits for the promise it returns. */
  tick(tables: Frame<T, B>, time: TickTime): void | Promise<void>;
}

/** One input the simulation applied, with the tick at which it was applied. */
export interface SimInput {
  readonly tick: number;
  readonly table: string;
  readonly index: number;
  readonly fields: InputObject;
}

/** The record of a run of a simulation, version 1. */
export interface SimRecord {
  readonly version: 1;
  readonly seed: number;
  readonly hz: number;
  /** The tick at which the run stopped. It counts from tick 0, also for a run from a save. */
  readonly ticks: number;
  /** Only in the record of a run that started from a save: the tick of the save (record 0112). */
  readonly from?: number;
  readonly inputs: readonly SimInput[];
}

/** The shape of `Sim.snapshot()`, version 1. */
export interface SimSnapshot {
  readonly version: 1;
  readonly tick: number;
  readonly seed: number;
  readonly hz: number;
  readonly tables: readonly {
    readonly name: string;
    readonly rows: readonly { readonly [field: string]: SnapshotValue }[];
  }[];
}

/** A copy of a row: a new instance of its class where it has one, with the row's fields. */
function copyRow<R extends object>(row: R): R {
  const cls = (row as { constructor?: unknown }).constructor;
  const copy: object =
    typeof cls === 'function' && cls !== Object ? new (cls as new () => object)() : {};
  for (const [field, value] of Object.entries(row)) {
    (copy as Record<string, unknown>)[field] =
      typeof value === 'object' && value !== null ? structuredClone(value) : value;
  }
  return copy as R;
}

/** A value as a plain value that JSON holds: a number that JSON cannot hold is its text. */
export function snapshotValue(value: unknown): SnapshotValue {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) return formatValue(value);
    return value;
  }
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Array.from(value as ArrayLike<unknown>, snapshotValue);
  }
  if (typeof value === 'object' && value !== null) {
    const out: { [field: string]: SnapshotValue } = {};
    for (const [field, v] of Object.entries(value)) out[field] = snapshotValue(v);
    return out;
  }
  return String(value);
}

/** A game on the raw structure that runs. Make one with `createSim`. */
export class Sim<T extends SimTables, B extends keyof T = never> {
  /** The seed the simulation was built with. */
  readonly seed: number;
  /** The tick rate the simulation was built with. */
  readonly hz: number;
  /** The time of one tick: `1 / hz` rounded to `f32`. */
  readonly dt: number;
  /** The names of the tables, in the order they were given. */
  readonly names: readonly string[];

  #tick = 0;
  readonly #from: number | undefined;
  /** The end of the work in hand: a tick or a read of the tables. The next one waits for it. */
  #work: Promise<void> = Promise.resolve();
  #queued = 0;
  readonly #options: SimOptions<T, B>;
  readonly #device: Device;
  readonly #read = new Map<string, Resident<object[]>>();
  readonly #write = new Map<string, Resident<object[]>>();
  /** What the check of an input needs of each table: its row count, a copy of a row, its class. */
  readonly #shape = new Map<string, { length: number; sample: object; className: string }>();
  readonly #slots = new Map<string, Slots<object>>();
  #queue: { table: string; index: number; fields: InputObject }[] = [];
  readonly #applied: SimInput[] = [];

  /** @internal Use `createSim`. */
  constructor(tables: T, options: SimOptions<T, B>) {
    const { seed, hz = 60, device } = options ?? ({} as SimOptions<T, B>);
    if (typeof device !== 'object' || device === null || typeof device.array !== 'function') {
      throw new TypeError(
        "createSim(): the options hold no device. Give a device of the compiler's runtime, for example { device: await createDevice({ prefer: ['cpu'] }) }.",
      );
    }
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError(
        `createSim(): the seed is ${String(seed)}. Give an integer from 0 to 4294967295, for example { seed: 1 }.`,
      );
    }
    if (!Number.isInteger(hz) || hz < 1) {
      throw new RangeError(
        `createSim(): hz is ${String(hz)}. Give the tick rate as an integer from 1, for example { hz: 60 }.`,
      );
    }
    if (typeof options.tick !== 'function') {
      throw new TypeError(
        'createSim(): the options hold no tick. Give the function that runs one tick, for example { tick: (t) => tick(t.cells) }.',
      );
    }
    const { startTick } = options;
    if (startTick !== undefined && (!Number.isInteger(startTick) || startTick < 0)) {
      throw new RangeError(
        `createSim(): startTick is ${String(startTick)}. Give an integer from 0, for example { startTick: 50 }.`,
      );
    }
    this.#tick = startTick ?? 0;
    this.#from = startTick;
    this.seed = seed;
    this.hz = hz;
    this.dt = Math.fround(1 / hz);
    this.#options = options;
    this.#device = device;
    this.names = Object.freeze(Object.keys(tables));
    for (const [name, slots] of Object.entries(options.slots ?? {})) {
      if (!this.names.includes(name)) {
        throw new TypeError(
          `createSim(): slots names ${JSON.stringify(name)}, which is no table. The tables are ${this.names.join(', ')}.`,
        );
      }
      const given = slots as Slots<object> | undefined;
      if (
        typeof given !== 'object' ||
        given === null ||
        !Number.isInteger(given.size) ||
        typeof given.free !== 'function'
      ) {
        throw new TypeError(
          `createSim(): the slots of ${JSON.stringify(name)} need a size and a function free, for example { size: 16, free: (row) => row.kind === 0 }.`,
        );
      }
      this.#slots.set(name, given);
    }
    const built = new Map<string, object[]>();
    for (const name of this.names) {
      const rows = tables[name];
      if (!Array.isArray(rows)) {
        throw new TypeError(
          `createSim(): the table ${JSON.stringify(name)} is not an array. Give each table its first rows as an array.`,
        );
      }
      if (rows.length === 0) {
        throw new RangeError(
          `createSim(): the table ${JSON.stringify(name)} has no row. Give each table one row or more.`,
        );
      }
      const first = rows[0];
      const className =
        (first as { constructor?: { name?: string } }).constructor?.name || 'the row';
      this.#shape.set(name, {
        length: this.#slots.get(name)?.size ?? rows.length,
        sample: structuredClone(first),
        className,
      });
      // The device keeps a copy, so a later change to the caller's rows does not reach it.
      const slots = this.#slots.get(name);
      const all: object[] = [...rows];
      if (slots !== undefined) {
        if (rows.length > slots.size) {
          throw new RangeError(
            `createSim(): the table ${JSON.stringify(name)} has ${rows.length} rows, and its slots are ${slots.size}. Give more slots or fewer rows.`,
          );
        }
        const cls = (first as { constructor?: unknown }).constructor;
        if (rows.length < slots.size && (typeof cls !== 'function' || cls === Object)) {
          throw new TypeError(
            `createSim(): the rows of ${JSON.stringify(name)} have no class, so the simulation cannot make a free row. Give rows of a class.`,
          );
        }
        while (all.length < slots.size) {
          const added = new (cls as new () => object)();
          if (!slots.free(added)) {
            throw new TypeError(
              `createSim(): a new row of the class ${className} is not free, in the table ${JSON.stringify(name)}. The function free must be true for a row with the class's first values.`,
            );
          }
          all.push(added);
        }
      }
      const copies = all.map((row, index) => {
        const copy = copyRow(row) as { seed?: unknown };
        // Design: 0106, section 1. A row with `seed` 0 gets a seed from the run's seed and its path.
        if (Object.hasOwn(copy, 'seed') && copy.seed === 0) {
          copy.seed = nodeSeed(seed, `${name}[${index}]`);
        }
        return copy;
      });
      built.set(name, copies);
      this.#read.set(name, device.array(copies) as Resident<object[]>);
    }
    for (const name of options.buffered ?? []) {
      if (!this.#read.has(name as string)) {
        throw new TypeError(
          `createSim(): buffered names ${JSON.stringify(name)}, which is no table. The tables are ${this.names.join(', ')}.`,
        );
      }
      const rows = built.get(name as string)!;
      this.#write.set(name as string, device.array(rows.map(copyRow)) as Resident<object[]>);
    }
  }

  /** The number of inputs that wait for the next tick. */
  get pending(): number {
    return this.#queue.length;
  }

  /** The number of ticks run, an integer from 0. */
  get tick(): number {
    return this.#tick;
  }

  #handle(where: string, name: string): Resident<object[]> {
    const handle = this.#read.get(name);
    if (handle === undefined) {
      throw new TypeError(
        `${where}: the simulation holds no table ${JSON.stringify(name)}. Its tables are ${this.names.join(', ')}.`,
      );
    }
    return handle;
  }

  /**
   * The handle of a table as it is after the last tick. A draw takes it, and reads the table
   * where it is on the device.
   */
  table<K extends keyof T & string>(name: K): Resident<T[K]> {
    return this.#handle('Sim.table()', name) as Resident<T[K]>;
  }

  /** The rows of a table, read from the device. On a GPU tier the promise waits for the device. */
  read<K extends keyof T & string>(name: K): Promise<T[K]> {
    return this.#handle('Sim.read()', name).read() as Promise<T[K]>;
  }

  /** Resolves when the device has run every call made so far. */
  wait(): Promise<void> {
    return this.#device.wait();
  }

  /** Resolves when the tick in work, and each tick or read that was asked for before it, is done. */
  idle(): Promise<void> {
    return this.#exclusive(async () => {});
  }

  /**
   * Runs `n` ticks, 1 when `n` is not given. One tick applies the queued inputs in the order
   * they were given, calls the tick function and waits for what it returns, swaps the two
   * handles of each buffered table, then adds 1 to `tick`. On a GPU tier the promise resolves
   * when the ticks are queued. `wait()` resolves when the device has run them.
   */
  async step(n = 1): Promise<void> {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(
        `Sim.step(): n is ${String(n)}. Give the number of ticks as an integer from 0.`,
      );
    }
    return this.#exclusive(() => this.#run(n));
  }

  /**
   * Runs `job` when the work in hand is done. A job that finds no work in hand starts at once.
   * A tick and a read of the tables never overlap, so a read sees the state between two ticks
   * (design record 0112, section 2).
   */
  #exclusive<V>(job: () => Promise<V>): Promise<V> {
    const idle = this.#queued === 0;
    this.#queued++;
    const run = idle ? job() : this.#work.then(job);
    const done = () => {
      this.#queued--;
    };
    this.#work = run.then(done, done);
    return run;
  }

  async #run(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      if (this.#queue.length > 0) {
        const queue = this.#queue;
        this.#queue = [];
        // One read and one whole write for each table that has an input in this tick. The
        // compiler has no write of one row of a handle yet.
        const rows = new Map<string, Record<string, unknown>[]>();
        for (const input of queue) {
          let table = rows.get(input.table);
          if (table === undefined) {
            table = (await this.#read.get(input.table)!.read()) as Record<string, unknown>[];
            rows.set(input.table, table);
          }
          const row = table[input.index];
          applyFields(row, input.fields);
          this.#applied.push(Object.freeze({ tick: this.#tick, ...input }));
        }
        for (const [name, table] of rows) this.#read.get(name)!.write(table);
      }
      const frame: Record<string, unknown> = {};
      for (const name of this.names) {
        const write = this.#write.get(name);
        const read = this.#read.get(name)!;
        frame[name] = write === undefined ? read : Object.freeze({ read, write });
      }
      await this.#options.tick(frame as Frame<T, B>, { dt: this.dt, tick: this.#tick });
      for (const [name, write] of this.#write) {
        this.#write.set(name, this.#read.get(name)!);
        this.#read.set(name, write);
      }
      this.#tick++;
    }
  }

  /**
   * Gives the simulation an input: a write of field values to one row. The simulation checks it
   * now, applies it at the start of the next tick that runs, and records it with that tick. It
   * is the same on each tier.
   */
  input(table: keyof T & string, index: number, fields: InputObject): void {
    this.#handle('Sim.input()', table);
    const shape = this.#shape.get(table)!;
    if (!Number.isInteger(index) || index < 0 || index >= shape.length) {
      throw new RangeError(
        `Sim.input(): the index is ${String(index)}, and the table ${JSON.stringify(table)} has ${shape.length} rows. Give an integer from 0 to ${shape.length - 1}.`,
      );
    }
    const checked = checkFields(
      'Sim.input()',
      `${table}[${index}]`,
      shape.className,
      shape.sample,
      fields,
    );
    this.#queue.push({ table, index, fields: checked });
  }

  /** The record of the run so far: a copy that JSON holds. */
  record(): SimRecord {
    return {
      version: 1,
      seed: this.seed,
      hz: this.hz,
      ticks: this.#tick,
      ...(this.#from === undefined ? {} : { from: this.#from }),
      inputs: this.#applied.map((input) => ({ ...input, fields: structuredClone(input.fields) })),
    };
  }

  /** The simulation as text: a header, then each table's name and one line for each row. */
  async dump(): Promise<string> {
    const lines = [`tick ${this.#tick}  seed ${this.seed}  hz ${this.hz}`];
    for (const name of this.names) {
      const rows = await this.#read.get(name)!.read();
      const slots = this.#slots.get(name);
      // Design: 0107, section 2. A table with slots shows its count and no free row.
      const shown = rows.map((row) => slots === undefined || !slots.free(row));
      lines.push(
        slots === undefined ? name : `${name}  ${shown.filter(Boolean).length} of ${slots.size}`,
      );
      rows.forEach((row, index) => {
        if (!shown[index]) return;
        const parts = [`[${index}]`];
        for (const [field, value] of Object.entries(row))
          parts.push(`${field} ${formatValue(value)}`);
        lines.push('  ' + parts.join('  '));
      });
    }
    return lines.join('\n') + '\n';
  }

  /**
   * The simulation as a plain object that JSON holds, read from the device. It waits for the
   * tick in work, so it reads the state between two ticks.
   */
  snapshot(): Promise<SimSnapshot> {
    return this.#exclusive(() => this.#snapshot());
  }

  async #snapshot(): Promise<SimSnapshot> {
    const tables: { name: string; rows: { [field: string]: SnapshotValue }[] }[] = [];
    for (const name of this.names) {
      const rows = await this.#read.get(name)!.read();
      tables.push({
        name,
        rows: rows.map((row) => snapshotValue(row) as { [field: string]: SnapshotValue }),
      });
    }
    return { version: 1, tick: this.#tick, seed: this.seed, hz: this.hz, tables };
  }
}

/** Builds a simulation from the first rows of its tables, on the device. It is at tick 0. */
export function createSim<T extends SimTables, B extends keyof T = never>(
  tables: T,
  options: SimOptions<T, B>,
): Sim<T, B> {
  return new Sim(tables, options);
}
