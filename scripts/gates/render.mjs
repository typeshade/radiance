// === The render gate: each example's picture held to its committed golden ===
//
// The gate runs each example of site/examples on a canvas of `RENDER.size`, with `RENDER.seed`,
// until every pixel has `RENDER.samples` samples. An example that sets its own seeds is held at the
// seed of the first render that reaches `RENDER.samples` (`OWN_SEED`). It runs on the harness
// browser. `RENDER` is in scripts/gates.mjs. The displayed image, `readPixels()`, is quantized to 8
// bits as the PNG encoder does. The gate holds it to scripts/__goldens__/<example>.png within the
// tolerance of `RENDER`. The goldens are 8-bit PNGs. The gate writes them, and the decoder in
// ./_png.mjs reads them. Docs/design/0002-verification.md lists the gate. Run it alone with
// `bun run gate:render`.
//
// The site's stills (site/public/stills) are not goldens. A still is the picture a page shows,
// captured at 64 samples a pixel and hashed (scripts/capture-stills.mjs).
//
// `run(options)` renders every example and answers `{ ok, numbers, message }`. `numbers` holds
// one entry for each example. Each entry has the values the tolerance judges, in 8-bit units:
//
//   mean     the mean absolute difference over the red, green and blue channels. Bound: `RENDER.mean`.
//   worst    the largest difference of any channel.
//   outside  the pixels with a channel beyond `RENDER.channel`. Bound: `RENDER.outside` of all.
//   pixels   the pixels of the picture.
//   ms       the milliseconds the example took: its set-up, its samples and the read-back.
//
// `UPDATE_GOLDENS=1 bun run gate:render` rewrites the goldens instead of holding to them. It
// prints how far each new golden is from the old one. The pull request that does so shows each
// old and new picture (README.md, Checks).
//
// `probe()` runs the gate once wrong on purpose and throws when the gate does not see it. It
// plants a fault in each golden and reads the golden back through the PNG encoder and decoder.
//
// `probeRadius(options)` is the radius probe of record 0002 ("The probes"). It renders
// `cornell-box` once more with the `radius` of every `Sphere` times 1.01, and throws when
// `comparePictures` passes that picture against the golden. It needs a render page.
//
// Options: `session` is an open render page (`openRenderPage` in ./_browser.mjs). Without one, the
// gate opens its own. `update` rewrites the goldens. `dir` names the goldens' directory.
// `examples` names the examples to run.

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RENDER } from '../gates.mjs';
import { exampleIds } from '../stills.mjs';
import { outDir, withRenderPage } from './_browser.mjs';
import { decodePng, encodePngBytes, toBytes } from './_png.mjs';

/** The directory of the goldens: one `<example>.png` for each example. */
export const GOLDENS = fileURLToPath(new URL('../__goldens__/', import.meta.url));
const SITE = fileURLToPath(new URL('../../site', import.meta.url));

/**
 * Holds `actual` to `golden`, two pictures `{ width, height, data }` of 8-bit RGBA, within
 * `tolerance` (`{ channel, outside, mean }`, as `RENDER`). Answers `{ ok, numbers, message }`:
 * `numbers` are `mean`, `worst`, `outside` and `pixels`, in 8-bit units. A picture of another
 * size, or with no pixel, fails.
 */
export function comparePictures(actual, golden, tolerance = RENDER) {
  const pixels = golden.width * golden.height;
  const unseen = { mean: NaN, worst: NaN, outside: NaN, pixels };
  if (actual.width !== golden.width || actual.height !== golden.height)
    return {
      ok: false,
      numbers: unseen,
      problems: [
        `the render is ${actual.width} x ${actual.height}, the golden ${golden.width} x ${golden.height}`,
      ],
      message: `the render is ${actual.width} x ${actual.height}, the golden ${golden.width} x ${golden.height}`,
    };
  if (!(pixels > 0) || actual.data.length !== pixels * 4 || golden.data.length !== pixels * 4) {
    const message = `a picture of ${pixels} pixels cannot be compared`;
    return { ok: false, numbers: unseen, problems: [message], message };
  }
  let outside = 0;
  let worst = 0;
  let sum = 0;
  for (let p = 0; p < pixels; p++) {
    let pixelWorst = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(actual.data[p * 4 + c] - golden.data[p * 4 + c]);
      if (c < 3) sum += d;
      if (d > pixelWorst) pixelWorst = d;
    }
    if (pixelWorst > tolerance.channel) outside++;
    if (pixelWorst > worst) worst = pixelWorst;
  }
  const mean = sum / (pixels * 3);
  const problems = [];
  if (!(outside / pixels <= tolerance.outside))
    problems.push(
      `${outside} of ${pixels} pixels differ by more than ${tolerance.channel}/255 in a channel, over the ${100 * tolerance.outside} % the gate allows`,
    );
  if (!(mean <= tolerance.mean))
    problems.push(
      `the mean absolute difference ${mean.toFixed(3)}/255 is over ${tolerance.mean}/255`,
    );
  const summary = `mean ${mean.toFixed(3)}/255, worst channel ${worst}/255, ${outside} of ${pixels} pixels beyond ${tolerance.channel}/255`;
  return {
    ok: problems.length === 0,
    numbers: { mean, worst, outside, pixels },
    problems,
    message: [summary, ...problems].join('\n'),
  };
}

/** `tolerance` with the share of pixels beyond `channel` at zero and the mean unbounded, so that
 *  only the per-channel bound can fail. The probe judges with it: the share exists to absorb a
 *  few pixels, so the share alone would hide the fault the probe plants. */
export const channelBoundOnly = (tolerance) => ({ ...tolerance, outside: 0, mean: Infinity });

/** The path of the golden of example `id` in `dir`. */
export const goldenPath = (id, dir = GOLDENS) => join(dir, `${id}.png`);

/** The goldens in `dir` that no example in `ids` owns: their file names. */
export function orphans(ids, dir = GOLDENS) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.png') && !ids.includes(f.slice(0, -4)))
    .sort();
}

/** The golden at `file` as a picture, `{ error }` when the file is not a PNG the decoder reads,
 *  or undefined when there is no file. */
function readGolden(file) {
  if (!existsSync(file)) return undefined;
  try {
    return decodePng(readFileSync(file));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** The first line of a comparison's message: its numbers. */
const firstLine = (compared) => compared.message.split('\n')[0];

/**
 * The seed of the picture the gate reads, for an example that sets its own seeds. The gate sets
 * `RENDER.seed` before the example's first render, and the example replaces it. The determinism
 * example draws seed 2 first (site/examples/determinism.ts), so its picture at `RENDER.samples` is
 * seed 2's. Every other example draws `RENDER.seed`. The 2 is a copy of `RENDER.otherSeed` in
 * site/examples/determinism.ts. A script cannot import that file. When the two differ, the check
 * of `ran` against `wanted` in `holdExample` fails the example and names both seeds.
 */
const OWN_SEED = new Map([['determinism', 2]]);

/**
 * Runs example `id` on the page and holds its picture to the golden in `dir`, or writes the
 * golden. Answers `{ numbers, line, failures }`: the numbers of the example, one line for the
 * output and the failures it found.
 */
async function holdExample(session, id, dir, update) {
  const rendered = await session.renderExample({
    id,
    size: RENDER.size,
    samples: RENDER.samples,
    perFrame: RENDER.perFrame,
    seed: RENDER.seed,
  });
  const ran = `${rendered.size.join(' x ')} at ${rendered.samples} spp, seed ${rendered.seed}`;
  const wanted = `${RENDER.size.join(' x ')} at ${RENDER.samples} spp, seed ${OWN_SEED.get(id) ?? RENDER.seed}`;
  if (ran !== wanted)
    return {
      numbers: {},
      line: `render ${id}: ran at ${ran}`,
      failures: [`${id}: ran at ${ran}, not ${wanted}`],
    };
  const picture = {
    width: rendered.size[0],
    height: rendered.size[1],
    data: toBytes(rendered.image),
  };
  const png = encodePngBytes(picture.width, picture.height, picture.data);
  writeFileSync(join(outDir(), `render-${id}.png`), png);
  const head = `render ${id}: ${ran} in ${(rendered.ms / 1000).toFixed(1)} s`;
  const file = goldenPath(id, dir);
  const golden = readGolden(file);
  const compared =
    golden === undefined || 'error' in golden ? undefined : comparePictures(picture, golden);
  if (update) {
    writeFileSync(file, png);
    const was =
      golden === undefined
        ? 'there was no golden'
        : compared === undefined
          ? `the old golden cannot be read: ${golden.error}`
          : `against the old golden ${firstLine(compared)}`;
    return {
      numbers: { ...compared?.numbers, ms: rendered.ms },
      line: `${head}, golden written, ${was}`,
      failures: [],
    };
  }
  if (golden === undefined)
    return {
      numbers: {},
      line: `${head}, no golden`,
      failures: [`${id}: no golden at ${file}: run UPDATE_GOLDENS=1 bun run gate:render`],
    };
  if (compared === undefined)
    return {
      numbers: {},
      line: `${head}, the golden cannot be read`,
      failures: [`${id}: the golden at ${file} cannot be read: ${golden.error}`],
    };
  return {
    numbers: { ...compared.numbers, ms: rendered.ms },
    line: `${head}, ${firstLine(compared)}`,
    failures: compared.problems.map((p) => `${id}: ${p} (the render is .harness/render-${id}.png)`),
  };
}

/**
 * Renders each example on the page and holds it to its golden, or, with `options.update`, writes
 * its golden. Answers `{ ok, numbers, message }`. Each render is also written to
 * `.harness/render-<example>.png`, to look at.
 */
export async function run(options = {}) {
  const dir = options.dir ?? GOLDENS;
  const update = options.update === true;
  const ids = options.examples ?? exampleIds(SITE);
  return withRenderPage(options, async (session) => {
    const numbers = {};
    const lines = [];
    const failures = [];
    if (update) mkdirSync(dir, { recursive: true });
    for (const id of ids) {
      const held = await holdExample(session, id, dir, update);
      numbers[id] = held.numbers;
      lines.push(held.line);
      failures.push(...held.failures);
    }
    for (const file of orphans(ids, dir)) {
      if (update) unlinkSync(join(dir, file));
      else failures.push(`${file} is a golden of no example: delete it`);
      lines.push(
        `render: ${update ? 'deleted' : 'found'} the golden ${file}, which no example owns`,
      );
    }
    return { ok: failures.length === 0, numbers, message: [...lines, ...failures].join('\n') };
  });
}

/** The channel of the centre pixel's red, as an index into 8-bit RGBA `data` of `width` x `height`. */
const centre = (width, height) => ((height >> 1) * width + (width >> 1)) * 4;

/** Plants the probe's faults in one golden, read from `bytes`, and answers what the gate saw.
 *  Throws when the encoder and the decoder do not give the golden back, or the comparison does
 *  not see a fault. */
function plant(name, bytes) {
  const golden = decodePng(bytes);
  const { width, height } = golden;
  const pixels = width * height;
  const through = (data) => decodePng(encodePngBytes(width, height, data));

  // The control: the golden, written and read again, is the golden, byte for byte.
  const same = comparePictures(through(golden.data), golden, channelBoundOnly(RENDER));
  if (!same.ok || same.numbers.worst !== 0)
    throw new Error(
      `the PNG encoder and decoder do not give ${name} back byte for byte (${same.message}), so the render gate cannot trust a golden it reads`,
    );

  // The fault of the record: one channel of one pixel moved by 8/255, read back through the
  // decoder. The tolerance admits a few such pixels, so the comparison is judged by the channel
  // bound alone, which must see it.
  const at = centre(width, height);
  const moved = Uint8Array.from(golden.data);
  moved[at] += moved[at] <= 247 ? 8 : -8;
  const one = comparePictures(through(moved), golden, channelBoundOnly(RENDER));
  if (one.ok || one.numbers.worst !== 8 || one.numbers.outside !== 1)
    throw new Error(
      `the render gate does not see one channel of one pixel of ${name} moved by 8/255 (${one.message}), so it cannot see a golden that moved`,
    );

  // The same fault on twice the share the tolerance admits: the gate's own tolerance fails it.
  const count = Math.ceil(pixels * RENDER.outside * 2);
  const spread = Uint8Array.from(golden.data);
  for (let i = 0; i < count; i++) {
    const channel = Math.floor((i * pixels) / count) * 4;
    spread[channel] += spread[channel] <= 247 ? 8 : -8;
  }
  const many = comparePictures(through(spread), golden, RENDER);
  if (many.ok || many.numbers.outside !== count)
    throw new Error(
      `the render gate passes ${count} of ${pixels} pixels of ${name} moved by 8/255 (${many.message}), so its tolerance does not hold a picture that moved`,
    );
  return { one: one.numbers, many: many.numbers, count };
}

/**
 * Plants a fault in each golden and throws when the gate does not see it. For each golden it
 * decodes the PNG, moves one channel of one pixel by 8/255, encodes it, decodes it again and
 * compares it with the golden. It does not need a browser. Answers `{ ok: true, numbers, message }`
 * of what it saw.
 */
export async function probe(options = {}) {
  const dir = options.dir ?? GOLDENS;
  const names = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.png'))
        .sort()
    : [];
  if (names.length === 0)
    throw new Error(
      `no golden is in ${dir}, so the render gate has no picture to plant a fault in`,
    );
  let seen;
  for (const name of names) seen = plant(name, readFileSync(join(dir, name)));
  return {
    ok: true,
    numbers: {
      goldens: names.length,
      worst: seen.one.worst,
      outside: seen.one.outside,
      spread: seen.count,
    },
    message: `a golden with one channel of one pixel moved by 8/255 is seen after the PNG encoder and decoder (worst ${seen.one.worst}/255, ${seen.one.outside} pixel beyond ${RENDER.channel}/255), and ${seen.count} such pixels fail the tolerance, as they must: ${names.length} golden(s)`,
  };
}

/** The radius probe (record 0002, "The probes"): the example and the factor on each radius. */
export const RADIUS_PROBE = { example: 'cornell-box', scale: 1.01 };

/**
 * Renders `RADIUS_PROBE.example` as the gate does, with the `radius` of every `Sphere` of its
 * scene times `RADIUS_PROBE.scale`, and holds it to the golden. Throws when the comparison passes,
 * when no `Sphere` was scaled, or when there is no golden. Answers `{ ok: true, numbers, message }`
 * with the numbers of the failed comparison. The render is written to
 * `.harness/render-<example>-radius.png`, to look at.
 */
export async function probeRadius(options = {}) {
  const dir = options.dir ?? GOLDENS;
  const { example: id, scale } = RADIUS_PROBE;
  return withRenderPage(options, async (session) => {
    const golden = readGolden(goldenPath(id, dir));
    if (golden === undefined || 'error' in golden)
      throw new Error(`the golden of ${id} cannot be read, so the radius probe has no picture`);
    const rendered = await session.renderExample({
      id,
      size: RENDER.size,
      samples: RENDER.samples,
      perFrame: RENDER.perFrame,
      seed: RENDER.seed,
      radiusScale: scale,
    });
    if (!(rendered.scaled > 0))
      throw new Error(`${id} has no Sphere, so the radius probe changed nothing`);
    const picture = {
      width: rendered.size[0],
      height: rendered.size[1],
      data: toBytes(rendered.image),
    };
    writeFileSync(
      join(outDir(), `render-${id}-radius.png`),
      encodePngBytes(picture.width, picture.height, picture.data),
    );
    const compared = comparePictures(picture, golden);
    if (compared.ok)
      throw new Error(
        `the render gate passes ${id} with the radius of each of its ${rendered.scaled} Sphere objects times ${scale} (${firstLine(compared)}), so it does not see the size of a sphere`,
      );
    return {
      ok: true,
      numbers: { ...compared.numbers, spheres: rendered.scaled },
      message: `${id} with the radius of each of its ${rendered.scaled} Sphere objects times ${scale} fails the golden, as it must: ${firstLine(compared)}`,
    };
  });
}

if (import.meta.main) {
  const update = process.env.UPDATE_GOLDENS === '1';
  const result = await run({ update });
  (result.ok ? console.log : console.error)(result.message);
  if (update && result.ok)
    console.log(
      'the goldens are rewritten: look at the old and the new picture of each one before you commit them',
    );
  process.exit(result.ok ? 0 : 1);
}
