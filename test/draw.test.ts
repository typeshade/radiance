// Verifies: Design 0111.3
// Verifies: Design 0111.4
// Verifies: Design 0111.5
//
// The view and the frame of a game with layers (design record 0111), with no GPU. The harness of
// the reference game reads the same view from a screenshot, and the layers on a device.

import { createDevice, type Device } from 'typeshade/runtime';
import { expect, test } from 'vitest';
import { fitRectangle, placeInWorld, viewMatrix, type Drawing } from '../src/draw.ts';
import { Engine } from '../src/index.ts';
import { run } from '../src/page.ts';
import { Row, bump } from './fixtures/sim.shade.ts';

/** Where a place of the world is on a screen of `size` pixels, given the view's matrix. */
function pixelOf(matrix: readonly number[], size: readonly [number, number], x: number, y: number) {
  const ndcX = matrix[0] * x + matrix[4] * y + matrix[12];
  const ndcY = matrix[1] * x + matrix[5] * y + matrix[13];
  return { x: ((ndcX + 1) / 2) * size[0], y: ((1 - ndcY) / 2) * size[1] };
}

const FIT = [10, 6] as const;

/** Holds a pixel to a place, with the error of f32 arithmetic in mind. */
function expectAt(pixel: { x: number; y: number }, x: number, y: number) {
  expect(pixel.x).toBeCloseTo(x, 6);
  expect(pixel.y).toBeCloseTo(y, 6);
}

test('the matrix puts the rectangle of the world in the middle of a wide screen', () => {
  // 800 by 480 is the shape of the world, so the rectangle fills the screen.
  const wide = viewMatrix(FIT, [800, 480]);
  expectAt(pixelOf(wide, [800, 480], 0, 0), 0, 0);
  expectAt(pixelOf(wide, [800, 480], 10, 6), 800, 480);
  // 1200 by 480 is wider: the rectangle fills the height, with a bar of 200 pixels on each side.
  const wider = viewMatrix(FIT, [1200, 480]);
  expectAt(pixelOf(wider, [1200, 480], 0, 0), 200, 0);
  expectAt(pixelOf(wider, [1200, 480], 10, 6), 1000, 480);
  expectAt(pixelOf(wider, [1200, 480], 5, 3), 600, 240);
});

test('the matrix puts the rectangle of the world in the middle of an upright screen', () => {
  // 400 by 800: the rectangle fills the width at 40 pixels a unit, and it is 240 pixels high,
  // with a bar of 280 pixels above it and below it.
  const upright = viewMatrix(FIT, [400, 800]);
  expectAt(pixelOf(upright, [400, 800], 0, 0), 0, 280);
  expectAt(pixelOf(upright, [400, 800], 10, 6), 400, 520);
  expectAt(pixelOf(upright, [400, 800], 5, 3), 200, 400);
  // The x axis goes right, and the y axis goes down.
  expect(pixelOf(upright, [400, 800], 1, 0).x).toBeGreaterThan(
    pixelOf(upright, [400, 800], 0, 0).x,
  );
  expect(pixelOf(upright, [400, 800], 0, 1).y).toBeGreaterThan(
    pixelOf(upright, [400, 800], 0, 0).y,
  );
});

test('one unit of the world has the same length on the two axes of the screen', () => {
  for (const size of [
    [800, 480],
    [400, 800],
    [1082, 2202],
    [300, 700],
    [1920, 1080],
    [100, 100],
  ] as const) {
    const matrix = viewMatrix(FIT, size);
    const origin = pixelOf(matrix, size, 0, 0);
    const alongX = pixelOf(matrix, size, 1, 0);
    const alongY = pixelOf(matrix, size, 0, 1);
    const lengthX = alongX.x - origin.x;
    const lengthY = alongY.y - origin.y;
    expect(lengthX).toBeCloseTo(lengthY, 9);
    expect(lengthX).toBeCloseTo(fitRectangle(FIT, size).scale, 9);
    // A unit moves a place along one axis only.
    expect(alongX.y).toBeCloseTo(origin.y, 9);
    expect(alongY.x).toBeCloseTo(origin.x, 9);
    // The whole rectangle is on the screen.
    const far = pixelOf(matrix, size, FIT[0], FIT[1]);
    for (const at of [origin, far]) {
      expect(at.x).toBeGreaterThanOrEqual(-1e-9);
      expect(at.y).toBeGreaterThanOrEqual(-1e-9);
      expect(at.x).toBeLessThanOrEqual(size[0] + 1e-9);
      expect(at.y).toBeLessThanOrEqual(size[1] + 1e-9);
    }
  }
});

test('a place of the screen gives the place of the world under it', () => {
  const size = [400, 800] as const;
  const matrix = viewMatrix(FIT, size);
  for (const [x, y] of [
    [0, 0],
    [3.5, 3.5],
    [9.99, 5.99],
    [-1, 7],
  ]) {
    const pixel = pixelOf(matrix, size, x, y);
    const back = placeInWorld(FIT, size, { x: pixel.x / size[0], y: pixel.y / size[1] });
    expect(back.x).toBeCloseTo(x, 9);
    expect(back.y).toBeCloseTo(y, 9);
  }
  // A place above the rectangle is a place with a y below 0.
  expect(placeInWorld(FIT, size, { x: 0.5, y: 0.1 }).y).toBeLessThan(0);
});

class Layered extends Engine {
  readonly tables = { rows: this.table(Row) };
  readonly systems = { bump: () => bump(this.tables.rows.rows, this.dt) };
  override readonly layers = [
    {
      name: 'cells',
      program: {},
      vertex: 'place',
      fragment: 'paint',
      rows: this.tables.rows,
      bind: (view: readonly number[]) => ({ view }),
    },
  ];
  override readonly view = { fit: [10, 6] } as const;
}

class Plain extends Engine {
  readonly tables = { rows: this.table(Row) };
  readonly systems = { bump: () => bump(this.tables.rows.rows, this.dt) };
}

/** A device of the CPU tier that counts its waits. */
async function counted(): Promise<{ device: Device; waits: () => number }> {
  const device = await createDevice({ prefer: ['cpu'] });
  const wait = device.wait.bind(device);
  let waits = 0;
  device.wait = () => {
    waits++;
    return wait();
  };
  return { device, waits: () => waits };
}

test('a game with layers waits for the device once, after its first tick', async () => {
  const { device, waits } = await counted();
  const drawn: string[] = [];
  const drawing: Drawing = {
    frame: async () => void drawn.push('frame'),
    toWorld: (at) => ({ x: at.x * 10, y: at.y * 6 }),
    dispose: () => void drawn.push('dispose'),
  };
  const game = Engine.start(new Layered(), device, {
    seed: 1,
    rows: { rows: [new Row()] },
    drawing,
  });
  await game.step(0);
  expect(waits()).toBe(0);
  await game.step(2);
  expect(waits()).toBe(1);
  await game.step(3);
  expect(waits()).toBe(1);
  // The engine hands the frame and the place to the drawing.
  await game.drawLayers();
  expect(game.toWorld({ x: 0.5, y: 0.5 })).toEqual({ x: 5, y: 3 });
  await game.dispose();
  expect(drawn).toEqual(['frame', 'dispose']);
});

test('a game with no layers on a device waits for no first tick, and it refuses a frame and a place', async () => {
  const { device, waits } = await counted();
  const game = Engine.start(new Plain(), device, { seed: 1, rows: { rows: [new Row()] } });
  await game.step(2);
  expect(waits()).toBe(0);
  await expect(game.drawLayers()).rejects.toThrow(
    'Plain.drawLayers(): the game has no layers on a device. Add "draw" and "view" to radiance.config.ts, and run the game with run() of radiance/page.',
  );
  expect(() => game.toWorld({ x: 0, y: 0 })).toThrow(
    'Plain.toWorld(): the game has no layers on a device, so it has no view. Add "draw" and "view" to radiance.config.ts, and run the game with run() of radiance/page.',
  );
  await game.dispose();
});

const canvas = {
  addEventListener() {},
  removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
  width: 200,
  height: 100,
};

test('a browser with no WebGPU gets the error of the layers, with the compiler issues', async () => {
  // This test runs in Node, where `navigator.gpu` does not exist.
  const failure = await run(Layered, { seed: 1, canvas, rows: { rows: [new Row()] } }).catch(
    (error: unknown) => error as Error,
  );
  expect(failure).toBeInstanceOf(Error);
  const text = (failure as Error).message;
  expect(text.startsWith('run(): the game draws in layers (cells), and layers need WebGPU. ')).toBe(
    true,
  );
  expect(text).toContain('The page got no WebGPU device: ');
  expect(text).toContain(
    ' WebGL2 cannot draw a layer yet. A storage array of a class with a class in a field has no WebGL2 form (typeshade/typeshade#1249), and the page cannot be the target of a pass (typeshade/typeshade#1263).',
  );
});

test('a game with layers makes its own device, so run refuses a device that it is given', async () => {
  const device = await createDevice({ prefer: ['cpu'] });
  await expect(
    run(Layered, { seed: 1, canvas, device, rows: { rows: [new Row()] } }),
  ).rejects.toThrow(
    'run(): the game draws in layers (cells), and run makes the device for them. Do not give a device.',
  );
  await device.dispose();
});
