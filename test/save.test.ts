// Verifies: Design 0112.1
// Verifies: Design 0112.2
//
// A save and a start from it (design record 0112, sections 1 and 2), with a game written by hand
// on the CPU tier. The reference games run the same check in their own tests.

import { expect, test } from 'vitest';
import { Engine, type Save } from '../src/index.ts';
import { replayGame, start } from '../src/test.ts';
import { Die, Row, bump, roll, shift } from './fixtures/sim.shade.ts';

const rows = (...ns: number[]) =>
  ns.map((n) => {
    const row = new Row();
    row.n = n;
    return row;
  });

/** A game with a buffered table, a pool with row seeds, and a scratch table. */
class Game extends Engine {
  readonly tables = {
    rows: this.table(Row, { buffered: true }),
    dice: this.pool(Die, { size: 4, free: (die) => die.face === 0 }),
    marks: this.scratch(Row, { like: 'rows' }),
  };
  readonly systems = {
    shift: () => shift(this.tables.rows.next, this.tables.rows.rows),
    count: () => bump(this.tables.marks.rows, this.dt),
    roll: async () => {
      roll(this.tables.dice.rows);
      this.tables.dice.next.write(await this.tables.dice.rows.read());
    },
  };
}

const first = () => ({ seed: 7, rows: { rows: rows(1, 2, 3) }, values: { width: 3 } });

const json = <V>(value: V): V => JSON.parse(JSON.stringify(value)) as V;

test('a save holds each table of the state by the names of its fields, and no scratch table', async () => {
  const game = await start(Game, first());
  await game.step(3);
  const save = await game.save();
  expect(save.format).toBe(1);
  expect([save.game, save.version, save.tick, save.seed, save.hz]).toEqual(['Game', 1, 3, 7, 60]);
  expect(save.values).toEqual({ width: 3 });
  expect(save.tables.map((table) => table.name)).toEqual(['rows', 'dice']);
  expect(save.tables[0].rows).toEqual([
    { n: 1, x: 0 },
    { n: 2, x: 0 },
    { n: 3, x: 0 },
  ]);
  const [row] = save.tables[0].rows as { n: number; x: number }[];
  expect(Object.keys(row)).toEqual(['n', 'x']);
  expect(save.tables[1].rows).toHaveLength(4);
  await game.dispose();
});

test('a save is JSON: it equals itself after JSON.parse of JSON.stringify', async () => {
  const level = rows(1, 2, 3);
  level[0].x = Infinity;
  level[1].x = -0;
  level[2].x = NaN;
  const game = await start(Game, { seed: 7, rows: { rows: level } });
  const save = await game.save();
  expect(json(save)).toEqual(save);
  // A number that JSON cannot hold is the text that a dump uses.
  expect(save.tables[0].rows.map((row) => (row as { x: unknown }).x)).toEqual([
    'Infinity',
    '-0',
    'NaN',
  ]);
  // The text is a number again in the run that starts from the save.
  const again = await start(Game, { from: json(save) });
  const [a, b, c] = await again.tables.rows.read();
  expect([a.x, Object.is(b.x, -0), Number.isNaN(c.x)]).toEqual([Infinity, true, true]);
  expect(await again.dump()).toBe(await game.dump());
  await Promise.all([game.dispose(), again.dispose()]);
});

test('50 ticks, a save, a start from it and 50 ticks give the dump of 100 ticks', async () => {
  const whole = await start(Game, first());
  await whole.step(50);
  whole.tables.rows.input(1, { n: 40 });
  await whole.step(50);

  const half = await start(Game, first());
  await half.step(50);
  const save = json(await half.save());
  await half.dispose();
  const again = await start(Game, { from: save });
  expect([again.tick, again.seed, again.hz, again.values]).toEqual([50, 7, 60, { width: 3 }]);
  again.tables.rows.input(1, { n: 40 });
  await again.step(50);

  expect(await again.dump()).toBe(await whole.dump());
  expect(await again.snapshot()).toEqual(await whole.snapshot());
  expect((await again.tables.dice.read()).map((die) => die.seed)).toEqual(
    (await whole.tables.dice.read()).map((die) => die.seed),
  );
  await Promise.all([whole.dispose(), again.dispose()]);
});

test('a save waits for the tick in work and holds the state between two ticks', async () => {
  const game = await start(Game, first());
  const ran = game.step(5);
  const save = await game.save();
  await ran;
  expect(save.tick).toBe(5);
  const more = game.step(2);
  const next = await game.save();
  expect(next.tick).toBe(7);
  await more;
  await game.dispose();
});

test('a record of a run from a save says where it started, and replayGame needs the save', async () => {
  const half = await start(Game, first());
  await half.step(10);
  const save = json(await half.save());
  const run = await start(Game, { from: save });
  run.tables.rows.input(0, { n: 5 });
  await run.step(10);
  const record = json(run.record());
  expect([record.from, record.ticks, record.inputs.map((i) => i.tick)]).toEqual([10, 20, [10]]);
  const again = await replayGame(Game, { from: save }, record);
  expect(await again.dump()).toBe(await run.dump());
  await expect(replayGame(Game, { rows: { rows: rows(1, 2, 3) } }, record)).rejects.toThrow(
    'replayGame(): the record is of a run that started from a save at tick 10. Give the same save as "from" in the options.',
  );
  expect(half.record().from).toBeUndefined();
  await Promise.all([half.dispose(), run.dispose(), again.dispose()]);
});

test('a start from a save refuses what the save and the game do not share, with the fact and a remedy', async () => {
  const game = await start(Game, first());
  await game.step(1);
  const save = json(await game.save()) as { -readonly [K in keyof Save]: Save[K] };
  const refuse = (change: object, text: string) =>
    expect(start(Game, { from: { ...save, ...change } as Save })).rejects.toThrow(text);
  const tables = (change: (rows: { name: string; rows: object[] }[]) => unknown) =>
    ({ tables: change(json(save.tables) as { name: string; rows: object[] }[]) }) as object;

  await refuse(
    { game: 'Other' },
    'Game: the save is of the game "Other", and this game is "Game". Start the game from a save of its own.',
  );
  await refuse(
    { format: 2 },
    'Game: the save has the format 2. This engine reads the format 1. Start from a save that game.save() of this engine wrote, or use an engine that reads the format.',
  );
  await refuse(
    { version: 2 },
    'Game: the save has the version 2, and the game has the version 1. A game cannot read a later version. Start from a save of the version 1 or earlier, or use the later version of the game.',
  );
  await refuse(
    tables((t) => [...t, { name: 'cards', rows: [] }]),
    'Game: the save holds the table "cards", and the game\'s state has no such table. The tables are rows, dice. Remove the table from the save, or start from a save of the game\'s version.',
  );
  await refuse(
    tables((t) => t.filter((table) => table.name !== 'dice')),
    'Game: the save has no table "dice", and the game\'s state has it. Add the table to the save, or start from a save that holds every table.',
  );
  await refuse(
    tables((t) => {
      Object.assign(t[0].rows[2], { level: 1 });
      return t;
    }),
    'Game: row 2 of the table "rows" of the save has the field "level", and the class Row has no such field. The fields are n, x. Remove the field from the save, or start from a save of the game\'s version.',
  );
  await refuse(
    tables((t) => {
      delete (t[1].rows[0] as { face?: number }).face;
      return t;
    }),
    'Game: row 0 of the table "dice" of the save has no field "face", and the class Die has it. Add the field to the row, or start from a save of the game\'s version.',
  );
  await refuse(
    tables((t) => {
      (t[0].rows[1] as { n: unknown }).n = 'many';
      return t;
    }),
    'Game: the field "n" of row 1 of the table "rows" of the save holds "many", and the class Row has a value of another shape there. Start from a save of the game\'s version.',
  );
  await refuse(
    { tick: -1 },
    'Game: the tick of the save is -1. A tick is an integer from 0. Start from a save that game.save() wrote.',
  );
  await expect(start(Game, { from: 'text' as never })).rejects.toThrow(
    'Game: the save is a string. Give the value that game.save() returned, or the same value after JSON.parse.',
  );
  // A save of an earlier version is not refused by the check of the version.
  const later = await start(Game, { from: { ...save, version: 1 }, version: 3 });
  expect(await later.save()).toMatchObject({ version: 3 });
  await Promise.all([game.dispose(), later.dispose()]);
});

test('a start from a save refuses a level, a seed and another tick rate', async () => {
  const game = await start(Game, first());
  const save = await game.save();
  await expect(start(Game, { from: save, seed: 1 })).rejects.toThrow(
    'Game: the options give "from" and "seed". A save holds the tables, the seed and the values of its run. Give "from" alone to go on with the save, or leave "from" out to start a new run.',
  );
  await expect(
    start(Game, { from: save, rows: { rows: rows(1) }, values: { width: 1 } }),
  ).rejects.toThrow(
    'Game: the options give "from" and "rows" and "values". A save holds the tables, the seed and the values of its run. Give "from" alone to go on with the save, or leave "from" out to start a new run.',
  );
  await expect(start(Game, { from: save, hz: 30 })).rejects.toThrow(
    'Game: the save runs at 60 hz, and the options give 30 hz. A run from a save keeps its tick rate. Leave "hz" out.',
  );
  await game.dispose();
});
