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

## The matrix

`doorstop publish all <dir>` writes the documents and `traceability.csv` / `traceability.html`.
CI uploads that output as the `traceability` artifact of every run.
