import {
  Box3,
  Color,
  DiffuseMaterial,
  EmissiveMaterial,
  Mesh,
  MirrorMaterial,
  PerspectiveCamera,
  QuadGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from '@typeshade/radiance';

export interface CornellBox {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Where the camera looks. */
  readonly target: Vector3;
  /** The box the camera's target should stay in, for controls. */
  readonly bounds: Box3;
}

/**
 * The Cornell box: two units wide, open at the front (+z), a red wall on the left, a green one
 * on the right, a light just below the ceiling, a mirror sphere and a white one. The camera
 * looks in through the open side.
 *
 * Every shape is triangles: the walls and the light are planes of two triangles each, and each
 * sphere is a `SphereGeometry` of three.js's default 32 by 16 segments, 960 triangles. It is the
 * scene CI renders on the GPU and on the CPU oracle (design record 0002).
 */
export function createCornellBox(): CornellBox {
  const scene = new Scene();
  const white = new DiffuseMaterial({ color: new Color(0.73, 0.73, 0.73) });
  const red = new DiffuseMaterial({ color: new Color(0.65, 0.05, 0.05) });
  const green = new DiffuseMaterial({ color: new Color(0.12, 0.45, 0.15) });
  const light = new EmissiveMaterial({ color: new Color(17, 12, 4) });
  const wall = new QuadGeometry(2, 2);

  const floor = new Mesh(wall, white);
  floor.rotation.x = -Math.PI / 2;
  const ceiling = new Mesh(wall, white);
  ceiling.position.set(0, 2, 0);
  ceiling.rotation.x = Math.PI / 2;
  const back = new Mesh(wall, white);
  back.position.set(0, 1, -1);
  const left = new Mesh(wall, red);
  left.position.set(-1, 1, 0);
  left.rotation.y = Math.PI / 2;
  const right = new Mesh(wall, green);
  right.position.set(1, 1, 0);
  right.rotation.y = -Math.PI / 2;

  const lamp = new Mesh(new QuadGeometry(0.5, 0.4), light);
  lamp.position.set(0, 1.98, 0);
  lamp.rotation.x = Math.PI / 2;

  const mirror = new Mesh(new SphereGeometry(0.4), new MirrorMaterial());
  mirror.position.set(-0.45, 0.4, -0.35);
  const ball = new Mesh(new SphereGeometry(0.4), white);
  ball.position.set(0.45, 0.4, 0.3);

  scene.add(floor, ceiling, back, left, right, lamp, mirror, ball);

  const camera = new PerspectiveCamera(40, 1);
  const target = new Vector3(0, 1, 0);
  camera.position.set(0, 1, 3.4);
  camera.lookAt(target);
  return {
    scene,
    camera,
    target,
    bounds: new Box3(new Vector3(-0.9, 0.1, -0.9), new Vector3(0.9, 1.9, 0.9)),
  };
}
