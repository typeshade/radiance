"use typeshade";
import { Cell } from "../state/cells.shade.ts";

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

/** The colour of one pixel: the colour its cell gives, and a thin line between cells. */
@fragment
export function picture(pos: builtin<"position">): Color {
  const cell: vec2 = vec2(view.size.x / f32(view.width), view.size.y / f32(view.height));
  const gx: u32 = min(u32(pos.x / cell.x), view.width - 1);
  const gy: u32 = min(u32(pos.y / cell.y), view.height - 1);
  const c: Cell = cells[gy * view.width + gx];
  // The place of the pixel in its cell, from -1 to 1.
  const local: vec2 = vec2(fract(pos.x / cell.x), fract(pos.y / cell.y)) * 2. - 1.;

  let color: vec3 = c.color(local);
  // A thin line between cells.
  if (abs(local.x) > 0.94 || abs(local.y) > 0.94) { color = color * 0.6; }
  return { color: vec4(color, 1.) };
}
