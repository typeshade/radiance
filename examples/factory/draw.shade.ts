"use typeshade";
import { BELT, Cell, MACHINE, SOURCE } from "./cells.shade.ts";

// The picture of the factory: one fragment entry that reads the cells where they are on the
// device. Nothing is read back to the host.

/** What the picture needs beside the cells: the grid's size and the canvas's size in pixels. */
export class View {
  width: u32 = 1;
  height: u32 = 1;
  size: vec2 = vec2(1., 1.);
}

declare const cells: storage<array<Cell>>;
declare const view: uniform<View>;

interface Color {
  color: vec4;
}

/** The colour of one pixel: its cell's kind, a dot for an item, a mark for the direction. */
@fragment
export function draw(pos: builtin<"position">): Color {
  const cell: vec2 = vec2(view.size.x / f32(view.width), view.size.y / f32(view.height));
  const gx: u32 = min(u32(pos.x / cell.x), view.width - 1);
  const gy: u32 = min(u32(pos.y / cell.y), view.height - 1);
  const c: Cell = cells[gy * view.width + gx];
  // The place of the pixel in its cell, from -1 to 1.
  const local: vec2 = vec2(fract(pos.x / cell.x), fract(pos.y / cell.y)) * 2. - 1.;

  let color: vec3 = vec3(0.07, 0.08, 0.1);
  if (c.kind == BELT) { color = vec3(0.26, 0.28, 0.32); }
  if (c.kind == SOURCE) { color = vec3(0.16, 0.45, 0.25); }
  if (c.kind == MACHINE) { color = vec3(0.18, 0.3, 0.6) + vec3(0.1, 0.1, 0.1) * f32(c.stock); }

  if (c.kind == BELT || c.kind == SOURCE) {
    // A light mark on the side the cell sends its item to.
    let ahead: f32 = -local.y;
    if (c.dir == 1) { ahead = local.x; }
    if (c.dir == 2) { ahead = local.y; }
    if (c.dir == 3) { ahead = -local.x; }
    if (ahead > 0.6) { color = color + vec3(0.12, 0.12, 0.12); }
    if (c.item != 0 && length(local) < 0.45) { color = vec3(0.95, 0.75, 0.2); }
  }
  // A thin line between cells.
  if (abs(local.x) > 0.94 || abs(local.y) > 0.94) { color = color * 0.6; }
  return { color: vec4(color, 1.) };
}
