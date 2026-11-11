// Verifies: Design 0108.5
// Verifies: Design 0108.6
// Verifies: Design 0108.9
//
// The engine as a class and the runtime (design record 0108), with a game written by hand. The
// device is the CPU tier, and the engine opens it.

import { expect, test } from 'vitest';
import { Engine } from '../src/index.ts';
import { replayGame, start } from '../src/test.ts';
import { Die, Row, bump, roll, shift } from './fixtures/sim.shade.ts';

const rows = (...ns: number[]) =>
  ns.map((n) => {
    const row = new Row();
    row.n = n;
    return row;
  });

/** A game with one table of each kind and three systems. */
class Game extends Engine {
  readonly tables = {
    rows: this.table(Row, { buffered: true }),
    dice: this.pool(Die, { size: 4, free: (die) => die.face === 0 }),
    marks: this.scratch(Row, { like: 'rows' }),
    // A name that the engine also has is the game's own here.
    tick: this.scratch(Row, { size: 1 }),
  };
  readonly order: string[] = [];

  readonly systems = {
    shift: () => {
      this.order.push('shift');
      return shift(this.tables.rows.next, this.tables.rows.rows);
    },
    count: () => {
      this.order.push('count');
      return bump(this.tables.marks.rows, this.dt);
    },
    // A system can have a name that the engine also has.
    step: async () => {
      this.order.push('step');
      // The pool is buffered. This system changes it in place and gives the same rows on.
      roll(this.tables.dice.rows);
      this.tables.dice.next.write(await this.tables.dice.rows.read());
    },
  };
}

const first = () => ({ seed: 7, rows: { rows: rows(1, 2, 3) } });

test('the systems run in the order of the class, and a buffered table swaps', async () => {
  const game = await start(Game, first());
  await game.step(2);
  expect(game.order).toEqual(['shift', 'count', 'step', 'shift', 'count', 'step']);
  expect((await game.tables.rows.read()).map((r) => r.n)).toEqual([3, 1, 2]);
  expect(game.tick).toBe(2);
  expect([game.seed, game.hz, game.tier]).toEqual([7, 60, 'cpu']);
  await game.dispose();
});

test('a pool gets its free rows, a scratch table has the rows of its table, and each has a seed', async () => {
  const game = await start(Game, first());
  expect(game.memory()).toEqual([
    { name: 'rows', kind: 'table', rows: 3, arrays: 2 },
    { name: 'dice', kind: 'pool', rows: 4, arrays: 2 },
    { name: 'marks', kind: 'scratch', rows: 3, arrays: 1 },
    { name: 'tick', kind: 'scratch', rows: 1, arrays: 1 },
  ]);
  const dice = await game.tables.dice.read();
  expect(dice.every((die) => die.seed !== 0)).toBe(true);
  expect(new Set(dice.map((die) => die.seed)).size).toBe(4);
  expect((await game.tables.marks.read()).length).toBe(3);
  await game.dispose();
});

test('the dump has no scratch table, and a record replays to the same dump', async () => {
  const game = await start(Game, first());
  await game.step(1);
  game.tables.rows.input(0, { n: 9 });
  await game.step(2);
  const text = await game.dump();
  expect(text.split('\n').filter((line) => !line.startsWith('  '))).toEqual([
    'tick 3  seed 7  hz 60',
    'rows',
    // Each die has a face after the first roll, so no slot is free.
    'dice  4 of 4',
    '',
  ]);
  expect((await game.tables.marks.read()).map((r) => r.n)).toEqual([3, 3, 3]);
  const again = await replayGame(Game, { rows: { rows: rows(1, 2, 3) } }, game.record());
  expect(await again.dump()).toBe(text);
  await game.dispose();
  await again.dispose();
});

test('dispose frees the game, and a later call is an error', async () => {
  const game = await start(Game, first());
  const handle = game.tables.rows.rows;
  await game.dispose();
  await game.dispose();
  expect(() => game.step(1)).toThrow(
    'Game.step(): the game is disposed. Start a new game to run it again.',
  );
  expect(() => game.tables.rows.read()).toThrow('Game.tables.rows.read(): the game is disposed.');
  await expect(handle.read()).rejects.toThrow();
});

test('the refusals name the class, the field, the fact and a remedy', async () => {
  class Empty extends Engine {
    readonly tables = { rows: this.table(Row) };
    readonly systems = {};
  }
  await expect(start(Empty, { seed: 1, rows: { rows: rows(1) } })).rejects.toThrow(
    'Empty: the game has no system. Give each step of a tick a name in "systems", for example "readonly systems = { move: () => move(this.tables.cells.rows) };".',
  );
  class Wrong extends Engine {
    readonly tables = { rows: 5 as never };
    readonly systems = { none: () => {} };
  }
  await expect(start(Wrong, { seed: 1 })).rejects.toThrow(
    'Wrong.tables.rows: the value is no table. Declare it with this.table, this.pool or this.scratch.',
  );
  await expect(start(Game, { seed: 7 })).rejects.toThrow(
    'Game.tables.rows: the table has no first row. Give its rows at the start, for example { rows: { rows: [...] } }.',
  );
  await expect(start(Game, { seed: 7, rows: { rows: rows(1), cards: [] } })).rejects.toThrow(
    'Game: the first rows name "cards", which is no table of the game\'s state. The tables are rows, dice.',
  );
  const five = [1, 2, 3, 4, 5].map(() => new Die());
  await expect(start(Game, { seed: 7, rows: { rows: rows(1), dice: five } })).rejects.toThrow(
    'Game.tables.dice: the first rows are 5, and the pool has 4 slots. Give more slots or fewer rows.',
  );

  class Plain extends Engine {
    readonly tables = { rows: this.table(Row), marks: this.scratch(Row, { size: 2 }) };
    readonly systems = { bump: () => bump(this.tables.rows.rows, this.dt) };
  }
  const unstarted = new Plain();
  expect(() => unstarted.tables.rows.rows).toThrow(
    'Rows.rows: the game has not started, so the table has no array yet. Read a table in a system or after the start.',
  );
  expect(() => unstarted.step()).toThrow(
    'Plain.step(): the game has not started. Start it with start() of radiance/test or run() of radiance/page.',
  );
  const plain = await start(Plain, { seed: 1, rows: { rows: rows(1) } });
  expect(() => plain.tables.rows.next).toThrow(
    'Plain.tables.rows.next: the table is not buffered, so it has one array. Declare it with { buffered: true }, or write it through "rows".',
  );
  expect(() => plain.tables.marks.input(0, { n: 1 })).toThrow(
    "Plain.tables.marks.input(): a scratch table is no state, so it takes no input. Give the input to a table of the game's state.",
  );
  await plain.step(1);
  expect((await plain.tables.rows.read())[0].n).toBe(2);
  await plain.dispose();

  const game = await start(Game, first());
  expect(() => game.tables.rows.next).toThrow(
    'Game.tables.rows.next: "next" is the array a tick writes. Read it in a system.',
  );
  await game.dispose();
});
