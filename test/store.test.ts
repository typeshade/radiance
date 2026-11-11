// Verifies: Design 0112.3
//
// The page keeps the save (design record 0112, section 3), with a store, a clock and a canvas
// that the test gives. The device is the CPU tier, so no browser runs.

import { createDevice } from 'typeshade/runtime';
import { expect, test } from 'vitest';
import { Engine } from '../src/index.ts';
import { run, type SaveStore } from '../src/page.ts';
import { readStore, saveKeys, saveWriter, type Save, type WriterState } from '../src/save.ts';
import { Row, bump } from './fixtures/sim.shade.ts';

/** A store in memory. `fail` says which write throws, counted from 1, and how. */
class MemoryStore implements SaveStore {
  readonly map = new Map<string, string>();
  writes = 0;
  fail: { at: number; torn: boolean } | undefined;
  failReads = false;
  async read(key: string) {
    if (this.failReads) throw new Error('the disk is gone');
    return this.map.get(key);
  }
  async write(key: string, text: string) {
    this.writes++;
    if (this.fail?.at === this.writes) {
      // A torn write leaves half of the text under the key, as a page that dies in the middle does.
      if (this.fail.torn) this.map.set(key, text.slice(0, Math.floor(text.length / 2)));
      throw new Error('the write failed');
    }
    this.map.set(key, text);
  }
}

class Clocked extends Engine {
  readonly tables = { rows: this.table(Row) };
  readonly systems = { bump: () => bump(this.tables.rows.rows, this.dt) };
}

const level = () => {
  const row = new Row();
  row.n = 5;
  return { rows: { rows: [row] }, values: { width: 1 } };
};

/** A page with no clock: the loop never runs, and the test steps the game. */
async function open(store: SaveStore | undefined, extra: object = {}) {
  const notices: string[] = [];
  let leave: (() => void) | undefined;
  const canvas = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect() {} };
  const game = await run(Clocked, {
    seed: 3,
    hz: 10,
    ...level(),
    game: 'Clocked',
    canvas,
    device: await createDevice({ prefer: ['cpu'] }),
    schedule: () => {},
    now: () => 0,
    hidden: () => false,
    ...(store === undefined ? {} : { store }),
    onNotice: (message: string) => void notices.push(message),
    leaving: (callback: () => void) => {
      leave = callback;
      return () => void (leave = undefined);
    },
    ...extra,
  } as never);
  return { game, notices, leave: () => leave?.() };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const parse = (text: string | undefined) => JSON.parse(text!) as Save;

test('the keys: the save under the name of the game, and the save before it as the backup', async () => {
  expect(saveKeys('Factory')).toEqual({
    save: 'Factory',
    backup: 'Factory.backup',
    unreadable: 'Factory.unreadable',
    unreadableBackup: 'Factory.backup.unreadable',
  });
  const store = new MemoryStore();
  const { game } = await open(store);
  await game.step(2);
  await game.save();
  expect([...store.map.keys()]).toEqual(['Clocked']);
  expect(parse(store.map.get('Clocked')).tick).toBe(2);
  await game.step(3);
  await game.save();
  // Write 1 puts the save before under the backup key, and write 2 puts the new save.
  expect(parse(store.map.get('Clocked.backup')).tick).toBe(2);
  expect(parse(store.map.get('Clocked')).tick).toBe(5);
  expect(store.writes).toBe(3);
  await game.dispose();
});

test('a store that fails in the middle of a write leaves the save before it, at each point', async () => {
  for (const torn of [false, true]) {
    for (const at of [1, 2]) {
      const store = new MemoryStore();
      const { game } = await open(store);
      await game.step(1);
      await game.save();
      const before = store.map.get('Clocked')!;
      expect(parse(before).tick).toBe(1);
      await game.step(1);
      // The second save is two writes. Write 1 of it is the write number 2 of the store.
      store.fail = { at: store.writes + at, torn };
      await expect(game.save()).rejects.toThrow('the write failed');
      // A new page reads a good save: the save before the failed one.
      const found = await readStore(store, 'Clocked', () => {});
      const read = parse(found.text);
      expect(read.tick, `write ${at}, torn ${torn}`).toBe(1);
      expect(found.text).toBe(before);
      await game.dispose();
    }
  }
});

test('the order of the two writes keeps one good save readable at every point', async () => {
  const store = new MemoryStore();
  const state: WriterState = { lastGood: undefined, writable: true };
  const write = saveWriter(store, 'G', state);
  const save = (tick: number) => ({ format: 1, game: 'G', version: 1, tick }) as unknown as Save;
  await write(save(1));
  await write(save(2));
  // After each of the writes that follow, a read finds a good save.
  const seen: number[] = [];
  const reader = new Proxy(store, {
    get(target, name, receiver) {
      if (name !== 'write') return Reflect.get(target, name, receiver);
      return async (key: string, text: string) => {
        await target.write(key, text);
        const found = await readStore(target, 'G', () => {});
        seen.push(parse(found.text).tick);
      };
    },
  });
  await saveWriter(reader, 'G', state)(save(3));
  // After write 1 the backup holds save 2, and the key holds save 2. After write 2: save 3.
  expect(seen).toEqual([2, 3]);
  expect(parse(store.map.get('G.backup')).tick).toBe(2);
  expect(parse(store.map.get('G')).tick).toBe(3);
});

test('a page that starts with no save starts from the level, and a reopened page goes on from its tick', async () => {
  const store = new MemoryStore();
  const first = await open(store);
  expect([first.game.tick, first.game.seed, first.notices]).toEqual([0, 3, []]);
  await first.game.step(7);
  await first.game.save();
  const rows = await first.game.tables.rows.read();
  await first.game.dispose();

  const again = await open(store);
  expect([again.game.tick, again.game.seed, again.game.hz, again.notices]).toEqual([7, 3, 10, []]);
  expect(await again.game.tables.rows.read()).toEqual(rows);
  expect(again.game.values).toEqual({ width: 1 });
  await again.game.dispose();
});

test('a page saves when it goes out of view, and not on a tick', async () => {
  const store = new MemoryStore();
  const { game, leave } = await open(store);
  await game.step(4);
  expect(store.writes).toBe(0);
  leave();
  await settle();
  expect(parse(store.map.get('Clocked')).tick).toBe(4);
  await game.dispose();
  // The game stops the listener when it is disposed.
  expect(() => leave()).not.toThrow();
});

test('a write that fails when the page goes out of view is a notice, and the run goes on', async () => {
  const store = new MemoryStore();
  const { game, leave, notices } = await open(store);
  store.fail = { at: 1, torn: false };
  leave();
  await settle();
  expect(notices).toEqual([
    'The page could not write the save (the write failed). The run goes on.',
  ]);
  await game.step(1);
  expect(game.tick).toBe(1);
  await game.dispose();
});

test('a page with no store keeps no save, and game.save() only gives the save', async () => {
  const { game, leave } = await open(undefined);
  await game.step(1);
  expect((await game.save()).tick).toBe(1);
  expect(() => leave()).not.toThrow();
  await game.dispose();
});

test('a store with no game name is refused', async () => {
  await expect(open(new MemoryStore(), { game: undefined })).rejects.toThrow(
    'run(): the options give a store and no game name. The key of the save is the name of the game, so give it, for example { game: "Factory", store: browserStore() }.',
  );
});

/** Saves a run of `ticks` ticks into `store` and gives its text. */
async function saveInto(store: MemoryStore, ticks: number) {
  const { game } = await open(store);
  await game.step(ticks);
  await game.save();
  await game.dispose();
  return store.map.get('Clocked')!;
}

test('a save that cannot be read starts from the backup, and nothing is deleted', async () => {
  const store = new MemoryStore();
  await saveInto(store, 2);
  const good = await saveInto(store, 5);
  expect(parse(store.map.get('Clocked.backup')).tick).toBe(2);
  // The latest save is torn.
  const torn = good.slice(0, 40);
  store.map.set('Clocked', torn);
  const { game, notices } = await open(store);
  expect(game.tick).toBe(2);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatch(
    /^The save under the key "Clocked" is not a save that this game reads \(.*\)\. The page went on from the save under the key "Clocked\.backup"\. The page kept each unread save under the key "Clocked\.unreadable"\.$/,
  );
  // The bytes of the save that cannot be read are still in the store, under two keys.
  expect(store.map.get('Clocked')).toBe(torn);
  expect(store.map.get('Clocked.unreadable')).toBe(torn);
  await game.save();
  // The next save moves the backup. The unread bytes stay under their own key.
  expect(store.map.get('Clocked.unreadable')).toBe(torn);
  expect(parse(store.map.get('Clocked')).tick).toBe(2);
  await game.dispose();
});

test('with no backup that reads, the page starts from the level and keeps the two saves under other keys', async () => {
  const store = new MemoryStore();
  await saveInto(store, 2);
  await saveInto(store, 5);
  // The latest is of a later version than the game, and the backup is not JSON.
  const later = { ...parse(store.map.get('Clocked')), version: 2 };
  const main = JSON.stringify(later);
  store.map.set('Clocked', main);
  store.map.set('Clocked.backup', 'not json');
  const { game, notices } = await open(store);
  expect([game.tick, game.seed]).toEqual([0, 3]);
  expect(notices).toHaveLength(1);
  // The words of a JSON parse error belong to the JavaScript engine, so a pattern holds them.
  const parts = notices[0].split(' The page started from the level. ');
  expect(parts[1]).toBe(
    'The page kept each unread save under the key "Clocked.unreadable" and "Clocked.backup.unreadable".',
  );
  expect(parts[0]).toMatch(
    /^The save under the key "Clocked" is not a save that this game reads \(Clocked: the save has the version 2, and the game has the version 1\. A game cannot read a later version\. Start from a save of the version 1 or earlier, or use the later version of the game\)\. The save under the key "Clocked\.backup" is not a save that this game reads \(.+\)\.$/,
  );
  expect(store.map.get('Clocked.unreadable')).toBe(main);
  expect(store.map.get('Clocked.backup.unreadable')).toBe('not json');
  await game.dispose();
});

test('a second unread save does not overwrite the first copy', async () => {
  const store = new MemoryStore();
  store.map.set('Clocked', 'first bad');
  await (await open(store)).game.dispose();
  expect(store.map.get('Clocked.unreadable')).toBe('first bad');
  store.map.set('Clocked', 'second bad');
  await (await open(store)).game.dispose();
  expect(store.map.get('Clocked.unreadable')).toBe('first bad');
  expect(store.map.get('Clocked.unreadable.2')).toBe('second bad');
});

test('a store that cannot be read, or a copy that fails, stops the writes so that no save is lost', async () => {
  const unreadable = new MemoryStore();
  await saveInto(unreadable, 3);
  unreadable.failReads = true;
  const a = await open(unreadable);
  expect(a.game.tick).toBe(0);
  expect(a.notices[0]).toContain('the store gave an error (the disk is gone)');
  expect(a.notices[0]).toContain('The page does not write a save, so that no save is lost.');
  unreadable.failReads = false;
  const bytes = unreadable.map.get('Clocked');
  await a.game.step(1);
  await a.game.save();
  expect(unreadable.map.get('Clocked')).toBe(bytes);
  await a.game.dispose();

  const copy = new MemoryStore();
  copy.map.set('Clocked', 'bad bytes');
  copy.fail = { at: 1, torn: false };
  const b = await open(copy);
  expect(b.notices[0]).toContain('and the copy failed (the write failed)');
  await b.game.save();
  expect(copy.map.get('Clocked')).toBe('bad bytes');
  await b.game.dispose();
});

test('game.restart() starts from the level of the start and writes over the save', async () => {
  const store = new MemoryStore();
  const { game } = await open(store);
  await game.step(6);
  await game.save();
  const before = (await game.tables.rows.read())[0].n;
  expect(before).toBe(11);
  await game.restart();
  expect([game.tick, game.seed]).toEqual([0, 3]);
  expect((await game.tables.rows.read())[0].n).toBe(5);
  expect(game.record().inputs).toEqual([]);
  // The new run is the save, and the run before is the backup.
  expect(parse(store.map.get('Clocked')).tick).toBe(0);
  expect(parse(store.map.get('Clocked.backup')).tick).toBe(6);
  await game.step(2);
  expect(game.tick).toBe(2);
  await game.dispose();
});

test('a page that started from a save restarts from the level, not from the save', async () => {
  const store = new MemoryStore();
  await saveInto(store, 4);
  const { game } = await open(store);
  expect(game.tick).toBe(4);
  await game.restart();
  expect([game.tick, (await game.tables.rows.read())[0].n]).toEqual([0, 5]);
  await game.dispose();
});

test('restart() of a game that started from a save in a test has no level, and says so', async () => {
  const { start } = await import('../src/test.ts');
  const game = await start(Clocked, { seed: 1, ...level() });
  const save = await game.save();
  const again = await start(Clocked, { from: save });
  await expect(again.restart()).rejects.toThrow(
    'Clocked.restart(): the game started from a save, so it has no first rows to start from. Start the game with a seed and a level, or run it with run() of radiance/page.',
  );
  await game.restart();
  expect(game.tick).toBe(0);
  await Promise.all([game.dispose(), again.dispose()]);
});
