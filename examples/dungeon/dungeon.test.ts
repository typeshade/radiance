// The second reference game on a device of the CPU tier. The pictures of the first tests were
// written by hand from the rules before the code ran.

import { createDevice, type Device } from 'typeshade/runtime';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { replaySim } from '../../src/test.ts';
import { FLOOR, NONE, ORC, RAT, SPAWN, WALL } from './actors.shade.ts';
import { createDungeon, EAST, move, parseLevel, render, type Dungeon } from './level.ts';

let device: Device;
beforeAll(async () => {
  device = await createDevice({ prefer: ['cpu'] });
});
afterAll(async () => {
  await device.dispose();
});

const make = (text: string, slots = 4, seed = 1) => createDungeon(text, { seed, device, slots });
const actorsOf = (d: Dungeon) => d.sim.read('actors');
const picture = async (d: Dungeon) =>
  render(d, await d.sim.read('actors'), await d.sim.read('tiles'));
async function go(d: Dungeon, ...ways: number[]) {
  for (const way of ways) {
    move(d, way);
    await d.sim.step(1);
  }
}

test('the player moves into a floor, and a wall and the spawn tile stop it', async () => {
  const open = make('@..');
  await go(open, EAST);
  expect(await picture(open)).toBe('.@.\n');
  const wall = make('@#');
  await go(wall, EAST);
  expect(await picture(wall)).toBe('@#\n');
  const spawn = make('@S');
  await go(spawn, EAST);
  expect(await picture(spawn)).toBe('@S\n');
});

test('two enemies attack each other in the same turn, and a dead actor leaves its row', async () => {
  const d = make('@o');
  await go(d, EAST);
  let [player, orc] = await actorsOf(d);
  expect([player.hp, orc.hp]).toEqual([4, 2]);
  await go(d, EAST);
  [player, orc] = await actorsOf(d);
  // The orc had 2 hit points left, so it is removed. It attacked in the same turn.
  expect([player.hp, player.kills, orc.kind]).toEqual([3, 1, NONE]);
  expect(await picture(d)).toBe('@.\n');
});

test('two actors go at one cell, and the lower row gets it', async () => {
  const d = make(`
    o.o
    .@.
  `);
  await d.sim.step(1);
  expect(await picture(d)).toBe('.oo\n.@.\n');
  await d.sim.step(1);
  // The first orc attacks. The second goes at a cell that holds a monster, and stays.
  expect(await picture(d)).toBe('.oo\n.@.\n');
  expect((await actorsOf(d))[0].hp).toBe(4);
});

test('a potion heals the player and becomes a floor', async () => {
  const d = make('@!.');
  await go(d, EAST);
  expect((await actorsOf(d))[0].hp).toBe(8);
  expect((await d.sim.read('tiles'))[1].kind).toBe(FLOOR);
  expect(await picture(d)).toBe('.@.\n');
});

test('a monster comes in on the spawn tile, in the row a dead monster left', async () => {
  const d = make('@o.S', 2);
  await go(d, EAST, EAST);
  expect((await actorsOf(d))[1].kind).toBe(NONE);
  await d.sim.step(6);
  expect(d.sim.tick).toBe(8);
  expect((await actorsOf(d))[1].kind).toBe(NONE);
  await d.sim.step(1);
  const monster = (await actorsOf(d))[1];
  expect([RAT, ORC]).toContain(monster.kind);
  expect([monster.x, monster.y]).toEqual([3, 0]);
});

const CAVE = `
  ##########
  #@..r...!#
  #..##..r.#
  #r.#S..o.#
  #....!...#
  ##########
`;

test('a long run keeps one actor to a cell, and a record replays to the same dump', async () => {
  const d = make(CAVE, 12, 7);
  let word = 12345;
  for (let t = 0; t < 120; t++) {
    word = (Math.imul(word, 1664525) + 1013904223) >>> 0;
    move(d, (word >>> 16) % 5);
    await d.sim.step(1);
    if (t % 10 === 9) {
      const actors = (await actorsOf(d)).filter((a) => a.kind !== NONE);
      const tiles = await d.sim.read('tiles');
      const cells = actors.map((a) => a.y * d.width + a.x);
      expect(new Set(cells).size).toBe(cells.length);
      for (const a of actors) expect(tiles[a.y * d.width + a.x].kind).not.toBe(WALL);
      for (const a of actors.filter((a) => a.kind === 1)) {
        expect(tiles[a.y * d.width + a.x].kind).not.toBe(SPAWN);
      }
    }
  }
  const again = await replaySim(
    (run) => createDungeon(CAVE, { seed: run.seed, device, slots: 12 }).sim,
    d.sim.record(),
  );
  expect(await again.dump()).toBe(await d.sim.dump());
});

test('another seed gives another run', async () => {
  const a = make(CAVE, 12, 7);
  const b = make(CAVE, 12, 8);
  await a.sim.step(40);
  await b.sim.step(40);
  expect(await a.sim.dump()).not.toBe(await b.sim.dump());
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
  expect(() => make('@rr', 2)).toThrow(
    'createSim(): the table "actors" has 3 rows, and its slots are 2. Give more slots or fewer rows.',
  );
});

test('the dump shows the actors and no free slot', async () => {
  const d = make('@o.S', 8);
  await go(d, EAST, EAST);
  const lines = (await d.sim.dump()).split('\n');
  expect(lines[1]).toBe('actors  1 of 8');
  expect(lines[2]).toMatch(/^  \[0\]  kind 1  x 0  y 0  hp 3  move 0  seed \d+  kills 1$/);
  expect(lines[3]).toBe('tiles');
});
