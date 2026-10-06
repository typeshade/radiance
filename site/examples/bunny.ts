// The Stanford bunny, loaded from a .glb: 69,451 triangles on a floor, under one area light. The
// loader turns the file's node into a `Mesh` with a `BufferGeometry` and a `PhysicalMaterial`, and
// the path tracer builds one BVH over the triangles. Drag to turn the camera around it.
// The bunny is the Stanford Computer Graphics Laboratory's (site/public/assets/LICENSES.md).

import {
  Clock,
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  PathTracer,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from '@typeshade/radiance';
import { GLTFLoader, OrbitControls } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

export default async function bunny(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const scene = new Scene();

  const floor = new Mesh(new PlaneGeometry(24, 24), new DiffuseMaterial({ color: 0xbfbfbf }));
  floor.rotation.x = -Math.PI / 2;

  // One area light, a square over the floor and to one side, facing down.
  const lamp = new Mesh(new PlaneGeometry(1.6, 1.6), new EmissiveMaterial({ intensity: 12 }));
  lamp.position.set(-1.6, 3.4, 1.8);
  lamp.rotation.x = Math.PI / 2;

  // The file's node scales the bunny to about 1.5 high and stands it on y = 0.
  const gltf = await new GLTFLoader().loadAsync('/assets/bunny.glb');
  scene.add(floor, lamp, gltf.scene);

  const camera = new PerspectiveCamera(35);
  camera.position.set(1.4, 1.5, 3.7);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.7, 0);
  controls.minDistance = 1.5;
  controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
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
