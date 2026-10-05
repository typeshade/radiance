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
 * path by a transcendental WGSL lets a GPU round loosely (`turn` in trace.shade.ts), so their
 * paths agree and only f32 rounding is left: on SwiftShader the largest difference was 2.4e-5
 * and the mean 1.4e-6. A path that still goes another way on another GPU moves its pixel by
 * one sample's share of 1024, which `rel` admits; many of them move `mean`, which a systematic
 * error (a lost term, a wrong sign) breaks too: a 1% change in one albedo put `mean` at 1.2e-2
 * when the gate was proved.
 */
export const ORACLE = { abs: 1e-3, rel: 0.05, mean: 1e-4 };

/** Half floats carry 11 bits of mantissa: what the display gate admits per channel. */
export const HALF = 2e-3;

/**
 * The render gate's goldens (docs/design/0002-verification.md): each example is rendered at `size`
 * and `samples` a pixel with `seed`, and held to scripts/__goldens__/<example>.png within the
 * tolerance. The tolerance is in 8-bit units, because a golden is an 8-bit picture:
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
