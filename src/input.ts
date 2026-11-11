// Design: 0101, sections 1 and 2. An input is a write of field values to one node. It is data
// that JSON holds, so a record of a run is a file.

/** A value an input writes: a finite number, a boolean, or an array of these. */
export type InputValue = number | boolean | readonly InputValue[];

/** One input the world applied, with the tick at which it was applied. */
export interface AppliedInput {
  /** The value of `world.tick` before the tick that applied the input. */
  readonly tick: number;
  /** The path of the node. */
  readonly path: string;
  /** The values written, by field. */
  readonly fields: { readonly [field: string]: InputValue };
}

/** The record of a run, version 1 (design record 0101, section 2). */
export interface RunRecord {
  readonly version: 1;
  readonly seed: number;
  readonly hz: number;
  /** The number of ticks the run had made when the record was taken. */
  readonly ticks: number;
  /** Each applied input, in the order the world applied them. */
  readonly inputs: readonly AppliedInput[];
}

function isInputValue(value: unknown): value is InputValue {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isInputValue);
  return false;
}

function show(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return 'a function';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Checks the fields of one input against the fields of the node's class, and returns a frozen
 * copy. `where` starts each message, for example `World.input()`.
 */
export function checkFields(
  where: string,
  path: string,
  className: string,
  declared: readonly string[],
  fields: unknown,
): { readonly [field: string]: InputValue } {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new TypeError(
      `${where}: the fields of the input at ${JSON.stringify(path)} are ${show(fields)}. Give an object of field values, for example { speed: 2 }.`,
    );
  }
  const copy: { [field: string]: InputValue } = {};
  for (const [field, value] of Object.entries(fields)) {
    if (!declared.includes(field)) {
      throw new TypeError(
        `${where}: the class ${className} declares no field ${JSON.stringify(field)}, at ${JSON.stringify(path)}. Its fields are ${declared.join(', ')}.`,
      );
    }
    if (!isInputValue(value)) {
      throw new TypeError(
        `${where}: the value of ${JSON.stringify(field)} at ${JSON.stringify(path)} is ${show(value)}. An input holds a finite number, a boolean, or an array of these.`,
      );
    }
    copy[field] = Array.isArray(value) ? (structuredClone(value) as InputValue) : value;
  }
  return Object.freeze(copy);
}
