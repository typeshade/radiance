// One seed, one image (docs/design/0005-determinism.md). One renderer draws the Cornell box with
// seed 2, then with seed 1, then with seed 1 again. Each render is read back as floats, and the
// page counts the floats that differ. The two renders of seed 1 differ in none, and seed 2 differs
// in many.
//
// The size is the canvas's, and the samples and the samples a frame are fixed. Nothing moves. A
// pixel's samples add up in chunks of `samplesPerFrame`, so two renders compared bit for bit must
// use the same chunks. That is why `targetFrameTime`, which changes the chunk with the time, is
// not set here. The render gate (scripts/gates/render.mjs) sets `maxSamples` after the set-up, so
// each render stops at the smaller of `RENDER.samples` and `maxSamples`.
//
// The order of the renders is the split's. The first frame that a renderer draws adds one sample.
// So the first render has frames of 1, 16, 16, 16 and 15 samples, and every later render has
// frames of 16. Seed 2 comes first and takes that split. The two renders of seed 1 come second and
// third, and they have the same split. Seed 2 differs from seed 1 in many floats with any split.
// The render gate reads the first render, so its golden shows seed 2.

import { PathTracer } from '@typeshade/radiance';
import { createCornellBox } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

/** The render. The size is the canvas's, and these are its fallback. The page reads the rest. */
export const RENDER = {
  width: 320,
  height: 200,
  samples: 64,
  perFrame: 16,
  seed: 1,
  otherSeed: 2,
} as const;
const { samples: SAMPLES, perFrame: PER_FRAME } = RENDER;
const { seed: SEED, otherSeed: OTHER_SEED } = RENDER;
/** A render's size in pixels. */
type Size = { width: number; height: number };
/** The difference picture shows each channel's difference times this. */
const GAIN = 16;
/** A pixel with a differing float shows at least this bright, so no difference is too small. */
const FLOOR = 0.25;
/** The milliseconds a finished render stays on the canvas before the next one starts. */
const HOLD = 100;

/** How many floats of `a` and `b` differ bit for bit. `Object.is` decides, as the gate does. */
function countDifferent(a: Float32Array, b: Float32Array): number {
  let count = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (!Object.is(a[i], b[i])) count++;
  return count;
}

/** The difference of two renders as a picture: black where every float of a pixel is the same. */
function differencePicture(a: Float32Array, b: Float32Array, size: Size): ImageData {
  const bytes = new Uint8ClampedArray(size.width * size.height * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    const differs = [0, 1, 2, 3].some((c) => !Object.is(a[i + c], b[i + c]));
    for (let c = 0; c < 3; c++) {
      const scaled = Math.abs(a[i + c]! - b[i + c]!) * GAIN;
      const shade = Number.isNaN(scaled) ? 1 : Math.min(1, scaled);
      bytes[i + c] = differs ? Math.round(Math.max(FLOOR, shade) * 255) : 0;
    }
    bytes[i + 3] = 255;
  }
  return new ImageData(bytes, size.width, size.height);
}

/** The displayed image of a render, `readPixels()`'s floats, as a picture. */
function picture(texels: Float32Array, size: Size): ImageData {
  return new ImageData(
    Uint8ClampedArray.from(texels, (t) => Math.round(t * 255)),
    size.width,
    size.height,
  );
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}

/** Three pictures with captions, and a list of counts. `rd-panel` is styled in custom.css. */
function buildPanel(size: Size) {
  const panel = element('div', 'rd-panel');
  const pictures = element('div', 'rd-panel-pictures');
  const tiles = (
    [
      ['Seed 1', 'The first render of seed 1.'],
      ['Seed 1 again', 'The same seed, after a reset.'],
      ['Difference', `Times ${GAIN}. Black means no float differs.`],
    ] as const
  ).map(([title, note]) => {
    const figure = element('figure', '');
    const tile = document.createElement('canvas');
    [tile.width, tile.height] = [size.width, size.height];
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
      ['floats', 'Floats in one render', size.width * size.height * 4],
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
  const size: Size = {
    width: canvas.clientWidth || RENDER.width,
    height: canvas.clientHeight || RENDER.height,
  };
  camera.aspect = size.width / size.height;
  const renderer = new PathTracer({ canvas, seed: SEED, samplesPerFrame: PER_FRAME });
  renderer.setSize(size.width, size.height);
  renderer.maxSamples = SAMPLES;
  await renderer.init();
  canvas.style.cursor = 'default';
  const { panel, tiles, counts, status } = buildPanel(size);

  let stopped = false;
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  /**
   * Render with `seed` from zero to the sample count, one frame at a time, so that the stage's
   * Pause stops it. The picture of the render before stays on the canvas for a moment first: the
   * render gate reads the displayed image when the samples reach their count, and a reset at that
   * moment would give it a picture of the next render.
   */
  async function render(seed: number, message: string) {
    status.textContent = message;
    await new Promise((resolve) => setTimeout(resolve, HOLD));
    if (stopped) throw new Error('stopped');
    renderer.seed = seed;
    renderer.reset();
    do {
      await nextFrame();
      if (stopped) throw new Error('stopped');
      await renderer.render(scene, camera);
    } while (renderer.samples < Math.min(SAMPLES, renderer.maxSamples));
    return { radiance: await renderer.readRadiance(), pixels: await renderer.readPixels() };
  }

  async function run() {
    // The first render takes the first frame's single sample, so seed 2 goes first. The two
    // renders of seed 1 that follow have one split. The canvas ends on the last of them.
    const other = await render(OTHER_SEED, `Rendering seed ${OTHER_SEED}.`);
    const first = await render(SEED, `Rendering seed ${SEED}.`);
    tiles[0]!.putImageData(picture(first.pixels, size), 0, 0);
    counts[2]!(countDifferent(first.radiance, other.radiance));
    const again = await render(SEED, `Rendering seed ${SEED} again.`);
    tiles[1]!.putImageData(picture(again.pixels, size), 0, 0);
    tiles[2]!.putImageData(differencePicture(first.radiance, again.radiance, size), 0, 0);
    const same = countDifferent(first.radiance, again.radiance);
    counts[1]!(same);
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
