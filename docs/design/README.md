# Design records

A design record is the agreed shape of one part of the engine before its code is written. It
is this repository's form of the compiler's change proposals (`changes/README.md` in
`typeshade/typeshade`). The record names what changes, why, what it touches and the steps that
implement it. The implementation is held to it.

[`docs/vision.md`](../vision.md) is the design of the whole engine. A record takes one part of
it and makes that part exact enough to implement.

The records exist because more than one agent builds the engine, on a compiler that is not yet
released. A contract that lives only in one session's memory is written again by the next
session. A contract that lives here is implemented as written, or amended here first.

## When a change needs one

A diff needs a record when it does any of the following:

| Criterion   | What counts                                                                           |
| ----------- | ------------------------------------------------------------------------------------- |
| contract    | Changes how the engine stores a node, a table or a save, or what one tick does        |
| exports     | Adds, removes or changes the shape of a public export or a command of the engine      |
| gates       | Adds, removes or changes a check in CI or its threshold                               |
| determinism | Changes a rule that a class or a system is written under                              |
| compiler    | Opens, withdraws or changes a request this repository makes of the compiler           |
| design      | Changes a decision of `docs/vision.md`. Such a change also needs the owner's go-ahead |

A change outside these needs no record: a bug fix inside a contract, a test, an example, a
performance change that moves no layout.

## The lifecycle

1. **Draft.** The author writes `docs/design/NNNN-short-name.md` with the next free number. The
   author opens it as its own pull request with `status: draft`.
2. **Accepted.** The owner's review or go-ahead in the conversation merges it with
   `status: accepted`. The merged text is the approved design.
3. **Implementation.** Each implementing commit names the record on a line of its own:
   `Design: 0100`. A test that verifies a decision carries `Verifies: Design 0100.3` in a
   comment. A pull request that reaches past the record amends the record first.
4. **Implemented.** The pull request that finishes the record's steps sets
   `status: implemented`. It records the delivered configuration: the commits, the compiler
   pin, the checks that ran and their numbers.
5. **Superseded** when a later record replaces it. The record names the later one.

A record is written for an agent that did not read the conversation. It names files, types,
layouts, tests and acceptance numbers. It labels a fact, an inference, a proposal and a
decision as what each is.

## The shape of a record

```yaml
---
id: '0100'
title: One line that says what the engine can do after this change
status: draft # draft | accepted | implemented | superseded
vision: [U1, U3] # the decisions of docs/vision.md the record serves
touches: [] # directories and files the implementation changes
compiler: [] # the compiler issues or proposals the implementation depends on, if any
---
```

Then a document-control table (the date, the baseline commit, the compiler pin, the pull
request), and these sections:

- **What changes.** The contract, before and after. Layouts, names, invariants.
- **Why.** The evidence, measured where it was measured, and the alternatives.
- **What it touches.** Files, tests owed and checks.
- **Implementation, in steps.** Numbered steps, each the size of one pull request. Each step
  says what it delivers and what proves it.
- **Decisions for the owner.** Each choice the record makes that the owner may want changed, as
  a numbered list.
- **Record.** The approval and validation records. For a draft, both say they do not yet apply.

## The records

| Id                                                    | Title                                                                                                             | Status      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- |
| [0100](0100-world-on-the-cpu-tier.md)                 | A scene of nodes runs as tables on the CPU tier, on a fixed tick, and a test reads its dump with no device        | implemented |
| [0101](0101-inputs-replay-and-seed.md)                | A world takes inputs at a tick, records them, replays them, and gives each node a seed                            | implemented |
| [0102](0102-tables-and-a-tick.md)                     | The engine's tools run tables and a tick function, so a game on the raw structure has a dump, inputs and a replay | implemented |
| [0103](0103-the-game-in-a-browser.md)                 | The reference game runs in a browser on WebGPU, and a harness holds its cells, its picture and its size           | implemented |
| [0104](0104-the-simulation-on-a-device.md)            | A simulation runs on a device, so a test on the CPU tier and a page on a GPU tier run the same code               | implemented |
| [0105](0105-kinds-as-classes.md)                      | A kind of cell is a class with its own fields and rules, and an input writes a field that holds a class           | implemented |
| [0106](0106-row-seeds-and-a-replay-from-a-builder.md) | A simulation gives each row a seed, and a record replays from the function that builds the game                   | implemented |
| [0107](0107-a-table-with-free-slots.md)               | A table of a simulation has free slots, so rows come and go in a table of a fixed size                            | implemented |
| [0108](0108-the-project-is-the-structure.md)          | A project is the structure of a game, and the engine builds the game from it and runs it                          | implemented |
| [0109](0109-the-build.md)                             | The engine builds a project into a page and holds its size to a budget                                            | implemented |
| [0110](0110-a-build-the-owner-opens-on-a-phone.md)    | A build of a game is a page that the owner opens on a phone, and the page shows its numbers                       | accepted    |

The first model's records hold the numbers 0001 to 0011. They are on the branch `legacy`, and
compiler proposals cite them by number. A record of this engine does not use those numbers
again.

The first model kept a Doorstop tree of its records and their decisions (`reqs/` on `legacy`).
Record 0100 adds no tree (its decision 9). A later record decides the tool.
