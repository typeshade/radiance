// Three lights of one size and three powers, over three spheres. The path tracer lists the
// triangles of every emissive mesh in a light table, and picks one for each bounce with a chance
// in proportion to its power: its area times the mean of its colour. The lights here are 1, 4 and
// 16 in intensity and equal in area, so they are picked about 5 %, 19 % and 76 % of the time.

import {
  Clock,
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  PathTracer,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
} from '@typeshade/radiance';
import { OrbitControls } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

/** The intensity of each lamp, from left to right. */
const POWERS = [1, 4, 16] as const;

export default async function lights(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const scene = new Scene();

  const white = new DiffuseMaterial({ color: 0xd8d8d8 });
  const floor = new Mesh(new PlaneGeometry(10, 6), white);
  floor.rotation.x = -Math.PI / 2;
  const wall = new Mesh(new PlaneGeometry(10, 4), white);
  wall.position.set(0, 2, -2.5);
  scene.add(floor, wall);

  const ball = new SphereGeometry(0.5);
  const lamp = new PlaneGeometry(0.9, 0.9);
  POWERS.forEach((intensity, i) => {
    const x = (i - 1) * 2.4;
    const light = new Mesh(lamp, new EmissiveMaterial({ intensity }));
    light.position.set(x, 2.4, 0);
    // Face down and toward the camera, so each lamp shows its own brightness.
    light.rotation.x = 0.9;
    const sphere = new Mesh(ball, white);
    sphere.position.set(x, 0.5, 0);
    scene.add(light, sphere);
  });

  const camera = new PerspectiveCamera(35);
  camera.position.set(0, 1.6, 7);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.2, 0);
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
