// English copy for the site's own pages and islands: the front page, the examples, the stage's
// controls, the header's links and the footer. Every number comes from the build
// (src/lib/facts.ts). The guide and the API reference are content, under src/content/docs.
import { facts } from '../lib/facts.ts';

export const en = {
  name: 'English',
  meta: {
    title: 'TypeShade Radiance',
    description:
      'A rendering engine for the web written on TypeShade: a scene graph, a progressive path tracer on WebGPU, and the same kernel checked on the CPU.',
  },
  nav: {
    guide: 'Guide',
    examples: 'Examples',
    api: 'API',
  },
  front: {
    title: 'A rendering engine on TypeShade',
    lede: `Radiance draws a scene graph written in TypeScript with a progressive path tracer on WebGPU. The GPU code is TypeShade, and the same kernel runs on the CPU oracle, where CI holds the two images within ${facts.gate.oracleMean} of each other.`,
    getStarted: 'Get started',
    examples: 'Examples',
    showcase: {
      file: 'first-scene.ts',
      caption: 'This file draws this picture.',
      open: 'Open this example',
    },
    graph: {
      h: 'A scene graph you already know',
      p: 'Objects, cameras, geometries, materials, meshes and renderers, laid out as three.js lays them out, so a scene reads the same way and a renderer is one call.',
      rows: [
        ['Object3D', 'position, rotation and scale, children, matrixWorld, lookAt'],
        ['Mesh', 'a geometry with a material, placed in the scene'],
        ['PerspectiveCamera', 'a field of view and an aspect ratio'],
        ['PathTracer', 'render(scene, camera), one dispatch of samples a frame'],
      ],
    },
    oracle: {
      h: 'One kernel, two machines',
      p: `The path tracer is one TypeShade file. The GPU runs it through the compiler's program runtime, and the compiler's CPU oracle runs the same file. CI renders the Cornell box both ways at ${facts.gate.size} and ${facts.gate.samples} samples a pixel, and holds the two images to each other; two renders of one seed are bit-identical.`,
      rows: [
        ['Mean relative difference, over the frame', `under ${facts.gate.oracleMean}`],
        [
          'Any channel of any pixel',
          `within ${facts.gate.oracleAbs}, or ${facts.gate.oracleRel * 100}% of the oracle's value`,
        ],
        ['Two renders of one seed', 'bit-identical'],
      ],
      source: 'The gate, in the repository',
    },
    gallery: {
      h: 'Examples',
      p: 'Every example is a file in the repository, run on its page. Open one and read the file that made it.',
      all: 'All examples',
    },
    install: {
      h: 'Install',
      p: `The engine is ${facts.packageName}, and the camera controls and ready-made scenes are ${facts.addonsName}. Both are written on the compiler pinned at commit ${facts.compilerCommit}.`,
      note: `Pre-release: version ${facts.version} of ${facts.packageName} is not on npm yet. Until it is, the repository is the way to run it.`,
      command: `npm install ${facts.packageName}`,
    },
  },
  examples: {
    h1: 'Examples',
    description:
      'Every example is a TypeScript file in the repository, run on its page by the engine. Open one and read the file that made it.',
    source: 'Source',
    onGithub: 'Open the file on GitHub',
    stage: {
      rendering: 'Rendering',
      preview: 'Preview',
      paused: 'Paused',
      done: 'Done',
      error: 'Not running',
      samples: 'samples a pixel',
      frameTime: 'ms a frame',
      pause: 'Pause',
      resume: 'Resume',
      resetView: 'Reset the view',
      png: 'Save as PNG',
      fullscreen: 'Full screen',
      exitFullscreen: 'Leave full screen',
      noWebgpu: 'This browser has no WebGPU. Chrome and Edge from version 113 have it.',
      stillAlt: (title: string) => `${title}, rendered by the engine`,
      canvasLabel: (title: string) =>
        `${title}. Drag to orbit, right-drag to pan, scroll to zoom, double-click to reset.`,
    },
  },
  footer: {
    docs: 'Documentation',
    project: 'Project',
    typeshade: 'TypeShade',
    guide: 'Guide',
    examples: 'Examples',
    api: 'API reference',
    plan: 'The plan',
    github: 'GitHub',
    npm: 'npm',
    issues: 'Issues',
    feedback: 'Field notes on TypeShade',
    site: 'typeshade.dev',
    compiler: 'The compiler',
    license: `Released under the ${facts.license} license.`,
    builtFrom: 'Built from commit',
    compilerPin: 'on the compiler at',
    attribution: 'Interface in the Vapor UI design language.',
  },
};
