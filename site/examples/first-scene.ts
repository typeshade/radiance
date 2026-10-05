// A floor, a lamp over it, a mirror ball and a matte one. This is the whole of a scene: objects
// in a graph, a camera, a renderer and a loop. The front page draws this file.

import {
  Clock,
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  MirrorMaterial,
  PathTracer,
  PerspectiveCamera,
  QuadGeometry,
  Scene,
  SphereGeometry,
} from '@typeshade/radiance';
import { OrbitControls } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

export default async function firstScene(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const scene = new Scene();

  const floor = new Mesh(new QuadGeometry(6, 6), new DiffuseMaterial({ color: 0xbfbfbf }));
  floor.rotation.x = -Math.PI / 2;

  const lamp = new Mesh(new QuadGeometry(1.2, 1.2), new EmissiveMaterial({ intensity: 10 }));
  lamp.position.set(0, 2.2, 0);
  lamp.rotation.x = Math.PI / 2;

  const mirror = new Mesh(new SphereGeometry(0.5), new MirrorMaterial());
  mirror.position.set(-0.6, 0.5, 0);
  const ball = new Mesh(new SphereGeometry(0.5), new DiffuseMaterial({ color: 0xe8703a }));
  ball.position.set(0.6, 0.5, 0.2);

  scene.add(floor, lamp, mirror, ball);

  const camera = new PerspectiveCamera(40);
  camera.position.set(0, 1.4, 3.6);
  camera.lookAt(ball.position);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.5, 0);
  controls.minDistance = 1.5;
  controls.maxDistance = 8;
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
