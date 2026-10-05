// === The API surface bake: what each package exports, as one committed file ===
//
// `bun run bake:api-surface` writes `packages/<package>/__api__/surface.md` for each package
// whose `package.json` exports a "." entry. The file has one line for each name that entry
// exports: the name, its kind and its type as TypeScript prints it. Nobody edits it by hand.
// A pull request that changes an export commits the new bake, and the diff is the review.
//
// `scripts/gates/api.mjs` bakes again into a temporary directory and fails when the result
// differs from the committed files.
//
// This follows the compiler's `scripts/bake-api-surface.ts` and `src/api-surface.test.ts`. The
// reader below keeps three of its measured decisions:
//
// - The compiler options are fixed here, so a change to a `tsconfig.json` cannot move the bake.
//   The options leave out `moduleSuffixes`, so an import of `./x.shade.ts` reads the kernel's
//   source and not its host view. Then the bake does not depend on `tshc sync` having run.
// - The members of an object type are sorted, and so are the members of a union type.
//   TypeScript orders a union by the order in which it made each type, and that order changes
//   with the whole program and not with the declaration.
// - A property with a `?` does not print `| undefined`. TypeScript prints a parameter by itself,
//   so a change of the TypeScript version in `package.json` can move the bake. Bake again then.
//
// It differs from the compiler's reader in two ways. A class line also lists its constructor
// signatures, its static members and its base class, because a changed constructor parameter is
// a breaking change. A `private` member and a `#private` member are not listed, because no
// consumer can use them.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** The repository root. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The command that writes the bake. */
export const REBAKE = 'bun run bake:api-surface';
/** This script, as the header of each bake names it. */
export const SCRIPT = 'scripts/bake-api-surface.ts';

/** A package whose "." entry is public API. */
export interface PublicPackage {
  /** The name in `package.json`. */
  readonly name: string;
  /** The package directory, relative to the root, with forward slashes. */
  readonly dir: string;
  /** The absolute path of the file that `exports["."]` names. */
  readonly entry: string;
}

/** One exported name. */
export interface Export {
  readonly name: string;
  readonly kind: string;
  /** The type on one line. */
  readonly shape: string;
}

/** The bake of one package. */
export interface Surface {
  readonly name: string;
  readonly dir: string;
  readonly exports: readonly Export[];
  /** The text of `surface.md`. */
  readonly text: string;
}

/** Where the bake of a package lives, relative to the root. */
export const surfaceFile = (dir: string): string => `${dir}/__api__/surface.md`;

/** The default comparison: UTF-16 code units, so no locale can reorder the output. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The packages under `packages/` that export a "." entry, sorted by directory. */
export function publicPackages(root = ROOT): PublicPackage[] {
  const base = join(root, 'packages');
  const found: PublicPackage[] = [];
  for (const dirent of readdirSync(base, { withFileTypes: true })) {
    const manifestPath = join(base, dirent.name, 'package.json');
    if (!dirent.isDirectory() || !existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      exports?: Record<string, unknown>;
    };
    const dot = manifest.exports?.['.'];
    if (dot === undefined) continue;
    if (typeof dot !== 'string') {
      throw new Error(
        `packages/${dirent.name}/package.json: exports["."] is not a path. The bake reads a path.`,
      );
    }
    found.push({
      name: manifest.name ?? dirent.name,
      dir: `packages/${dirent.name}`,
      entry: join(base, dirent.name, dot),
    });
  }
  return found.sort((a, b) => byText(a.dir, b.dir));
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};
const FORMAT = ts.TypeFormatFlags.NoTruncation;
/** For a declared type: the printer spells out an alias's right-hand side and not its name. */
const FORMAT_DECLARED = FORMAT | ts.TypeFormatFlags.InTypeAlias;

/** Order matters: a class is also a value, and an enum is also a variable. */
function kindOf(sym: ts.Symbol): string {
  const f = sym.getFlags();
  if (f & ts.SymbolFlags.Class) {
    const abstract = sym
      .getDeclarations()
      ?.some((d) => (ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Abstract) !== 0);
    return abstract ? 'abstract class' : 'class';
  }
  if (f & ts.SymbolFlags.Interface) return 'interface';
  if (f & ts.SymbolFlags.TypeAlias) return 'type';
  if (f & ts.SymbolFlags.Enum) return 'enum';
  if (f & ts.SymbolFlags.Function) return 'function';
  if (f & ts.SymbolFlags.Variable) return 'const';
  return 'value';
}

const declarationOf = (sym: ts.Symbol): ts.Declaration | undefined =>
  sym.valueDeclaration ?? sym.getDeclarations()?.[0];

/** A member that no consumer can use: `private` or `#name`. */
function isPrivate(sym: ts.Symbol): boolean {
  const decl = declarationOf(sym);
  if (decl === undefined) return false;
  const name = ts.getNameOfDeclaration(decl);
  if (name !== undefined && ts.isPrivateIdentifier(name)) return true;
  return (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Private) !== 0;
}

/** A symbol-keyed member is named `__@<symbol>@<id>` inside TypeScript, and the id changes. */
const memberName = (name: string): string => name.replace(/^__@(.+)@\d+$/, '[$1]');

/** Every run of number literals joined by ` | `, in ascending order, wherever it stands. */
function sortNumberRuns(printed: string): string {
  return printed.replace(/(?<![\w.$])-?\d+(?: \| -?\d+)+(?![\w.$])/g, (run) =>
    run
      .split(' | ')
      .sort((a, b) => Number(a) - Number(b))
      .join(' | '),
  );
}

const balanced = (s: string): boolean => {
  let depth = 0;
  for (const ch of s) {
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth++;
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
};

/**
 * The printed form of a type. A union type has its members sorted, because a union is a set.
 * The sort applies only to a union type. A function type that returns a union prints a ` | `
 * too, and splitting it would change its meaning. With `dropUndefined`, the `undefined` member
 * is removed: it is what a `?` says.
 */
function typeText(
  c: ts.TypeChecker,
  type: ts.Type,
  format: ts.TypeFormatFlags,
  dropUndefined = false,
): string {
  const printed = sortNumberRuns(
    c.typeToString(type, undefined, format).replace(/<ArrayBufferLike>/g, ''),
  );
  if (!type.isUnion() || !printed.includes(' | ')) return printed;
  const parts = printed.split(' | ');
  if (!parts.every(balanced)) return printed;
  return (dropUndefined ? parts.filter((p) => p !== 'undefined') : parts).sort(byText).join(' | ');
}

function modifiersOf(sym: ts.Symbol): string {
  const flags = ts.getCombinedModifierFlags(declarationOf(sym) ?? ({} as ts.Declaration));
  const readonly =
    (flags & ts.ModifierFlags.Readonly) !== 0 ||
    ((sym.flags & ts.SymbolFlags.GetAccessor) !== 0 &&
      (sym.flags & ts.SymbolFlags.SetAccessor) === 0);
  return (
    ((flags & ts.ModifierFlags.Protected) !== 0 ? 'protected ' : '') +
    ((flags & ts.ModifierFlags.Abstract) !== 0 ? 'abstract ' : '') +
    (readonly ? 'readonly ' : '')
  );
}

/** One member as `modifiers name?: type`, or nothing for a member that is not public. */
function memberText(c: ts.TypeChecker, sym: ts.Symbol): string | undefined {
  if (isPrivate(sym)) return undefined;
  const optional = (sym.flags & ts.SymbolFlags.Optional) !== 0;
  const type = typeText(c, c.getTypeOfSymbol(sym), FORMAT, optional);
  return `${modifiersOf(sym)}${memberName(sym.getName())}${optional ? '?' : ''}: ${type}`;
}

/** The members of one type: its signatures in order, its index signatures, then its properties sorted. */
function membersOf(c: ts.TypeChecker, type: ts.Type, props: readonly ts.Symbol[]): string[] {
  const signatures = type.getCallSignatures().map((s) => c.signatureToString(s, undefined, FORMAT));
  const constructors = type
    .getConstructSignatures()
    .map((s) => c.signatureToString(s, undefined, FORMAT, ts.SignatureKind.Construct));
  const indexes = c
    .getIndexInfosOfType(type)
    .map(
      (i) =>
        `${i.isReadonly ? 'readonly ' : ''}[key: ${c.typeToString(i.keyType, undefined, FORMAT)}]: ` +
        c.typeToString(i.type, undefined, FORMAT),
    );
  const named = props
    .map((p) => memberText(c, p))
    .filter((m): m is string => m !== undefined)
    .sort(byText);
  return [...signatures, ...constructors, ...indexes, ...named];
}

const braces = (members: readonly string[]): string =>
  members.length === 0 ? '{}' : `{ ${members.join('; ')} }`;

/** `<T extends U = V>` of a class, an interface or a type alias, or an empty string. */
function typeParametersOf(c: ts.TypeChecker, sym: ts.Symbol): string {
  for (const decl of sym.getDeclarations() ?? []) {
    if (
      !ts.isClassLike(decl) &&
      !ts.isInterfaceDeclaration(decl) &&
      !ts.isTypeAliasDeclaration(decl)
    )
      continue;
    if (decl.typeParameters === undefined || decl.typeParameters.length === 0) continue;
    const items = decl.typeParameters.map((node) => {
      const parameter = c.getTypeAtLocation(node);
      const constraint = parameter.getConstraint();
      const fallback = parameter.getDefault();
      return (
        node.name.text +
        (constraint === undefined
          ? ''
          : ` extends ${c.typeToString(constraint, undefined, FORMAT)}`) +
        (fallback === undefined ? '' : ` = ${c.typeToString(fallback, undefined, FORMAT)}`)
      );
    });
    return `<${items.join(', ')}>`;
  }
  return '';
}

function shapeOf(c: ts.TypeChecker, sym: ts.Symbol): string {
  const f = sym.getFlags();
  if (f & ts.SymbolFlags.Enum) {
    const values = [...(sym.exports?.values() ?? [])].map((m) => {
      const decl = m.valueDeclaration;
      const value =
        decl !== undefined && ts.isEnumMember(decl) ? c.getConstantValue(decl) : undefined;
      return `${m.getName()} = ${JSON.stringify(value)}`;
    });
    return braces(values);
  }
  if (f & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) {
    const declared = c.getDeclaredTypeOfSymbol(sym);
    const isClass = (f & ts.SymbolFlags.Class) !== 0;
    // The members are read from the `this` type, so a method that returns `this` prints
    // `this` and not the name of the class. A subclass inherits the polymorphism.
    const props = c.getPropertiesOfType((declared as ts.InterfaceType).thisType ?? declared);
    const parts: string[] = [];
    if (
      declared.flags & ts.TypeFlags.Object &&
      (props.length > 0 || isClass || f & ts.SymbolFlags.Interface)
    ) {
      const bases =
        f & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)
          ? c.getBaseTypes(declared as ts.InterfaceType)
          : [];
      const head = [
        typeParametersOf(c, sym),
        bases.length > 0
          ? `extends ${bases.map((b) => c.typeToString(b, undefined, FORMAT)).join(', ')}`
          : '',
      ]
        .filter((p) => p !== '')
        .join(' ');
      if (head !== '') parts.push(head);
      if (isClass) {
        const statics = c.getTypeOfSymbol(sym);
        for (const s of statics.getConstructSignatures()) {
          parts.push(c.signatureToString(s, undefined, FORMAT, ts.SignatureKind.Construct));
        }
        const own = c
          .getPropertiesOfType(statics)
          .filter((p) => p.getName() !== 'prototype')
          .map((p) => memberText(c, p))
          .filter((m): m is string => m !== undefined)
          .sort(byText);
        if (own.length > 0) parts.push(`static ${braces(own)}`);
      }
      parts.push(braces(membersOf(c, declared, props)));
      return parts.join('; ');
    }
    // A union, an intersection, a function type or a primitive alias: spell the type itself.
    const generics = typeParametersOf(c, sym);
    return `${generics === '' ? '' : `${generics} `}${typeText(c, declared, FORMAT_DECLARED)}`;
  }
  if (declarationOf(sym) === undefined) return '<no-declaration>';
  return typeText(c, c.getTypeOfSymbol(sym), FORMAT);
}

/** What one entry file exports, sorted by name. The reader throws when it cannot see them. */
export function exportsOfEntry(entry: string): Export[] {
  const program = ts.createProgram([entry], OPTIONS);
  const c = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const where = relative(ROOT, entry);
  if (source === undefined) throw new Error(`${where}: the TypeScript program has no such file`);
  const module = c.getSymbolAtLocation(source);
  if (module === undefined)
    throw new Error(`${where}: the file is not a module and exports nothing`);
  const found = c.getExportsOfModule(module).map((sym): Export => {
    const target = sym.flags & ts.SymbolFlags.Alias ? c.getAliasedSymbol(sym) : sym;
    const shape = shapeOf(c, target);
    // A type from another file prints as `import("/abs/path").Name` when TypeScript cannot
    // name it, and the path differs from one machine to the next.
    if (shape === '<no-declaration>' || shape.includes('import("')) {
      throw new Error(
        `${where}: the export "${sym.getName()}" prints as "${shape.slice(0, 80)}". ` +
          'The reader cannot see its type, or the type holds a path of this machine.',
      );
    }
    return { name: sym.getName(), kind: kindOf(target), shape };
  });
  // An empty bake would pass the gate over a surface the reader can no longer see.
  if (found.length === 0) throw new Error(`${where}: the reader found no exports`);
  return found.sort((a, b) => byText(a.name, b.name));
}

/** The text of one package's `surface.md`. */
export function renderSurface(pkg: PublicPackage, exports: readonly Export[]): string {
  const entry = relative(join(ROOT, pkg.dir), pkg.entry).split('\\').join('/');
  return [
    `# ${pkg.name}: public API surface`,
    '',
    `Generated file: \`${SCRIPT}\` writes it. Do not edit it by hand.`,
    '',
    `Run \`${REBAKE}\` to write it again from the TypeScript program. \`bun run gate:api\` fails when it and the tree disagree.`,
    '',
    `Each line is one name that \`${entry}\` exports: the name, its kind and its type as TypeScript prints it.`,
    'A class line also lists its constructor and its static members. A private member is not listed.',
    'The script sorts the lines by name.',
    '',
    `## ${exports.length} exports`,
    '',
    '```',
    ...exports.map((e) => `${e.name}  ${e.kind}  ${e.shape}`),
    '```',
    '',
  ].join('\n');
}

/** Bakes every public package under `root`. */
export function bakeSurfaces(root = ROOT): Surface[] {
  const packages = publicPackages(root);
  if (packages.length === 0) throw new Error(`${root}: no package under packages/ exports "."`);
  return packages.map((pkg) => {
    const exports = exportsOfEntry(pkg.entry);
    return { name: pkg.name, dir: pkg.dir, exports, text: renderSurface(pkg, exports) };
  });
}

/** Writes each bake to `<outRoot>/<dir>/__api__/surface.md` and returns the paths. */
export function writeSurfaces(surfaces: readonly Surface[], outRoot = ROOT): string[] {
  return surfaces.map((s) => {
    const file = join(outRoot, surfaceFile(s.dir));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, s.text);
    return file;
  });
}

if (import.meta.main) {
  const surfaces = bakeSurfaces();
  writeSurfaces(surfaces);
  for (const s of surfaces) console.log(`${surfaceFile(s.dir)}: ${s.exports.length} exports`);
}
