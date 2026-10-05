// === The differential gate: the GPU's render of a scene held to the CPU oracle's ===
//
// The oracle runs the same kernel the GPU runs, on the same seed and samples (scripts/oracle.ts,
// the compiler's CPU oracle at f32 precision). The two paths agree, so only f32 rounding is left
// between the images, and the bounds of the scene (`ORACLE` in scripts/gates.mjs) hold that
// rounding and nothing more. Docs/design/0002-verification.md lists the gate. Run it alone with
// `bun run gate:differential`.
//
// `run(options)` renders `options.scene` (the Cornell box when none is named) on both and
// answers `{ ok, numbers, message }`. `numbers` are the measured values, each one compared with
// the bound of its own name:
//
//   abs      the largest difference of a channel that `rel` does not admit.
//   rel      the largest difference, relative to the oracle's value, of a channel that `abs`
//            does not admit.
//   mean     the mean relative difference of a pixel's luminance over the frame.
//   largest  the largest difference of any channel, absolute.
//   outOfBounds  the count of channels beyond `abs` and `rel` together.
//
// `probe()` runs the gate once wrong on purpose and throws when the gate does not fail.
//
// Options: `scene` names a key of `SCENES`. `session` is an open render page
// (`openRenderPage` in ./_browser.mjs), which several gates may share. Without one, the gate
// opens its own.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GATE, ORACLE } from '../gates.mjs';
import { outDir, withRenderPage } from './_browser.mjs';

/** The scenes the differential and determinism gates render: each one's gated render and its
 *  bounds. The names are the keys of scripts/scenes.ts. */
export const SCENES = { cornell: { gate: GATE, oracle: ORACLE } };

/** The gated scene called `name`, or an error that lists the names. */
export function gatedScene(name) {
  const scene = Object.hasOwn(SCENES, name) ? SCENES[name] : undefined;
  if (scene === undefined)
    throw new Error(`no gated scene is named ${name}: ${Object.keys(SCENES).join(', ')}`);
  return scene;
}

const lum = (a, i) => (a[i] + a[i + 1] + a[i + 2]) / 3;

/** The difference of two channels. A NaN is as far as an infinity, so it never passes. */
const distance = (g, w) => (g === w ? 0 : Math.abs(g - w) || Infinity);

/** Holds `gpu` to `cpu`, two arrays of RGBA floats (the mean radiance of each pixel, then its
 *  sample count), within `bounds` (`{ abs, rel, mean }`). Answers `{ ok, numbers, message }`. */
export function compareImages(gpu, cpu, bounds) {
  if (gpu.length !== cpu.length || gpu.length % 4 !== 0)
    return {
      ok: false,
      numbers: { abs: NaN, rel: NaN, mean: NaN, largest: NaN, outOfBounds: NaN },
      message: `the GPU image has ${gpu.length} floats and the oracle's has ${cpu.length}`,
    };
  const pixels = gpu.length / 4;
  let largest = { d: 0, p: 0, g: gpu[0], w: cpu[0] };
  let abs = 0;
  let rel = 0;
  let outOfBounds = 0;
  let relSum = 0;
  for (let p = 0; p < pixels; p++) {
    for (let c = 0; c < 3; c++) {
      const g = gpu[p * 4 + c];
      const w = cpu[p * 4 + c];
      const d = distance(g, w);
      const allowed = bounds.rel * Math.abs(w);
      if (d > bounds.abs && d > allowed) outOfBounds++;
      if (d > allowed && d > abs) abs = d;
      if (d > bounds.abs) rel = Math.max(rel, d / Math.abs(w));
      if (d > largest.d) largest = { p, c, d, g, w };
    }
    relSum += Math.abs(lum(gpu, p * 4) - lum(cpu, p * 4)) / Math.max(lum(cpu, p * 4), 1e-3);
  }
  const mean = relSum / pixels;
  const message = [
    `oracle: mean relative difference ${mean.toExponential(2)}; largest ${largest.d.toExponential(2)} at pixel ${largest.p} (gpu ${largest.g}, cpu ${largest.w}); ${outOfBounds} channel(s) out of bounds`,
  ];
  if (outOfBounds > 0)
    message.push(
      `${outOfBounds} channel(s) differ from the oracle by more than ${JSON.stringify(bounds)}`,
    );
  if (!(mean <= bounds.mean))
    message.push(`the mean relative difference ${mean} is over ${bounds.mean}`);
  return {
    ok: outOfBounds === 0 && mean <= bounds.mean,
    numbers: { abs, rel, mean, largest: largest.d, outOfBounds },
    message: message.join('\n'),
  };
}

/** `bounds` with `abs` and `rel` opened without limit, so that only the `mean` bound can fail. The
 *  probe judges with it, to show that the gate holds the `mean` bound by itself. */
export const meanBoundOnly = (bounds) => ({ ...bounds, abs: Infinity, rel: Infinity });

/** `image` moved one pixel to the right: each pixel takes its left neighbour's value, and the
 *  first column repeats. The fault the probe plants. */
export function shiftOnePixel(image, width, height) {
  const out = new Float32Array(image.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++)
        out[(y * width + x) * 4 + c] = image[(y * width + Math.max(0, x - 1)) * 4 + c];
  return out;
}

/** The scene on the oracle, as a child process: `{ image, log }` when it ends. */
function renderOracle(name, gate) {
  const file = join(outDir(), `oracle-${name}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bun',
      [
        'scripts/oracle.ts',
        ...gate.size.map(String),
        String(gate.samples),
        String(gate.seed),
        file,
        name,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve({ image: JSON.parse(readFileSync(file, 'utf8')), log: log.trim() })
        : reject(new Error(`the oracle exited with ${code}`)),
    );
  });
}

/** The GPU's render and the oracle's. The oracle starts first and runs while the GPU renders. */
async function measure(name, session) {
  const { gate } = gatedScene(name);
  const oracle = renderOracle(name, gate);
  let render;
  try {
    render = await session.render({ ...gate, scene: name });
  } catch (e) {
    oracle.catch(() => {});
    throw e;
  }
  const cpu = await oracle;
  return { render, cpu: cpu.image, log: cpu.log };
}

/** The last measurement of each scene. The probe reuses it: the oracle takes about a minute. */
const measured = new Map();

/** Renders the scene on the GPU and on the oracle and holds the first to the second. The result
 *  also carries `render`, the GPU's `{ radiance, image, ms }`, for a caller that checks more. */
export async function run(options = {}) {
  const name = options.scene ?? 'cornell';
  const { gate, oracle } = gatedScene(name);
  return withRenderPage(options, async (session) => {
    const m = await measure(name, session);
    measured.set(name, m);
    const compared = compareImages(m.render.radiance, m.cpu, oracle);
    const gpu = `gpu: ${gate.size.join('x')} at ${gate.samples} spp in ${(m.render.ms / 1000).toFixed(1)} s`;
    return { ...compared, message: [gpu, m.log, compared.message].join('\n'), render: m.render };
  });
}

/** Runs the gate on the oracle's image moved one pixel, twice: with the bounds of the scene, and
 *  with `meanBoundOnly` of them. Both must fail, so the `mean` bound fails the image by itself.
 *  Throws when one does not. Answers `{ ok: true, numbers, message }` of the failure it saw. */
export async function probe(options = {}) {
  const name = options.scene ?? 'cornell';
  const { gate, oracle } = gatedScene(name);
  return withRenderPage(options, async (session) => {
    const m = measured.get(name) ?? (await measure(name, session));
    const moved = shiftOnePixel(m.cpu, gate.size[0], gate.size[1]);
    const whole = compareImages(m.render.radiance, moved, oracle);
    const alone = compareImages(m.render.radiance, moved, meanBoundOnly(oracle));
    if (whole.ok || alone.ok || !(alone.numbers.mean > oracle.mean))
      throw new Error(
        `the differential gate does not fail the mean bound on the oracle's image moved one pixel (the bounds of the scene: ok ${whole.ok}; the mean bound alone: ok ${alone.ok}, mean ${alone.numbers.mean}, bound ${oracle.mean}), so it cannot see a picture that moved`,
      );
    return {
      ok: true,
      numbers: alone.numbers,
      message: `the oracle's image moved one pixel fails the gate, and fails the mean bound alone, as it must: mean ${alone.numbers.mean.toExponential(2)} over ${oracle.mean}`,
    };
  });
}

if (import.meta.main) {
  const result = await run();
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}
