// Design: 0108, section 10, rules 1 and 2. The facts of a `"use typeshade"` file that the
// engine needs and the compiler does not report yet (compiler issue typeshade/typeshade#1253).
// This is the one module of the engine that reads source. It reads names only: the name of an
// exported class, an exported number, an exported function and its parameters, and the entries
// and the `declare const` names of a layer (design record 0111). When the pin
// has the compiler's report, this module reads the report, and no other module changes.

import ts from 'typescript';

/** The facts of a file that declares a table. */
export interface TableFacts {
  /** The name of the one class the file exports. */
  readonly className: string;
  /** The value of `export const slots`, when the file has one. */
  readonly slots: number | undefined;
}

/** The facts of a file that declares a system. */
export interface SystemFacts {
  /** The names of the function's parameters, in order. */
  readonly params: readonly string[];
}

/** The facts of a layer's file (design record 0111, section 2). */
export interface LayerFacts {
  /** The names of the exported functions that carry `@vertex`, in the order of the file. */
  readonly vertex: readonly string[];
  /** The names of the exported functions that carry `@fragment`, in the order of the file. */
  readonly fragment: readonly string[];
  /** Each `declare const` of the file: its name and the kind of its type, for example `storage`. */
  readonly declares: readonly { readonly name: string; readonly kind: string }[];
}

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

function exported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** Reads the facts of a table's file: its one exported class and its `slots`. */
export function readTable(file: string, source: string): TableFacts {
  const classes: string[] = [];
  let slots: number | undefined;
  for (const node of parse(file, source).statements) {
    if (!exported(node)) continue;
    if (ts.isClassDeclaration(node) && node.name !== undefined) classes.push(node.name.text);
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== 'slots') continue;
        const value = decl.initializer;
        if (value === undefined || !ts.isNumericLiteral(value) || !/^[1-9]\d*$/.test(value.text)) {
          throw new TypeError(
            `${file}: "slots" is not a whole number from 1. Write the number of rows, for example "export const slots = 16;".`,
          );
        }
        slots = Number(value.text);
      }
    }
  }
  if (classes.length !== 1) {
    throw new TypeError(
      `${file}: the file exports ${classes.length} classes${classes.length > 0 ? ` (${classes.join(', ')})` : ''}. A file of a table exports one class, the class of its rows.`,
    );
  }
  return { className: classes[0], slots };
}

/** Reads the facts of a system's file: the parameters of the exported function `name`. */
export function readSystem(file: string, source: string, name: string): SystemFacts {
  const functions: string[] = [];
  for (const node of parse(file, source).statements) {
    if (!exported(node) || !ts.isFunctionDeclaration(node) || node.name === undefined) continue;
    functions.push(node.name.text);
    if (node.name.text !== name) continue;
    return {
      params: node.parameters.map((param) => {
        if (!ts.isIdentifier(param.name)) {
          throw new TypeError(
            `${file}: a parameter of "${name}" is a pattern. Give each parameter a name.`,
          );
        }
        return param.name.text;
      }),
    };
  }
  throw new TypeError(
    `${file}: the file exports no function "${name}"${functions.length > 0 ? `. It exports ${functions.join(', ')}` : ''}. A file of a system exports one function with the file's name.`,
  );
}

/**
 * Reads the facts of a layer's file: the exported functions with `@vertex` and with `@fragment`,
 * and each `declare const` with the kind of its type (`storage`, `uniform`).
 */
export function readLayer(file: string, source: string): LayerFacts {
  const vertex: string[] = [];
  const fragment: string[] = [];
  const declares: { name: string; kind: string }[] = [];
  for (const node of parse(file, source).statements) {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && exported(node)) {
      for (const modifier of node.modifiers ?? []) {
        if (!ts.isDecorator(modifier)) continue;
        // `@vertex` and `@vertex()` both name the entry.
        const at = ts.isCallExpression(modifier.expression)
          ? modifier.expression.expression
          : modifier.expression;
        if (!ts.isIdentifier(at)) continue;
        if (at.text === 'vertex') vertex.push(node.name.text);
        if (at.text === 'fragment') fragment.push(node.name.text);
      }
    }
    if (ts.isVariableStatement(node)) {
      const declared = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
      if (!declared) continue;
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const type = decl.type;
        const kind =
          type !== undefined && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)
            ? type.typeName.text
            : 'other';
        declares.push({ name: decl.name.text, kind });
      }
    }
  }
  return { vertex, fragment, declares };
}

/**
 * The `declare const` names of a layer's file that the file never uses. The compiler refuses such
 * a name at the first frame, when the engine binds it (design record 0111, section 2). A name
 * after a dot, as in `a.view`, is a member and no use.
 */
export function unusedNames(file: string, source: string): readonly string[] {
  const sourceFile = parse(file, source);
  const declared = new Map<string, ts.Node>();
  for (const node of sourceFile.statements) {
    if (!ts.isVariableStatement(node)) continue;
    if (!(node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) declared.set(decl.name.text, decl.name);
    }
  }
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && declared.has(node.text) && declared.get(node.text) !== node) {
      const parent = node.parent;
      const member =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!member) used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...declared.keys()].filter((name) => !used.has(name));
}

/** Reads the names of the functions a host file exports, in the order of the file. */
export function readFunctions(file: string, source: string): readonly string[] {
  const names: string[] = [];
  for (const node of parse(file, source).statements) {
    if (exported(node) && ts.isFunctionDeclaration(node) && node.name !== undefined) {
      names.push(node.name.text);
    }
  }
  return names;
}
