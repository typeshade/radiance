// The scene graph in motion: a group turns in the Cornell box, and two spheres turn on it. Each
// frame moves them, so the path tracer starts again every frame and shows what one or two
// samples a pixel look like: a game's frame, before denoising (docs/plan.md, M4). Paused, the
// motion stops and the samples add up again on the frame it stopped on.

import {
  Clock,
  DiffuseMaterial,
  Mesh,
  MirrorMaterial,
  Object3D,
  PathTracer,
  SphereGeometry,
} from '@typeshade/radiance';
import { OrbitControls, createCornellBox } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

export default async function sceneGraph(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const { scene, camera, target, bounds } = createCornellBox();
  // Take the box's own spheres out, and put a turning group in their place.
  for (const child of [...scene.children])
    if (child instanceof Mesh && child.geometry instanceof SphereGeometry) scene.remove(child);

  const pivot = new Object3D();
  pivot.position.set(0, 0.8, 0);
  const arm = new Object3D();
  pivot.add(arm);
  const mirror = new Mesh(new SphereGeometry(0.28), new MirrorMaterial());
  mirror.position.set(0.55, 0, 0);
  const ball = new Mesh(new SphereGeometry(0.22), new DiffuseMaterial({ color: 0xf0ad4e }));
  ball.position.set(-0.55, 0, 0);
  const moon = new Mesh(new SphereGeometry(0.08), new DiffuseMaterial({ color: 0xffffff }));
  moon.position.set(0, 0, 0.4);
  ball.add(moon);
  arm.add(mirror, ball);
  scene.add(pivot);

  const renderer = await new PathTracer({ canvas, seed: 1, samplesPerFrame: 2 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.targetBounds = bounds;
  controls.minAzimuthAngle = -0.5;
  controls.maxAzimuthAngle = 0.5;
  controls.minPolarAngle = Math.PI / 2 - 0.45;
  controls.maxPolarAngle = Math.PI / 2 + 0.45;
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
  const run: ExampleRun = {
    renderer,
    controls,
    playing: true,
    dispose() {
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
  renderer.setAnimationLoop(async () => {
    const dt = clock.getDelta();
    controls.update(dt);
    if (run.playing) {
      pivot.rotation.y += dt * 0.6;
      ball.rotation.y += dt * 2;
    }
    renderer.preview = controls.moving ? 2 : 1;
    await renderer.render(scene, camera);
  });
  return run;
}
