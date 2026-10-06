import {
  Box3,
  BoxGeometry,
  Color,
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  PerspectiveCamera,
  QuadGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from '@typeshade/radiance';
import type { DemoScene } from './DemoScene.ts';

/**
 * Low-polygon meshes under one lamp: a sphere of 12 by 8 segments (168 triangles) shaded with
 * smooth normals, and a box of 12 triangles shaded flat, on a floor with a back wall. Every
 * ray walks the two-level BVH to a triangle, and the sphere's silhouette is the polygon's while
 * its shading is the sphere's. It is the `triangles` scene of the differential gate (design
 * record 0002).
 */
export function createTrianglesScene(): DemoScene {
  const scene = new Scene();
  const white = new DiffuseMaterial({ color: new Color(0.73, 0.73, 0.73) });
  const orange = new DiffuseMaterial({ color: new Color(0.8, 0.45, 0.15) });
  const blue = new DiffuseMaterial({ color: new Color(0.2, 0.35, 0.75) });
  const light = new EmissiveMaterial({ color: new Color(14, 13, 10) });

  const floor = new Mesh(new QuadGeometry(4, 4), white);
  floor.rotation.x = -Math.PI / 2;
  const back = new Mesh(new QuadGeometry(4, 3), white);
  back.position.set(0, 1.5, -1.2);

  const lamp = new Mesh(new QuadGeometry(0.8, 0.5), light);
  lamp.position.set(0, 1.9, 0.2);
  lamp.rotation.x = Math.PI / 2;

  const ball = new Mesh(new SphereGeometry(0.5, 12, 8), orange);
  ball.position.set(-0.55, 0.5, 0);
  const box = new Mesh(new BoxGeometry(0.6, 0.6, 0.6), blue);
  box.position.set(0.6, 0.3, 0.25);
  box.rotation.y = 0.5;

  scene.add(floor, back, lamp, ball, box);

  const camera = new PerspectiveCamera(40, 1);
  const target = new Vector3(0, 0.6, 0);
  camera.position.set(0, 1.2, 3.2);
  camera.lookAt(target);
  return {
    scene,
    camera,
    target,
    bounds: new Box3(new Vector3(-1, 0.1, -1), new Vector3(1, 1.5, 1)),
  };
}
