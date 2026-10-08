// What the harness page imports: the engine, the gate scenes, the site's examples and the hit
// probe (scripts/gates/_browser.mjs).
export { PathTracer } from '@typeshade/radiance';
export { EXAMPLES } from '../site/examples/index.ts';
export { scenes } from './scenes.ts';
// The compiled entry of the hit probe (design record 0002, "The hit probe"), which the row
// `sphere-hit` of the differential gate dispatches. The row calls `configure` to require the
// WebGPU tier, so the entry cannot run on the CPU tier in its place.
export { probe as hitSphereProbe } from './probes/hit-sphere.shade.ts';
export { configure } from 'typeshade/runtime';
