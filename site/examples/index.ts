// The examples the site lists, in order: each is a module whose default export sets a scene up
// on a canvas (types.ts). The file that runs is the file the page shows. `scripts/stills.mjs`
// reads the same directory for the ids, so an example without a still stops the build.

import type { Example } from './types.ts';

export interface ExampleEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly load: () => Promise<{ default: Example }>;
}

export const EXAMPLES: readonly ExampleEntry[] = [
  {
    id: 'first-scene',
    title: 'First scene',
    description: 'A floor, a lamp, a mirror ball and a matte one: the scene the front page draws.',
    category: 'Path tracing',
    load: () => import('./first-scene.ts'),
  },
  {
    id: 'cornell-box',
    title: 'Cornell box',
    description: 'The reference scene, the one CI holds to the CPU oracle.',
    category: 'Path tracing',
    load: () => import('./cornell-box.ts'),
  },
  {
    id: 'materials',
    title: 'Materials',
    description: 'Diffuse spheres in four colours and a mirror, under one wide light.',
    category: 'Path tracing',
    load: () => import('./materials.ts'),
  },
  {
    id: 'coloured-lights',
    title: 'Coloured lights',
    description: 'Three area lights, red, green and blue: coloured shadows.',
    category: 'Path tracing',
    load: () => import('./coloured-lights.ts'),
  },
  {
    id: 'lights',
    title: 'Lights',
    description:
      'Three lights of one size, with powers 1, 4 and 16: each bounce picks a light in proportion to its power.',
    category: 'Path tracing',
    load: () => import('./lights.ts'),
  },
  {
    id: 'bunny',
    title: 'Stanford bunny',
    description:
      'A glTF mesh of 69,451 triangles on a floor, under one area light: the loader and the BVH.',
    category: 'Path tracing',
    load: () => import('./bunny.ts'),
  },
  {
    id: 'determinism',
    title: 'Determinism',
    description:
      'One seed, one image: two renders of one seed differ in no float, and another seed in many.',
    category: 'Path tracing',
    load: () => import('./determinism.ts'),
  },
  {
    id: 'geometries',
    title: 'Geometries',
    description:
      'A box, a sphere, a pyramid built by hand and a plane: every geometry the engine has, in one scene.',
    category: 'Geometry',
    load: () => import('./geometries.ts'),
  },
  {
    id: 'scene-graph',
    title: 'Scene graph',
    description: 'A turning group of spheres: the path tracer starts again every frame.',
    category: 'Scene graph',
    load: () => import('./scene-graph.ts'),
  },
  {
    id: 'instances',
    title: 'Instances',
    description:
      'One pyramid drawn 24 times, the right half mirrored: the path tracer builds one BLAS, and the TLAS holds 24 instances of it.',
    category: 'Scene graph',
    load: () => import('./instances.ts'),
  },
];

export const exampleById = (id: string): ExampleEntry | undefined =>
  EXAMPLES.find((e) => e.id === id);
