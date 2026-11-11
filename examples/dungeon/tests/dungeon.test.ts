// The second reference game, loaded as a project on a device of the CPU tier (design record
// 0108). The pictures of the first tests were written by hand from the rules before the code
// ran.

import { expect, test } from 'vitest';
import { load, replayGame } from '../../../src/test.ts';
import type { Game } from '../.radiance/game.ts';
import { EAST, parseLevel } from '../levels/parse.ts';
import { render } from '../levels/parse.ts';
import { CAVE } from '../levels/cave.ts';
import { FLOOR, NONE, ORC, RAT, SPAWN, WALL } from '../rules.shade.ts';

const PROJECT = 'examples/dungeon';
const make = (text: string, seed = 1) => load<Game>(PROJECT, { seed, level: parseLevel(text) });
const picture = async (g: Game) =>
  render(g.values.width, g.values.height, await g.actors.read(), await g.tiles.read());
async function go(g: Game, ...ways: number[]) {
  for (const way of ways) {
    g.actors.input(0, { move: way });
    await g.step(1);
  }
}

test('the player moves into a floor, and a wall and the spawn tile stop it', async () => {
  const open = await make('@..');
  await go(open, EAST);
  expect(await picture(open)).toBe('.@.\n');
  const wall = await make('@#');
  await go(wall, EAST);
  expect(await picture(wall)).toBe('@#\n');
  const spawn = await make('@S');
  await go(spawn, EAST);
  expect(await picture(spawn)).toBe('@S\n');
  await Promise.all([open.dispose(), wall.dispose(), spawn.dispose()]);
});

test('two enemies attack each other in the same turn, and a dead actor leaves its row', async () => {
  const g = await make('@o');
  await go(g, EAST);
  let [player, orc] = await g.actors.read();
  expect([player.hp, orc.hp]).toEqual([4, 2]);
  await go(g, EAST);
  [player, orc] = await g.actors.read();
  // The orc had 2 hit points left, so it is removed. It attacked in the same turn.
  expect([player.hp, player.kills, orc.kind]).toEqual([3, 1, NONE]);
  expect(await picture(g)).toBe('@.\n');
  await g.dispose();
});

test('two actors go at one cell, and the lower row gets it', async () => {
  const g = await make(`
    o.o
    .@.
  `);
  await g.step(1);
  expect(await picture(g)).toBe('.oo\n.@.\n');
  await g.step(1);
  // The first orc attacks. The second goes at a cell that holds a monster, and stays.
  expect(await picture(g)).toBe('.oo\n.@.\n');
  expect((await g.actors.read())[0].hp).toBe(4);
  await g.dispose();
});

test('a potion heals the player and becomes a floor', async () => {
  const g = await make('@!.');
  await go(g, EAST);
  expect((await g.actors.read())[0].hp).toBe(8);
  expect((await g.tiles.read())[1].kind).toBe(FLOOR);
  expect(await picture(g)).toBe('.@.\n');
  await g.dispose();
});

test('a monster comes in on the spawn tile, in the row a dead monster left', async () => {
  const g = await make('@o.S');
  await go(g, EAST, EAST);
  expect((await g.actors.read())[1].kind).toBe(NONE);
  await g.step(6);
  expect(g.tick).toBe(8);
  expect((await g.actors.read())[1].kind).toBe(NONE);
  await g.step(1);
  const monster = (await g.actors.read())[1];
  expect([RAT, ORC]).toContain(monster.kind);
  expect([monster.x, monster.y]).toEqual([3, 0]);
  await g.dispose();
});

test('a long run keeps one actor to a cell, and a record replays to the same dump', async () => {
  const g = await load<Game>(PROJECT, { seed: 7, level: 'cave' });
  const { width } = g.values;
  let word = 12345;
  for (let t = 0; t < 120; t++) {
    word = (Math.imul(word, 1664525) + 1013904223) >>> 0;
    g.actors.input(0, { move: (word >>> 16) % 5 });
    await g.step(1);
    if (t % 10 === 9) {
      const actors = (await g.actors.read()).filter((a) => a.kind !== NONE);
      const tiles = await g.tiles.read();
      const cells = actors.map((a) => a.y * width + a.x);
      expect(new Set(cells).size).toBe(cells.length);
      for (const a of actors) expect(tiles[a.y * width + a.x].kind).not.toBe(WALL);
      for (const a of actors.filter((a) => a.kind === 1)) {
        expect(tiles[a.y * width + a.x].kind).not.toBe(SPAWN);
      }
    }
  }
  const level = parseLevel(CAVE);
  const { Game: GameClass } = await import('../.radiance/game.ts');
  const again = await replayGame(GameClass, { rows: level.rows, values: level.values }, g.record());
  expect(await again.dump()).toBe(await g.dump());
  await Promise.all([g.dispose(), again.dispose()]);
});

test('another seed gives another run', async () => {
  const a = await load<Game>(PROJECT, { seed: 7, level: 'cave' });
  const b = await load<Game>(PROJECT, { seed: 8, level: 'cave' });
  await a.step(40);
  await b.step(40);
  expect(await a.dump()).not.toBe(await b.dump());
  await Promise.all([a.dispose(), b.dispose()]);
});

test('a wrong level is refused with the fact and the remedy', () => {
  expect(() => parseLevel('@.\n.')).toThrow(
    'parseLevel(): row 1 has 1 cells, and row 0 has 2. Give each row the same length.',
  );
  expect(() => parseLevel('@?')).toThrow(
    'parseLevel(): row 0 holds "?". A cell is one of # . ! S @ r o.',
  );
  expect(() => parseLevel('..')).toThrow('parseLevel(): the level has no player. Give one @.');
  expect(() => parseLevel('@@')).toThrow('parseLevel(): the level has two players. Give one @.');
});

test('the dump shows the actors and no free slot, and the memory lists each table', async () => {
  const g = await make('@o.S');
  await go(g, EAST, EAST);
  const lines = (await g.dump()).split('\n');
  expect(lines[1]).toBe('actors  1 of 16');
  expect(lines[2]).toMatch(/^  \[0\]  kind 1  x 0  y 0  hp 3  move 0  seed \d+  kills 1$/);
  expect(lines[3]).toBe('tiles');
  expect(g.memory()).toEqual([
    { name: 'actors', kind: 'pool', rows: 16, arrays: 2 },
    { name: 'tiles', kind: 'table', rows: 4, arrays: 2 },
    { name: 'wants', kind: 'scratch', rows: 16, arrays: 1 },
  ]);
  await g.dispose();
});
