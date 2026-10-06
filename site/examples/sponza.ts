// The atrium of Sponza, loaded from a .glb: 227,327 triangles in 22 meshes, without textures, under
// one large area light above the open roof. The path tracer builds one BVH for each mesh and one
// over the 23 instances (22 meshes and the light). The nave is about 4 m wide and the roof opens
// above it in a slot of 14.5 m by 3 m, so the light is a plane of that size: a larger one would
// have most of its samples hidden by the roof. The galleries and the curtains are lit by the
// paths that bounce in from the nave. Drag to look around from inside the nave.
// The model is by Frank Meinl (Crytek), from the Computer Graphics Archive of Morgan McGuire, under
// CC BY 3.0 (site/public/assets/LICENSES.md has the credit and the source).
//
// The BVH of the 22 meshes builds in about 380 ms on the host (scripts/sponza.test.ts prints it),
// and docs/benchmarks.md has the speed of this example on SwiftShader.

import {
  Box3,
  Clock,
  EmissiveMaterial,
  Mesh,
  PathTracer,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
} from '@typeshade/radiance';
import { GLTFLoader, OrbitControls } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

/**
 * The orbit of the camera, in metres and radians. The camera starts at `start` and turns about
 * `target`, 8.8 m down the nave and 1.6 m below the start. The nave is 3.8 m wide, its floor is at
 * y = 0.991, and its columns, arches and hanging vases stand at the sides and at the end bay.
 * The limits keep every position the orbit reaches at least 0.2 m from a triangle of the model
 * and above y = 1.25 (`scripts/sponza.test.ts` holds that, on a grid of the whole range):
 *
 * - `maxDistance` 9 keeps the camera in front of the arch at x = -7.3, out of the end bay.
 * - `maxPolar` is 0.32 rad below the horizon. At 9 m it puts the camera at y = 1.37 at the lowest.
 * - `azimuth` 0.15 rad keeps the camera within 1.35 m of the axis of the nave, inside its columns.
 *
 * The pivot is one point, so the pan gestures do not move it.
 */
export const ORBIT = {
  start: [-6.8, 5.8, 0.4] as const,
  target: [2, 4.2, 0] as const,
  minDistance: 2,
  maxDistance: 9,
  minPolar: Math.PI / 2 - 0.4,
  maxPolar: Math.PI / 2 + 0.32,
  /** Half the azimuth range, about the direction of the start (-x). */
  azimuth: 0.15,
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
  // The controls read the camera when they are made, about a pivot at the origin. `saveState` and
  // `reset` read it again about the pivot set here, so the camera stays where `ORBIT.start` puts it.
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...ORBIT.target);
  controls.targetBounds = new Box3(new Vector3(...ORBIT.target), new Vector3(...ORBIT.target));
  controls.minDistance = ORBIT.minDistance;
  controls.maxDistance = ORBIT.maxDistance;
  controls.minPolarAngle = ORBIT.minPolar;
  controls.maxPolarAngle = ORBIT.maxPolar;
  controls.minAzimuthAngle = -Math.PI / 2 - ORBIT.azimuth;
  controls.maxAzimuthAngle = -Math.PI / 2 + ORBIT.azimuth;
  controls.enableDamping = true;
  controls.saveState();
  controls.reset();
  controls.update();
  controls.saveState();

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
    controls.update(clock.getDelta());
    // While the camera moves, trace one pixel in four by four: a quick preview.
    renderer.preview = controls.moving ? 4 : 1;
    await renderer.render(scene, camera);
  });

  return {
    renderer,
    controls,
    dispose() {
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}
