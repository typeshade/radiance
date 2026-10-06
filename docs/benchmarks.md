# Benchmarks

This file records how fast each scene renders. A row is a measurement. It is not a bound, and no
gate reads it (design record 0002, decision 3). `scripts/bench.mjs` produces the rows. The owner
or an agent appends them here by hand. Each render takes a fixed number of samples a pixel and
stops there, so the work is the same on every device (design record 0002, Amendment 4).

The first rows come from SwiftShader, the software WebGPU device the gates use. A SwiftShader row
shows a trend and nothing more. Milestone M2's acceptance asks for samples a second at 1080p on a
real GPU. That row comes from the owner's machine, by the procedure below.

## What a row holds

`scripts/bench.mjs` prints one row for each scene and size. The scenes are `cornell` (the gate's
Cornell box) and every site example. Each row has these columns.

| Column      | Meaning                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `date`      | The UTC date of the run.                                                                                             |
| `commit`    | The short hash of `HEAD`. `-dirty` follows it when the tree differs from that commit.                                |
| `scene`     | `cornell`, or the id of a site example.                                                                              |
| `size`      | The frame in pixels.                                                                                                 |
| `spp`       | The samples a pixel of the render.                                                                                   |
| `triangles` | The triangles the scene draws. Each visible mesh counts, so an instance counts again.                                |
| `BVH ms`    | The median of five builds of the bottom-level BVH of every distinct geometry. A build over one second is timed once. |
| `frame ms`  | The mean time of one frame. The first counted frame is left out when a second frame exists.                          |
| `paths/s`   | The paths the counted frames traced, over their time.                                                                |
| `spp/s`     | `paths/s` over the pixels of the frame.                                                                              |
| `device`    | The adapter's description as the browser reports it. When the description is empty, the vendor and architecture.     |
| `browser`   | The browser and its version.                                                                                         |

The top-level BVH and the packing of the scene are not in `BVH ms`. The page builds the BVH again
for the timing, so the number is the cost of the builder and not a part of `frame ms`. A page that
is not cross-origin isolated has a timer of about 0.1 ms resolution. A `BVH ms` value below that
resolution reads as 0.0.

## The options

`bun run bench` takes these options.

| Option             | Effect                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `--gpu`            | Drops the SwiftShader flags. The run fails when the adapter is a software one.           |
| `--smoke`          | A tiny run: 32 x 32, 2 samples. It checks that every scene renders. It measures nothing. |
| `--size WxH[,WxH]` | The frame sizes. The default is `512x512,1920x1080`.                                     |
| `--samples N`      | The samples a pixel. The default is 16.                                                  |
| `--per-frame N`    | The samples one frame adds. The default is 4.                                            |
| `--scene a,b`      | The scenes to run. The default is every scene.                                           |
| `--timeout S`      | The seconds one render may take. The default is 1800.                                    |

`RADIANCE_CHROMIUM` names the Chromium or Chrome executable. `RADIANCE_HEADED=1` shows the window.

## Procedure: SwiftShader

Run these steps on Linux or macOS from the repository root.

1. Run `git submodule update --init`. It fetches the compiler into `vendor/typeshade`.
2. Run `bun install`.
3. Run `npx playwright install chromium`, or set `RADIANCE_CHROMIUM` to a Chromium executable.
4. Run `node scripts/bench.mjs --size 128x128 --samples 16 --per-frame 4`.
5. Copy each row of the output into the SwiftShader table below.
6. Check that `device` names SwiftShader.

SwiftShader traces about 28,000 to 160,000 paths a second on four cores. At 1920 x 1080 the default
run takes over an hour. Use the small size of step 4.

## Procedure: a real GPU, in Windows PowerShell

The owner runs these steps. The run takes minutes on a real GPU. Git, node and bun must be on
`PATH`. `bun run bench` runs `node scripts/bench.mjs`, and the script starts `bun` without a shell.
So `bun` must be an executable, as the installer from bun.sh sets it up. A `.cmd` shim may not work
(inference, not tested).

1. Open PowerShell in the repository folder.
2. Run `git submodule update --init`. It fetches the compiler into `vendor/typeshade`.
3. Run `bun install`.
4. Set the browser: `$env:RADIANCE_CHROMIUM = "C:\Program Files\Google\Chrome\Application\chrome.exe"`.
5. Run `bun run bench --gpu`.
6. Read the first row. The `device` column must name your GPU and not SwiftShader.
7. If the run fails with a software adapter, run `$env:RADIANCE_HEADED = "1"`.
8. After step 7, run step 5 again.
9. Copy each row of the output into the real GPU table below.
10. Commit the rows in a pull request.

The script records a WARP adapter (the "Microsoft Basic Render Driver") as software, even when the
browser does not set the fallback flag. The default run renders every scene at 512 x 512 and
1920 x 1080 with 16 samples a pixel. To record the 1080p speed of one scene, run
`bun run bench --gpu --scene cornell --size 1920x1080`.

## CI

CI does not record a row. A smoke step for the `harness` job is `node scripts/bench.mjs --smoke`,
after `bun run harness`. The step fails when a scene does not render, and it records nothing.
`.github/workflows/ci.yml` does not have this step yet.

## Rows

### SwiftShader, this machine

The command was `node scripts/bench.mjs --size 128x128 --samples 16 --per-frame 4`, and for the
512 x 512 row `node scripts/bench.mjs --scene cornell --size 512x512 --samples 4 --per-frame 2`.
The machine had four cores shared with other jobs, so the numbers vary from run to run. The
compiler pin was 596c805. The `commit` column names 1dcdfaf, the commit of `scripts/bench.mjs` when
the rows were measured. A later rebase renamed that commit e75b7f5, and the script's code is the same.

| date       | commit  | scene           | size    | spp | triangles | BVH ms | frame ms | paths/s | spp/s | device             | browser                |
| ---------- | ------- | --------------- | ------- | --- | --------- | ------ | -------- | ------- | ----- | ------------------ | ---------------------- |
| 2026-10-06 | 1dcdfaf | cornell         | 128x128 | 16  | 1932      | 5.2    | 1218.0   | 50444   | 3.08  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 1dcdfaf | first-scene     | 128x128 | 16  | 1924      | 1.6    | 388.5    | 158147  | 9.65  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 1dcdfaf | cornell-box     | 128x128 | 16  | 1932      | 5.1    | 1117.2   | 54997   | 3.36  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 1dcdfaf | materials       | 128x128 | 16  | 4806      | 7.7    | 849.9    | 77113   | 4.71  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 1dcdfaf | coloured-lights | 128x128 | 16  | 2888      | 4.5    | 566.1    | 108537  | 6.62  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 1dcdfaf | determinism     | 128x128 | 16  | 1932      | 2.9    | 1344.4   | 48747   | 2.98  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 1dcdfaf | scene-graph     | 128x128 | 16  | 2892      | 8.3    | 1127.0   | 58149   | 3.55  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 1dcdfaf | cornell         | 512x512 | 4   | 1932      | 6.0    | 13756.5  | 28584   | 0.11  | google swiftshader | Chromium 141.0.7390.37 |

### Real GPU, the owner's machine

This row is empty until the owner runs `bun run bench --gpu` and pastes the rows.

| date | commit | scene | size | spp | triangles | BVH ms | frame ms | paths/s | spp/s | device | browser |
| ---- | ------ | ----- | ---- | --- | --------- | ------ | -------- | ------- | ----- | ------ | ------- |
|      |        |       |      |     |           |        |          |         |       |        |         |
