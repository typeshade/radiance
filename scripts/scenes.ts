// The scenes the gates render, by name. The harness page (scripts/harness-entry.ts) and the CPU
// oracle (scripts/oracle.ts) build a scene from this one table, so the GPU and the oracle render
// the same scene. scripts/gates/differential.mjs holds the bounds of each one. Each scene is a
// function of `packages/addons/src/scenes/`, as record 0002 lists them.
import {
  createCornellBox,
  createInstancesScene,
  createLightsScene,
  createTrianglesScene,
} from '@typeshade/radiance-addons';

export const scenes = {
  cornell: createCornellBox,
  triangles: createTrianglesScene,
  instances: createInstancesScene,
  lights: createLightsScene,
} as const;

export type SceneName = keyof typeof scenes;
