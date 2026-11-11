"use typeshade";
import { NONE, ahead } from "../rules.shade.ts";
import { Want } from "../scratch/wants.shade.ts";
import { Actor, wish } from "../state/actors.shade.ts";

/** The first phase of a turn: where each actor goes. */
export function plan(wants: array<Want>, actors: array<Actor>, width: u32, height: u32) {
  for (let i: u32 = 0; i < wants.length; i++) {
    const a: Actor = actors[i];
    let w: Want = wants[i];
    w.target = -1;
    if (a.kind != NONE) { w.target = ahead(a.x, a.y, wish(a, actors[0]), width, height); }
    wants[i] = w;
  }
}
