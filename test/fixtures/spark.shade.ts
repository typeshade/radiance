"use typeshade";
import { uniform, xorshift32 } from "typeshade/random";

/** Draws one random number in each tick from its own seed (design record 0101, section 4). */
export class Spark {
  seed: u32 = 0;
  heat: f32 = 0.;
  step(dt: f32) {
    this.seed = xorshift32(this.seed);
    this.heat = uniform(this.seed);
  }
}
