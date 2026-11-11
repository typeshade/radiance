// Design: 0111, sections 2 to 5. A game draws in layers. Each layer draws one instance for each
// row of one table, and the table stays on the device. The engine gives each layer a view that
// keeps the shape of the world on every screen. This module is of the runtime: it imports no
// module of the project layer, and it names no interface of the page.

import type { Device, Pack, Runtime, Texture } from 'typeshade/runtime';
import type { Blend } from './config.ts';
import { show } from './show.shade.ts';

/** A layer of a game: the class written into `.radiance/game.ts` gives one for each file of `draw/`. */
export interface Layer {
  /** The name of the layer, which is the name of its file. */
  readonly name: string;
  /** The compiled program of the layer's file: the default export of the module. */
  readonly program: object;
  /** The name of the `@vertex` entry. */
  readonly vertex: string;
  /** The name of the `@fragment` entry. */
  readonly fragment: string;
  /** The table the layer draws. The layer draws one instance for each of its rows. */
  readonly rows: { readonly size: number };
  /** How the colour of the layer meets the colour under it. Not given: the layer covers it. */
  readonly blend?: Blend;
  /**
   * The value of each `declare const` of the layer, by name, for a frame with this `view` and
   * this `blend` (design record 0111, section 6).
   */
  bind(view: readonly number[], blend: number): { readonly [name: string]: unknown };
}

/** The view of a game (design record 0111, section 3). */
export interface ViewOptions {
  /** A rectangle of the world, `[width, height]`, with its first corner at the origin. */
  readonly fit: readonly [number, number];
  /** The colour of the part of the screen that the rectangle does not cover. Black when not given. */
  readonly clear?: readonly [number, number, number];
}

/** A place, as a pointer gives it or as the world has it. */
export interface Place {
  readonly x: number;
  readonly y: number;
}

/** What the engine holds for a game with layers, from the start of the run to its end. */
export interface Drawing {
  /**
   * Draws each layer in order into the texture, and shows the texture on the surface. `blend` is
   * how far the frame is from the last tick to the tick after it, from 0 to 1.
   */
  frame(blend: number): Promise<void>;
  /** The place in the world of a place of the surface, `x` and `y` from 0 to 1. */
  toWorld(at: Place): Place;
  /** Frees the texture and the runtime. */
  dispose(): void;
}

/** The size of a surface in pixels: a surface has a `width` and a `height`. */
function sizeOf(surface: unknown): readonly [number, number] {
  const { width, height } = surface as { width?: unknown; height?: unknown };
  if (typeof width !== 'number' || typeof height !== 'number') {
    throw new TypeError(
      'The surface of the game has no width and height. Give run() the element the game draws to.',
    );
  }
  return [width, height];
}

/**
 * Where the rectangle of the world is on a screen of `size` pixels: the whole rectangle, in the
 * middle, as large as it can be. `scale` is the length of one unit in pixels, the same on both
 * axes. `x` and `y` are the pixels of the rectangle's first corner.
 */
export function fitRectangle(
  fit: readonly [number, number],
  size: readonly [number, number],
): { readonly scale: number; readonly x: number; readonly y: number } {
  const scale = Math.min(size[0] / fit[0], size[1] / fit[1]);
  return { scale, x: (size[0] - fit[0] * scale) / 2, y: (size[1] - fit[1] * scale) / 2 };
}

/**
 * The matrix of `view` (design record 0111, section 3): 16 numbers, column by column. It takes a
 * place of the world to a place of the screen. The x axis of the world goes right and its y axis
 * goes down. The screen's y axis goes up, so the matrix turns it over.
 */
export function viewMatrix(
  fit: readonly [number, number],
  size: readonly [number, number],
): number[] {
  const { scale, x, y } = fitRectangle(fit, size);
  const a = (2 * scale) / size[0];
  const d = (-2 * scale) / size[1];
  const tx = (2 * x) / size[0] - 1;
  const ty = 1 - (2 * y) / size[1];
  // prettier-ignore
  return [
    a, 0, 0, 0,
    0, d, 0, 0,
    0, 0, 1, 0,
    tx, ty, 0, 1,
  ];
}

/**
 * The place in the world of a place of the screen. `at` is `x` and `y` from 0 to 1 of the
 * screen. A place outside the rectangle gives a place outside the world: below 0 or from the
 * rectangle's width or height.
 */
export function placeInWorld(
  fit: readonly [number, number],
  size: readonly [number, number],
  at: Place,
): Place {
  const { scale, x, y } = fitRectangle(fit, size);
  return { x: (at.x * size[0] - x) / scale, y: (at.y * size[1] - y) / scale };
}

/** The `blend` member of a target, or nothing for a layer that covers what is under it. */
const blendOf = (layer: Layer) => {
  const blend = blendState(layer.blend);
  return blend === undefined ? {} : { blend };
};

/** What `createDrawing` needs. */
export interface DrawingOptions {
  /** The program runtime. The device of the game was made from it. */
  readonly runtime: Runtime;
  /** The device of the game. The texture of the layers is its own, as a draw needs. */
  readonly device: Device;
  readonly layers: readonly Layer[];
  readonly view: ViewOptions;
  /** What the picture is shown on. */
  readonly surface: unknown;
}

const FORMAT = 'rgba8unorm';

/**
 * The blend state of a pipeline (design record 0111, section 6). `alpha` puts the colour of the
 * layer over the colour under it by its alpha. `add` adds the colour of the layer, by its alpha,
 * to the colour under it. Both keep the alpha of the texture, so the picture stays opaque.
 */
export function blendState(blend: Blend | undefined): object | undefined {
  if (blend === 'alpha') {
    return {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
  }
  if (blend === 'add') {
    return {
      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
    };
  }
  return undefined;
}
/** A layer draws two triangles for each row: six vertices. */
const VERTICES = 6;

/**
 * Makes the drawing of a game (design record 0111, section 4). The pipelines are made at the
 * first frame. The texture has the size of the surface, and it is made again when the surface
 * changes its size.
 */
export function createDrawing(options: DrawingOptions): Drawing {
  const { runtime, device, layers, view, surface } = options;
  const clear = [...(view.clear ?? [0, 0, 0]), 1] as [number, number, number, number];
  let texture: Texture | undefined;
  let pipelines: Promise<unknown[]> | undefined;
  let disposed = false;

  const make = () =>
    Promise.all(
      layers.map((layer) =>
        runtime.load(layer.program as Pack<never>).render({
          vertex: layer.vertex,
          fragment: layer.fragment,
          targets: [{ format: FORMAT, ...blendOf(layer) }],
          primitive: { topology: 'triangle-list' },
        } as never),
      ),
    );

  return {
    async frame(blend) {
      if (disposed) return;
      const size = sizeOf(surface);
      if (!(size[0] >= 1 && size[1] >= 1)) return;
      if (texture === undefined) texture = device.texture({ size, format: FORMAT });
      else if (texture.width !== size[0] || texture.height !== size[1]) {
        texture.resize(size[0], size[1]);
      }
      pipelines ??= make();
      const pipes = (await pipelines) as { draw(pass: object, b: object, g: object): void }[];
      const target = texture;
      const matrix = viewMatrix(view.fit, size);
      const frame = runtime.frame();
      layers.forEach((layer, index) => {
        const color = index === 0 ? { target, clear } : { target, load: 'load' as const };
        frame.pass({ color: [color] } as never, (pass) => {
          pass.draw(pipes[index] as never, layer.bind(matrix, blend) as never, {
            count: VERTICES,
            instances: layer.rows.size,
          });
        });
      });
      await frame.submit();
      await show(surface as never, { tex: target });
    },
    toWorld: (at) => placeInWorld(view.fit, sizeOf(surface), at),
    dispose() {
      if (disposed) return;
      disposed = true;
      texture?.destroy();
      runtime.destroy();
    },
  };
}
