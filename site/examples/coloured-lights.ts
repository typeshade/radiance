// Three area lights, red, green and blue, over a white floor: where all three reach, the floor
// is white, and each sphere throws a shadow in the colours the others still give. Next-event
// estimation picks one light per bounce, so many lights cost no more than one.

import {
  Clock,
  Color,
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

export default async function colouredLights(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const scene = new Scene();
  const white = new DiffuseMaterial({ color: new Color(0.85, 0.85, 0.85) });
  const floor = new Mesh(new PlaneGeometry(10, 10), white);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const colours = [new Color(8, 0.2, 0.2), new Color(0.2, 8, 0.2), new Color(0.2, 0.2, 8)];
  colours.forEach((colour, i) => {
    const angle = (i / colours.length) * Math.PI * 2;
    const light = new Mesh(new PlaneGeometry(0.8, 0.8), new EmissiveMaterial({ color: colour }));
    light.position.set(Math.sin(angle) * 1.6, 2.4, Math.cos(angle) * 1.6);
    light.rotation.x = Math.PI / 2;
    scene.add(light);
  });

  for (const [x, z, r] of [
    [0, 0, 0.6],
    [1.4, -0.8, 0.35],
    [-1.3, -0.6, 0.45],
  ] as const) {
    const ball = new Mesh(new SphereGeometry(r), white);
    ball.position.set(x, r, z);
    scene.add(ball);
  }

  const camera = new PerspectiveCamera(40);
  camera.position.set(0, 3.2, 5.5);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.4, 0);
  controls.minDistance = 2;
  controls.maxDistance = 12;
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
