// Design: 0108, section 10, rules 1 and 2. The facts of a `"use typeshade"` file that the
// engine needs and the compiler does not report yet (compiler issue typeshade/typeshade#1253).
// This is the one module of the engine that reads source. It reads names only: the name of an
// exported class, an exported number, an exported function and its parameters. When the pin
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
