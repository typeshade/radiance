// The drawing of the factory: one host function that the engine calls for each frame. It gives
// the fragment entry the cells where they are on the device. Nothing is read back.

import type { Game } from '../.radiance/game.ts';
import { picture } from './picture.shade.ts';

export function draw(game: Game) {
  const canvas = game.surface as HTMLCanvasElement;
  const { width, height } = game.values;
  return picture(canvas, {
    cells: game.cells.rows,
    view: { width, height, size: [canvas.width, canvas.height] },
  });
}
