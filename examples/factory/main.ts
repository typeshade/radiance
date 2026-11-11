// The factory in a browser. The engine opens the device, runs the loop, gives the pointer to
// the functions of input/ and calls draw/draw.ts for each frame. This file starts the game and
// gives a browser check a handle on it.

import { run } from '../../src/page.ts';
import { Game } from './.radiance/game.ts';
import { putCell } from './cells.ts';
import level from './levels/demo.ts';
import type { Cell } from './state/cells.shade.ts';

/** What a browser check reads of the running game. */
export interface Handle {
  /** The tier the device opened: `webgpu` or `webgl2`. */
  readonly tier: string;
  /** Runs `n` ticks now, draws, and waits for the device. */
  step(n: number): Promise<void>;
  /** Puts a cell of a kind, with the way it sends its item, in the cell (x, y). */
  put(x: number, y: number, kind: number, dir: number): void;
  /** Reads the cells back from the device. */
  read(): Promise<Cell[]>;
}

export async function start(canvas: HTMLCanvasElement, auto: boolean): Promise<Handle> {
  const game = await run(Game, {
    seed: 1,
    canvas,
    rows: level.rows,
    values: level.values,
    // A browser check steps the game itself, so the loop asks for no frame.
    ...(auto ? {} : { schedule: () => {} }),
  });
  return {
    tier: game.tier,
    async step(n) {
      await game.step(n);
      await game.draw();
      await game.wait();
    },
    put: (x, y, kind, dir) => putCell(game, x, y, kind, dir),
    read: () => game.cells.read(),
  };
}

const canvas = document.querySelector('canvas');
if (canvas !== null) {
  const auto = !new URLSearchParams(location.search).has('manual');
  (globalThis as { game?: Promise<Handle> }).game = start(canvas, auto);
}
