// One seed, one image (docs/design/0005-determinism.md). One renderer draws the Cornell box with
// seed 1, again with seed 1, and once with seed 2. Each render is read back as floats, and the
// page counts the floats that differ. Two renders of seed 1 differ in none, and seed 2 differs
// in many.
//
// The size, the samples and the samples a frame are fixed, and nothing moves. A pixel's samples
// add up in chunks of `samplesPerFrame`, so two renders compared bit for bit must use the same
// chunks. That is why `targetFrameTime`, which changes the chunk with the time, is not set here.

import { PathTracer } from '@typeshade/radiance';
import { createCornellBox } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

/** The render, fixed. The page's text reads these numbers from here. */
export const RENDER = {
  width: 320,
  height: 200,
  samples: 128,
  perFrame: 16,
  seed: 1,
  otherSeed: 2,
} as const;
const { width: WIDTH, height: HEIGHT, samples: SAMPLES, perFrame: PER_FRAME } = RENDER;
const { seed: SEED, otherSeed: OTHER_SEED } = RENDER;
/** The difference picture shows each channel's difference times this. */
const GAIN = 16;
/** A pixel with a differing float shows at least this bright, so no difference is too small. */
const FLOOR = 0.25;

/** How many floats of `a` and `b` differ bit for bit. `Object.is` decides, as the gate does. */
function countDifferent(a: Float32Array, b: Float32Array): number {
  let count = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (!Object.is(a[i], b[i])) count++;
  return count;
}

/** The difference of two renders as a picture: black where every float of a pixel is the same. */
function differencePicture(a: Float32Array, b: Float32Array): ImageData {
  const bytes = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    const differs = [0, 1, 2, 3].some((c) => !Object.is(a[i + c], b[i + c]));
    for (let c = 0; c < 3; c++) {
      const scaled = Math.abs(a[i + c]! - b[i + c]!) * GAIN;
      const shade = Number.isNaN(scaled) ? 1 : Math.min(1, scaled);
      bytes[i + c] = differs ? Math.round(Math.max(FLOOR, shade) * 255) : 0;
    }
    bytes[i + 3] = 255;
  }
  return new ImageData(bytes, WIDTH, HEIGHT);
}

/** The displayed image of a render, `readPixels()`'s floats, as a picture. */
function picture(texels: Float32Array): ImageData {
  return new ImageData(
    Uint8ClampedArray.from(texels, (t) => Math.round(t * 255)),
    WIDTH,
    HEIGHT,
  );
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}

/** Three pictures with captions, and a list of counts. `rd-panel` is styled in custom.css. */
function buildPanel() {
  const panel = element('div', 'rd-panel');
  const pictures = element('div', 'rd-panel-pictures');
  const tiles = (
    [
      ['Seed 1', 'The first render.'],
      ['Seed 1 again', 'The same seed, after a reset.'],
      ['Difference', `Times ${GAIN}. Black means no float differs.`],
    ] as const
  ).map(([title, note]) => {
    const figure = element('figure', '');
    const tile = document.createElement('canvas');
    [tile.width, tile.height] = [WIDTH, HEIGHT];
    tile.setAttribute('role', 'img');
    tile.setAttribute('aria-label', `${title}. ${note}`);
    const caption = element('figcaption', '', title);
    caption.append(element('small', '', note));
    figure.append(tile, caption);
    pictures.append(figure);
    return tile.getContext('2d')!;
  });
  const list = element('dl', 'rd-panel-counts');
  const counts = (
    [
      ['floats', 'Floats in one render', WIDTH * HEIGHT * 4],
      ['same-seed', `Differ, seed ${SEED} against seed ${SEED} again`, undefined],
      ['other-seed', `Differ, seed ${SEED} against seed ${OTHER_SEED}`, undefined],
    ] as const
  ).map(([key, label, value]) => {
    const number = element('dd', 'rd-num');
    number.dataset.count = key;
    const row = element('div', '');
    row.append(element('dt', '', label), number);
    list.append(row);
    const set = (n: number | undefined): void => {
      number.dataset.value = n === undefined ? '' : String(n);
      number.textContent = n === undefined ? 'waiting' : n.toLocaleString('en-US');
    };
    set(value);
    return set;
  });
  const status = element('p', 'rd-panel-status');
  status.setAttribute('role', 'status');
  panel.append(pictures, list, status);
  return { panel, tiles, counts, status };
}

export default async function determinism(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const { scene, camera } = createCornellBox();
  camera.aspect = WIDTH / HEIGHT;
  const renderer = new PathTracer({ canvas, seed: SEED, samplesPerFrame: PER_FRAME });
  renderer.setSize(WIDTH, HEIGHT);
  renderer.maxSamples = SAMPLES;
  await renderer.init();
  canvas.style.cursor = 'default';
  const { panel, tiles, counts, status } = buildPanel();

  let stopped = false;
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  /** Render from zero to SAMPLES, one frame at a time, so that the stage's Pause stops it. */
  async function render(message: string) {
    status.textContent = message;
    renderer.reset();
    do {
      await nextFrame();
      if (stopped) throw new Error('stopped');
      await renderer.render(scene, camera);
    } while (renderer.samples < SAMPLES);
    return { radiance: await renderer.readRadiance(), pixels: await renderer.readPixels() };
  }

  async function run() {
    const first = await render(`Rendering seed ${SEED}.`);
    tiles[0]!.putImageData(picture(first.pixels), 0, 0);
    const again = await render(`Rendering seed ${SEED} again.`);
    tiles[1]!.putImageData(picture(again.pixels), 0, 0);
    tiles[2]!.putImageData(differencePicture(first.radiance, again.radiance), 0, 0);
    const same = countDifferent(first.radiance, again.radiance);
    counts[1]!(same);
    renderer.seed = OTHER_SEED;
    const other = await render(`Rendering seed ${OTHER_SEED}.`);
    counts[2]!(countDifferent(first.radiance, other.radiance));
    // Draw seed 1 on the canvas again, so that the canvas and its PNG show the first render.
    renderer.seed = SEED;
    await render(`Drawing seed ${SEED} on the canvas again.`);
    status.textContent =
      same === 0
        ? `Two renders of seed ${SEED} are bit-identical.`
        : `Two renders of seed ${SEED} differ in ${same} floats.`;
    panel.dataset.done = '';
  }
  run().catch((e: unknown) => {
    if (stopped) return;
    status.textContent = `Not running: ${e instanceof Error ? e.message : String(e)}`;
  });

  return {
    renderer,
    panel,
    dispose() {
      stopped = true;
      renderer.dispose();
    },
  };
}
