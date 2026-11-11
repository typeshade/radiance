"use typeshade";
import { Cell } from "../state/cells.shade.ts";
import { BELT, BELT_PERIOD, ITEM, SOURCE } from "../kinds.shade.ts";

// The second layer of the factory: the item of each belt, drawn over the layer `cells` with an
// alpha blend (design record 0111, section 6). It draws one instance for each row of `cells`.
// A row that is no belt with an item puts its square outside the view.
//
// The item moves along its belt at one speed. A belt holds an item for BELT_PERIOD + 1 ticks:
// the ticks of its `wait` from BELT_PERIOD down to 0, and the tick in which it leaves. So the
// distance that the item has gone is (a + blend) / (BELT_PERIOD + 1) of the belt, where `a` is
// the ticks that the item has waited. It starts at the edge where it came in (distance 0) and
// ends at the edge where it leaves (distance 1). The next belt starts the item at its own
// distance 0, which is the same place on the screen.

declare const cells: storage<array<Cell>>;
declare const view: uniform<mat4x4>;
declare const blend: uniform<f32>;
declare const width: uniform<u32>;
declare const height: uniform<u32>;

interface Corner {
  at: builtin<"position">;
  local: location<0, vec2>;
}
interface Color {
  color: location<0, vec4>;
}

/** The radius of the item, and the half side of its square, in cells. */
const RADIUS: f32 = 0.22;
const HALF: f32 = 0.3;

/** The index of the neighbour of (x, y) in a direction, or -1 outside the grid. */
function neighbor(x: u32, y: u32, dir: u32): i32 {
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

/** The step of one cell in a direction: 0 north, 1 east, 2 south, 3 west. The y axis goes down. */
function toward(dir: u32): vec2 {
  if (dir == 0) { return vec2(0., -1.); }
  if (dir == 1) { return vec2(1., 0.); }
  if (dir == 2) { return vec2(0., 1.); }
  return vec2(-1., 0.);
}

/** True when the cell at `index` is a belt or a source that sends its item back along `side`. */
function sendsFrom(index: i32, side: u32): bool {
  if (index < 0) { return false; }
  const c: Cell = cells[u32(index)];
  if (c.kind != BELT && c.kind != SOURCE) { return false; }
  return c.out() == (side + 2) % 4;
}

/** True when the cell ahead of a belt takes its item in this tick. */
function aheadTakes(x: u32, y: u32, dir: u32): bool {
  const ahead: i32 = neighbor(x, y, dir);
  if (ahead < 0) { return false; }
  const c: Cell = cells[u32(ahead)];
  return c.accepts();
}

/** Places the six corners of the square of one row, around the place of the item. */
@vertex
export function place(corner: builtin<"vertex_index">, row: builtin<"instance_index">): Corner {
  let k: u32 = corner;
  if (corner == 3) { k = 2; }
  if (corner == 4) { k = 1; }
  if (corner == 5) { k = 3; }
  const unit: vec2 = vec2(f32(k % 2), f32(k / 2));
  const cell: Cell = cells[row];
  let at: vec4 = vec4(2., 2., 0., 1.);
  let local: vec2 = vec2(0., 0.);
  if (cell.kind == BELT && cell.belt.item != 0) {
    const x: u32 = row % width;
    const y: u32 = row / width;
    const dir: u32 = cell.belt.dir;
    // The ticks the item has waited, and how far it has gone along the belt, from 0 to 1.
    const waited: u32 = BELT_PERIOD - cell.belt.wait;
    let along: f32 = (f32(waited) + blend) / f32(BELT_PERIOD + 1);
    // A ready item stays where it is until the cell ahead takes it.
    if (cell.belt.wait == 0 && !aheadTakes(x, y, dir)) {
      along = f32(waited) / f32(BELT_PERIOD + 1);
    }
    // The edge where the item came in: from behind, or from the side that sends to this belt.
    let side: u32 = (dir + 2) % 4;
    if (!sendsFrom(neighbor(x, y, side), side)) {
      const left: u32 = (dir + 1) % 4;
      const right: u32 = (dir + 3) % 4;
      if (sendsFrom(neighbor(x, y, left), left)) { side = left; }
      else if (sendsFrom(neighbor(x, y, right), right)) { side = right; }
    }
    // The path runs from the middle of the entry edge to the middle of the cell, and from there
    // to the middle of the exit edge. Each part is half a cell long.
    const middle: vec2 = vec2(f32(x) + 0.5, f32(y) + 0.5);
    let spot: vec2 = middle + toward(dir) * (along - 0.5);
    if (along < 0.5) { spot = middle + toward(side) * (0.5 - along); }
    local = (unit * 2. - 1.) * HALF;
    at = view * vec4(spot + local, 0., 1.);
  }
  return { at, local };
}

/** The colour of the item, with an alpha of 0 outside its disc and a soft edge of one pixel. */
@fragment
export function paint(corner: Corner): Color {
  const pixel: f32 = fwidth(corner.local.x);
  const cover: f32 = clamp(0.5 - (length(corner.local) - RADIUS) / pixel, 0., 1.);
  return { color: vec4(ITEM, cover) };
}
