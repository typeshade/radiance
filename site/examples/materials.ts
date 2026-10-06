// The materials M1 has, side by side: diffuse spheres in four colours and a mirror, on a white
// floor under one wide light. The light is an emissive quad; it is also what the mirror shows.

import {
  Clock,
  Color,
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

export default async function materials(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const scene = new Scene();

  const white = new DiffuseMaterial({ color: new Color(0.8, 0.8, 0.8) });
  const floor = new Mesh(new PlaneGeometry(8, 6), white);
  floor.rotation.x = -Math.PI / 2;
  const back = new Mesh(new PlaneGeometry(8, 4), white);
  back.position.set(0, 2, -2);
  const light = new Mesh(new PlaneGeometry(4, 1.5), new EmissiveMaterial({ intensity: 6 }));
  light.position.set(0, 3, 0.5);
  light.rotation.x = Math.PI / 2;
  scene.add(floor, back, light);

  const spheres = [
    new DiffuseMaterial({ color: 0xd9534f }),
    new DiffuseMaterial({ color: 0xf0ad4e }),
    new MirrorMaterial(),
    new DiffuseMaterial({ color: 0x5cb85c }),
    new DiffuseMaterial({ color: 0x428bca }),
  ];
  spheres.forEach((material, i) => {
    const ball = new Mesh(new SphereGeometry(0.45), material);
    ball.position.set((i - 2) * 1.05, 0.45, 0);
    scene.add(ball);
  });

  const camera = new PerspectiveCamera(35);
  camera.position.set(0, 1.6, 6.5);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.6, 0);
  controls.minDistance = 2;
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minAzimuthAngle = -1;
  controls.maxAzimuthAngle = 1;
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
