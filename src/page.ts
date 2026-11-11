// Design: 0108, section 7. The loop of a page: the ticks that are due,
// then the picture. This is the one file under `src/` that reads a clock, and it is the page's
// clock.

import { createDevice, type Device } from 'typeshade/runtime';
import { Engine, type InputEvent, type StartOptions } from './engine.ts';

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
  /**
   * Called after each frame with its numbers (design record 0110, section 2). With it, a frame
   * waits for the device after its ticks, so that the time of a tick is a time of the work.
   */
  readonly onFrame?: (stats: FrameStats) => void;
  /**
   * Called when a frame fails, with the error. The loop stops. When it is not given, the error
   * of the frame is not caught.
   */
  readonly onError?: (error: unknown) => void;
}

/** The numbers of one frame of `run`. */
export interface FrameStats {
  /** The tier of the device: `webgpu`, `webgl2` or `cpu`. */
  readonly tier: string;
  /** The time of the frame's ticks together, in milliseconds, with the wait for the device. */
  readonly tickMs: number;
  /** The time from the frame before to this frame, in milliseconds. */
  readonly frameMs: number;
  /** The ticks the frame ran. */
  readonly ticks: number;
}

/**
 * The line of a readout (design record 0110, section 1): the tier, the mean time of a tick,
 * the mean time of a frame, the mean count of ticks in a frame and the commit of the build.
 * The means are over the last 60 frames. The function it gives takes a frame and gives the line.
 */
export function readout(commit: string): (stats: FrameStats) => string {
  const frames: FrameStats[] = [];
  const fixed = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '0.0');
  return (stats) => {
    frames.push(stats);
    if (frames.length > 60) frames.shift();
    const ticks = frames.reduce((sum, frame) => sum + frame.ticks, 0);
    const tickMs = frames.reduce((sum, frame) => sum + frame.tickMs, 0);
    const frameMs = frames.reduce((sum, frame) => sum + frame.frameMs, 0);
    const perFrame = ticks / frames.length;
    return [
      stats.tier,
      `tick ${fixed(ticks === 0 ? 0 : tickMs / ticks)} ms`,
      `frame ${fixed(frameMs / frames.length)} ms`,
      `${Number.isInteger(perFrame) ? String(perFrame) : fixed(perFrame)} tick/frame`,
      commit,
    ].join('  ');
  };
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
 * the game, gives each event of the canvas to the function of the game's `inputs`, and
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
  const inputs = (game.inputs ?? {}) as {
    [event: string]: ((data: unknown) => unknown) | undefined;
  };
  for (const event of Object.keys(inputs) as InputEvent[]) {
    const take = inputs[event];
    if (typeof take !== 'function') continue;
    const target = event.startsWith('key') ? (canvas.ownerDocument ?? canvas) : canvas;
    const listener = (raw: { clientX: number; clientY: number; buttons: number; key: string }) => {
      if (event.startsWith('key')) {
        take.call(inputs, { key: raw.key });
        return;
      }
      const box = canvas.getBoundingClientRect();
      take.call(inputs, {
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
      const frameMs = at - before;
      before = at;
      if (ticks > 0) await game.step(ticks);
      let tickMs = 0;
      if (options.onFrame !== undefined && ticks > 0) {
        await game.wait();
        tickMs = now() - at;
      }
      if (stopped) return;
      if (typeof draw === 'function') await draw.call(game);
      options.onFrame?.({ tier: game.tier, tickMs, frameMs, ticks });
    }
    schedule(() => void turn());
  };
  // A frame that fails stops the loop, and the page hears the reason.
  const turn = async () => {
    try {
      await frame();
    } catch (error) {
      stopped = true;
      if (options.onError === undefined) throw error;
      options.onError(error);
    }
  };
  game.onDispose(() => {
    stopped = true;
    for (const [target, event, listener] of listeners) target.removeEventListener(event, listener);
  });
  schedule(() => void turn());
  return game;
}
