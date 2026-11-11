// Design: 0102. A simulation runs a game on the raw structure of docs/vision.md (D11): named
// tables and one tick function. It is a tool of the tests. It reads no clock, no random source
// and no device.

import { formatValue, type SnapshotValue } from './dump.ts';
import { checkFields, type InputValue } from './input.ts';

/** The first rows of each table, by name. A row is an instance of a class. */
export type SimTables = Record<string, object[]>;

/** The two arrays of a buffered table in one tick. */
export interface Buffered<R> {
  /** The rows as the last tick left them. The tick reads this array. */
  readonly read: R;
  /** The array the tick writes. It becomes `read` in the next tick. */
  readonly write: R;
}

/** What a tick gets: each table by name, and `{ read, write }` for a buffered table. */
export type Frame<T extends SimTables, B extends keyof T> = {
  readonly [K in keyof T]: K extends B ? Buffered<T[K]> : T[K];
};

/** The time of one tick. */
export interface TickTime {
  /** `1 / hz` rounded to `f32`. The same number in every tick. */
  readonly dt: number;
  /** The number of ticks run before this one. */
  readonly tick: number;
}

/** The options of `createSim`. */
export interface SimOptions<T extends SimTables, B extends keyof T = never> {
  /** The seed of the run, a `u32`. Required: a run always has one. */
  readonly seed: number;
  /** The tick rate, an integer from 1. 60 when it is not given. */
  readonly hz?: number;
  /** The tables that a tick reads and writes through two arrays. */
  readonly buffered?: readonly B[];
  /** One tick. The simulation waits for the promise it returns. */
  tick(tables: Frame<T, B>, time: TickTime): void | Promise<void>;
}

/** One input the simulation applied, with the tick at which it was applied. */
export interface SimInput {
  readonly tick: number;
  readonly table: string;
  readonly index: number;
  readonly fields: { readonly [field: string]: InputValue };
}

/** The record of a run of a simulation, version 1. */
export interface SimRecord {
  readonly version: 1;
  readonly seed: number;
  readonly hz: number;
  readonly ticks: number;
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

function snapshotValue(value: unknown): SnapshotValue {
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
  readonly #options: SimOptions<T, B>;
  readonly #read = new Map<string, object[]>();
  readonly #write = new Map<string, object[]>();
  #queue: { table: string; index: number; fields: { readonly [field: string]: InputValue } }[] = [];
  readonly #applied: SimInput[] = [];

  /** @internal Use `createSim`. */
  constructor(tables: T, options: SimOptions<T, B>) {
    const { seed, hz = 60 } = options ?? ({} as SimOptions<T, B>);
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
    this.seed = seed;
    this.hz = hz;
    this.dt = Math.fround(1 / hz);
    this.#options = options;
    this.names = Object.freeze(Object.keys(tables));
    for (const name of this.names) {
      const rows = tables[name];
      if (!Array.isArray(rows)) {
        throw new TypeError(
          `createSim(): the table ${JSON.stringify(name)} is not an array. Give each table its first rows as an array.`,
        );
      }
      this.#read.set(name, rows.map(copyRow));
    }
    for (const name of options.buffered ?? []) {
      const rows = this.#read.get(name as string);
      if (rows === undefined) {
        throw new TypeError(
          `createSim(): buffered names ${JSON.stringify(name)}, which is no table. The tables are ${this.names.join(', ')}.`,
        );
      }
      this.#write.set(name as string, rows.map(copyRow));
    }
  }

  /** The number of ticks run, an integer from 0. */
  get tick(): number {
    return this.#tick;
  }

  #table(where: string, name: string): object[] {
    const rows = this.#read.get(name);
    if (rows === undefined) {
      throw new TypeError(
        `${where}: the simulation holds no table ${JSON.stringify(name)}. Its tables are ${this.names.join(', ')}.`,
      );
    }
    return rows;
  }

  /** The rows of a table as they are after the last tick. */
  rows<K extends keyof T & string>(name: K): T[K] {
    return this.#table('Sim.rows()', name) as T[K];
  }

  /**
   * Runs `n` ticks, 1 when `n` is not given. One tick applies the queued inputs in the order
   * they were given, calls the tick function and waits for it, swaps the two arrays of each
   * buffered table, then adds 1 to `tick`.
   */
  async step(n = 1): Promise<void> {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(
        `Sim.step(): n is ${String(n)}. Give the number of ticks as an integer from 0.`,
      );
    }
    for (let i = 0; i < n; i++) {
      if (this.#queue.length > 0) {
        const queue = this.#queue;
        this.#queue = [];
        for (const input of queue) {
          const row = this.#read.get(input.table)![input.index] as Record<string, unknown>;
          for (const [field, value] of Object.entries(input.fields)) {
            row[field] = Array.isArray(value) ? structuredClone(value) : value;
          }
          this.#applied.push(Object.freeze({ tick: this.#tick, ...input }));
        }
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
   * now, applies it at the start of the next tick that runs, and records it with that tick.
   */
  input(
    table: keyof T & string,
    index: number,
    fields: { readonly [field: string]: InputValue },
  ): void {
    const rows = this.#table('Sim.input()', table);
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
      throw new RangeError(
        `Sim.input(): the index is ${String(index)}, and the table ${JSON.stringify(table)} has ${rows.length} rows. Give an integer from 0 to ${rows.length - 1}.`,
      );
    }
    const row = rows[index];
    const className = (row as { constructor?: { name?: string } }).constructor?.name || 'the row';
    const checked = checkFields(
      'Sim.input()',
      `${table}[${index}]`,
      className,
      Object.keys(row),
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
      inputs: this.#applied.map((input) => ({ ...input, fields: structuredClone(input.fields) })),
    };
  }

  /** The simulation as text: a header, then each table's name and one line for each row. */
  dump(): string {
    const lines = [`tick ${this.#tick}  seed ${this.seed}  hz ${this.hz}`];
    for (const name of this.names) {
      lines.push(name);
      this.#read.get(name)!.forEach((row, index) => {
        const parts = [`[${index}]`];
        for (const [field, value] of Object.entries(row))
          parts.push(`${field} ${formatValue(value)}`);
        lines.push('  ' + parts.join('  '));
      });
    }
    return lines.join('\n') + '\n';
  }

  /** The simulation as a plain object: a copy, so a later tick does not change it. */
  snapshot(): SimSnapshot {
    return {
      version: 1,
      tick: this.#tick,
      seed: this.seed,
      hz: this.hz,
      tables: this.names.map((name) => ({
        name,
        rows: this.#read
          .get(name)!
          .map((row) => snapshotValue(row) as { [field: string]: SnapshotValue }),
      })),
    };
  }
}

/** Builds a simulation from the first rows of its tables. The simulation is at tick 0. */
export function createSim<T extends SimTables, B extends keyof T = never>(
  tables: T,
  options: SimOptions<T, B>,
): Sim<T, B> {
  return new Sim(tables, options);
}
