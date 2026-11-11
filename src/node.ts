// Design: 0100, section 2. A node is a plain description of one place in a scene's tree. It runs
// nothing. `scene` checks the whole tree once and returns an immutable value.

/** A class of a `"use typeshade"` file that the host builds with `new` and no argument. */
export type NodeClass<T extends object = object> = new () => T;

/** The fields of a class's instance: its members that are not methods. */
export type FieldsOf<T> = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  [K in keyof T as T[K] extends Function ? never : K]: T[K];
};

/** One node as the author wrote it. Make one with `node`. */
export class NodeSpec {
  /** @internal Use `node`. */
  constructor(
    /** The name the author gave, or `undefined`. */
    readonly name: string | undefined,
    /** The node's class, or `undefined` for a group. */
    readonly cls: NodeClass | undefined,
    /** The first values of the class's fields. */
    readonly fields: Readonly<Record<string, unknown>>,
    /** The children, in order. */
    readonly children: readonly NodeSpec[],
  ) {
    Object.freeze(this);
  }
}

/** One node of a checked scene, with its name and its path settled. */
export interface SceneNode {
  /** The node's name: the author's, or `<Class>#<n>`. */
  readonly name: string;
  /** True when the author gave the name. */
  readonly named: boolean;
  /** The names from the root to this node, joined with `/`. */
  readonly path: string;
  /** How many nodes are above this one. The root is 0. */
  readonly depth: number;
  /** The node's class, or `undefined` for a group. */
  readonly cls: NodeClass | undefined;
  /** The first values of the class's fields. */
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A checked scene. Make one with `scene`. */
export class Scene {
  /** @internal Use `scene`. */
  constructor(
    /** The root as the author wrote it. */
    readonly root: NodeSpec,
    /** Every node, depth first, a parent before its children, children in order. */
    readonly nodes: readonly SceneNode[],
  ) {
    Object.freeze(this);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return `the class ${value.name || '(no name)'}`;
  if (value instanceof NodeSpec) return 'a node';
  if (isPlainObject(value)) return 'an object of field values';
  return String(value);
}

/**
 * Describes one node. The arguments are read in this order, and each is optional:
 *
 * 1. a string, the node's name
 * 2. a class of a `"use typeshade"` file, the node's class
 * 3. an object, the first values of the class's fields (only after a class)
 * 4. the children, each made with `node`
 *
 * A node with no class is a group, and a group has a name.
 */
export function node(name: string, ...children: NodeSpec[]): NodeSpec;
export function node<T extends object>(cls: NodeClass<T>, ...children: NodeSpec[]): NodeSpec;
export function node<T extends object>(
  cls: NodeClass<T>,
  fields: Partial<FieldsOf<T>>,
  ...children: NodeSpec[]
): NodeSpec;
export function node<T extends object>(
  name: string,
  cls: NodeClass<T>,
  ...children: NodeSpec[]
): NodeSpec;
export function node<T extends object>(
  name: string,
  cls: NodeClass<T>,
  fields: Partial<FieldsOf<T>>,
  ...children: NodeSpec[]
): NodeSpec;
export function node(...args: unknown[]): NodeSpec {
  let at = 0;
  let name: string | undefined;
  let cls: NodeClass | undefined;
  let fields: Record<string, unknown> = {};

  if (typeof args[at] === 'string') {
    name = args[at] as string;
    at++;
    if (name === '') {
      throw new TypeError(
        'node(): the name is an empty string. Give a name of one character or more.',
      );
    }
    if (name.includes('/')) {
      throw new TypeError(
        `node(): the name ${JSON.stringify(name)} holds "/". A path joins names with "/", so use another character.`,
      );
    }
  }
  if (typeof args[at] === 'function') {
    cls = args[at] as NodeClass;
    at++;
    if (isPlainObject(args[at])) {
      fields = { ...(args[at] as Record<string, unknown>) };
      at++;
    }
  } else if (isPlainObject(args[at])) {
    throw new TypeError(
      'node(): an object of field values follows no class. Put the class before the object.',
    );
  }
  const children = args.slice(at);
  for (const child of children) {
    if (!(child instanceof NodeSpec)) {
      throw new TypeError(
        `node(): ${describe(child)} is where a child is read. Give the name, the class and the field values first, then each child as node(...).`,
      );
    }
  }
  if (cls === undefined && name === undefined) {
    throw new TypeError(
      'node(): a node with no class is a group, and a group has a name. Give the name first.',
    );
  }
  return new NodeSpec(name, cls, Object.freeze(fields), Object.freeze(children as NodeSpec[]));
}

/** The names of a class's fields, read from one instance built with `new` and no argument. */
function fieldNames(cls: NodeClass, cache: Map<NodeClass, readonly string[]>): readonly string[] {
  const known = cache.get(cls);
  if (known !== undefined) return known;
  let instance: object;
  try {
    instance = new cls();
  } catch (cause) {
    throw new TypeError(
      `scene(): new ${cls.name}() failed, and a node's class is built with no argument. Give each constructor parameter a default, or set the fields in node(${cls.name}, { ... }).`,
      { cause },
    );
  }
  const names = Object.freeze(Object.keys(instance));
  cache.set(cls, names);
  return names;
}

/**
 * Checks a tree of nodes and returns the scene. The check gives each unnamed node its name
 * (`<Class>#<n>`, where `n` counts the earlier unnamed siblings of that class), refuses two
 * siblings with one name, and refuses a field value for a field the class does not declare.
 */
export function scene(root: NodeSpec): Scene {
  if (!(root instanceof NodeSpec)) {
    throw new TypeError(`scene(): ${describe(root)} is not a node. Give the root as node(...).`);
  }
  const cache = new Map<NodeClass, readonly string[]>();
  const nodes: SceneNode[] = [];

  const visit = (
    spec: NodeSpec,
    name: string,
    parentPath: string | undefined,
    depth: number,
  ): void => {
    const path = parentPath === undefined ? name : `${parentPath}/${name}`;
    if (spec.cls !== undefined) {
      const declared = fieldNames(spec.cls, cache);
      for (const field of Object.keys(spec.fields)) {
        if (!declared.includes(field)) {
          throw new TypeError(
            `scene(): the class ${spec.cls.name} declares no field ${JSON.stringify(field)}, at ${JSON.stringify(path)}. Its fields are ${declared.join(', ')}.`,
          );
        }
      }
    }
    nodes.push(
      Object.freeze({
        name,
        named: spec.name !== undefined,
        path,
        depth,
        cls: spec.cls,
        fields: spec.fields,
      }),
    );

    const counts = new Map<NodeClass, number>();
    const taken = new Set<string>();
    for (const child of spec.children) {
      let childName = child.name;
      if (childName === undefined) {
        // `node` refuses a group with no name, so an unnamed node has a class.
        const cls = child.cls as NodeClass;
        const n = counts.get(cls) ?? 0;
        counts.set(cls, n + 1);
        childName = `${cls.name}#${n}`;
      }
      if (taken.has(childName)) {
        throw new TypeError(
          `scene(): two children of ${JSON.stringify(path)} have the name ${JSON.stringify(childName)}. Give each sibling its own name.`,
        );
      }
      taken.add(childName);
      visit(child, childName, path, depth + 1);
    }
  };

  const rootName = root.name ?? `${(root.cls as NodeClass).name}#0`;
  visit(root, rootName, undefined, 0);
  return new Scene(root, Object.freeze(nodes));
}
