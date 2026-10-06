// One geometry, drawn 24 times. The path tracer builds one BLAS for the pyramid's triangles, and
// the TLAS holds one instance for each mesh that uses it: a transform, and the number of the
// material. The right half is the left half under a scale of -1 along x, so its pyramids lean the
// other way: a mirrored instance keeps its outside. The floor and the lamp are two more
// geometries, so the scene holds 26 instances of 3 BLASes.

import {
  BufferGeometry,
  Clock,
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  Object3D,
  PathTracer,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from '@typeshade/radiance';
import { OrbitControls } from '@typeshade/radiance-addons';
import type { ExampleRun } from './types.ts';

/**
 * A square pyramid that leans to +x: the base is on y = 0 and the apex is above a point to the
 * right of its centre, so a mirror image is plain to see. Each face has its own three vertices,
 * and each triangle runs counter-clockwise seen from outside.
 */
function leaningPyramid(): BufferGeometry {
  const half = 0.2;
  const corner = [
    [-half, 0, half],
    [half, 0, half],
    [half, 0, -half],
    [-half, 0, -half],
  ] as const;
  const apex = [0.3, 0.7, 0] as const;
  const faces = [
    [corner[0], corner[1], apex],
    [corner[1], corner[2], apex],
    [corner[2], corner[3], apex],
    [corner[3], corner[0], apex],
    [corner[0], corner[2], corner[1]],
    [corner[0], corner[3], corner[2]],
  ] as const;
  const geometry = new BufferGeometry();
  geometry.position = Float32Array.from(faces.flat(2));
  geometry.index = Uint32Array.from({ length: faces.length * 3 }, (_, i) => i);
  geometry.computeVertexNormals();
  return geometry;
}

/** The columns and the rows of pyramids in each half. */
const COLUMNS = 3;
const ROWS = 4;

export default async function instances(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const scene = new Scene();

  const white = new DiffuseMaterial({ color: 0xd8d8d8 });
  const floor = new Mesh(new PlaneGeometry(10, 8), white);
  floor.rotation.x = -Math.PI / 2;
  const lamp = new Mesh(new PlaneGeometry(4, 1.2), new EmissiveMaterial({ intensity: 6 }));
  lamp.position.set(0, 3.2, 0);
  lamp.rotation.x = Math.PI / 2;
  scene.add(floor, lamp);

  // One geometry. Every mesh below shares it, and each half shares one material.
  const shared = leaningPyramid();
  const orange = new DiffuseMaterial({ color: 0xf0ad4e });
  const blue = new DiffuseMaterial({ color: 0x428bca });

  // The left half as it is, and the right half as the same group with its x axis flipped.
  const left = new Object3D();
  left.position.set(-0.4, 0, 0);
  const right = new Object3D();
  right.position.set(0.4, 0, 0);
  right.scale.x = -1;
  for (const [half, material] of [
    [left, orange],
    [right, blue],
  ] as const) {
    for (let column = 0; column < COLUMNS; column++) {
      for (let row = 0; row < ROWS; row++) {
        const pyramid = new Mesh(shared, material);
        // Each mesh has a place, a turn about y and a size of its own.
        pyramid.position.set(-0.5 - column * 0.9, 0, 1.2 - row * 0.8);
        pyramid.rotation.y = (row - column) * 0.25;
        const size = 0.8 + 0.25 * column;
        pyramid.scale.set(size, size, size);
        half.add(pyramid);
      }
    }
  }
  scene.add(left, right);

  const camera = new PerspectiveCamera(35);
  camera.position.set(0, 3.4, 6.5);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.3, 0);
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
