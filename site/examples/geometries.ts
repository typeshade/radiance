// Every geometry the engine exports, in one scene: a BoxGeometry, a SphereGeometry, a
// BufferGeometry built by hand (a pyramid) and a PlaneGeometry standing up as a card. The floor,
// the wall and the lamp are PlaneGeometry too. All of them are triangle meshes in the end: the
// path tracer reads the arrays of a BufferGeometry and builds a BVH over its triangles.

import {
  BoxGeometry,
  BufferGeometry,
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

/**
 * A square pyramid, built from the arrays a BufferGeometry holds: `position`, `index` and, from
 * them, `normal`. Each face has its own three vertices, so its normals are flat. The base is on
 * y = 0 and the apex above its centre. Each triangle runs counter-clockwise seen from outside.
 */
function pyramid(half: number, height: number): BufferGeometry {
  const corner = [
    [-half, 0, half],
    [half, 0, half],
    [half, 0, -half],
    [-half, 0, -half],
  ] as const;
  const apex = [0, height, 0] as const;
  const faces = [
    // The four sides: two base corners and the apex.
    [corner[0], corner[1], apex],
    [corner[1], corner[2], apex],
    [corner[2], corner[3], apex],
    [corner[3], corner[0], apex],
    // The base, in two triangles, faces down.
    [corner[0], corner[2], corner[1]],
    [corner[0], corner[3], corner[2]],
  ] as const;
  const geometry = new BufferGeometry();
  geometry.position = Float32Array.from(faces.flat(2));
  geometry.index = Uint32Array.from({ length: faces.length * 3 }, (_, i) => i);
  geometry.computeVertexNormals();
  return geometry;
}

export default async function geometries(canvas: HTMLCanvasElement): Promise<ExampleRun> {
  const scene = new Scene();

  const white = new DiffuseMaterial({ color: 0xd8d8d8 });
  const floor = new Mesh(new PlaneGeometry(10, 8), white);
  floor.rotation.x = -Math.PI / 2;
  const wall = new Mesh(new PlaneGeometry(10, 4), white);
  wall.position.set(0, 2, -2.5);
  const lamp = new Mesh(new PlaneGeometry(4, 1.2), new EmissiveMaterial({ intensity: 6 }));
  lamp.position.set(0, 3.2, 0.5);
  lamp.rotation.x = Math.PI / 2;
  scene.add(floor, wall, lamp);

  const box = new Mesh(new BoxGeometry(0.9, 0.9, 0.9), new DiffuseMaterial({ color: 0xd9534f }));
  box.position.set(-2.25, 0.45, 0);
  box.rotation.y = 0.5;

  const sphere = new Mesh(new SphereGeometry(0.5), new DiffuseMaterial({ color: 0xf0ad4e }));
  sphere.position.set(-0.75, 0.5, 0);

  const tent = new Mesh(pyramid(0.5, 1.1), new DiffuseMaterial({ color: 0x5cb85c }));
  tent.position.set(0.75, 0, 0);
  tent.rotation.y = 0.4;

  const card = new Mesh(new PlaneGeometry(0.9, 1.2), new DiffuseMaterial({ color: 0x428bca }));
  card.position.set(2.25, 0.6, 0);
  card.rotation.y = -0.5;
  scene.add(box, sphere, tent, card);

  const camera = new PerspectiveCamera(35);
  camera.position.set(0, 1.7, 6.5);

  const renderer = await new PathTracer({ canvas, seed: 1, targetFrameTime: 30 }).init();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.6, 0);
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
