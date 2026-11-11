"use typeshade";

/** Counts its ticks and keeps the last `dt` it was given. */
export class Counter {
  ticks: u32 = 0;
  last: f32 = 0.;
  step(dt: f32) {
    this.ticks = this.ticks + 1;
    this.last = dt;
  }
}

/** Moves by its speed in each tick. */
export class Mover {
  x: f32 = 0.;
  speed: f32 = 1.;
  step(dt: f32) {
    this.x = this.x + this.speed * dt;
  }
}

/** A class with no `step`: it has a table and no call. */
export class Marker {
  id: u32 = 0;
}
