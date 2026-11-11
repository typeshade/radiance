// Design: 0104, section 6, and 0108, section 7. The loop of a page: the ticks that are due,
// then the picture. This is the one file under `src/` that reads a clock, and it is the page's
// clock.

import { createDevice, type Device } from 'typeshade/runtime';
import { Engine, inputsOf, type StartOptions } from './engine.ts';

/** What `frames` needs of a simulation. */
export interface Steps {
  /** The ticks in one second. */
  readonly hz: number;
  /** Runs `n` ticks. */
  step(n: number): Promise<void>;
}

/** The options of `frames`. */
export interface FramesOptions {
  /** The most ticks one frame runs. 8 when it is not given. A page that was hidden drops the rest. */
  readonly maxTicks?: number;
  /** The clock, in milliseconds. `performance.now` when it is not given. A test gives its own. */
  readonly now?: () => number;
  /** Asks for the next frame. `requestAnimationFrame` when it is not given. A test gives its own. */
  readonly schedule?: (frame: () => void) => void;
}

/**
 * Runs a simulation in a page. In each frame it runs the ticks that are due at the
 * simulation's tick rate, at most `maxTicks` of them, then calls `draw`. It asks for the next
 * frame when the frame is done, so a frame does not start while the frame before it still
 * applies inputs. It returns a function that stops the loop.
 */
export function frames(sim: Steps, draw: () => void, options: FramesOptions = {}): () => void {
  const maxTicks = options.maxTicks ?? 8;
  if (!Number.isInteger(maxTicks) || maxTicks < 1) {
    throw new RangeError(`frames(): maxTicks is ${String(maxTicks)}. Give an integer from 1.`);
  }
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((frame: () => void) => void requestAnimationFrame(frame));

  let stopped = false;
  let before = now();
  let owed = 0;
  const frame = async () => {
    if (stopped) return;
    const at = now();
    owed += ((at - before) / 1000) * sim.hz;
    before = at;
    const whole = Math.floor(owed);
    owed -= whole;
    await sim.step(Math.min(whole, maxTicks));
    if (stopped) return;
    draw();
    schedule(() => void frame());
  };
  schedule(() => void frame());
  return () => {
    stopped = true;
  };
}

/** The options of `run`: the start of a game, its canvas, and what a test gives in place of the page. */
export interface RunOptions extends StartOptions {
  /** The canvas the game draws to and takes its events from. */
  readonly canvas: unknown;
  /** A device the host already has. When not given, the engine opens WebGPU, or WebGL2 after it. */
  readonly device?: Device;
  /** The most ticks one frame runs. 8 when it is not given. */
  readonly maxTicks?: number;
  /** The clock, in milliseconds. `performance.now` when it is not given. */
  readonly now?: () => number;
  /** Asks for the next frame. `requestAnimationFrame` when it is not given. */
  readonly schedule?: (frame: () => void) => void;
  /** True while the page is hidden. `document.hidden` when it is not given. */
  readonly hidden?: () => boolean;
}

/** What `run` needs of a canvas: its events and its place on the page. */
interface CanvasLike {
  addEventListener(event: string, listener: (event: never) => void): void;
  removeEventListener(event: string, listener: (event: never) => void): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  readonly ownerDocument?: CanvasLike;
}

/**
 * Runs a game in a page (design record 0108, sections 5 and 7). It opens the device, starts
 * the game, gives each event of the canvas to the method the game marked with `@input`, and
 * runs the loop: the ticks that are due, then `game.draw()`. A game with `stepOn: 'input'`
 * runs one tick for each frame that has an input. The loop stops while the page is hidden, and
 * `game.dispose()` ends it.
 */
export async function run<G extends Engine>(Game: new () => G, options: RunOptions): Promise<G> {
  const canvas = options.canvas as CanvasLike | undefined;
  if (canvas === undefined || canvas === null || typeof canvas.addEventListener !== 'function') {
    throw new TypeError(
      'run(): the options hold no canvas. Give the canvas of the page, for example { canvas: document.querySelector("canvas") }.',
    );
  }
  const maxTicks = options.maxTicks ?? 8;
  if (!Number.isInteger(maxTicks) || maxTicks < 1) {
    throw new RangeError(`run(): maxTicks is ${String(maxTicks)}. Give an integer from 1.`);
  }
  const device = options.device ?? (await createDevice({ prefer: ['webgpu', 'webgl2'] }));
  const game = Engine.start(new Game(), device, { ...options, surface: canvas });

  // Each event becomes data, and the game's method makes it an input of the run.
  const listeners: [CanvasLike, string, (event: never) => void][] = [];
  for (const [event, method] of inputsOf(game)) {
    const target = event.startsWith('key') ? (canvas.ownerDocument ?? canvas) : canvas;
    const listener = (raw: { clientX: number; clientY: number; buttons: number; key: string }) => {
      const call = (game as unknown as Record<string, (data: unknown) => unknown>)[method];
      if (event.startsWith('key')) {
        call.call(game, { key: raw.key });
        return;
      }
      const box = canvas.getBoundingClientRect();
      call.call(game, {
        x: (raw.clientX - box.left) / box.width,
        y: (raw.clientY - box.top) / box.height,
        down: raw.buttons !== 0,
      });
    };
    target.addEventListener(event, listener as (event: never) => void);
    listeners.push([target, event, listener as (event: never) => void]);
  }

  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((frame: () => void) => void requestAnimationFrame(frame));
  const hidden = options.hidden ?? (() => document.hidden);
  const draw = (game as unknown as { draw?: () => unknown }).draw;
  let stopped = false;
  let before = now();
  let owed = 0;
  const frame = async () => {
    if (stopped) return;
    const at = now();
    if (hidden()) {
      // The ticks of the time the page was hidden are not run after.
      before = at;
      owed = 0;
    } else {
      let ticks: number;
      if (game.stepOn === 'input') {
        ticks = game.pending > 0 ? 1 : 0;
      } else {
        owed += ((at - before) / 1000) * game.hz;
        const whole = Math.floor(owed);
        owed -= whole;
        ticks = Math.min(whole, maxTicks);
      }
      before = at;
      if (ticks > 0) await game.step(ticks);
      if (stopped) return;
      if (typeof draw === 'function') await draw.call(game);
    }
    schedule(() => void frame());
  };
  game.onDispose(() => {
    stopped = true;
    for (const [target, event, listener] of listeners) target.removeEventListener(event, listener);
  });
  schedule(() => void frame());
  return game;
}
