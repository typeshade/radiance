// The host side of the second reference game: a level from text, the dungeon as text, and the
// simulation of its two tables.

import type { Device } from 'typeshade/runtime';
import { createSim, type Sim } from '../../src/index.ts';
import {
  Actor,
  FLOOR,
  NONE,
  ORC,
  ORC_HP,
  PLAYER,
  POTION,
  RAT,
  RAT_HP,
  SPAWN,
  Tile,
  WALL,
  pickup,
  turn,
} from './actors.shade.ts';

/** The player's hit points at the start. */
export const PLAYER_HP = 5;

/** The ways of a move. */
export const NORTH = 1;
export const EAST = 2;
export const SOUTH = 3;
export const WEST = 4;

/** A level: its grid, its tiles row by row, its actors and its spawn tile. */
export interface Level {
  readonly width: number;
  readonly height: number;
  readonly tiles: Tile[];
  /** The player is row 0. The other rows are the monsters in reading order, then free slots. */
  readonly actors: Actor[];
  /** The spawn tile. `x` is `width` when the level has none, and no monster comes in. */
  readonly spawn: { readonly x: number; readonly y: number };
}

/** A dungeon that runs. */
export interface Dungeon {
  readonly width: number;
  readonly height: number;
  readonly sim: Sim<{ actors: Actor[]; tiles: Tile[] }, 'actors' | 'tiles'>;
}

/**
 * Reads a level. Each line is a row and each character a cell: `#` a wall, `.` a floor, `!` a
 * potion, `S` the spawn tile, `@` the player, `r` a rat, `o` an orc. `slots` is the number of
 * rows of the actor table. A level has one player.
 */
export function parseLevel(text: string, options: { slots: number }): Level {
  const rows = text
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const tiles: Tile[] = [];
  const monsters: Actor[] = [];
  let player: Actor | undefined;
  let spawn: { x: number; y: number } | undefined;
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new TypeError(
        `parseLevel(): row ${y} has ${row.length} cells, and row 0 has ${width}. Give each row the same length.`,
      );
    }
    [...row].forEach((ch, x) => {
      const tile = new Tile();
      tile.kind = ch === '#' ? WALL : ch === '!' ? POTION : ch === 'S' ? SPAWN : FLOOR;
      tiles.push(tile);
      if (ch === 'S') {
        if (spawn !== undefined) {
          throw new TypeError(`parseLevel(): the level has two spawn tiles. Give one S or none.`);
        }
        spawn = { x, y };
      } else if (ch === '@' || ch === 'r' || ch === 'o') {
        const actor = new Actor();
        actor.kind = ch === '@' ? PLAYER : ch === 'r' ? RAT : ORC;
        actor.hp = ch === '@' ? PLAYER_HP : ch === 'r' ? RAT_HP : ORC_HP;
        actor.x = x;
        actor.y = y;
        if (ch !== '@') monsters.push(actor);
        else if (player === undefined) player = actor;
        else throw new TypeError(`parseLevel(): the level has two players. Give one @.`);
      } else if (!'#.!'.includes(ch)) {
        throw new TypeError(
          `parseLevel(): row ${y} holds ${JSON.stringify(ch)}. A cell is one of # . ! S @ r o.`,
        );
      }
    });
  });
  if (player === undefined) {
    throw new TypeError(`parseLevel(): the level has no player. Give one @.`);
  }
  const actors = [player, ...monsters];
  if (actors.length > options.slots) {
    throw new RangeError(
      `parseLevel(): the level has ${actors.length} actors, and the table has ${options.slots} slots. Give more slots.`,
    );
  }
  while (actors.length < options.slots) actors.push(new Actor());
  return { width, height, tiles, actors, spawn: spawn ?? { x: width, y: 0 } };
}

/** The dungeon as text, one line for each row. An actor hides its tile. */
export function render(
  dungeon: { readonly width: number; readonly height: number },
  actors: readonly Actor[],
  tiles: readonly Tile[],
): string {
  const cells = tiles.map((t) => '#.!S'[t.kind]);
  for (const a of actors) {
    if (a.kind !== NONE) cells[a.y * dungeon.width + a.x] = ' @ro'[a.kind];
  }
  const lines: string[] = [];
  for (let y = 0; y < dungeon.height; y++) {
    lines.push(cells.slice(y * dungeon.width, (y + 1) * dungeon.width).join(''));
  }
  return lines.join('\n') + '\n';
}

/** Builds the dungeon of a level on a device. Both tables are buffered. */
export function createDungeon(
  text: string,
  options: { readonly seed: number; readonly device: Device; readonly slots?: number },
): Dungeon {
  const level = parseLevel(text, { slots: options.slots ?? 16 });
  const { width, height, spawn } = level;
  const sim = createSim(
    { actors: level.actors, tiles: level.tiles },
    {
      device: options.device,
      seed: options.seed,
      buffered: ['actors', 'tiles'],
      // Two functions make one turn. Both read the tables as the last turn left them.
      tick: async (t, time) => {
        await turn(
          t.actors.write,
          t.actors.read,
          t.tiles.read,
          width,
          height,
          time.tick,
          options.seed,
          spawn.x,
          spawn.y,
        );
        await pickup(t.tiles.write, t.tiles.read, t.actors.read, width, height);
      },
    },
  );
  return { width, height, sim };
}

/** The player's move for the next turn. It is an input of the simulation. */
export function move(dungeon: Dungeon, way: number): void {
  dungeon.sim.input('actors', 0, { move: way });
}
