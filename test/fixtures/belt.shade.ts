"use typeshade";

/** The belt of the design's first example (docs/vision.md, section 4). */
export class Belt {
  speed: f32 = 1.;
  offset: f32 = 0.;
  step(dt: f32) {
    this.offset = fract(this.offset + this.speed * dt);
  }
}
