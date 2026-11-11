"use typeshade";
import { Cell } from "../state/cells.shade.ts";

/** The index of the neighbour of (x, y) in a direction, or -1 outside the grid. */
function neighbor(x: u32, y: u32, dir: u32, width: u32, height: u32): i32 {
  if (dir == 0) {
    if (y == 0) { return -1; }
    return i32((y - 1) * width + x);
  }
  if (dir == 1) {
    if (x + 1 >= width) { return -1; }
    return i32(y * width + x + 1);
  }
  if (dir == 2) {
    if (y + 1 >= height) { return -1; }
    return i32((y + 1) * width + x);
  }
  if (x == 0) { return -1; }
  return i32(y * width + x - 1);
}

/**
 * One tick of the factory. It reads `cells` and writes `cellsNext`, so each cell sees the same state
 * and the order of the cells does not matter. The engine gives the two arrays.
 *
 * A cell that can take an item takes it from the first ready neighbour that points at it, in
 * the order north, east, south, west. A cell gives its item when its target takes it from
 * this cell and not from another.
 */
export function flow(cellsNext: array<Cell>, cells: array<Cell>, width: u32, height: u32) {
  for (let i: u32 = 0; i < cellsNext.length; i++) {
    const x: u32 = i % width;
    const y: u32 = i / width;
    let c: Cell = cells[i];

    // Does this cell take an item? Find the first ready neighbour that points here.
    let takes: bool = false;
    if (c.accepts()) {
      for (let d: u32 = 0; d < 4; d++) {
        const n: i32 = neighbor(x, y, d, width, height);
        if (n >= 0 && !takes) {
          const nc: Cell = cells[u32(n)];
          if (nc.ready() && nc.out() == (d + 2) % 4) { takes = true; }
        }
      }
    }

    // Does this cell give its item? Its target must take, and take from this cell.
    let gives: bool = false;
    if (c.ready()) {
      const t: i32 = neighbor(x, y, c.out(), width, height);
      if (t >= 0) {
        const tc: Cell = cells[u32(t)];
        if (tc.accepts()) {
          const tx: u32 = u32(t) % width;
          const ty: u32 = u32(t) / width;
          let first: i32 = -1;
          for (let d: u32 = 0; d < 4; d++) {
            const n: i32 = neighbor(tx, ty, d, width, height);
            if (n >= 0 && first < 0) {
              const nc: Cell = cells[u32(n)];
              if (nc.ready() && nc.out() == (d + 2) % 4) { first = n; }
            }
          }
          gives = first == i32(i);
        }
      }
    }

    c.step(takes, gives);
    cellsNext[i] = c;
  }
}
