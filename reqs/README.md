# Traceability

This directory is the traceability tree of the design records, kept with
[Doorstop](https://doorstop.readthedocs.io), as the compiler keeps its design rules
(`vendor/typeshade/reqs/README.md`). Every item has a content fingerprint. Every item that depends
on another records the fingerprint it was checked against. When a record changes, each dependent
item becomes _suspect_. It stays suspect until someone reads it and clears it.

| Document | Directory         | Items                                                                                                                                                                                                 |
| -------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REC`    | `reqs/records/`   | One per design record in `docs/design/`. `REC-0001` is record 0001. Its text is the record's title and its "What changes" section. Its `references` are the documents that cite the record.           |
| `DEC`    | `reqs/decisions/` | One per entry of a record's "Decisions for the owner". `DEC-0103` is decision 3 of record 0001. It links to its `REC`. Its `references` are the files that carry the tag `Verifies: Design 0001.3`. |

**Never edit these files by hand.** The records stay the normative text, and `bun run reqs:sync`
(`scripts/reqs-sync.ts`) derives the items from them. The script keeps only what Doorstop owns
from the committed items: each item's `reviewed` fingerprint and each link's stamp.
`scripts/reqs.test.ts` fails when the items are stale.

## When you change a record or a verifying test

1. Edit the record or the test.
2. Run `bun run reqs:sync`.
3. Run `doorstop -e -F` (install once with `pip install doorstop==3.2`). Each flagged item is a step:
   - `REC-nnnn: unreviewed changes`: the record's text changed. Read the item. Then run
     `doorstop review REC-nnnn`.
   - `DEC-rrkk: unreviewed changes`: the decision's text or its verifying files changed. Check that
     each file in its `references` still verifies the decision. Then run `doorstop review DEC-rrkk`.
   - `DEC-rrkk: suspect link: REC-nnnn`: the record this decision belongs to has changed. Read the
     decision against the new text. Then run `doorstop clear DEC-rrkk`.
   - `external reference not found`: a verifying file is gone, or no longer carries its tag.
     Restore the `Verifies: Design nnnn.k` tag, or remove the claim.
4. Commit the items together with the change. CI's `traceability (Doorstop)` job runs
   `doorstop -e -F`, so a suspect link or an unreviewed item fails the pull request.

`doorstop review` and `doorstop clear` record that you read the item. Each is the traceability
equivalent of a signature. Never run one without reading the item.

## How a decision is verified

`verification` in each `DEC` item is one of two values:

- `test`: a file under `packages/`, `scripts/` or `.github/` carries the tag
  `Verifies: Design nnnn.k` in a comment. The tag is how a test states its end of the link.
- `pending`: no file carries the tag yet. A record that is `accepted` and not `implemented` has
  pending decisions. A record that is `implemented` with a pending decision is a gap for a test
  to close.

Doorstop cannot see a hidden path (`.github/`) or a path that contains a word from `.gitignore`.
A verifying file it cannot see is listed under `evidence` instead of `references`, and
`scripts/reqs.test.ts` checks its tag.

Doorstop reads every directory under the root for a document. `bun install` copies the compiler,
its `reqs/` included, into `node_modules/typeshade`, so `bun run reqs:sync` writes a
`.doorstop.skip-all` marker into each installed `node_modules`. `vendor/.doorstop.skip-all` is
committed for the submodule.

## Text that hangs the publisher

`doorstop publish all` never ends on some item text. Doorstop 3.2 reads each line that starts with a bullet (`-`, `*` or `+`) or with a number and a period (`1.`) as a list line. It does so inside a code fence too. It keeps the state of bullets and of steps apart.

An indented list line that no list line of its own kind has opened sets the list's indent step to zero. The publisher then loops at the end of the list. CI's `traceability (Doorstop)` job ran until the runner stopped on this (typeshade/radiance#14 and #29).

`bun run reqs:sync` refuses such text, names the item and the line, and writes nothing (`doorstopListHazard` in `scripts/reqs-sync.ts`). The rule is as follows:

- A list line at the margin always passes.
- An indented list line passes only when the nearest list line above it has the same kind. A bullet nests under a bullet, and a step nests under a step.
- A blank line, a code fence line or a line that starts with `<p>` ends the nearest list line. The first line inside a fence does not start one.

The shapes the rule refuses, and the fix:

1. Steps indented under a bullet, with no blank line between (`- text`, then `  1. step`). Write the steps at the margin, after a blank line.
2. A bullet indented under steps. Write its words as a sentence of the step, or end the steps and start the bullets after a blank line.
3. A list line in a code fence that starts with `*`, for example the continuation lines of a JSDoc block. Write the line so that it does not start with a bullet.

`scripts/reqs.test.ts` holds the rule against the text of pull request #29, word for word, and against its near misses.

## The matrix

`doorstop publish all <dir>` writes the documents and `traceability.csv` / `traceability.html`.
CI uploads that output as the `traceability` artifact of every run.
