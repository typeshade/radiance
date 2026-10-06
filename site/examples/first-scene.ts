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
  PlaneGeometry,
  Scene,
  SphereGeometry,
} from '@typeshade/radiance';
import { OrbitControls } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

export default async function firstScene(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const scene = new Scene();

  const ground = new PlaneGeometry(6, 6);
  const grey = new DiffuseMaterial();
  grey.color.setHex(0xbfbfbf);
  const floor = new Mesh(ground, grey);
  floor.rotation.x = -Math.PI / 2;

  const panel = new PlaneGeometry(1.2, 1.2);
  const light = new EmissiveMaterial();
  light.emissive.multiplyScalar(10);
  const lamp = new Mesh(panel, light);
  lamp.position.set(0, 2.2, 0);
  lamp.rotation.x = Math.PI / 2;

  const sphere = new SphereGeometry(0.5);
  const chrome = new MirrorMaterial();
  const mirror = new Mesh(sphere, chrome);
  mirror.position.set(-0.6, 0.5, 0);

  const orange = new DiffuseMaterial();
  orange.color.setHex(0xe8703a);
  const ball = new Mesh(sphere, orange);
  ball.position.set(0.6, 0.5, 0.2);

  scene.add(floor, lamp, mirror, ball);

  const camera = new PerspectiveCamera(40);
  camera.position.set(0, 1.4, 3.6);
  camera.lookAt(ball.position);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.5, 0);
  controls.minDistance = 0.05;
  controls.maxDistance = 50;
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
