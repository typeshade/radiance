// Design: 0101, sections 1 and 2, and 0105, section 2. An input is a write of field values to one node. It is data
// that JSON holds, so a record of a run is a file.

/**
 * A value an input writes: a finite number, a boolean, an array of these, or an object of
 * values for a field that holds an object (design record 0105, section 2).
 */
export type InputValue = number | boolean | readonly InputValue[] | InputObject;

/** Values by field. An object writes only the fields it names. */
export interface InputObject {
  readonly [field: string]: InputValue;
}

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

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value)
  );
}

const HOLDS =
  'An input holds a finite number, a boolean, an array of these, or an object for a field that holds an object.';

function checkObject(
  where: string,
  path: string,
  owner: string,
  sample: Record<string, unknown>,
  fields: Record<string, unknown>,
): InputObject {
  const declared = Object.keys(sample);
  const copy: { [field: string]: InputValue } = {};
  for (const [field, value] of Object.entries(fields)) {
    if (!declared.includes(field)) {
      throw new TypeError(
        `${where}: ${owner} declares no field ${JSON.stringify(field)}, at ${JSON.stringify(path)}. Its fields are ${declared.join(', ')}.`,
      );
    }
    if (isObject(value) && isObject(sample[field])) {
      const inner = `${path}.${field}`;
      copy[field] = checkObject(where, inner, `the object`, sample[field], value);
    } else if (isObject(sample[field])) {
      throw new TypeError(
        `${where}: the value of ${JSON.stringify(field)} at ${JSON.stringify(path)} is ${show(value)}, and the field holds an object. Give an object of its fields: ${Object.keys(sample[field]).join(', ')}.`,
      );
    } else if (isInputValue(value)) {
      copy[field] = Array.isArray(value) ? (structuredClone(value) as InputValue) : value;
    } else {
      throw new TypeError(
        `${where}: the value of ${JSON.stringify(field)} at ${JSON.stringify(path)} is ${show(value)}. ${HOLDS}`,
      );
    }
  }
  return Object.freeze(copy);
}

/**
 * Checks the fields of one input against a row or an instance of the node's class, and returns
 * a frozen copy. `where` starts each message, for example `World.input()`. `sample` gives the
 * fields that exist, and which of them hold an object.
 */
export function checkFields(
  where: string,
  path: string,
  className: string,
  sample: object,
  fields: unknown,
): InputObject {
  if (!isObject(fields)) {
    throw new TypeError(
      `${where}: the fields of the input at ${JSON.stringify(path)} are ${show(fields)}. Give an object of field values, for example { speed: 2 }.`,
    );
  }
  return checkObject(
    where,
    path,
    `the class ${className}`,
    sample as Record<string, unknown>,
    fields,
  );
}

/** Writes the values of an input to a row or an instance. An object writes the fields it names. */
export function applyFields(target: Record<string, unknown>, fields: InputObject): void {
  for (const [field, value] of Object.entries(fields)) {
    if (Array.isArray(value)) target[field] = structuredClone(value);
    else if (typeof value === 'object') {
      applyFields(target[field] as Record<string, unknown>, value as InputObject);
    } else target[field] = value;
  }
}
