// The numbers M1's acceptance is held to, in one place: scripts/gates/differential.mjs and
// scripts/gates/determinism.mjs hold the engine to them, scripts/harness.mjs runs those gates,
// and the site prints them (site/src/lib/facts.ts), so a bound on the page is the bound CI holds.
// `RENDER` is the render gate's (scripts/gates/render.mjs).

/** The gated render: small, so SwiftShader and the oracle finish in CI's time. */
export const GATE = { size: [16, 16], samples: 1024, perFrame: 64, seed: 1 };

/**
 * How close the GPU's mean radiance must be to the oracle's, per channel: within `abs`, or within
 * `rel` of the oracle's value; and `mean`, the mean relative difference of a pixel's luminance
 * over the frame. The two run the same kernel on the same samples, and the kernel steers no
 * path by a transcendental WGSL lets a GPU round loosely (`turn` in materials.shade.ts), so their
 * paths agree and only f32 rounding is left. A path that still goes another way on another GPU
 * moves its pixel by one sample's share of 1024, which `rel` admits; many of them move `mean`,
 * which a systematic error (a lost term, a wrong sign) breaks too.
 *
 * Derived by record 0002's rule when record 0001 step 3 made the Cornell box triangles (two
 * spheres of 960 triangles, through the two-level BVH): on SwiftShader the mean was 3.27e-7 and
 * the largest difference 2.86e-6, so `mean` is ten times the measured mean, and `abs` and `rel`
 * stay M1's. Before, on M1's analytic scene, they were 1e-3, 5 % and a `mean` of 1e-4.
 *
 * The spheres then grew to 64 by 32 segments, 3,968 triangles each (createCornellBox). On
 * SwiftShader the mean was 3.03e-7 and the largest difference 2.86e-6, with 0 channels out of
 * bounds. Record 0002 re-derives the bound when the scene changes, so `mean` was ten times the
 * measured 3.03e-7, rounded up to 3.1e-6 as 3.27e-7 was rounded up to 3.3e-6.
 *
 * The lamp then became two-sided (createCornellBox), so the ceiling takes light from it by next-event
 * estimation. On SwiftShader the mean was 1.91e-6 and the largest difference 7.31e-5, with 0
 * channels out of bounds. So `mean` is ten times the measured 1.91e-6, rounded up to 2e-5.
 * Before, it was 3.1e-6.
 *
 * The two balls then became analytic spheres, `Sphere(0.4, material)` (record 0001, step 8), so
 * the scene holds 4 triangles. On SwiftShader the mean was 2.01e-6 and the largest difference
 * 7.71e-5, with 0 channels out of bounds. So `mean` is ten times the measured 2.01e-6, rounded up
 * to one significant figure (as 1.91e-5 became 2e-5 before): 3e-5. Before, it was 2e-5.
 */
export const ORACLE = { abs: 1e-3, rel: 0.05, mean: 3e-5 };

/**
 * The differential gate's scenes of M2 (docs/design/0002-verification.md, "The differential
 * scenes"): `triangles`, `instances` and `lights`, each 16 x 16 at 256 samples a pixel. At that size
 * the oracle renders one in 20 to 38 seconds on a four-core machine, 20 seconds when it is lightly
 * loaded and 38 seconds at a load average of 9 (`lights`, measured on 2026-10-06, SwiftShader).
 * The gate takes 36 to 48 seconds for a scene at that load. The three scenes with their determinism
 * renders add under 3 minutes to the harness.
 */
export const GATE_M2 = { size: [16, 16], samples: 256, perFrame: 64, seed: 1 };

/**
 * The bounds of the scene `triangles` (a sphere of 12 x 8 segments and a box). Derived by record
 * 0002's rule on 2026-10-06 (SwiftShader, pin 596c805): the mean relative difference was 1.52e-7
 * and the largest difference 2.38e-7, so `mean` is ten times the measured mean, rounded up, and
 * `abs` and `rel` stay M1's.
 */
export const ORACLE_TRIANGLES = { abs: 1e-3, rel: 0.05, mean: 1.6e-6 };

/**
 * The bounds of the scene `instances` (one geometry in four instances, one scaled non-uniformly
 * under a turn, one mirrored).
 * Derived the same way: the mean was 2.19e-7 and the largest difference 8.20e-7.
 */
export const ORACLE_INSTANCES = { abs: 1e-3, rel: 0.05, mean: 2.2e-6 };

/**
 * The bounds of the scene `lights` (three emissive triangles of different areas and colours).
 * Derived the same way: the mean was 1.73e-7 and the largest difference 2.03e-6.
 */
export const ORACLE_LIGHTS = { abs: 1e-3, rel: 0.05, mean: 1.8e-6 };

/** Half floats carry 11 bits of mantissa: what the display gate admits per channel. */
export const HALF = 2e-3;

/**
 * The render gate's goldens (docs/design/0002-verification.md): each example is rendered at `size`
 * and `samples` a pixel with `seed`, and held to scripts/__goldens__/<example>.png within the
 * tolerance. An example that sets its own seeds is held at the seed of the first render that
 * reaches `samples` (`OWN_SEED` in scripts/gates/render.mjs). The tolerance is in 8-bit units,
 * because a golden is an 8-bit picture:
 *
 * - `channel`: a pixel is within when each of its four channels differs by at most this much.
 * - `outside`: the share of pixels that may be beyond `channel`. A pixel at a light's edge may
 *   land on the other side of a rounding.
 * - `mean`: the mean absolute difference over the red, green and blue channels of the frame.
 *
 * `perFrame` is how many samples one frame of the example's loop adds. It divides `samples`, so
 * the loop stops on exactly `samples`. The image does not depend on it.
 */
export const RENDER = {
  size: [96, 64],
  samples: 64,
  perFrame: 16,
  seed: 1,
  channel: 4,
  outside: 0.001,
  mean: 1,
};
