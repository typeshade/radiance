"use typeshade";
import { FLOOR, PLAYER, POTION } from "../rules.shade.ts";
import { Actor } from "../state/actors.shade.ts";
import { Tile } from "../state/tiles.shade.ts";

/** The last phase of a turn: a potion under the player becomes a floor. `actorsNext` holds the actors after the turn. */
export function pickup(
  tilesNext: array<Tile>,
  tiles: array<Tile>,
  actorsNext: array<Actor>,
  width: u32,
) {
  for (let i: u32 = 0; i < tilesNext.length; i++) {
    let t: Tile = tiles[i];
    const p: Actor = actorsNext[0];
    if (t.kind == POTION && p.kind == PLAYER && p.y * width + p.x == i) { t.kind = FLOOR; }
    tilesNext[i] = t;
  }
}
