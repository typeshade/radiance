"use typeshade";

// The full-screen entry that shows the texture of the layers on the surface (design record 0111,
// section 4). It goes away when the compiler lets a pass draw into the surface (compiler issue
// typeshade/typeshade#1263).

declare const tex: texture_2d<f32>;

interface Color {
  color: vec4;
}

/** The colour of one pixel of the surface: the texel at the same place in the texture. */
@fragment
export function show(pos: builtin<"position">): Color {
  return { color: textureLoad(tex, vec2u(u32(pos.x), u32(pos.y)), 0) };
}
