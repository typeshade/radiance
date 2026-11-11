"use typeshade";

/** A row with an integer and a number. */
export class Row {
  n: u32 = 0;
  x: f32 = 0.;
}

/** Each row counts a tick and moves by `dt`. */
export function bump(rows: array<Row>, dt: f32) {
  for (let i: u32 = 0; i < rows.length; i++) {
    rows[i].n = rows[i].n + 1;
    rows[i].x = rows[i].x + dt;
  }
}

/** Each row takes the value of the row after it. The result needs two arrays. */
export function shift(next: array<Row>, prev: array<Row>) {
  for (let i: u32 = 0; i < next.length; i++) {
    next[i] = prev[(i + 1) % prev.length];
  }
}

/** A row with random numbers of its own. */
export class Die {
  seed: u32 = 0;
  face: u32 = 0;
}

/** Each die advances its seed and shows a face from 1 to 6. */
export function roll(dice: array<Die>) {
  for (let i: u32 = 0; i < dice.length; i++) {
    let d: Die = dice[i];
    d.seed = d.seed ^ (d.seed << 13);
    d.seed = d.seed ^ (d.seed >> 17);
    d.seed = d.seed ^ (d.seed << 5);
    d.face = d.seed % 6 + 1;
    dice[i] = d;
  }
}
