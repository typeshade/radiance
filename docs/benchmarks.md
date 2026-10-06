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

The SwiftShader rows below show about 28,000 to 126,000 paths a second on four cores. At
1920 x 1080 the default run takes over an hour. Use the small size of step 4.

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

The 11 rows at 128 x 128 come from `node scripts/bench.mjs --size 128x128 --samples 16 --per-frame 4`.
The row at 512 x 512 comes from
`node scripts/bench.mjs --scene cornell --size 512x512 --samples 4 --per-frame 2`. The machine had
four cores shared with other jobs, so the numbers vary from run to run. The compiler pin was 596c805.
The browser was Chromium 141.0.7390.37 on SwiftShader.

The rows were measured on 2026-10-06 at commit 85cce4f of the branch `wt/B3`, in a clean tree: the
`commit` column has no `-dirty` suffix. Commit 85cce4f is the parent of the commit that records the
rows here, and that commit changes no script. The squash merge of the pull request gives `main`
another hash, so `main` does not hold 85cce4f.

| date       | commit  | scene           | size    | spp | triangles | BVH ms | frame ms | paths/s | spp/s | device             | browser                |
| ---------- | ------- | --------------- | ------- | --- | --------- | ------ | -------- | ------- | ----- | ------------------ | ---------------------- |
| 2026-10-06 | 85cce4f | cornell         | 128x128 | 16  | 1932      | 5.2    | 2141.6   | 28689   | 1.75  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | first-scene     | 128x128 | 16  | 1924      | 1.7    | 520.0    | 126039  | 7.69  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | cornell-box     | 128x128 | 16  | 1932      | 3.5    | 2062.6   | 31774   | 1.94  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | materials       | 128x128 | 16  | 4806      | 9.3    | 1378.3   | 47550   | 2.90  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | coloured-lights | 128x128 | 16  | 2888      | 4.9    | 730.2    | 89751   | 5.48  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | lights          | 128x128 | 16  | 2890      | 1.6    | 892.9    | 73400   | 4.48  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | bunny           | 128x128 | 16  | 69455     | 161.4  | 643.3    | 101869  | 6.22  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | determinism     | 128x128 | 16  | 1932      | 3.3    | 1891.8   | 34643   | 2.11  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | geometries      | 128x128 | 16  | 986       | 5.6    | 922.0    | 66636   | 4.07  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | scene-graph     | 128x128 | 16  | 2892      | 5.9    | 1524.8   | 40294   | 2.46  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | instances       | 128x128 | 16  | 148       | 0.0    | 762.0    | 80633   | 4.92  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 85cce4f | cornell         | 512x512 | 4   | 1932      | 5.7    | 8137.8   | 48320   | 0.18  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 78f8132 | sponza          | 128x128 | 16  | 227329    | 532.0  | 13588.5  | 4521    | 0.28  | google swiftshader | Chromium 141.0.7390.37 |
| 2026-10-06 | 78f8132 | sponza          | 512x512 | 2   | 227329    | 444.4  | 62681.8  | 4182    | 0.02  | google swiftshader | Chromium 141.0.7390.37 |

### SwiftShader, the `sponza` rows

The two `sponza` rows come from `node scripts/bench.mjs --scene sponza --size 128x128 --samples 16 --per-frame 4`
and from `node scripts/bench.mjs --scene sponza --size 512x512 --samples 2 --per-frame 1`. The tree
was commit 78f8132 of the branch `wt/S3` with no change, and the compiler pin was 596c805. Commit
78f8132 is the parent of the commit that records the rows here. The squash merge of the pull request
gives `main` another hash, so `main` does not hold 78f8132.

The machine had four cores shared with other jobs. Its load average was between 7 and 8. The
triangle count holds the 2 triangles of the light. The 227,327 triangles of the model build into 22
BVHs (`BVH ms`). The rate is about 4,500 paths a second, a sixth of the `cornell` row at 128 x 128.
This is a speed on a software device and is not a measure of a GPU.

### Real GPU, the owner's machine

This row is empty until the owner runs `bun run bench --gpu` and pastes the rows. Milestone M2's acceptance needs the `sponza` row at 1920 x 1080 from a real GPU (`docs/plan.md`, M2, and design record 0002, "The benchmark"). It is open. The command is `bun run bench --gpu --scene sponza --size 1920x1080`.

| date | commit | scene | size | spp | triangles | BVH ms | frame ms | paths/s | spp/s | device | browser |
| ---- | ------ | ----- | ---- | --- | --------- | ------ | -------- | ------- | ----- | ------ | ------- |
|      |        |       |      |     |           |        |          |         |       |        |         |
