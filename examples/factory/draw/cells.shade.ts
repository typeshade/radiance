"use typeshade";
import { Cell } from "../state/cells.shade.ts";

// The layer of the factory: one square for each row of the table `cells`. The table stays on the
// device, and nothing is read back to the host (design record 0111).

declare const cells: storage<array<Cell>>;
declare const view: uniform<mat4x4>;
declare const width: uniform<u32>;

interface Corner {
  at: builtin<"position">;
  local: location<0, vec2>;
  row: location<1, u32>;
}
interface Color {
  color: location<0, vec4>;
}

/** Places the six corners of the square of one row: the two triangles 0, 1, 2 and 2, 1, 3. */
@vertex
export function place(corner: builtin<"vertex_index">, row: builtin<"instance_index">): Corner {
  let k: u32 = corner;
  if (corner == 3) { k = 2; }
  if (corner == 4) { k = 1; }
  if (corner == 5) { k = 3; }
  const unit: vec2 = vec2(f32(k % 2), f32(k / 2));
  const cell: vec2 = vec2(f32(row % width), f32(row / width));
  return { at: view * vec4(cell + unit, 0., 1.), local: unit * 2. - 1., row };
}

/** The colour of one pixel: the colour its cell gives, and a thin line between cells. */
@fragment
export function paint(corner: Corner): Color {
  let color: vec3 = cells[corner.row].color(corner.local);
  if (abs(corner.local.x) > 0.94 || abs(corner.local.y) > 0.94) { color = color * 0.6; }
  return { color: vec4(color, 1.) };
}
