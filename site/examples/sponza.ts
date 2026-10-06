// The atrium of Sponza, loaded from a .glb: 227,327 triangles in 22 meshes, without textures, under
// one large area light above the open roof. The path tracer builds one BVH for each mesh and one
// over the 23 instances (22 meshes and the light). The nave is about 4 m wide and the roof opens
// above it in a slot of 14.5 m by 3 m, so the light is a plane of that size: a larger one would
// have most of its samples hidden by the roof. The galleries and the curtains are lit by the
// paths that bounce in from the nave. The view starts in fly mode inside the nave: drag to look,
// W A S D to move, Q and E to go down and up, Shift to go faster. KeyF swaps to the orbit, which
// is free, and back (site/src/lib/swap-controls.ts).
// The model is by Frank Meinl (Crytek), from the Computer Graphics Archive of Morgan McGuire, under
// CC BY 3.0 (site/public/assets/LICENSES.md has the credit and the source).
//
// The BVH of the 22 meshes builds in about 380 ms on the host (scripts/sponza.test.ts prints it),
// and docs/benchmarks.md has the speed of this example on SwiftShader.

import {
  Clock,
  EmissiveMaterial,
  Mesh,
  PathTracer,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from '@typeshade/radiance';
import { FlyControls, GLTFLoader, OrbitControls } from '@typeshade/radiance-addons';
import { swapControls } from '../src/lib/swap-controls.ts';
import type { ExampleRun } from './types.ts';

/**
 * Where the camera starts, and the point it turns about, in metres. The camera starts 8.8 m down
 * the nave from the pivot and 1.6 m above it. The nave is 3.8 m wide, its floor is at y = 0.991,
 * and its columns, arches and hanging vases stand at the sides and at the end bay. The start is
 * inside the nave, 0.2 m or more from a triangle of the model and above its floor
 * (`scripts/sponza.test.ts` holds that). The orbit has no limit after the start: the viewer can
 * go anywhere, as in the other examples. Only the distance is bounded, from 0.05 to 50 metres.
 */
export const ORBIT = {
  start: [-6.8, 5.8, 0.4] as const,
  target: [2, 4.2, 0] as const,
};

export default async function sponza(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const scene = new Scene();

  // The file's node scales the model to metres and puts the atrium on y = 0, centred on x = z = 0:
  // it is 29.8 m long (x), 18.3 m wide (z) and 12.4 m high.
  const gltf = await new GLTFLoader().loadAsync('/assets/sponza.glb');

  // One large emitter above the open roof, facing down: the sky and the sun in one.
  const sky = new Mesh(new PlaneGeometry(14.6, 3.2), new EmissiveMaterial({ intensity: 60 }));
  sky.position.set(0, 12.9, 0);
  sky.rotation.x = Math.PI / 2;
  scene.add(gltf.scene, sky);

  const camera = new PerspectiveCamera(70);
  camera.position.set(...ORBIT.start);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...ORBIT.target);
  controls.minDistance = 0.05;
  controls.maxDistance = 50;
  controls.enableDamping = true;
  // The controls read the camera when they are made, about a pivot at the origin. `saveState` and
  // `reset` read it again about the pivot set here, so the camera stays where `ORBIT.start` puts it.
  controls.saveState();
  controls.reset();
  controls.update();
  controls.saveState();

  // Fly mode starts. The orbit's `update` above aimed the camera at its target from the start
  // position, and the fly controls take that place and look as they are, so the first frame is
  // the one the orbit start gave.
  const fly = new FlyControls(camera, canvas);
  fly.movementSpeed = 3;
  const FLY_LABEL =
    'Drag to look, W A S D to move, Q and E to go down and up, Shift to go faster, F to switch to orbit.';
  const ORBIT_LABEL = 'Drag to orbit, scroll to zoom, right-drag to pan, F to switch to fly.';
  let label = FLY_LABEL;
  const swap = swapControls(camera, canvas, fly, controls, 'fly', (mode) => {
    // The stage set the canvas label from `controlsLabel`: swap its tail for the active mode's.
    const now = mode === 'fly' ? FLY_LABEL : ORBIT_LABEL;
    const current = canvas.getAttribute('aria-label');
    if (current?.endsWith(label))
      canvas.setAttribute('aria-label', current.slice(0, -label.length) + now);
    label = now;
  });

  // Fill the canvas: the frame follows its size, and the camera its shape.
  const resize = (): void => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const clock = new Clock();
  renderer.setAnimationLoop(async () => {
    swap.update(clock.getDelta());
    // While the camera moves, trace one pixel in four by four: a quick preview.
    renderer.preview = swap.moving ? 4 : 1;
    await renderer.render(scene, camera);
  });

  return {
    renderer,
    controlsLabel: FLY_LABEL,
    get controls() {
      return swap.active;
    },
    dispose() {
      observer.disconnect();
      swap.dispose();
      renderer.dispose();
    },
  };
}
