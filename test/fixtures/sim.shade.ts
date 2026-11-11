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
