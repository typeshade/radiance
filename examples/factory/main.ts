// The factory in a browser. The engine's simulation runs the ticks on a GPU device, the
// engine's frame loop runs the page, and one fragment entry draws the cells. The same
// `createFactory` and the same `putCell` run in the tests, on a device of the CPU tier.

import { createDevice } from 'typeshade/runtime';
import { frames } from '../../src/page.ts';
import { BELT, EMPTY, type Cell } from './cells.shade.ts';
import { draw } from './draw.shade.ts';
import { createFactory, DEMO, putCell } from './level.ts';

/** What a page or a test reads of the running game. */
export interface Game {
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
  // D12: WebGPU first, WebGL2 where there is no WebGPU. The CPU tier is not a tier of a shipped
  // game.
  const device = await createDevice({ prefer: ['webgpu', 'webgl2'] });
  const factory = createFactory(DEMO, { seed: 1, device });
  const { width, height, sim } = factory;
  const paint = () =>
    draw(canvas, {
      cells: sim.table('cells'),
      view: { width, height, size: [canvas.width, canvas.height] },
    });

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
    putCell(factory, last.x, last.y, BELT, dir);
    last = at;
  });
  canvas.addEventListener('pointerup', () => (last = undefined));
  canvas.addEventListener('dblclick', (event) => {
    const at = cellOf(event);
    putCell(factory, at.x, at.y, EMPTY, 0);
  });

  if (options.auto) frames(sim, paint);
  return {
    tier: device.tier,
    async step(n) {
      await sim.step(n);
      paint();
      await sim.wait();
    },
    put: (x, y, kind, dir) => putCell(factory, x, y, kind, dir),
    read: () => sim.read('cells'),
  };
}

const canvas = document.querySelector('canvas');
if (canvas !== null) {
  const auto = !new URLSearchParams(location.search).has('manual');
  (globalThis as { game?: Promise<Game> }).game = start(canvas, { auto });
}
