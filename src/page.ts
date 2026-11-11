// Design: 0104, section 6. The loop of a page: the ticks that are due, then the picture. This
// is the one file under `src/` that reads a clock, and it is the page's clock.

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
