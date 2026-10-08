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
// `runHits(options)` is the row `sphere-hit` (record 0002, "The hit probe"): it runs `hitSphere`
// alone over the 4,096 rays of `hitRays()`, on the GPU (the entry `hitSphereProbe` of the
// harness page) and on the oracle, and `compareHits` counts the rays outside the rule.
//
// Options: `scene` names a key of `SCENES`. `session` is an open render page
// (`openRenderPage` in ./_browser.mjs), which several gates may share. Without one, the gate
// opens its own.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATE,
  GATE_M2,
  ORACLE,
  ORACLE_INSTANCES,
  ORACLE_LIGHTS,
  ORACLE_TRIANGLES,
} from '../gates.mjs';
import { outDir, withRenderPage } from './_browser.mjs';

/** The scenes the differential and determinism gates render: each one's gated render and its
 *  bounds. The names are the keys of scripts/scenes.ts. */
export const SCENES = {
  cornell: { gate: GATE, oracle: ORACLE },
  triangles: { gate: GATE_M2, oracle: ORACLE_TRIANGLES },
  instances: { gate: GATE_M2, oracle: ORACLE_INSTANCES },
  lights: { gate: GATE_M2, oracle: ORACLE_LIGHTS },
};

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

// ---- The row `sphere-hit` (record 0002, "The hit probe") -----------------------------------

/** The rays of the row: 3,584 aimed rays of precision rule 1, then 512 away rays of rule 3. */
export const HIT_AIMED = 3584;
export const HIT_AWAY = 512;
export const HIT_RAYS = HIT_AIMED + HIT_AWAY;
/** The `limit` of every ray. */
const HIT_LIMIT = 1e30;

/** Numbers in [0, 1) from a seed: mulberry32. */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The 4,096 rays of the row, 3 vec4 each: `(o.xyz, limit)`, `(d.xyz, 0)` and `(c.xyz, r)`. Drawn
 * from `mulberry32` with seed 1, in f64, each word rounded to f32 (record 0002, "The hit probe").
 */
export function hitRays() {
  const next = mulberry32(1);
  const logUniform = (a, b) => a * Math.pow(b / a, next());
  const unit = () => {
    const z = next() * 2 - 1;
    const phi = next() * 2 * Math.PI;
    const s = Math.sqrt(1 - z * z);
    return [s * Math.cos(phi), s * Math.sin(phi), z];
  };
  const out = new Float32Array(HIT_RAYS * 12);
  for (let i = 0; i < HIT_RAYS; i++) {
    const r = logUniform(0.01, 100);
    const c = [0, 1, 2].map(() => next() * 2000 - 1000);
    const len = logUniform(1e-3, 1e3);
    let o;
    let d;
    if (i < HIT_AIMED) {
      const n = unit();
      const far = r * logUniform(1.0001, 1e5);
      o = c.map((x, k) => x + n[k] * far);
      // A spot in the plane through c at right angles to the line from o to c.
      const w = n.map((x) => -x);
      const helper = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const e1 = normalized(cross(helper, w));
      const e2 = cross(w, e1);
      const b = next() * 0.9 * r;
      const angle = next() * 2 * Math.PI;
      const spot = c.map((x, k) => x + b * (Math.cos(angle) * e1[k] + Math.sin(angle) * e2[k]));
      d = normalized(spot.map((x, k) => x - o[k])).map((x) => x * len);
    } else {
      const n = unit();
      const far = r * logUniform(1.00005, 1e5);
      o = c.map((x, k) => x + n[k] * far);
      const u = unit();
      const side = u[0] * n[0] + u[1] * n[1] + u[2] * n[2] < 0 ? -1 : 1;
      d = u.map((x) => x * side * len);
    }
    out.set([...o, HIT_LIMIT, ...d, 0, ...c, r], i * 12);
  }
  return out;
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalized(a) {
  const l = Math.hypot(...a);
  return a.map((x) => x / l);
}

/**
 * Holds the GPU's `hits` to the oracle's, ray by ray, by the rule of record 0002 ("The hit
 * probe"). `gpu`, `cpu` and `rays` are `Float32Array`s. Answers `{ ok, outside, total, worst,
 * worstQ, message }`: `worst` is the largest `t` error in units of `ulp(S)`, `worstQ` the largest
 * `length(q_gpu - q_cpu)`, and `message` names the first ray outside, with both answers.
 */
export function compareHits(gpu, cpu, rays) {
  const total = rays.length / 12;
  if (gpu.length !== total * 4 || cpu.length !== total * 4)
    return {
      ok: false,
      outside: total,
      total,
      worst: NaN,
      worstQ: NaN,
      message: `${total} rays, and the GPU gave ${gpu.length / 4} hits and the oracle ${cpu.length / 4}`,
    };
  let outside = 0;
  let worst = 0;
  let worstQ = 0;
  let first;
  for (let i = 0; i < total; i++) {
    const g = Array.from(gpu.subarray(i * 4, i * 4 + 4));
    const w = Array.from(cpu.subarray(i * 4, i * 4 + 4));
    const o = rays.subarray(i * 12, i * 12 + 3);
    const d = rays.subarray(i * 12 + 4, i * 12 + 7);
    const c = rays.subarray(i * 12 + 8, i * 12 + 11);
    const r = rays[i * 12 + 11];
    let reason;
    if (Number.isNaN(g[0]) || Number.isNaN(w[0])) reason = 'a t is NaN';
    else if (g[0] < 0 !== w[0] < 0) reason = 'one is a hit and the other a miss';
    else if (g[0] >= 0) {
      if (!g.every(Number.isFinite) || !w.every(Number.isFinite)) reason = 'a value is not finite';
      else {
        const s = Math.max(1, ...[0, 1, 2].map((k) => Math.abs(o[k] - c[k]) / r));
        const ulp = Math.pow(2, Math.floor(Math.log2(s)) - 23);
        const dt = (Math.abs(g[0] - w[0]) * Math.hypot(d[0], d[1], d[2])) / r / ulp;
        const dq = Math.hypot(g[1] - w[1], g[2] - w[2], g[3] - w[3]);
        worst = Math.max(worst, dt);
        worstQ = Math.max(worstQ, dq);
        if (dt > 16) reason = `the t error is ${dt.toFixed(2)} ulp(S), above 16`;
        else if (dq > 16 * ulp + 8e-7) reason = `the q difference is ${dq.toExponential(2)}`;
      }
    }
    if (reason !== undefined) {
      outside++;
      first ??= `ray ${i}: ${reason} (gpu ${JSON.stringify(g)}, oracle ${JSON.stringify(w)})`;
    }
  }
  const message = [
    `sphere-hit: ${outside} of ${total} rays outside the rule; the largest t error ${worst.toFixed(2)} ulp(S), the largest q difference ${worstQ.toExponential(2)}`,
  ];
  if (first !== undefined) message.push(`the first ray outside: ${first}`);
  return { ok: outside === 0, outside, total, worst, worstQ, message: message.join('\n') };
}

/** The oracle's half: `hit-sphere.shade.ts` compiled with `compile` and run with
 *  `compileModuleJs` at f32, one invocation for each ray. It runs under bun, which reads the
 *  compiler's TypeScript. */
async function hitsOnCpu(rays) {
  const { compile, compileModuleJs } = await import('typeshade');
  const path = fileURLToPath(new URL('../probes/hit-sphere.shade.ts', import.meta.url));
  const read = (f) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return undefined;
    }
  };
  const compiled = compile(readFileSync(path, 'utf8'), { fileName: path, readDocument: read });
  const errors = compiled.diagnostics.filter((x) => x.category === 'error');
  if (errors.length > 0 || compiled.module === undefined)
    throw new Error(`hit-sphere.shade.ts does not compile: ${JSON.stringify(errors)}`);
  const cpu = compileModuleJs(compiled.module, { precision: 'f32' });
  const total = rays.length / 12;
  const vec4s = Array.from({ length: total * 3 }, (_, i) =>
    Array.from(rays.subarray(i * 4, i * 4 + 4)),
  );
  const hits = Array.from({ length: total }, () => [0, 0, 0, 0]);
  cpu.setBinding('rays', vec4s);
  cpu.setBinding('hits', hits);
  for (let i = 0; i < total; i++) cpu.fns.probe([i, 0, 0]);
  return new Float32Array(hits.flat());
}

/** The oracle's half, as a child process under bun: this file with `--hits <outfile>`. */
function hitsOnOracle() {
  const file = join(outDir(), 'oracle-sphere-hit.json');
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [fileURLToPath(import.meta.url), '--hits', file], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(new Float32Array(JSON.parse(readFileSync(file, 'utf8'))))
        : reject(new Error(`the oracle of sphere-hit exited with ${code}`)),
    );
  });
}

/** The GPU's half: the page of the session calls `hitSphereProbe` on 64 workgroups, which reads
 *  `hits` back into the array it was given. The page requires the WebGPU tier first: an entry
 *  call falls back to the CPU tier when it finds no device, and the row would then hold the
 *  oracle to itself. */
async function hitsOnGpu(session, rays) {
  const page = await session.browser.newPage();
  page.on('pageerror', (e) => session.errors.push(`sphere-hit: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      session.errors.push(`sphere-hit: console.${m.type()}: ${m.text()}`);
  });
  try {
    await page.goto(`${session.origin}/__harness/`);
    const hits = await page.evaluate(async (list) => {
      const { configure, hitSphereProbe } = await import('/__harness/render.js');
      configure({ prefer: ['webgpu'] });
      const out = new Float32Array((list.length / 12) * 4);
      await hitSphereProbe({ rays: new Float32Array(list), hits: out }, 64);
      return Array.from(out);
    }, Array.from(rays));
    return new Float32Array(hits);
  } finally {
    await page.close();
  }
}

/** The row `sphere-hit`: `hitSphere` on the GPU and on the oracle over `hitRays()`, held to each
 *  other by `compareHits`. The number is the count of rays outside the rule: 0 of 4,096. */
export async function runHits(options = {}) {
  const rays = hitRays();
  return withRenderPage(options, async (session) => {
    const oracle = hitsOnOracle();
    let gpu;
    try {
      gpu = await hitsOnGpu(session, rays);
    } catch (e) {
      oracle.catch(() => {});
      throw e;
    }
    return compareHits(gpu, await oracle, rays);
  });
}

if (import.meta.main && process.argv[2] === '--hits') {
  // The oracle's half of the row `sphere-hit`, which `runHits` starts under bun.
  writeFileSync(process.argv[3], JSON.stringify(Array.from(await hitsOnCpu(hitRays()))));
} else if (import.meta.main) {
  // `bun run gate:differential -- <scene>` renders the scene called `<scene>`. With no name it
  // renders the Cornell box. `sphere-hit` runs the row of the hit probe.
  const result =
    process.argv[2] === 'sphere-hit' ? await runHits() : await run({ scene: process.argv[2] });
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}
