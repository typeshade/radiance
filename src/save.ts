// Design: 0112, sections 1 and 2. A save is a plain value that JSON holds: the state tables of a
// run by the names of their fields. This file is the runtime side. It checks a save against a
// game and turns its rows back into rows of the game's classes. It reads no browser interface
// and no file.

/** The save of a run (design record 0112, section 1). It is JSON. */
export interface Save {
  /** The engine's format of a save. */
  readonly format: 1;
  /** The name of the config. */
  readonly game: string;
  /** The game's version of its state, from the config. */
  readonly version: number;
  readonly tick: number;
  readonly seed: number;
  readonly hz: number;
  readonly values: { readonly [name: string]: number };
  readonly tables: readonly { readonly name: string; readonly rows: readonly object[] }[];
}

/** What a save is checked against: the game's name, its version and its state tables. */
export interface SaveShape {
  readonly game: string;
  readonly version: number;
  readonly tables: readonly {
    readonly name: string;
    readonly className: string;
    /** The names of the fields of a row, in the order of the class. */
    readonly fields: readonly string[];
  }[];
}

/** The text of a value that JSON holds, for a message: short, and in one line. */
function show(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Refuses a `level` or a `seed` that comes with a save: a save holds both (design record 0112,
 * section 2). `given` names each option that the caller gave.
 */
export function checkNoLevel(where: string, given: readonly string[]): void {
  if (given.length === 0) return;
  const names = given.map((name) => JSON.stringify(name)).join(' and ');
  throw new TypeError(
    `${where}: the options give "from" and ${names}. A save holds the tables, the seed and the values of its run. Give "from" alone to go on with the save, or leave "from" out to start a new run.`,
  );
}

/**
 * Checks a save against a game. It throws a `TypeError` with the fact and a remedy when the
 * save is of another game, has a format that this engine does not know, has a later version,
 * or has other tables or fields than the game.
 */
export function checkSave(where: string, save: unknown, shape: SaveShape): asserts save is Save {
  if (!isRecord(save)) {
    throw new TypeError(
      `${where}: the save is ${save === null ? 'null' : typeof save === 'object' ? 'a list' : `a ${typeof save}`}. Give the value that game.save() returned, or the same value after JSON.parse.`,
    );
  }
  if (save.format !== 1) {
    throw new TypeError(
      `${where}: the save has the format ${show(save.format)}. This engine reads the format 1. Start from a save that game.save() of this engine wrote, or use an engine that reads the format.`,
    );
  }
  if (save.game !== shape.game) {
    throw new TypeError(
      `${where}: the save is of the game ${show(save.game)}, and this game is ${show(shape.game)}. Start the game from a save of its own.`,
    );
  }
  const { version } = save;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new TypeError(
      `${where}: the version of the save is ${show(version)}. A version is an integer from 1. Start from a save that game.save() wrote.`,
    );
  }
  if (version > shape.version) {
    throw new TypeError(
      `${where}: the save has the version ${version}, and the game has the version ${shape.version}. A game cannot read a later version. Start from a save of the version ${shape.version} or earlier, or use the later version of the game.`,
    );
  }
  const { tick, seed, hz, values } = save;
  if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0) {
    throw new TypeError(
      `${where}: the tick of the save is ${show(tick)}. A tick is an integer from 0. Start from a save that game.save() wrote.`,
    );
  }
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new TypeError(
      `${where}: the seed of the save is ${show(seed)}. A seed is an integer from 0 to 4294967295. Start from a save that game.save() wrote.`,
    );
  }
  if (typeof hz !== 'number' || !Number.isInteger(hz) || hz < 1) {
    throw new TypeError(
      `${where}: the hz of the save is ${show(hz)}. A tick rate is an integer from 1. Start from a save that game.save() wrote.`,
    );
  }
  if (!isRecord(values)) {
    throw new TypeError(
      `${where}: the values of the save are ${show(values)}. Values are an object of numbers. Start from a save that game.save() wrote.`,
    );
  }
  if (!Array.isArray(save.tables)) {
    throw new TypeError(
      `${where}: the tables of the save are ${show(save.tables)}. Tables are a list of { name, rows }. Start from a save that game.save() wrote.`,
    );
  }
  const names = shape.tables.map((table) => table.name);
  const seen = new Set<string>();
  for (const table of save.tables as unknown[]) {
    const name = isRecord(table) ? table.name : undefined;
    const known = shape.tables.find((t) => t.name === name);
    if (!isRecord(table) || typeof name !== 'string' || !Array.isArray(table.rows)) {
      throw new TypeError(
        `${where}: an entry of the tables of the save is ${show(table)}. An entry is { name, rows }, and rows is a list. Start from a save that game.save() wrote.`,
      );
    }
    if (known === undefined) {
      throw new TypeError(
        `${where}: the save holds the table ${show(name)}, and the game's state has no such table. The tables are ${names.join(', ')}. Remove the table from the save, or start from a save of the game's version.`,
      );
    }
    if (seen.has(name)) {
      throw new TypeError(
        `${where}: the save holds the table ${show(name)} twice. Keep one entry for each table.`,
      );
    }
    seen.add(name);
    (table.rows as unknown[]).forEach((row, index) => {
      if (!isRecord(row)) {
        throw new TypeError(
          `${where}: row ${index} of the table ${show(name)} of the save is ${show(row)}. A row is an object of fields. Start from a save that game.save() wrote.`,
        );
      }
      const own = Object.keys(row);
      const extra = own.find((field) => !known.fields.includes(field));
      if (extra !== undefined) {
        throw new TypeError(
          `${where}: row ${index} of the table ${show(name)} of the save has the field ${show(extra)}, and the class ${known.className} has no such field. The fields are ${known.fields.join(', ')}. Remove the field from the save, or start from a save of the game's version.`,
        );
      }
      const lack = known.fields.find((field) => !own.includes(field));
      if (lack !== undefined) {
        throw new TypeError(
          `${where}: row ${index} of the table ${show(name)} of the save has no field ${show(lack)}, and the class ${known.className} has it. Add the field to the row, or start from a save of the game's version.`,
        );
      }
    });
  }
  const missing = names.find((name) => !seen.has(name));
  if (missing !== undefined) {
    throw new TypeError(
      `${where}: the save has no table ${show(missing)}, and the game's state has it. Add the table to the save, or start from a save that holds every table.`,
    );
  }
}

/** The numbers that a dump writes as text, and a save holds as text (design record 0100, rule 5). */
const TEXT_NUMBERS: { readonly [text: string]: number } = {
  NaN: NaN,
  Infinity: Infinity,
  '-Infinity': -Infinity,
  '-0': -0,
};

/** The number that a value of a save stands for: a number, or the text of a dump. */
export function saveNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && Object.hasOwn(TEXT_NUMBERS, value)) return TEXT_NUMBERS[value];
  return undefined;
}

/** The value of a field of a save, in the shape of the class's own value `template`. */
function restoreValue(value: unknown, template: unknown, fail: () => never): unknown {
  if (typeof template === 'number') {
    const number = saveNumber(value);
    if (number === undefined) return fail();
    return number;
  }
  if (typeof template === 'boolean') return typeof value === 'boolean' ? value : fail();
  if (Array.isArray(template) || ArrayBuffer.isView(template)) {
    if (!Array.isArray(value)) return fail();
    const list = template as unknown as ArrayLike<unknown>;
    if (value.length !== list.length) return fail();
    const items = value.map((item, i) => restoreValue(item, list[i], fail));
    return Array.isArray(template)
      ? items
      : new (template.constructor as new (items: unknown[]) => object)(items);
  }
  if (isRecord(template)) {
    if (!isRecord(value)) return fail();
    const keys = Object.keys(template);
    if (Object.keys(value).length !== keys.length) return fail();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) return fail();
      out[key] = restoreValue(value[key], template[key], fail);
    }
    return out;
  }
  return value;
}

/**
 * The rows of a table of a save, as instances of the game's class. A field gets the number
 * that a text of a dump stands for. A value of another shape than the class's is refused.
 */
export function restoreRows<R extends object>(
  where: string,
  table: string,
  cls: new () => R,
  rows: readonly object[],
): R[] {
  return rows.map((row, index) => {
    const instance = new cls();
    for (const field of Object.keys(instance)) {
      const value = (row as Record<string, unknown>)[field];
      const fail = (): never => {
        throw new TypeError(
          `${where}: the field ${show(field)} of row ${index} of the table ${show(table)} of the save holds ${show(value)}, and the class ${cls.name} has a value of another shape there. Start from a save of the game's version.`,
        );
      };
      (instance as Record<string, unknown>)[field] = restoreValue(
        value,
        (instance as Record<string, unknown>)[field],
        fail,
      );
    }
    return instance;
  });
}

// Design: 0112, section 3. The store of a page and the order of its writes.

/**
 * Where a page keeps its saves: two functions over text. A browser's store uses IndexedDB, a test
 * gives its own, and a native shell can give a store of files. The engine does not know which one
 * it has. `read` gives `undefined` for a key that holds nothing.
 */
export interface SaveStore {
  read(key: string): Promise<string | undefined>;
  write(key: string, text: string): Promise<void>;
}

/** The keys of one game's saves. */
export function saveKeys(game: string) {
  return {
    /** The latest save, under the name of the game. */
    save: game,
    /** The save before the latest one. */
    backup: `${game}.backup`,
    /** The base of the key that holds a copy of a latest save that could not be read. */
    unreadable: `${game}.unreadable`,
    /** The base of the key that holds a copy of a backup that could not be read. */
    unreadableBackup: `${game}.backup.unreadable`,
  };
}

/** The reason in text of an error that a store or a parse gave. */
function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[.\s]*$/, '');
}

/** What the page found in its store at its start. */
export interface StoreStart {
  /** The save to start from, or `undefined` to start from the config's `start`. */
  readonly save: Save | undefined;
  /** The text of that save, as the store holds it. */
  readonly text: string | undefined;
  /** What the page says: set when a save could not be read, `undefined` when all went well. */
  readonly notice: string | undefined;
  /** False when the page must not write: a save that cannot be read could not be kept. */
  readonly writable: boolean;
}

/**
 * Reads the saves of a game and chooses the one to start from. It tries the latest save and then
 * the backup, and takes the first that `accepts` (the check of the start throws a refusal). A save
 * that is there and is not taken is copied under a key of its own before anything is written, and
 * the copy keeps it. The engine never deletes a save that it cannot read.
 */
export async function readStore(
  store: SaveStore,
  game: string,
  accepts: (save: unknown) => void,
): Promise<StoreStart> {
  const keys = saveKeys(game);
  const found: { key: string; text: string | undefined; reason: string | undefined }[] = [];
  let writable = true;
  for (const key of [keys.save, keys.backup]) {
    try {
      found.push({ key, text: await store.read(key), reason: undefined });
    } catch (error) {
      // A store that cannot be read may hold a good save. The page does not overwrite it.
      writable = false;
      found.push({ key, text: undefined, reason: `the store gave an error (${reasonOf(error)})` });
    }
  }
  let taken: { save: Save; text: string; key: string } | undefined;
  for (const item of found) {
    if (item.text === undefined) continue;
    try {
      const save: unknown = JSON.parse(item.text);
      accepts(save);
      taken ??= { save: save as Save, text: item.text, key: item.key };
    } catch (error) {
      item.reason = `is not a save that this game reads (${reasonOf(error)})`;
    }
  }
  // Each text that is there and is not the one taken keeps a copy.
  const kept: string[] = [];
  const copies: [string, string][] = [
    [keys.save, keys.unreadable],
    [keys.backup, keys.unreadableBackup],
  ];
  for (const [from, base] of copies) {
    const item = found.find((f) => f.key === from)!;
    // Only a text that was refused is copied. A good backup stays where it is.
    if (item.text === undefined || item.reason === undefined) continue;
    try {
      kept.push(await copyUnder(store, base, item.text));
    } catch (error) {
      writable = false;
      item.reason = `${item.reason ?? ''} and the copy failed (${reasonOf(error)})`;
    }
  }
  const lines = found
    .filter((item) => item.reason !== undefined)
    .map((item) => `The save under the key "${item.key}" ${item.reason}.`);
  let notice: string | undefined;
  if (lines.length > 0) {
    const where =
      kept.length === 0
        ? ''
        : ` The page kept each unread save under the key ${kept.map((k) => `"${k}"`).join(' and ')}.`;
    const went =
      taken === undefined
        ? ' The page started from the level.'
        : ` The page went on from the save under the key "${taken.key}".`;
    const stop = writable ? '' : ' The page does not write a save, so that no save is lost.';
    notice = `${lines.join(' ')}${went}${where}${stop}`;
  }
  return { save: taken?.save, text: taken?.text, notice, writable };
}

/** Writes `text` under `base`, or under `base.2`, `base.3` and so on when `base` holds other text. */
async function copyUnder(store: SaveStore, base: string, text: string): Promise<string> {
  for (let n = 1; n <= 1000; n++) {
    const key = n === 1 ? base : `${base}.${n}`;
    const held = await store.read(key);
    if (held === text) return key;
    if (held === undefined) {
      await store.write(key, text);
      return key;
    }
  }
  throw new Error(`the keys of ${base} are all in use`);
}

/** What `saveWriter` keeps between two saves. */
export interface WriterState {
  /** The text of the latest save that the page read or wrote. It becomes the backup. */
  lastGood: string | undefined;
  /** False when the page must not write. */
  writable: boolean;
}

/**
 * The function that writes each save to the store. One save is two writes, in this order:
 *
 * 1. The latest good save that this page knows goes under the backup key.
 * 2. The new save goes under the key of the game.
 *
 * A write of a store is whole or it fails. After write 1, both keys hold the latest good save.
 * After write 2, the game's key holds the new save and the backup holds the one before it. A
 * failure of a write, or a page that closes between the two, leaves at least one good save that
 * `readStore` reads: the save before it, under the game's key or under the backup key. The first
 * save of a game has no save before it, so it is one write. The writes of two calls never overlap.
 */
export function saveWriter(
  store: SaveStore,
  game: string,
  state: WriterState,
): (save: Save) => Promise<void> {
  const keys = saveKeys(game);
  let chain: Promise<unknown> = Promise.resolve();
  return (save) => {
    const run = chain.then(async () => {
      if (!state.writable) return;
      const text = JSON.stringify(save);
      if (state.lastGood !== undefined) await store.write(keys.backup, state.lastGood);
      await store.write(keys.save, text);
      state.lastGood = text;
    });
    chain = run.catch(() => {});
    return run;
  };
}
