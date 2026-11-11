"use typeshade";

/** A class held as a field of another class. */
export class Inner {
  a: f32 = 0.5;
  n: u32 = 3;
}

/** A class another class extends. */
export class Base {
  id: u32 = 7;
  bump() {
    this.id = this.id + 1;
  }
}

/** One field of each kind the dump of design record 0100 prints. */
export class Probe extends Base {
  speed: f32 = 1.;
  offset: f32 = 0.;
  count: i32 = -2;
  on: bool = true;
  pos: vec2 = vec2(1., 2.);
  basis: mat2x2 = mat2x2(1., 0., 0., 1.);
  slots: array<f32, 3> = [1., 2., 3.];
  inner: Inner = new Inner();
  step(dt: f32) {
    this.offset = fract(this.offset + this.speed * dt);
    this.count = this.count + 1;
  }
}
