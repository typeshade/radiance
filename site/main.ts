// The demo page: the Cornell box, rendered progressively on the visitor's GPU.
//
// Each animation frame adds samples (one dispatch) and shows the mean. The samples per frame
// adapt so a frame takes about `FRAME_MS`, which keeps the page responsive and every dispatch far
// under the GPU watchdog (plan 3.1, constraint 1). Dragging orbits the camera about the box's
// centre and starts the accumulation again.

import { createRenderer, type Renderer } from '@typeshade/radiance-render';
import { cornellBox, type Camera } from '@typeshade/radiance-scene';

const FRAME_MS = 30;
const MAX_PER_FRAME = 64;
const TARGET: readonly [number, number, number] = [0, 1, 0];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const notice = $('notice');

/** Where the camera is: its angle about the y axis and its height angle, in radians. */
let yaw = 0;
let pitch = 0;
const DISTANCE = 3.4;

function camera(): Camera {
  const c = Math.cos(pitch);
  return {
    eye: [
      TARGET[0] + DISTANCE * c * Math.sin(yaw),
      TARGET[1] + DISTANCE * Math.sin(pitch),
      TARGET[2] + DISTANCE * c * Math.cos(yaw),
    ],
    target: TARGET,
    up: [0, 1, 0],
    fovY: 40,
  };
}

let renderer: Renderer | undefined;
let perFrame = 1;
let paused = false;
let moved = false;
let generation = 0;

async function start(): Promise<void> {
  const mine = ++generation;
  renderer?.destroy();
  renderer = undefined;
  const side = Number($<HTMLSelectElement>('size').value);
  canvas.width = side;
  canvas.height = side;
  const scene = { ...cornellBox(), camera: camera() };
  const r = await createRenderer({
    size: [side, side],
    scene,
    seed: Number($<HTMLInputElement>('seed').value) >>> 0,
    canvas,
    exposure: Number($<HTMLInputElement>('exposure').value),
  });
  if (mine !== generation) {
    r.destroy();
    return;
  }
  renderer = r;
  perFrame = 1;
  requestAnimationFrame(() => tick(mine));
}

function tick(mine: number): void {
  step(mine).catch((e) => {
    // A frame of a renderer that a new start() has replaced may fail as it is destroyed.
    if (mine === generation) fail(e);
  });
}

async function step(mine: number): Promise<void> {
  const r = renderer;
  if (mine !== generation || r === undefined) return;
  if (moved) {
    moved = false;
    r.reset(camera());
    perFrame = 1;
  }
  const limit = Number($<HTMLInputElement>('limit').value) || Infinity;
  if (!paused && r.samples < limit) {
    const t0 = performance.now();
    await r.frame();
    await r.show();
    const ms = performance.now() - t0;
    const side = canvas.width;
    $('ms').textContent = `${ms.toFixed(1)} ms`;
    $('pps').textContent = `${((perFrame * side * side) / (ms / 1000) / 1e6).toFixed(1)} M`;
    $('spf').textContent = String(perFrame);
    perFrame = Math.max(1, Math.min(MAX_PER_FRAME, Math.round((perFrame * FRAME_MS) / ms) || 1));
  }
  $('spp').textContent = String(r.samples);
  requestAnimationFrame(() => tick(mine));
}

// Orbiting: a drag turns the camera about the box's centre.
let drag: { x: number; y: number } | undefined;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag === undefined) return;
  yaw -= (e.clientX - drag.x) * 0.005;
  pitch = Math.max(-0.6, Math.min(0.6, pitch + (e.clientY - drag.y) * 0.005));
  drag = { x: e.clientX, y: e.clientY };
  moved = true;
});
canvas.addEventListener('pointerup', () => (drag = undefined));
canvas.addEventListener('pointercancel', () => (drag = undefined));

$<HTMLInputElement>('exposure').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  $('exposure-value').textContent = v.toFixed(1);
  renderer?.setExposure(v);
  if (
    paused ||
    (renderer !== undefined && renderer.samples >= Number($<HTMLInputElement>('limit').value))
  )
    void renderer?.show();
});
$('size').addEventListener('change', () => void start().catch(fail));
$('seed').addEventListener('change', () => void start().catch(fail));
$('restart').addEventListener('click', () => {
  yaw = 0;
  pitch = 0;
  moved = true;
});
$('pause').addEventListener('click', () => {
  paused = !paused;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
});
$('save').addEventListener('click', () => {
  void renderer?.show().then(() => {
    const a = document.createElement('a');
    a.download = `cornell-${renderer?.samples ?? 0}spp.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  });
});

function fail(e: unknown): void {
  notice.hidden = false;
  notice.textContent = `The renderer stopped: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
}

if (!('gpu' in navigator)) {
  notice.hidden = false;
  notice.textContent =
    'This browser has no WebGPU, so the path tracer cannot run here. Chrome and Edge from version 113 have it.';
} else {
  start().catch(fail);
}
