// Verifies: Design 0104.6
//
// `frames`, the loop of a page, with a clock and a scheduler that the test gives.

import { expect, test } from 'vitest';
import { frames } from '../src/page.ts';

/** A page the test drives: a clock it sets, and the next frame it runs by hand. */
function page() {
  let time = 0;
  let next: (() => void) | undefined;
  const steps: number[] = [];
  let draws = 0;
  const sim: { hz: number; step(n: number): Promise<void> } = {
    hz: 30,
    step: async (n) => void steps.push(n),
  };
  return {
    sim,
    steps,
    get draws() {
      return draws;
    },
    draw: () => void draws++,
    options: { now: () => time, schedule: (frame: () => void) => void (next = frame) },
    /** Moves the clock and runs the frame that was asked for. */
    async advance(ms: number) {
      time += ms;
      const frame = next;
      next = undefined;
      frame?.();
      await new Promise((done) => setTimeout(done, 0));
    },
    get asked() {
      return next !== undefined;
    },
  };
}

test('a frame runs the ticks that are due at the tick rate, then draws', async () => {
  const p = page();
  frames(p.sim, p.draw, p.options);
  // 100 ms at 30 ticks in a second are 3 ticks.
  await p.advance(100);
  expect(p.steps).toEqual([3]);
  expect(p.draws).toBe(1);
  // 16 ms are less than a tick. The part of a tick is kept for the next frame.
  await p.advance(16);
  await p.advance(16);
  await p.advance(16);
  expect(p.steps).toEqual([3, 0, 0, 1]);
  expect(p.draws).toBe(4);
});

test('a frame runs no more than maxTicks, and drops the rest', async () => {
  const p = page();
  frames(p.sim, p.draw, { ...p.options, maxTicks: 4 });
  await p.advance(10_000);
  expect(p.steps).toEqual([4]);
  await p.advance(34);
  expect(p.steps).toEqual([4, 1]);
});

test('the next frame is asked for when the frame is done', async () => {
  const p = page();
  let release: (() => void) | undefined;
  p.sim.step = (n: number) => {
    p.steps.push(n);
    return new Promise<void>((done) => (release = done));
  };
  frames(p.sim, p.draw, p.options);
  await p.advance(100);
  // The step is not done: no draw, and no next frame.
  expect(p.draws).toBe(0);
  expect(p.asked).toBe(false);
  release?.();
  await new Promise((done) => setTimeout(done, 0));
  expect(p.draws).toBe(1);
  expect(p.asked).toBe(true);
});

test('the function it returns stops the loop', async () => {
  const p = page();
  const stop = frames(p.sim, p.draw, p.options);
  await p.advance(100);
  stop();
  await p.advance(100);
  expect(p.steps).toEqual([3]);
  expect(p.draws).toBe(1);
});

test('a wrong maxTicks is refused', () => {
  const p = page();
  expect(() => frames(p.sim, p.draw, { maxTicks: 0 })).toThrow(
    'frames(): maxTicks is 0. Give an integer from 1.',
  );
});
