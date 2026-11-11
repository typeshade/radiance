// The host side of a level: a level from text, and the dungeon as text.

import {
  FLOOR,
  NONE,
  ORC,
  ORC_HP,
  PLAYER,
  POTION,
  RAT,
  RAT_HP,
  SPAWN,
  WALL,
} from '../rules.shade.ts';
import { Actor } from '../state/actors.shade.ts';
import { Tile } from '../state/tiles.shade.ts';

/** The player's hit points at the start. */
export const PLAYER_HP = 5;

/** The ways of a move. */
export const NORTH = 1;
export const EAST = 2;
export const SOUTH = 3;
export const WEST = 4;

/** A level of the dungeon: the first rows of its two tables and the values of the run. */
export interface DungeonLevel {
  /** The player is row 0 of `actors`. The other rows are the monsters in reading order. */
  readonly rows: { readonly actors: Actor[]; readonly tiles: Tile[] };
  readonly values: {
    readonly width: number;
    readonly height: number;
    readonly sx: number;
    readonly sy: number;
  };
}

/**
 * Reads a level. Each line is a row and each character a cell: `#` a wall, `.` a floor, `!` a
 * potion, `S` the spawn tile, `@` the player, `r` a rat, `o` an orc. A level has one player.
 */
export function parseLevel(text: string): DungeonLevel {
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
  // A level with no spawn tile gives `sx` as `width`, and no monster comes in.
  const at = spawn ?? { x: width, y: 0 };
  return { rows: { actors, tiles }, values: { width, height, sx: at.x, sy: at.y } };
}

/** The dungeon as text, one line for each row. An actor hides its tile. */
export function render(
  width: number,
  height: number,
  actors: readonly Actor[],
  tiles: readonly Tile[],
): string {
  const cells = tiles.map((t) => '#.!S'[t.kind]);
  for (const a of actors) {
    if (a.kind !== NONE) cells[a.y * width + a.x] = ' @ro'[a.kind];
  }
  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    lines.push(cells.slice(y * width, (y + 1) * width).join(''));
  }
  return lines.join('\n') + '\n';
}
