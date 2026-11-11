// The pointer on the factory: a drag puts belts along its path, each pointing the way the
// pointer moved. Each belt is an input of the run, so a record holds it.

import type { PointerInput } from 'radiance';
import type { Game } from '../.radiance/game.ts';
import { BELT } from '../kinds.shade.ts';
import { putCell } from '../cells.ts';

let last: { x: number; y: number } | undefined;

const cellOf = (game: Game, at: PointerInput) => ({
  x: Math.floor(at.x * game.values.width),
  y: Math.floor(at.y * game.values.height),
});

export function pointerdown(game: Game, at: PointerInput) {
  last = cellOf(game, at);
}

export function pointermove(game: Game, at: PointerInput) {
  if (last === undefined) return;
  const cell = cellOf(game, at);
  if (cell.x === last.x && cell.y === last.y) return;
  const dir = cell.x > last.x ? 1 : cell.x < last.x ? 3 : cell.y > last.y ? 2 : 0;
  putCell(game, last.x, last.y, BELT, dir);
  last = cell;
}

export function pointerup(_game: Game, _at: PointerInput) {
  last = undefined;
}
