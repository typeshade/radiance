// Design: 0108, section 7, and 0111, sections 4 and 5. The loop of a page: the ticks that are due,
// then the picture. This is the one file under `src/` that reads a clock, and it is the page's
// clock.

import { createDevice, createRuntime, type Device } from 'typeshade/runtime';
import { createDrawing, type Drawing } from './draw.ts';
import {
  checkStartFrom,
  Engine,
  setLoopBlend,
  type InputEvent,
  type StartOptions,
} from './engine.ts';
import { readStore, saveWriter, type SaveStore } from './save.ts';

export type { Save, SaveStore } from './save.ts';

/** The options of `run`: the start of a game, its canvas, and what a test gives in place of the page. */
export interface RunOptions extends StartOptions {
  /** The canvas the game draws to and takes its events from. */
  readonly canvas: unknown;
  /**
   * A device the host already has. When not given, the engine opens WebGPU, or WebGL2 after it.
   * A game with layers takes none: it opens WebGPU with its program runtime (design record 0111).
   */
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
  /**
   * The store that keeps the save (design record 0112, section 3). With it, `run` starts from the
   * save in the store, and `game.save()` also writes to it. It needs `game`, the name of the game,
   * as the key of the save. Without it, the page keeps no save.
   */
  readonly store?: SaveStore;
  /**
   * Called with a sentence when the page has something to say about the store: a save that
   * could not be read, or a write that failed on its own. The loop goes on.
   */
  readonly onNotice?: (message: string) => void;
  /**
   * Calls `leave` when the page goes out of view, and gives the function that stops it. The page
   * saves then. When it is not given, `leave` is called when `visibilitychange` makes the document
   * hidden, and on `pagehide`.
   */
  readonly leaving?: (leave: () => void) => () => void;
}

/** The events of a browser that take a page out of view. */
function pageLeaving(leave: () => void): () => void {
  const hide = () => {
    if (document.hidden) leave();
  };
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('pagehide', leave);
  return () => {
    document.removeEventListener('visibilitychange', hide);
    window.removeEventListener('pagehide', leave);
  };
}

/**
 * The store of a browser: the IndexedDB database `database` of the page's address, with one
 * object store. A write is one transaction, so it is whole or it fails (design record 0112,
 * section 3).
 */
export function browserStore(database = 'radiance'): SaveStore {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(database, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saves');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('the database did not open'));
      request.onblocked = () => reject(new Error('the database is blocked by another page'));
    }));
  const finish = (transaction: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('the transaction was aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('the transaction failed'));
    });
  return {
    async read(key) {
      const transaction = (await open()).transaction('saves', 'readonly');
      const request = transaction.objectStore('saves').get(key);
      await finish(transaction);
      return typeof request.result === 'string' ? request.result : undefined;
    },
    async write(key, text) {
      const transaction = (await open()).transaction('saves', 'readwrite');
      transaction.objectStore('saves').put(text, key);
      await finish(transaction);
    },
  };
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
  /** The number of ticks the game has run after the frame, counted from tick 0 (also after a save). */
  readonly at: number;
}

/**
 * The line of a readout (design record 0110, section 1): the tier, the tick the game is at (record
 * 0112), the mean time of a tick,
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
      `at tick ${stats.at}`,
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
 * runs the loop: the ticks that are due, then `game.draw()`, or the layers of a game that draws
 * in layers (design record 0111). A game with `stepOn: 'input'`
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
  // Design: 0112, section 3. The save in the store, when the page has a store.
  const store = options.store;
  let begin: StartOptions = { ...options };
  let fresh: StartOptions | undefined;
  let kept: { lastGood: string | undefined; writable: boolean } = {
    lastGood: undefined,
    writable: true,
  };
  let notice: string | undefined;
  if (store !== undefined) {
    const name = options.game;
    if (typeof name !== 'string' || name === '') {
      throw new TypeError(
        'run(): the options give a store and no game name. The key of the save is the name of the game, so give it, for example { game: "Factory", store: browserStore() }.',
      );
    }
    // The start the page makes with no save, and the start that `restart()` goes back to.
    fresh = {
      seed: options.seed,
      hz: options.hz,
      rows: options.rows,
      values: options.values,
      game: name,
      version: options.version,
    };
    if (options.from === undefined) {
      const found = await readStore(store, name, (save) =>
        checkStartFrom(new Game(), { game: name, version: options.version, from: save as never }),
      );
      kept = { lastGood: found.text, writable: found.writable };
      notice = found.notice;
      if (found.save !== undefined) {
        begin = { game: name, version: options.version, from: found.save };
      }
    }
  }
  const instance = new Game();
  const layers = instance.layers ?? [];
  let device: Device;
  let drawing: Drawing | undefined;
  if (layers.length === 0) {
    device = options.device ?? (await createDevice({ prefer: ['webgpu', 'webgl2'] }));
  } else {
    // A game with layers runs on WebGPU only (design record 0111, section 5). The program
    // runtime comes first, and the device is made from it: the other order draws nothing.
    if (options.device !== undefined) {
      throw new TypeError(
        `run(): the game draws in layers (${layers.map((l) => l.name).join(', ')}), and run makes the device for them. Do not give a device.`,
      );
    }
    const names = layers.map((layer) => layer.name).join(', ');
    let runtime: Awaited<ReturnType<typeof createRuntime>>;
    try {
      runtime = await createRuntime({ prefer: ['webgpu'] });
      device = await createDevice({ runtime });
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(
        /[.\s]*$/,
        '.',
      );
      throw new Error(
        `run(): the game draws in layers (${names}), and layers need WebGPU. The page got no WebGPU device: ${reason} WebGL2 cannot draw a layer yet. A storage array of a class with a class in a field has no WebGL2 form (typeshade/typeshade#1249), and the page cannot be the target of a pass (typeshade/typeshade#1263).`,
        { cause: error },
      );
    }
    drawing = createDrawing({
      runtime,
      device,
      layers,
      view: instance.view ?? { fit: [1, 1] },
      surface: canvas,
    });
  }
  let game: G;
  try {
    game = Engine.start(instance, device, { ...begin, surface: canvas, drawing }, fresh);
  } catch (error) {
    drawing?.dispose();
    throw error;
  }
  if (store !== undefined) {
    // From now on `game.save()` also writes, and a page that goes out of view saves.
    const name = options.game!;
    Engine.setSaver(game, saveWriter(store, name, kept));
    const stop = (options.leaving ?? pageLeaving)(() => {
      game.save().catch((error: unknown) => {
        const reason = (error instanceof Error ? error.message : String(error)).replace(
          /[.\s]*$/,
          '',
        );
        options.onNotice?.(`The page could not write the save (${reason}). The run goes on.`);
      });
    });
    game.onDispose(stop);
  }
  if (notice !== undefined) options.onNotice?.(notice);

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
  // A game with layers draws them. Another game may have its own `draw()`.
  const draw =
    drawing !== undefined ? game.drawLayers : (game as unknown as { draw?: () => unknown }).draw;
  let stopped = false;
  let before = now();
  let owed = 0;
  // A game with turns: the time of the latest tick, so that `blend` runs from 0 to 1 after it.
  let ticked = -Infinity;
  const frame = async () => {
    if (stopped) return;
    const at = now();
    if (hidden()) {
      // The ticks of the time the page was hidden are not run after.
      before = at;
      owed = 0;
      ticked = -Infinity;
      setLoopBlend(game, game.stepOn === 'input' ? 1 : 0);
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
      // `blend` (design record 0111, section 6). A game with a clock gives the part of a tick that
      // the loop still owes. A game with turns gives the time since its latest tick, in ticks.
      if (game.stepOn === 'input') {
        if (ticks > 0) ticked = at;
        setLoopBlend(game, Math.min(1, Math.max(0, ((at - ticked) / 1000) * game.hz)));
      } else {
        setLoopBlend(game, owed);
      }
      let tickMs = 0;
      if (options.onFrame !== undefined && ticks > 0) {
        await game.wait();
        tickMs = now() - at;
      }
      if (stopped) return;
      if (typeof draw === 'function') await draw.call(game);
      options.onFrame?.({ tier: game.tier, tickMs, frameMs, ticks, at: game.tick });
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
