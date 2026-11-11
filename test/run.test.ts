// Verifies: Design 0108.7
// Verifies: Design 0108.9
// Verifies: Design 0111.6
//
// The loop of a page (design record 0108, section 7), with a clock, a canvas and a device that
// the test gives. The device is the CPU tier, so no browser runs.

import { createDevice } from 'typeshade/runtime';
import { expect, test } from 'vitest';
import { Engine, type KeyInput, type PointerInput } from '../src/index.ts';
import { readout, run, type FrameStats } from '../src/page.ts';
import { Row, bump } from './fixtures/sim.shade.ts';

/** A canvas that holds its listeners, so a test can send an event. */
function fakeCanvas() {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const target = {
    addEventListener(event: string, listener: (event: never) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener as (e: unknown) => void]);
    },
    removeEventListener(event: string, listener: (event: never) => void) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((l) => l !== (listener as unknown)),
      );
    },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
  };
  return {
    canvas: target,
    send: (event: string, data: object) => (listeners.get(event) ?? []).forEach((l) => l(data)),
    count: (event: string) => (listeners.get(event) ?? []).length,
  };
}

/** A clock and a frame queue that the test turns by hand. */
function fakePage() {
  let at = 0;
  let next: (() => void) | undefined;
  let hidden = false;
  return {
    now: () => at,
    schedule: (frame: () => void) => void (next = frame),
    hidden: () => hidden,
    hide: (value: boolean) => void (hidden = value),
    /** Moves the clock by `ms` and runs the frame that waits. */
    async frame(ms: number) {
      at += ms;
      const frame = next;
      next = undefined;
      frame?.();
      // The frame is a promise chain of at most a few steps on the CPU tier.
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    waiting: () => next !== undefined,
  };
}

class Clocked extends Engine {
  readonly tables = { rows: this.table(Row) };
  readonly systems = { bump: () => bump(this.tables.rows.rows, this.dt) };
  draws = 0;
  last: PointerInput | KeyInput | undefined;

  override readonly inputs = {
    pointerdown: (at: PointerInput) => {
      this.last = at;
      this.tables.rows.input(0, { n: 100 });
    },
    keydown: (key: KeyInput) => {
      this.last = key;
    },
  };
  draw() {
    this.draws++;
  }
}

class Turns extends Clocked {
  override readonly stepOn = 'input' as const;
}

const first = () => ({ seed: 1, hz: 10, rows: { rows: [new Row()] } });

test('the loop runs the ticks that are due, at most maxTicks, then draws', async () => {
  const page = fakePage();
  const { canvas } = fakeCanvas();
  const device = await createDevice({ prefer: ['cpu'] });
  const game = await run(Clocked, { ...first(), canvas, device, maxTicks: 3, ...page });
  await page.frame(250); // 2.5 ticks at 10 hz
  expect([game.tick, game.draws]).toEqual([2, 1]);
  await page.frame(50); // the half tick that was left, and half a tick more
  expect([game.tick, game.draws]).toEqual([3, 2]);
  await page.frame(1000); // 10 ticks are due, and the frame runs 3
  expect([game.tick, game.draws]).toEqual([6, 3]);
  await game.dispose();
});

test('the loop stops while the page is hidden, and does not run those ticks after', async () => {
  const page = fakePage();
  const { canvas } = fakeCanvas();
  const device = await createDevice({ prefer: ['cpu'] });
  const game = await run(Clocked, { ...first(), canvas, device, ...page });
  page.hide(true);
  await page.frame(5000);
  expect([game.tick, game.draws]).toEqual([0, 0]);
  page.hide(false);
  await page.frame(100);
  expect([game.tick, game.draws]).toEqual([1, 1]);
  await game.dispose();
});

test('a game with turns runs one tick for each frame that has an input', async () => {
  const page = fakePage();
  const { canvas, send } = fakeCanvas();
  const device = await createDevice({ prefer: ['cpu'] });
  const game = await run(Turns, { ...first(), canvas, device, ...page });
  await page.frame(1000);
  expect([game.tick, game.draws]).toEqual([0, 1]);
  send('pointerdown', { clientX: 110, clientY: 45, buttons: 1 });
  expect(game.pending).toBe(1);
  expect(game.last).toEqual({ x: 0.5, y: 0.25, down: true });
  await page.frame(16);
  expect(game.tick).toBe(1);
  // The input set n to 100 before the tick, and the tick added 1.
  expect((await game.tables.rows.read())[0].n).toBe(101);
  expect(game.record().inputs).toEqual([{ tick: 0, table: 'rows', index: 0, fields: { n: 100 } }]);
  send('keydown', { key: 'ArrowUp' });
  expect(game.last).toEqual({ key: 'ArrowUp' });
  await page.frame(16);
  expect(game.tick).toBe(1);
  await game.dispose();
});

test('dispose ends the loop and takes the listeners off the canvas', async () => {
  const page = fakePage();
  const { canvas, count } = fakeCanvas();
  const device = await createDevice({ prefer: ['cpu'] });
  const game = await run(Clocked, { ...first(), canvas, device, ...page });
  expect([count('pointerdown'), count('keydown'), game.surface]).toEqual([1, 1, canvas]);
  await game.dispose();
  expect([count('pointerdown'), count('keydown')]).toEqual([0, 0]);
  await page.frame(1000);
  expect(page.waiting()).toBe(false);
});

test('run refuses a place with no canvas and a wrong maxTicks', async () => {
  await expect(run(Clocked, { ...first(), canvas: undefined })).rejects.toThrow(
    'run(): the options hold no canvas. Give the canvas of the page, for example { canvas: document.querySelector("canvas") }.',
  );
  const { canvas } = fakeCanvas();
  await expect(run(Clocked, { ...first(), canvas, maxTicks: 0 })).rejects.toThrow(
    'run(): maxTicks is 0. Give an integer from 1.',
  );
});

// Verifies: Design 0110.2
test('run calls onFrame once for each frame, with the tier, the ticks and the times', async () => {
  const page = fakePage();
  const { canvas } = fakeCanvas();
  const device = await createDevice({ prefer: ['cpu'] });
  const seen: FrameStats[] = [];
  const onFrame = (stats: FrameStats) => void seen.push(stats);
  const game = await run(Clocked, { ...first(), canvas, device, ...page, onFrame });
  await page.frame(250); // 2.5 ticks at 10 hz
  await page.frame(50);
  expect(seen).toEqual([
    { tier: 'cpu', tickMs: 0, frameMs: 250, ticks: 2, at: 2 },
    { tier: 'cpu', tickMs: 0, frameMs: 50, ticks: 1, at: 3 },
  ]);
  await game.dispose();
});

// Verifies: Design 0110.1
test('the line of a readout holds the tier, the tick, the means of the last 60 frames and the commit', () => {
  const line = readout('011f294');
  expect(line({ tier: 'webgpu', tickMs: 1.6, frameMs: 16.7, ticks: 2, at: 480 })).toBe(
    'webgpu  at tick 480  tick 0.8 ms  frame 16.7 ms  2 tick/frame  011f294',
  );
  expect(line({ tier: 'webgpu', tickMs: 0, frameMs: 16.7, ticks: 0, at: 480 })).toBe(
    'webgpu  at tick 480  tick 0.8 ms  frame 16.7 ms  1 tick/frame  011f294',
  );
  // A frame with no tick yet gives no time of a tick.
  expect(readout('abc')({ tier: 'webgl2', tickMs: 0, frameMs: 20, ticks: 0, at: 0 })).toBe(
    'webgl2  at tick 0  tick 0.0 ms  frame 20.0 ms  0 tick/frame  abc',
  );
  // The 61st frame pushes the first one out of the means.
  const long = readout('abc');
  long({ tier: 'webgpu', tickMs: 600, frameMs: 600, ticks: 1, at: 1 });
  let last = '';
  for (let i = 0; i < 60; i++)
    last = long({ tier: 'webgpu', tickMs: 1, frameMs: 10, ticks: 1, at: 61 });
  expect(last).toBe('webgpu  at tick 61  tick 1.0 ms  frame 10.0 ms  1 tick/frame  abc');
});

// Verifies: Design 0110.1
test('a frame that fails stops the loop and gives the error to onError', async () => {
  class Broken extends Clocked {
    override draw() {
      throw new Error('nothing can draw into this canvas');
    }
  }
  const page = fakePage();
  const { canvas } = fakeCanvas();
  const device = await createDevice({ prefer: ['cpu'] });
  const errors: unknown[] = [];
  const onError = (error: unknown) => void errors.push(error);
  const game = await run(Broken, { ...first(), canvas, device, ...page, onError });
  await page.frame(250);
  expect(errors.map((error) => (error as Error).message)).toEqual([
    'nothing can draw into this canvas',
  ]);
  expect(page.waiting()).toBe(false);
  await game.dispose();
});

// Verifies: Design 0111.6
test('blend is the part of a tick that the loop still owes, and it is 0 before the loop gives one', async () => {
  const page = fakePage();
  const { canvas } = fakeCanvas();
  const device = await createDevice({ prefer: ['cpu'] });
  const game = await run(Clocked, { ...first(), canvas, device, maxTicks: 3, ...page });
  expect(game.blend).toBe(0);
  await page.frame(250); // 2.5 ticks at 10 hz: 2 ticks run, half a tick is owed
  expect([game.tick, game.blend]).toEqual([2, 0.5]);
  await page.frame(30); // 0.3 tick more: 0.8 is owed
  expect(game.tick).toBe(2);
  expect(game.blend).toBeCloseTo(0.8, 10);
  await page.frame(20); // 0.2 tick more: the tick runs, and nothing is owed
  expect([game.tick, game.blend]).toEqual([3, 0]);
  await page.frame(1000); // 10 ticks are due and 3 run: the loop owes no part of a tick
  expect([game.tick, game.blend]).toEqual([6, 0]);
  page.hide(true);
  await page.frame(50);
  page.hide(false);
  await page.frame(30);
  expect([game.tick, game.blend]).toEqual([6, 0.3]);
  await game.dispose();
});

// Verifies: Design 0111.6
test('blend of a game with turns goes from 0 to 1 in the time of a tick, and then it stays at 1', async () => {
  const page = fakePage();
  const { canvas, send } = fakeCanvas();
  const device = await createDevice({ prefer: ['cpu'] });
  const game = await run(Turns, { ...first(), canvas, device, ...page });
  expect(game.blend).toBe(0);
  await page.frame(1000); // no tick has run: the game is at rest
  expect([game.tick, game.blend]).toEqual([0, 1]);
  send('pointerdown', { clientX: 110, clientY: 45, buttons: 1 });
  await page.frame(16); // the tick runs in this frame
  expect([game.tick, game.blend]).toEqual([1, 0]);
  await page.frame(40); // 40 ms of the 100 ms of a tick at 10 hz
  expect(game.blend).toBeCloseTo(0.4, 10);
  await page.frame(30);
  expect(game.blend).toBeCloseTo(0.7, 10);
  await page.frame(500);
  expect([game.tick, game.blend]).toEqual([1, 1]);
  await page.frame(500);
  expect(game.blend).toBe(1);
  // A new tick starts it again from 0.
  send('keydown', { key: 'ArrowUp' });
  game.tables.rows.input(0, { n: 1 });
  await page.frame(16);
  expect([game.tick, game.blend]).toEqual([2, 0]);
  await game.dispose();
});
