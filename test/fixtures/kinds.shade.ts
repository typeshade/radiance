"use typeshade";

/** A part of a row or of a node, with a rule of its own. */
export class Part {
  dir: u32 = 0;
  count: u32 = 0;
  step() {
    this.count = this.count + 1;
  }
}

/** A row that holds a class. */
export class Holder {
  kind: u32 = 0;
  part: Part = new Part();
}

/** Each row of kind 1 runs the rule of its part. */
export function run(rows: array<Holder>) {
  for (let i: u32 = 0; i < rows.length; i++) {
    let row: Holder = rows[i];
    if (row.kind == 1) { row.part.step(); }
    rows[i] = row;
  }
}

/** A node's class that holds a class. */
export class Carrier {
  part: Part = new Part();
  step(dt: f32) {
    this.part.step();
  }
}
