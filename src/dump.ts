// Design: 0100, sections 4 and 5. The dump is the world as text, for an agent to read. The
// snapshot is the world as a plain object that JSON holds. Both read the world and change
// nothing.

import type { World } from './world.ts';

/** The text of one number (design record 0100, section 4, rule 5). */
export function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (Object.is(value, -0)) return '-0';
  // An integer is printed in full: a `u32` and an `f32` reach the host as the same kind of
  // number, and the shortest f32 text of a large `u32` is not that integer.
  if (Number.isInteger(value)) return BigInt(value).toString();
  // Any other number: the shortest decimal text that reads back to the same f32.
  const target = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = Number(target.toPrecision(digits));
    if (Math.fround(text) === target) return String(text);
  }
  return String(value);
}

function isList(value: unknown): value is ArrayLike<unknown> {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

/** The text of one field's value (rules 5 to 8). */
export function formatValue(value: unknown): string {
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  if (isList(value)) return `(${Array.from(value, formatValue).join(', ')})`;
  if (typeof value === 'object' && value !== null) {
    const parts = Object.keys(value).map(
      (key) => `${key} ${formatValue((value as Record<string, unknown>)[key])}`,
    );
    return `{${parts.join(', ')}}`;
  }
  return String(value);
}

/** The world as text: one header line, then one line for each node, in visit order. */
export function dump(world: World): string {
  const lines = [`tick ${world.tick}  seed ${world.seed}  hz ${world.hz}`];
  for (const node of world.scene.nodes) {
    const parts = [node.name];
    if (node.cls !== undefined) {
      if (node.named) parts.push(node.cls.name);
      const instance = world.find(node.path) as Record<string, unknown>;
      for (const field of Object.keys(instance)) {
        parts.push(`${field} ${formatValue(instance[field])}`);
      }
    }
    lines.push('  '.repeat(node.depth) + parts.join('  '));
  }
  return lines.join('\n') + '\n';
}

/** A value of a snapshot: what `JSON.stringify` accepts. */
export type SnapshotValue =
  | number
  | string
  | boolean
  | readonly SnapshotValue[]
  | { readonly [field: string]: SnapshotValue };

/** The shape of `World.snapshot()`, version 1 (design record 0100, section 5). */
export interface Snapshot {
  readonly version: 1;
  readonly tick: number;
  readonly seed: number;
  readonly hz: number;
  readonly tables: readonly {
    readonly class: string;
    readonly rows: readonly {
      readonly path: string;
      readonly fields: { readonly [field: string]: SnapshotValue };
    }[];
  }[];
}

function snapshotValue(value: unknown): SnapshotValue {
  if (typeof value === 'number') {
    // JSON holds no NaN, no infinity and no -0: each is the string of dump rule 5.
    if (!Number.isFinite(value) || Object.is(value, -0)) return formatNumber(value);
    return value;
  }
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (isList(value)) return Array.from(value, snapshotValue);
  if (typeof value === 'object' && value !== null) return snapshotFields(value);
  return String(value);
}

function snapshotFields(instance: object): { [field: string]: SnapshotValue } {
  const fields: { [field: string]: SnapshotValue } = {};
  for (const field of Object.keys(instance)) {
    fields[field] = snapshotValue((instance as Record<string, unknown>)[field]);
  }
  return fields;
}

/** The world as a plain object: a copy, so a later tick does not change it. */
export function snapshot(world: World): Snapshot {
  return {
    version: 1,
    tick: world.tick,
    seed: world.seed,
    hz: world.hz,
    tables: world.tables.map((table) => ({
      class: table.cls.name,
      rows: table.rows.map((row) => ({
        path: row.node.path,
        fields: snapshotFields(row.instance),
      })),
    })),
  };
}
