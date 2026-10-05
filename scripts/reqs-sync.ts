// === The traceability tree: the design records as Doorstop items, with links that go suspect ===
//
// `docs/design/` holds the agreed shape of each part of the engine, and the implementation is
// held to it (CLAUDE.md, "A contract changes in a design record first"). What a record cannot
// do on its own is notice when one end of a link moved: a record whose text changed left the
// decisions it fixes as they were, and a test written for a decision could stop naming it.
//
// This tree uses Doorstop (https://doorstop.readthedocs.io) the way the compiler's `reqs/` does
// (`vendor/typeshade/reqs/README.md`): every item has a content fingerprint, every child records
// the fingerprint of the parent it was checked against, and a change to the parent makes the link
// SUSPECT until someone reads the child and clears it.
//
// THE TREE (reqs/, see reqs/README.md):
//
//   REC  reqs/records    one item per design record, UID REC-NNNN (record 0001 is REC-0001).
//                        Text: the record's title, status, milestones and its "What changes"
//                        section. References: the documents that cite the record by its file name.
//   DEC  reqs/decisions  one item per numbered entry of a record's "Decisions for the owner",
//                        UID DEC-RRKK (record 0001, decision 3 is DEC-0103), linked to its REC.
//                        References: every file carrying a `Verifies: Design 0001.3` tag.
//                        `verification` is `test` when such a file exists and `pending` until then.
//
// ONE AUTHORITY. The records stay the normative text. This script derives the items from them,
// and nobody edits an item by hand. What the script keeps from the committed items is only what
// Doorstop owns: the `reviewed` fingerprint and each link's stamp. Writing a new text beside an
// old fingerprint is exactly how a change becomes visible, so the script never resets them.
//
// Usage:
//   bun scripts/reqs-sync.ts           write reqs/ from the records
//   bun scripts/reqs-sync.ts --check   exit 1, naming each item, when reqs/ is stale

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN_DIR = 'docs/design';
const REC_DIR = 'reqs/records';
const DEC_DIR = 'reqs/decisions';
/** The documents a record is cited from, searched for the record's file name. */
const CITING = ['README.md', 'CLAUDE.md', 'docs/plan.md', 'docs/design/README.md'];

export interface RecordItem {
  readonly uid: string;
  readonly id: string;
  readonly file: string;
  readonly title: string;
  readonly status: string;
  readonly milestones: string;
  readonly text: string;
  readonly references: readonly string[];
  readonly decisions: readonly DecisionItem[];
}

export interface DecisionItem {
  readonly uid: string;
  readonly record: string;
  readonly number: number;
  readonly text: string;
  /** Verifying files Doorstop checks itself. */
  readonly references: readonly string[];
  /** Verifying files Doorstop cannot see (`doorstopSees`); `scripts/reqs.test.ts` checks them. */
  readonly evidence: readonly string[];
  readonly verification: 'test' | 'pending';
}

export const recUid = (id: string): string => `REC-${id}`;
export const decUid = (id: string, n: number): string =>
  `DEC-${String(Number(id)).padStart(2, '0')}${String(n).padStart(2, '0')}`;
/** The tag a verifying file carries for decision `n` of record `id`. */
export const tagOf = (id: string, n: number): string => `Design ${id}.${n}`;

const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n?/g, '\n');

export function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** The record files, in order of their id. */
export function recordFiles(files = trackedFiles()): string[] {
  return files.filter((f) => /^docs\/design\/\d{4}-[^/]+\.md$/.test(f)).sort();
}

/** The front matter's scalar fields. */
export function frontMatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1]!.split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/\s+#.*$/, '').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

/** The lines of one `## ` section, without its heading, up to the next `## ` heading. */
export function section(md: string, heading: string): string[] {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => l === `## ${heading}`);
  if (at < 0) return [];
  let end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  if (end < 0) end = lines.length;
  const out = lines.slice(at + 1, end);
  while (out[0]?.trim() === '') out.shift();
  while (out[out.length - 1]?.trim() === '') out.pop();
  return out;
}

/** The numbered entries of "Decisions for the owner", each with its wrapped lines joined. */
export function decisionTexts(md: string): string[] {
  const out: string[] = [];
  for (const line of section(md, 'Decisions for the owner')) {
    const m = /^(\d+)\. (.*)$/.exec(line);
    if (m) {
      if (Number(m[1]) !== out.length + 1) {
        throw new Error(`decision ${m[1]} follows decision ${out.length}: the list is not 1, 2, 3`);
      }
      out.push(m[2]!);
    } else if (/^\s{3}\S/.test(line) && out.length) {
      out[out.length - 1] += ` ${line.trim()}`;
    } else if (line.trim() !== '') {
      throw new Error(`a line in the decisions that is not part of a numbered entry: ${line}`);
    }
  }
  return out;
}

/** `Verifies: Design 0001.3, Design 0004.2` tags, by tag. */
export function verifyTags(files = trackedFiles()): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of files) {
    if (
      !/\.(ts|mts|mjs|ya?ml)$/.test(f) ||
      f === 'scripts/reqs-sync.ts' ||
      f.endsWith('reqs.test.ts')
    )
      continue;
    const text = read(f);
    for (const m of text.matchAll(/Verifies:((?:\s*,?\s*(?:\/\/|#)?\s*Design \d{4}\.\d+)+)/g)) {
      for (const r of m[1]!.matchAll(/Design \d{4}\.\d+/g)) {
        if (!out.has(r[0])) out.set(r[0], new Set());
        out.get(r[0])!.add(f);
      }
    }
  }
  return out;
}

/**
 * Whether Doorstop's reference finder can see a path. It skips every path with a hidden segment
 * (`.github/workflows/ci.yml`) and turns each `.gitignore` line into `*line*`, so a file it
 * cannot see would fail as "not found" however true the link is (doorstop 3.2,
 * `core/vcs/base.py`). Such a file is recorded as `evidence` and checked by `scripts/reqs.test.ts`.
 */
export function doorstopSees(path: string): boolean {
  path = path.replace(/\\/g, '/');
  if (('/' + path).includes('/.')) return false;
  const gitignore = existsSync(join(ROOT, '.gitignore')) ? read('.gitignore') : '';
  for (const line of gitignore.split('\n')) {
    const p = line.trim().replace(/^[ @\\/*]+|[ @\\/*]+$/g, '');
    if (!p || p.startsWith('#')) continue;
    const re = new RegExp(
      '^' +
        `*${p}*`
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$',
    );
    if (re.test(path)) return false;
  }
  return true;
}

export function buildRecords(files = trackedFiles()): RecordItem[] {
  const tags = verifyTags(files);
  return recordFiles(files).map((file) => {
    const md = read(file);
    const fm = frontMatter(md);
    const id = fm.id ?? '';
    if (!/^\d{4}$/.test(id) || !file.includes(`/${id}-`)) {
      throw new Error(`${file}: the front matter's id (${id}) does not match the file name`);
    }
    const name = file.slice(file.lastIndexOf('/') + 1);
    const references = CITING.filter((c) => files.includes(c) && read(c).includes(name));
    const decisions = decisionTexts(md).map((text, i): DecisionItem => {
      const n = i + 1;
      const all = [...(tags.get(tagOf(id, n)) ?? [])].sort();
      return {
        uid: decUid(id, n),
        record: id,
        number: n,
        text: `**Decision ${id}.${n}.** ${text}`,
        references: all.filter(doorstopSees),
        evidence: all.filter((f) => !doorstopSees(f)),
        verification: all.length ? 'test' : 'pending',
      };
    });
    if (decisions.length === 0) throw new Error(`${file}: no "Decisions for the owner" entries`);
    const what = section(md, 'What changes').join('\n');
    return {
      uid: recUid(id),
      id,
      file,
      title: fm.title ?? '',
      status: fm.status ?? '',
      milestones: fm.milestones ?? '',
      text: `# ${fm.title}\n\nDesign record ${id} (\`${file}\`), status \`${fm.status}\`, milestones ${fm.milestones}.\n\n## What changes\n\n${what}`,
      references,
      decisions,
    };
  });
}

/**
 * A line of an item's text that makes Doorstop 3.2's publisher loop forever. Its HTML and LaTeX
 * publishers read every line that matches `^\\s*[*+-]\\s` or `^\\s*\\d+\\.\\s` as a list item, inside a
 * code fence too. A list whose first item is indented sets the list's depth to that indent and
 * its indent step to zero, and the loop that closes the list at the next blank line subtracts
 * zero from the depth forever (`doorstop/core/publishers/base.py`, `_check_for_list_end`). A
 * JSDoc block whose continuation lines start with ` * ` did this to CI's traceability job
 * (typeshade/radiance#14). Returns the offending line, or null.
 */
export function doorstopListHazard(text: string): string | null {
  const bullet = /^(\s*)(?:[*+-]|\d+\.)\s/;
  let open = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.startsWith('<p>')) {
      open = false;
      continue;
    }
    const m = bullet.exec(line);
    if (!m) continue;
    if (!open && m[1]!.length > 0) return line;
    open = true;
  }
  return null;
}

/** The front matter of a Doorstop item, read without a YAML library (the subset Doorstop writes). */
export function parseFront(yaml: string): Record<string, unknown> {
  const scalar = (v: string): unknown => {
    const t = v.trim();
    if (t === 'null' || t === '~' || t === '') return null;
    if (t === 'true' || t === 'false') return t === 'true';
    if (t === '[]') return [];
    if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t.startsWith('"') && t.endsWith('"')) return JSON.parse(t) as unknown;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return t;
  };
  const out: Record<string, unknown> = {};
  let list: unknown[] | null = null;
  let item: Record<string, unknown> | null = null;
  for (const line of yaml.split('\n')) {
    if (!line.trim()) continue;
    const top = /^([\w-]+):(?:\s(.*))?$/.exec(line);
    if (top) {
      item = null;
      if (top[2] === undefined || top[2].trim() === '') {
        list = [];
        out[top[1]!] = list;
      } else {
        list = null;
        out[top[1]!] = scalar(top[2]);
      }
      continue;
    }
    const entry = /^\s*- (.*)$/.exec(line);
    if (entry && list) {
      const kv = /^([^:\s][^:]*):(?:\s(.*))?$/.exec(entry[1]!);
      if (kv) {
        item = { [kv[1]!]: scalar(kv[2] ?? '') };
        list.push(item);
      } else {
        item = null;
        list.push(scalar(entry[1]!));
      }
      continue;
    }
    const cont = /^\s+([\w-]+):(?:\s(.*))?$/.exec(line);
    if (cont && item) item[cont[1]!] = scalar(cont[2] ?? '');
  }
  return out;
}

/** What Doorstop owns in a committed item: its `reviewed` fingerprint and each link's stamp. */
function existing(path: string): { reviewed: string | null; links: Map<string, string | null> } {
  const links = new Map<string, string | null>();
  if (!existsSync(join(ROOT, path))) return { reviewed: null, links };
  const m = /^---\n([\s\S]*?)\n---\n/.exec(read(path));
  if (!m) return { reviewed: null, links };
  const front = parseFront(m[1]!);
  if (Array.isArray(front.links)) {
    for (const l of front.links as Record<string, unknown>[]) {
      const [k, v] = Object.entries(l)[0]!;
      links.set(k, v == null ? null : String(v));
    }
  }
  return { reviewed: typeof front.reviewed === 'string' ? front.reviewed : null, links };
}

/**
 * A YAML string as Doorstop writes it: plain when YAML reads it back as the same string. A file
 * name that starts with a digit (`0001-scene-data-model.md`) is plain too, since it holds a
 * letter and so is neither a number nor a date. Doorstop wrote it plain, and a sync that quoted
 * it left a diff on every run.
 */
const q = (s: string): string =>
  /^[A-Za-z0-9][\w./ -]*[\w.]$/.test(s) &&
  /[A-Za-z]/.test(s) &&
  !/^(true|false|null|yes|no|on|off)$/i.test(s)
    ? s
    : `'${s.replace(/'/g, "''")}'`;

/** An item as Doorstop writes it: sorted keys, YAML front matter, the text after a blank line. */
function itemFile(front: [string, string][], text: string): string {
  const keys = [...front].sort(([a], [b]) => a.localeCompare(b));
  return `---\n${keys.map(([k, v]) => (v.startsWith('\n') ? `${k}:${v}` : `${k}: ${v}`)).join('\n')}\n---\n\n${text}`;
}

const stamp = (s: string | null | undefined): string => (s ? s : 'null');

/** A level as Doorstop writes it: bare, unless YAML would read it as another number (`1.10`). */
const level = (n: string): string => (/\.\d*0$/.test(n) ? q(n) : n);

const refList = (keyword: string, files: readonly string[]): string =>
  files.length
    ? '\n' + files.map((f) => `- keyword: ${q(keyword)}\n  path: ${f}\n  type: file`).join('\n')
    : '[]';

export function render(records = buildRecords()): Map<string, string> {
  const files = new Map<string, string>();
  files.set(
    `${REC_DIR}/.doorstop.yml`,
    "settings:\n  digits: 4\n  itemformat: markdown\n  prefix: REC\n  sep: '-'\n",
  );
  files.set(
    `${DEC_DIR}/.doorstop.yml`,
    "settings:\n  digits: 4\n  itemformat: markdown\n  parent: REC\n  prefix: DEC\n  sep: '-'\n",
  );
  for (const r of records) {
    for (const [uid, text] of [
      [r.uid, r.text] as const,
      ...r.decisions.map((d) => [d.uid, d.text] as const),
    ]) {
      const line = doorstopListHazard(text);
      if (line !== null) {
        throw new Error(
          `${uid} (${r.file}): the line ${JSON.stringify(line)} starts an indented list, which Doorstop's publish reads as a list without an indent step and never ends. Start the list at the margin, or write the line so that it does not begin with a bullet or a number.`,
        );
      }
    }
    const path = `${REC_DIR}/${r.uid}.md`;
    const old = existing(path);
    files.set(
      path,
      itemFile(
        [
          ['active', 'true'],
          ['derived', 'false'],
          ['level', level(String(Number(r.id)))],
          ['links', '[]'],
          ['normative', 'true'],
          ['ref', "''"],
          ['references', refList(r.file.slice(r.file.lastIndexOf('/') + 1), r.references)],
          ['reviewed', stamp(old.reviewed)],
          ['source', r.file],
        ],
        r.text,
      ),
    );
    for (const d of r.decisions) {
      const dpath = `${DEC_DIR}/${d.uid}.md`;
      const dold = existing(dpath);
      files.set(
        dpath,
        itemFile(
          [
            ['active', 'true'],
            ['derived', 'false'],
            ['level', level(`${Number(r.id)}.${d.number}`)],
            ['links', `\n- ${r.uid}: ${stamp(dold.links.get(r.uid))}`],
            ['normative', 'true'],
            ['ref', "''"],
            ['references', refList(tagOf(r.id, d.number), d.references)],
            ['reviewed', stamp(dold.reviewed)],
            ['verification', d.verification],
            ...(d.evidence.length
              ? ([['evidence', '\n' + d.evidence.map((f) => `- ${f}`).join('\n')]] as [
                  string,
                  string,
                ][])
              : []),
          ],
          d.text,
        ),
      );
    }
  }
  return files;
}

/** The items as fields, for a comparison Doorstop's own reformatting cannot disturb. */
export function semantic(text: string): unknown {
  const m = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(text);
  if (!m) return text;
  const front = parseFront(m[1]!) as Record<string, unknown>;
  delete front.reviewed;
  if (Array.isArray(front.links)) {
    front.links = (front.links as Record<string, unknown>[]).map((l) => Object.keys(l)[0]);
  }
  if (front.level !== undefined) front.level = String(front.level);
  return { ...front, text: m[2]!.trimEnd() };
}

function itemsOn(dir: string): string[] {
  return existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir))
        .filter((f) => f.endsWith('.md') || f === '.doorstop.yml')
        .map((f) => `${dir}/${f}`)
    : [];
}

export function stale(want = render()): string[] {
  const problems: string[] = [];
  for (const [path, text] of want) {
    if (!existsSync(join(ROOT, path))) problems.push(`${path}: missing`);
    else if (
      path.endsWith('.md') &&
      JSON.stringify(semantic(read(path))) !== JSON.stringify(semantic(text))
    )
      problems.push(`${path}: differs from its design record`);
  }
  for (const path of [...itemsOn(REC_DIR), ...itemsOn(DEC_DIR)]) {
    if (!want.has(path)) problems.push(`${path}: no longer derived from a design record`);
  }
  return problems;
}

/**
 * Doorstop walks every directory under the root for a `.doorstop.yml`, and `bun install` copies the
 * compiler, `reqs/` included, into each `node_modules/typeshade`. A `.doorstop.skip-all` file keeps
 * Doorstop out of a directory, so one is written into each installed `node_modules` (an ignored
 * directory; CI's traceability job installs nothing). `vendor/.doorstop.skip-all` is committed.
 */
export function hideNodeModules(): void {
  for (const dir of [
    'node_modules',
    'packages/radiance/node_modules',
    'packages/addons/node_modules',
  ]) {
    if (existsSync(join(ROOT, dir))) writeFileSync(join(ROOT, dir, '.doorstop.skip-all'), '');
  }
}

if (import.meta.main) {
  hideNodeModules();
  const want = render();
  if (process.argv.includes('--check')) {
    const problems = stale(want);
    for (const p of problems) console.log(p);
    if (problems.length)
      console.log('\nreqs/ is stale: run `bun run reqs:sync`, then `doorstop` (reqs/README.md).');
    process.exit(problems.length ? 1 : 0);
  }
  for (const dir of [REC_DIR, DEC_DIR]) mkdirSync(join(ROOT, dir), { recursive: true });
  for (const path of [...itemsOn(REC_DIR), ...itemsOn(DEC_DIR)]) {
    if (!want.has(path)) rmSync(join(ROOT, path));
  }
  for (const [path, text] of want) writeFileSync(join(ROOT, path), text);
  console.log(`wrote ${want.size} files under reqs/`);
}
