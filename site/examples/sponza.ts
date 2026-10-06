// The atrium of Sponza, loaded from a .glb: 227,327 triangles in 22 meshes, without textures, under
// one large area light above the open roof. The path tracer builds one BVH for each mesh and one
// over the 23 instances (22 meshes and the light). The nave is about 4 m wide and the roof opens
// above it in a slot of 14.5 m by 3 m, so the light is a plane of that size: a larger one would
// have most of its samples hidden by the roof. The galleries and the curtains are lit by the
// paths that bounce in from the nave. Drag to look around from inside the nave.
// The model is Crytek's, from the Khronos glTF-Sample-Assets (site/public/assets/LICENSES.md).
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
import { GLTFLoader, OrbitControls } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

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
  camera.position.set(-9, 1.6, 0.4);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  // The camera stays in the nave, which is about 4 m wide: the drag turns it about a point 11 m
  // down the nave, and the azimuth limits keep it within 1.6 m of the nave's axis.
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(2, 4.2, 0);
  controls.minDistance = 5;
  controls.maxDistance = 11.5;
  controls.minPolarAngle = Math.PI / 2 - 0.25;
  controls.maxPolarAngle = Math.PI / 2 + 0.45;
  controls.minAzimuthAngle = -Math.PI / 2 - 0.15;
  controls.maxAzimuthAngle = -Math.PI / 2 + 0.15;
  controls.enableDamping = true;
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
