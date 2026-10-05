// The numbers M1's acceptance is held to, in one place: scripts/harness.mjs runs the gates and
// the site prints them (site/src/lib/facts.ts), so a bound on the page is the bound CI holds.

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
