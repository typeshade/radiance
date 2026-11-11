# TypeShade Radiance

A game engine written in [TypeShade](https://typeshade.dev), made for development by a coding
agent.

**Status: design. Nothing is implemented.** [`docs/vision.md`](docs/vision.md) is the design:
the claim, the owner's decisions, what an agent writes and reads, the scene model, the tick, and
what is not promised.

## The design in short

- An agent makes the game. Each thing the engine does is text the agent can read.
- A scene is TypeScript code. A node's behaviour is a class in a `"use typeshade"` file.
- The author writes a tree of nodes. The engine stores and runs tables.
- The simulation runs on a fixed tick. A game is a function of a seed and its inputs.
- Game logic runs on the CPU tier. The GPU draws the frame and computes wide effects.
- The platform is the web. A game ships as a store package and needs no server.
- The first games are offline games of the roguelike kind and the automation kind.

## The first model

This repository first held a path-tracing renderer of the same name. It tested the compiler's
feedback loop. The owner decided on 2026-11-11 to design the engine again from nothing and to
keep the name.

The first model is on the branch `legacy`, at commit `3e4efb3f`: its packages, its design
records 0001 to 0011, its plan and its site. Compiler proposals that cite the first model cite
its commits, and those commits stay reachable.

## Layout

| Path                    | Content                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `docs/vision.md`        | The design                                                       |
| `docs/design/README.md` | What a design record is, and when a change needs one             |
| `scripts/`              | The prose checks and the commit gate                             |
| `CLAUDE.md`             | The rules for a session with a coding agent                      |
| `.agents/`, `.claude/`  | The installed skills, pinned by `skills-lock.json`, and the hook |

## Checks

`bun run check` runs the format check (`format:check`) and the two prose checks (`check:prose`,
`check:ste`). CI runs the same three. The engine has no code yet, so there is no type check, no
test and no harness.

## Licence

Apache-2.0. See [`LICENSE`](LICENSE).
