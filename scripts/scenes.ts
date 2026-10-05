// The scenes the gates render, by name. The harness page (scripts/harness-entry.ts) and the CPU
// oracle (scripts/oracle.ts) build a scene from this one table, so the GPU and the oracle render
// the same scene. scripts/gates/differential.mjs holds the bounds of each one. Record 0002 moves
// the next scenes into `packages/addons/src/scenes/` and lists them here.
import { createCornellBox } from '@typeshade/radiance-addons';

export const scenes = { cornell: createCornellBox } as const;

export type SceneName = keyof typeof scenes;
