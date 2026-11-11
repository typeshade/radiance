// The factory in a browser: the tick on a GPU device, the picture in a canvas, and a pointer
// that puts belts. This is the thin loop of a shipped game (docs/vision.md, D10), written by
// hand. It uses the compiler's runtime and nothing of the engine.

import { createDevice } from 'typeshade/runtime';
import { BELT, Cell, EMPTY, place, tick } from './cells.shade.ts';
import { draw } from './draw.shade.ts';
import { DEMO, parseLevel } from './level.ts';

/** The ticks in one second. The tick is fixed, and a frame runs the ticks that are due. */
const HZ = 30;

/** What a page or a test reads of the running game. */
export interface Game {
  /** The number of ticks run. */
  readonly ticks: number;
  /** The tier the device opened: `webgpu` or `webgl2`. */
  readonly tier: string;
  /** Runs `n` ticks now, draws, and waits for the device. */
  step(n: number): Promise<void>;
  /** Puts a belt that sends its item in `dir`, or nothing, in the cell (x, y). */
  put(x: number, y: number, kind: number, dir: number): void;
  /** Reads the cells back from the device. */
  read(): Promise<Cell[]>;
}

export async function start(
  canvas: HTMLCanvasElement,
  options: { readonly auto: boolean },
): Promise<Game> {
  const level = parseLevel(DEMO);
  const { width, height } = level;
  // D12: WebGPU first, WebGL2 where there is no WebGPU. The CPU tier is not a tier of a shipped
  // game.
  const device = await createDevice({ prefer: ['webgpu', 'webgl2'] });
  let prev = device.array(level.cells);
  let next = device.array(level.cells.map(() => new Cell()));
  let ticks = 0;
  const edits: { at: number; kind: number; dir: number }[] = [];

  const frame = (due: number) => {
    for (let i = 0; i < due; i++) {
      // The input phase: each edit is a call that writes one cell on the device.
      for (const edit of edits.splice(0)) place(prev, edit.at, edit.kind, edit.dir);
      tick(next, prev, width, height);
      [prev, next] = [next, prev];
      ticks++;
    }
    draw(canvas, { cells: prev, view: { width, height, size: [canvas.width, canvas.height] } });
  };

  const game: Game = {
    get ticks() {
      return ticks;
    },
    tier: device.tier,
    async step(n) {
      frame(n);
      await device.wait();
    },
    put(x, y, kind, dir) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      edits.push({ at: y * width + x, kind, dir });
    },
    read: () => prev.read(),
  };

  // A drag puts belts along its path, each pointing the way the pointer moved.
  let last: { x: number; y: number } | undefined;
  const cellOf = (event: MouseEvent) => {
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((event.clientX - box.left) / box.width) * width),
      y: Math.floor(((event.clientY - box.top) / box.height) * height),
    };
  };
  canvas.addEventListener('pointerdown', (event) => {
    last = cellOf(event);
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (last === undefined) return;
    const at = cellOf(event);
    if (at.x === last.x && at.y === last.y) return;
    const dir = at.x > last.x ? 1 : at.x < last.x ? 3 : at.y > last.y ? 2 : 0;
    game.put(last.x, last.y, BELT, dir);
    last = at;
  });
  canvas.addEventListener('pointerup', () => (last = undefined));
  canvas.addEventListener('dblclick', (event) => {
    const at = cellOf(event);
    game.put(at.x, at.y, EMPTY, 0);
  });

  if (options.auto) {
    let before = performance.now();
    let owed = 0;
    const loop = (now: number) => {
      owed += ((now - before) / 1000) * HZ;
      before = now;
      const due = Math.min(Math.floor(owed), 8);
      owed -= Math.floor(owed);
      frame(due);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return game;
}

const canvas = document.querySelector('canvas');
if (canvas !== null) {
  const auto = !new URLSearchParams(location.search).has('manual');
  (globalThis as { game?: Promise<Game> }).game = start(canvas, { auto });
}
