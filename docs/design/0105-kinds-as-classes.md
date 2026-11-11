---
id: '0105'
title: A kind of cell is a class with its own fields and rules, and an input writes a field that holds a class
status: accepted
vision: [D4, D10, D11]
touches:
  - src/input.ts
  - src/sim.ts
  - src/world.ts
  - test/
  - examples/factory/
  - README.md
compiler: []
---

# 0105. Kinds as classes

**Document control**

| Field          | Record                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Identity       | Design record `0105`, `status: accepted`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.      |
| Baseline       | `typeshade/radiance` `main` `64927bd`.                                                           |
| Compiler pin   | `6d6a979`.                                                                                       |
| Pull request   | The pull request that adds this file.                                                            |
| What is a fact | The reference game's list of what was hard, and the probe (section 4). No step is implemented.   |

## What changes

The reference game has one class `Cell` for every kind of cell. Its field `wait` has three
meanings and its field `made` has two. The rules of each kind are blocks of one tick function,
and the colours of each kind are in a second file (`examples/factory/README.md`, P4 and P11).
A new kind of cell is a change in both files.

After this record, the game writes each kind as a class of its own. The class holds the kind's
fields, its rules as methods and its colour as a method. The game writes the class `Cell` by
hand: a tag and one field for each kind. The engine adds no code that makes `Cell`.

### 1. A kind is a class

```ts
"use typeshade";

export class Belt {
  dir: u32 = 0;
  item: u32 = 0;
  wait: u32 = 0;
  ready(): bool {
    return this.item != 0 && this.wait == 0;
  }
  step(takes: bool, gives: bool) {
    if (gives) { this.item = 0; }
    if (takes) {
      this.item = 1;
      this.wait = BELT_PERIOD;
    } else if (this.item != 0 && this.wait > 0) {
      this.wait = this.wait - 1;
    }
  }
}

export class Cell {
  kind: u32 = 0;
  belt: Belt = new Belt();
  source: Source = new Source();
  machine: Machine = new Machine();
}
```

The rules for the game's author:

1. Each kind is a class. Its fields have one meaning each.
2. A rule of a kind is a method of its class. The tick function calls it.
3. The colour of a kind is a method of its class. The fragment entry calls it.
4. `Cell` has the tag `kind` and one field for each kind. The tick function and the fragment
   entry choose by the tag.

This is a way to write a game. The engine does not check it.

### 2. An input writes a field of a class in a class

Design record 0101 (section 1, rule 4) says that each value of an input is a finite number, a
boolean, or an array of these. So an input cannot write `belt` of a `Cell`.

After this record, a value can also be an object.

```ts
sim.input('cells', 2, { kind: BELT, belt: { dir: 1 } });
```

The rules:

1. A value is a finite number, a boolean, an array of values, or an object of values by field.
2. An object is valid only for a field whose value in the row is an object. Any other use is
   an error.
3. Each field of the object is a field of the row's object. An unknown field is an error that
   lists the fields, with the path of the object, for example `cells[2].belt`.
4. An object writes only the fields that it names. The other fields of the row's object keep
   their values.
5. The record of a run holds the object as it was given. It is data that JSON holds.
6. The same rules apply to `World.input` of design record 0100.

### 3. The dump

The dump already prints a class in a class: `belt {dir 1, item 0, wait 0}`. This record does
not change it.

### 4. The probe

| Item     | Value                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- |
| Date     | 2026-11-11                                                                                  |
| Compiler | `6d6a979`, the pin                                                                          |
| Devices  | The CPU tier in Vitest. WebGPU on SwiftShader in headless Chromium (Playwright 1.63.0).     |
| Source   | `Cell` of the reference game with a field `mark` of a class `Mark`, and a method `tint`     |
| Result 1 | `tshc check` found no problem.                                                              |
| Result 2 | A method that returns a changed copy and a method that writes `this` both ran in the tick.  |
| Result 3 | After 200 ticks the cells of the GPU device equal the cells of the CPU device, with `mark`. |
| Result 4 | The fragment entry called `c.tint()`, and the picture check passed.                         |
| Result 5 | `sim.dump()` printed `mark {v 10, n 5}`. `sim.input` refused `{ mark: { v: 9, n: 9 } }`.    |

Not observed: WebGL2, and a class in a class in a class.

## Why

- **Classes by hand, not a build.** The owner chose this on 2026-11-11 (Record). A build that
  makes `Cell` from the kinds is engine code that the agent must read. The game is written by
  hand first, and the count of what is still hard decides if a build is needed.
- **Methods, not blocks of the tick.** The compiler refuses a function with a loop that another
  function calls (P8). A method of a class has no loop, so a rule can leave the tick function.
- **The colour beside the rule.** A new kind is then one class in one file.
- **An object writes the fields it names.** A player's input changes one thing. An input that
  must give every field of `belt` says more than the player did.

## The cost

Each cell holds the fields of every kind. The reference game's cell goes from 6 words to about 11. Step 2 measures the bytes of a cell and records them. A cell that holds only its own kind
needs a table for each kind and an index, which is a later record if the measure asks for it.

## What is not in this record

- A build that makes `Cell` from the kinds.
- A table for each kind.
- The grid (P1, P2). It waits on compiler issue typeshade/typeshade#1244.

## What it touches

| Path                                         | Change                                                   |
| -------------------------------------------- | -------------------------------------------------------- |
| `src/input.ts`                               | The check of an object value. `InputValue` has an object |
| `src/sim.ts`, `src/world.ts`                 | An object writes the fields it names                     |
| `test/input.test.ts`, `test/sim.test.ts`     | The rules of section 2                                   |
| `examples/factory/`                          | The kinds as classes. The tests and the page follow.     |
| `docs/design/0101-inputs-replay-and-seed.md` | A note that this record changes rule 4 of section 1      |
| `README.md`                                  | The layout row of this record                            |

Tests owed:

| Test                                                                                   | Verifies      |
| -------------------------------------------------------------------------------------- | ------------- |
| Each rule of section 2 on a simulation, the valid form and the error text              | Design 0105.2 |
| An object value on a world                                                             | Design 0105.2 |
| A run with an object input replays to the same dump                                    | Design 0105.2 |
| The reference game's tests give the same pictures and counts with the kinds as classes | Design 0105.1 |
| The harness: the cells of the GPU device equal the cells of the CPU device             | Design 0105.1 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0105`.

1. **The input.** Section 2 and its tests.
2. **The game.** The kinds as classes in `examples/factory/`. The game's `README.md` shows the
   code before and after, with the lines, the bytes of a cell and the state of P4, P8 and P11.
   Set this record to `implemented`.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. A kind is a class with its fields, its rules and its colour. The game writes `Cell` by hand.
2. An input's value can be an object, for a field that holds an object. It writes the fields it
   names.
3. The engine adds no code for kinds in this record.

## Record

- **Approval.** The agent showed the owner two ways on 2026-11-11: `Cell` written by hand, or a
  build that makes `Cell`. The agent recommended the first, and the owner answered "네". The
  owner's rule of 2026-11-11 approves a merge with green checks in advance (`CLAUDE.md`,
  Merging).
- **Validation.** Does not yet apply: no step is implemented.
- **Deviations.** None.
