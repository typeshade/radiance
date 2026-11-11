---
id: '0110'
title: A build of a game is a page that the owner opens on a phone, and the page shows its numbers
status: implemented
vision: [D7, D12, D13, D15, D16]
touches:
  - src/page.ts
  - src/build.ts
  - src/cli.ts
  - test/
  - examples/factory/
  - .github/workflows/
  - README.md
compiler:
  - typeshade/typeshade#1249
---

# 0110. A build the owner opens on a phone

**Document control**

| Field          | Record                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Identity       | Design record `0110`, `status: accepted`. The front matter holds the identity and the lifecycle. |
| Date           | Written 2026-11-11 by the repository's coding agent, under decision D9 of `docs/vision.md`.      |
| Baseline       | `typeshade/radiance` `main` `011f294`.                                                           |
| Compiler pin   | `6d6a979`.                                                                                       |
| Pull request   | The pull request that adds this file.                                                            |
| What is a fact | The state of `main` in "What changes". No step is implemented. No phone was measured.            |

## What changes

Decision D16 says that the first game is for a phone, and that the owner tries a build in a
phone's browser. Today `radiance build` writes `<project>/dist`, and nothing puts it at an
address. The page shows no number, so a try on a phone gives no record.

After this record, a build of `main` is at an address that only the owner opens. The page shows
its device tier, its times and its commit.

### 1. The readout

`radiance build --readout <project>` writes a page with a readout: one line of text in a corner
of the page.

```
webgpu  tick 0.8 ms  frame 16.7 ms  1 tick/frame  011f294
```

| Part         | What it is                                                                     |
| ------------ | ------------------------------------------------------------------------------ |
| `webgpu`     | The tier of the device: `webgpu` or `webgl2`                                   |
| `tick`       | The mean time of one tick over the last 60 frames, with the wait for the GPU   |
| `frame`      | The mean time from one frame to the next over the last 60 frames               |
| `tick/frame` | The mean count of ticks in one frame over the last 60 frames                   |
| `011f294`    | The commit of the build, as `git rev-parse --short HEAD` gives it at the build |

- A page with no device shows the reason in the same place, and it does not stay empty. A phone
  with no WebGPU is such a page today (compiler issue #1249).
- A build without `--readout` has no readout and none of its code. A store package has none.
- The readout is text of the page, not a drawing of the engine. The drawing layer is a later
  record.

### 2. The numbers come from the runtime

`run` of `radiance/page` gains one option.

```ts
export interface FrameStats {
  readonly tier: string;
  readonly tickMs: number;
  readonly frameMs: number;
  readonly ticks: number;
}

run(Game, { seed, canvas, rows, values, onFrame: (stats: FrameStats) => void });
```

- `run` calls `onFrame` after each frame, with the numbers of that frame.
- `run` also takes `onError`. A frame that fails stops the loop, and `onError` gets the error.
- The entry file that the build writes holds the means and writes the line.
- `src/engine.ts` gains nothing. The loop of a page is `src/page.ts` (design record 0108,
  section 10).

### 3. The page fits a phone

- The canvas fills the screen in either orientation, and it follows a turn of the phone.
- A touch gives the pointer events that a mouse gives. A touch does not scroll or zoom the page.
- The harness opens the page with a phone's screen and a touch, and it puts a belt with a drag.

### 4. The address

The hosting is the owner's. The owner's statement on 2026-11-11: "게임은 그 따로 도메인 판 뒤,
클라우드플레어가 제공하는 기능 위에서 기반으로 저만 들어가서 볼 예정입니다".

- The build output is a directory of static files with relative addresses. It needs no server
  code, so any static host serves it (D7).
- The address is `game.typeshade.dev`. The owner named the subdomain on 2026-11-11: "game 서브
  도메인으로". The page is a Cloudflare Worker of static assets, as the sites of the sibling
  repositories are.
- `wrangler.jsonc` holds the Worker's name, the account and the address. The account's id is
  not a secret, by the convention of those repositories.
- `.github/workflows/deploy.yml` builds the first reference game from `main` with `--readout`,
  and it deploys the directory.
- The workflow reads one secret, `CLOUDFLARE_API_TOKEN`. The owner sets it. Without it the
  workflow says so, and it does not fail.
- A Cloudflare Access application limits the address to the owner. It is a setting of the
  owner's account, and no file of this repository holds it or a credential.
- The Worker has no `workers.dev` address and no preview address. Access covers the one
  address that there is. A test holds the two settings.
- A pull request does not upload. Only a push to `main` does.

## Why

- **A number on the screen is a record.** `docs/vision.md` (section 12) takes a claim about a
  phone only with the device, the commit and the number. The readout puts them in one picture.
- **The commit is in the line.** The owner sees which build is on the phone.
- **The runtime gives numbers, and the page shows them.** The runtime names no browser
  interface (record 0108, section 10).
- **The same build as CI.** The workflow uploads what the checks built. A second build on the
  host could differ from it.
- **A reason, not an empty page.** A phone with no WebGPU is the first case the owner can meet.

## The cost

- The readout line and its means are in a `--readout` build only. The budget of record 0109
  holds for the build without it.
- A time of a tick includes a wait for the GPU. It is higher than the work of the GPU alone.
- The workflow needs two secrets, and the owner maintains them.

## What is not in this record

- A store package (D6) and a build for a desktop store (D15).
- The WebGL2 path for a table of classes. It waits on compiler issue #1249.
- A measurement on a phone. This record makes it possible, and the owner's first try is it.
- The drawing layer.

## What it touches

| Path                                             | Change                                                        |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `src/page.ts`                                    | `onFrame` and `FrameStats`                                    |
| `src/build.ts`                                   | `--readout`: the entry file's readout, the commit, the reason |
| `src/cli.ts`                                     | The option `--readout`                                        |
| `test/build.test.ts`, `test/run.test.ts`         | New tests                                                     |
| `examples/factory/tests/`                        | The harness with a phone's screen and a touch                 |
| `.github/workflows/deploy.yml`, `wrangler.jsonc` | New: the deploy from `main`                                   |
| `README.md`                                      | The option and the workflow                                   |

Tests owed:

| Test                                                                       | Verifies      |
| -------------------------------------------------------------------------- | ------------- |
| `run` calls `onFrame` once for each frame, with the tier and the count     | Design 0110.2 |
| The entry file has the readout with `--readout`, and no word of it without | Design 0110.1 |
| The harness: the readout shows `webgpu`, three numbers and the commit      | Design 0110.1 |
| The harness: a page with no device shows the reason                        | Design 0110.1 |
| The harness: on a phone's screen, a drag of a touch puts a belt            | Design 0110.3 |
| The Worker has no `workers.dev` address and no preview address             | Design 0110.4 |

## Implementation, in steps

Each step is one pull request. Each commit carries `Design: 0110`.

1. **The readout.** Sections 1 to 3 with their tests.
2. **The upload.** Section 4. The owner sets the secrets and the Cloudflare project. Set this
   record to `implemented` when the owner opens the address on a phone.

## Decisions for the owner

The agent made these decisions under D9. The owner can change each one.

1. The readout is an option of the build, and a store package has none.
2. A workflow of this repository uploads the build. The other way is that Cloudflare reads the
   repository and builds it. That way needs no secret here, and it is a second build.
3. The first reference game is the page at the address, until the first game for a phone exists.

## Record

- **Approval.** The owner stated D16 and the hosting on 2026-11-11. The owner's rule of
  2026-11-11 approves a merge with green checks in advance (`CLAUDE.md`, Merging).
- **Validation.** Step 1, on 2026-11-11, compiler pin `6d6a979`: `bun run check` passed with
  128 tests. `bun run harness` passed with 8 checks in headless Chromium, WebGPU on SwiftShader.
  The readout showed the tier `webgpu`, three numbers and the commit. A touch on the screen of
  an emulated Pixel 7 put a belt. Step 2, on 2026-11-11: the workflow `deploy` deployed commit `ee0425f`. A request to
  `https://game.typeshade.dev/` with no login got a redirect to the Access login. The owner
  opened the address on a phone and said: "잘 나오네요". The owner gave no device, system version
  or number, so this is no measurement of `docs/vision.md` (section 12).
  The owner then sent a picture of the page, taken on 2026-11-11: an iPhone, Safari, the page
  upright, commit `ee0425f`. The readout said `webgpu  tick 4.1 ms  frame 16.6 ms  1 tick/frame`.
  The owner gave no model and no system version. The level is 10 by 6 cells.
- **Deviations.**
  - Section 3 says that the canvas fills the screen. On the owner's iPhone the canvas reached
    under the bar of Safari, and the bar hid the last row of cells and stood over the readout.
    The canvas now has the height that the browser leaves to the page, and it follows a change
    of its place. Disposition: closed by the pull request that records this line.
  - The picture is stretched on an upright phone: a cell is taller than it is wide. The game's
    own drawing fills the canvas with the grid. Disposition: open. The drawing layer gives a
    game a view that keeps the shape of a cell.
  - Section 4 said that no file holds the domain, and that the workflow reads the account
    from a secret. `wrangler.jsonc` holds both, as the sibling repositories do, and the workflow
    reads one secret. The owner named the address. Disposition: made part of this record.
  - `run` gains two options, not one: `onFrame` and `onError`. A browser with no WebGPU and no
    WebGL2 context still opens a device, and the first drawing fails. The reason is then the
    error of a frame, so the loop gives it to `onError`. Disposition: made part of this record.
