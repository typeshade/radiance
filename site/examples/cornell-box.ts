// The Cornell box, the path tracer's reference scene: the same one CI renders and holds to
// the CPU oracle. Drag to orbit inside the limits that keep the camera looking in.

import { Clock, PathTracer } from '@typeshade/radiance';
import { OrbitControls, createCornellBox } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

export default async function cornellBox(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const { scene, camera, target, bounds } = createCornellBox();

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.targetBounds = bounds;
  controls.minDistance = 1;
  controls.maxDistance = 6;
  // The box is open at the front only: keep the camera on that side.
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
