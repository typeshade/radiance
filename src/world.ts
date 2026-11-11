// Design: 0100, section 3. A world holds one table for each class of a scene and runs a fixed
// tick on the CPU tier. It reads no clock, no random source and no device (invariants 2 and 3).

import { dump, snapshot, type Snapshot } from './dump.ts';
import type { NodeClass, Scene, SceneNode } from './node.ts';

/** The options of `createWorld`. */
export interface WorldOptions {
  /** The seed of the run, a `u32`. Required: a run always has one. */
  readonly seed: number;
  /** The tick rate, an integer from 1. 60 when it is not given. */
  readonly hz?: number;
}

/** One row of a table: a node of the scene and the instance the world built for it. */
export interface Row<T extends object = object> {
  /** The node of the scene. */
  readonly node: SceneNode;
  /** The instance of the node's class. */
  readonly instance: T;
}

/** One table: every row of one class, in the order the scene visits its nodes. */
export interface Table<T extends object = object> {
  /** The class of the rows. */
  readonly cls: NodeClass<T>;
  /** The rows, in visit order. */
  readonly rows: readonly Row<T>[];
}

interface Stepper {
  step(dt: number): void;
}

function hasStep(instance: object): instance is Stepper {
  return typeof (instance as Partial<Stepper>).step === 'function';
}

/** A scene that runs. Make one with `createWorld`. */
export class World {
  /** The scene the world was built from. */
  readonly scene: Scene;
  /** The seed the world was built with. */
  readonly seed: number;
  /** The tick rate the world was built with. */
  readonly hz: number;
  /** The time of one tick: `1 / hz` rounded to `f32`. The same number in every tick. */
  readonly dt: number;
  /** The tables, in schedule order: the order in which the scene first meets each class. */
  readonly tables: readonly Table[];

  #tick = 0;
  readonly #byClass = new Map<NodeClass, Table>();
  readonly #byPath = new Map<string, object>();

  /** @internal Use `createWorld`. */
  constructor(scene: Scene, options: WorldOptions) {
    const { seed, hz = 60 } = options ?? ({} as WorldOptions);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError(
        `createWorld(): the seed is ${String(seed)}. Give an integer from 0 to 4294967295, for example { seed: 1 }.`,
      );
    }
    if (!Number.isInteger(hz) || hz < 1) {
      throw new RangeError(
        `createWorld(): hz is ${String(hz)}. Give the tick rate as an integer from 1, for example { hz: 60 }.`,
      );
    }
    this.scene = scene;
    this.seed = seed;
    this.hz = hz;
    this.dt = Math.fround(1 / hz);

    const rows = new Map<NodeClass, Row[]>();
    const tables: Table[] = [];
    for (const node of scene.nodes) {
      if (node.cls === undefined) continue;
      const instance = new node.cls();
      Object.assign(instance, node.fields);
      let list = rows.get(node.cls);
      if (list === undefined) {
        list = [];
        rows.set(node.cls, list);
        const table: Table = { cls: node.cls, rows: list };
        tables.push(table);
        this.#byClass.set(node.cls, table);
      }
      list.push(Object.freeze({ node, instance }));
      this.#byPath.set(node.path, instance);
    }
    this.tables = Object.freeze(tables);
  }

  /** The number of ticks run, an integer from 0. */
  get tick(): number {
    return this.#tick;
  }

  /**
   * Runs `n` ticks, 1 when `n` is not given. One tick calls `step(dt)` on each row of each
   * table that declares it, tables in schedule order and rows in visit order, then adds 1 to
   * `tick`.
   */
  step(n = 1): void {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(
        `World.step(): n is ${String(n)}. Give the number of ticks as an integer from 0.`,
      );
    }
    const dt = this.dt;
    for (let i = 0; i < n; i++) {
      for (const table of this.tables) {
        for (const row of table.rows) {
          if (hasStep(row.instance)) row.instance.step(dt);
        }
      }
      this.#tick++;
    }
  }

  /** The instances of a class, in visit order. A class the scene does not hold throws. */
  table<T extends object>(cls: NodeClass<T>): readonly T[] {
    const table = this.#byClass.get(cls);
    if (table === undefined) {
      const known = this.tables.map((t) => t.cls.name).join(', ');
      throw new TypeError(
        `World.table(): the scene holds no node of the class ${cls.name}. Its classes are ${known || '(none)'}.`,
      );
    }
    return table.rows.map((row) => row.instance) as T[];
  }

  /** The instance at a path, or `undefined` for a group or a path the scene does not hold. */
  find<T extends object = object>(path: string): T | undefined {
    return this.#byPath.get(path) as T | undefined;
  }

  /** The world as text: a header, then one line for each node (design record 0100, section 4). */
  dump(): string {
    return dump(this);
  }

  /** The world as a plain object that JSON holds (design record 0100, section 5). */
  snapshot(): Snapshot {
    return snapshot(this);
  }
}

/** Builds a world from a scene. The world is at tick 0. */
export function createWorld(scene: Scene, options: WorldOptions): World {
  return new World(scene, options);
}
