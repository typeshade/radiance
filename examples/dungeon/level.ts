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
  Want,
  pickup,
  plan,
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
  /** The player is row 0. The other rows are the monsters in reading order. */
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
 * potion, `S` the spawn tile, `@` the player, `r` a rat, `o` an orc. A level has one player.
 */
export function parseLevel(text: string): Level {
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
  const level = parseLevel(text);
  const { width, height, spawn } = level;
  const size = options.slots ?? 16;
  // What the actors want in a turn. It is no state of the game, so it is no table of the
  // simulation. It has one row for each slot.
  const wants = options.device.array(Array.from({ length: size }, () => new Want()));
  const sim = createSim(
    { actors: level.actors, tiles: level.tiles },
    {
      device: options.device,
      seed: options.seed,
      buffered: ['actors', 'tiles'],
      // The simulation adds the free rows. A monster comes in on a free row.
      slots: { actors: { size, free: (actor) => actor.kind === NONE } },
      // Three functions make one turn. `plan` writes what each actor wants, `turn` reads it
      // for every actor, and `pickup` reads the actors that `turn` wrote.
      tick: async (t, time) => {
        await plan(wants, t.actors.read, width, height);
        await turn(
          t.actors.write,
          t.actors.read,
          wants,
          t.tiles.read,
          width,
          time.tick,
          spawn.x,
          spawn.y,
        );
        await pickup(t.tiles.write, t.tiles.read, t.actors.write, width);
      },
    },
  );
  return { width, height, sim };
}

/** The player's move for the next turn. It is an input of the simulation. */
export function move(dungeon: Dungeon, way: number): void {
  dungeon.sim.input('actors', 0, { move: way });
}
