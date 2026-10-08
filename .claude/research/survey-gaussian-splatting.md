# Gaussian splatting for radiance (survey, 2026-10-09)

The owner asked on 2026-10-09 for a plan for 2D and 3D Gaussian splatting. Nothing about Gaussian
splatting exists in the repository at `main` a0106e0. This survey reads the papers, the formats and
the web viewers, and ranks the options for the engine. Design record 0011
(`docs/design/0011-gaussian-splatting.md`) is the draft that follows from it.

Two owner decisions of the same day changed the scope while the survey was written:

1. Training is in. A user uploads a video or several photos, and the system produces a 3D scene
   through 2D Gaussian splatting (2DGS). The survey therefore also covers the capture pipeline:
   ingest, camera poses, optimisation, output.
2. Gradients come from the compiler. TypeShade is to support forward and reverse mode `grad`
   officially. The compiler's roadmap (`vendor/typeshade/docs/roadmap.md`, line 295) lists
   reverse-mode `grad` after 1.0, and says it "needs the tape and the memory rules a design issue
   has to settle". So 2DGS training waits on a compiler change, and the survey lists what that
   change must settle for this use.

Labels. **Fact** is read in the cited source on 2026-10-09. **Inference** is reasoned here and is
not measured. **Proposal** is what this survey recommends. A number from a paper is the paper's
claim, and no number here was measured in this repository.

The constraints each item is held to (from `docs/plan.md` section 3.1 and records 0001, 0005, 0006):

- **D (determinism).** Record 0005: no atomics on the accumulation path (rule 4), no transcendental
  (`exp`, `log`, `pow`, ...) that feeds a comparison, an index or a choice (rule 2), and a reduction
  has one order (rule 5). The promise is bit-identical images on one device and one driver.
- **A (atomics).** WGSL has no float atomics. Only `atomic<u32>` and `atomic<i32>`.
- **G (grad).** `grad()` is forward mode, a few parameters a render. Reverse mode is after 1.0.
  Traversal (a runtime-length `while`) is not differentiated (plan section 3.1, item 2).
- **B (bindings).** Eight storage buffers a stage. Record 0001 rule 1 binds seven in `trace` and
  keeps the eighth for the compiler's console. 128 MiB a binding by default (record 0006, item 1).
- **R (no hardware ray tracing).** WebGPU has no ray-tracing pipeline. A ray tracer is a software
  BVH walk in a compute kernel (plan section 3.2).

## What a Gaussian splat is, in the numbers that matter here

**Fact** (3DGS paper and the reference `.ply` layout). One 3D Gaussian has a centre (3 floats), a
rotation quaternion (4), a scale per axis stored as its log (3), an opacity stored as its logit (1),
and colour as spherical harmonics (SH). Degree 0 is 3 floats. Degree 3 is 16 coefficients per
channel, 48 floats. The INRIA `.ply` row is 62 floats, 248 bytes, with 3 unused normal floats.
A scene of a room or an object has 0.2 to 6 million Gaussians. The renderer of the paper projects
each Gaussian to a 2D ellipse (the EWA approximation), adds a 0.3 pixel low-pass to its covariance,
sorts all splats by view depth once a frame, and alpha-blends front to back in 16 by 16 tiles.

**Inference** for radiance. A 1M-Gaussian scene at degree 3 is 248 MB as `.ply`, above one 128 MiB
binding. So the packing (record 0001's buffers) and the file format are design items, not details.

## The items

### Core methods

1. **3D Gaussian Splatting for Real-Time Radiance Field Rendering** (Kerbl, Kopanas, Leimkuehler,
   Drettakis, ACM TOG 42(4), SIGGRAPH 2023)
   - What: anisotropic 3D Gaussians fitted to photographs by a differentiable tile rasterizer,
     with adaptive density control (clone, split, prune). Real-time display by sorted alpha
     blending of projected 2D ellipses.
   - Why here: it defines the asset that every format and viewer below carries. Any option must
     read it.
   - Fits: the asset and the loader (L2 classes, L3 addons loaders). The renderer depends on the
     option.
   - Depth: host (loader, packing) plus kernel. Cost: the loader is small, the renderer is medium
     to large.
   - Collisions: the rasterizer's backward pass sums gradients per Gaussian with float `atomicAdd`
     (A, D). The forward pass needs a global sort a frame (integer atomics for the histogram only).
     The projection uses a first-order (EWA) approximation, so a ray tracer and a rasterizer do not
     give the same image of one asset.
   - https://arxiv.org/abs/2308.04079 , https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/

2. **2D Gaussian Splatting for Geometrically Accurate Radiance Fields** (Huang, Yu, Chen, Geiger,
   Gao, SIGGRAPH 2024)
   - What: each primitive is a flat 2D Gaussian disk (a surfel) in 3D, with two tangent axes and a
     normal. The renderer intersects the ray with the disk's plane (ray-splat intersection), so the
     depth and the normal are exact and view-consistent.
   - Why here: a surfel is a surface with a normal. A ray tracer meets it with a plane test, which
     is cheaper and better defined than a 3D Gaussian's "maximum response" point. The normal is
     what a later relighting needs.
   - Fits: option B as a second kernel kind beside the 3D Gaussian. Same buffers.
   - Depth: kernel (one intersection function) plus loader (a 2D scale). Cost: small once option B
     exists.
   - Collisions: none beyond option B's. The test is `+`, `*`, `/` and `dot` (record 0005 rule 3).
     Few published assets are 2DGS, so it is not the first kind to support (inference).
   - https://arxiv.org/abs/2403.17888 , https://surfsplatting.github.io/

### Ray-traced Gaussians

3. **3D Gaussian Ray Tracing: Fast Tracing of Particle Scenes (3DGRT)** (Moenne-Loccoz, Mirzaei,
   Perel, de Lutio, Martinez Esturo, State, Fidler, Sharp, Gojcic, SIGGRAPH Asia 2024)
   - What: a BVH over the Gaussians, each wrapped in a stretched icosahedron for hardware
     ray-triangle tests. A ray gathers its hits in a k-buffer (insertion sort of `k` hits), shades
     them in depth order, and continues from the last hit. A Gaussian is evaluated at its point of
     maximum response along the ray, `tau = -dot(o_g, d_g) / dot(d_g, d_g)` in the Gaussian's unit
     space. Secondary rays (shadows, reflection, refraction) and distorted cameras come for free.
   - Fact: 3DGRT reports 68 FPS against 253 for 3DGS on the 13 standard scenes (as tabled by GRay,
     item 6). AABB proxies were about 3 times slower than icosahedra on RTX hardware.
   - Why here: it is the model for option B. The maximum-response evaluation fits a software BVH
     walk, and the paper's own playground inserts path-traced meshes into a Gaussian scene.
   - Fits: option B, L1 (`intersect.shade.ts`) plus record 0001 (a new instance kind).
   - Depth: kernel plus record. Cost: medium.
   - Collisions: R (no hardware RT, so no icosahedron proxy: test the ellipsoid in the leaf
     instead). The k-buffer is a per-ray sorted array of runtime length, a `while` that `grad`
     cannot pass (G). `exp` of the Gaussian decides the early stop at a transmittance floor (D, rule
     2). The stochastic form (item 7) removes both the k-buffer and the decision on `exp` if the
     falloff is written from products.
   - https://arxiv.org/abs/2407.07090 , https://gaussiantracer.github.io/

4. **3DGUT: Enabling Distorted Cameras and Secondary Rays in Gaussian Splatting** (Wu et al., CVPR 2025)
   - What: replaces the EWA projection by an unscented transform (sigma points), so a rasterizer
     handles any camera model. It aligns the rasterizer's particle evaluation with 3DGRT's, so one
     asset renders by raster for primary rays and by ray tracing for secondary rays.
   - Why here: it is the bridge between option A and option B. An asset trained with 3DGUT's
     formulation renders the same in both.
   - Fits: option A's projection, if A is built. Depth: kernel. Cost: medium.
   - Collisions: none special. The sigma points are sums and products.
   - https://arxiv.org/abs/2412.12507 , https://github.com/nv-tlabs/3dgrut

5. **EVER: Exact Volumetric Ellipsoid Rendering for Real-time View Synthesis** (Mai et al., 2024)
   - What: constant-density ellipsoids, rendered as an exact volume integral along the ray, with no
     popping and no view-dependent density. About 30 FPS at 720p on an RTX 4090 (paper's claim).
   - Why here: it shows that an exact, order-independent ray integral is possible for ellipsoid
     primitives. Its assets are not 3DGS assets.
   - Fits: none now. A later primitive kind. Depth: kernel. Cost: medium.
   - Collisions: needs the sorted list of every ellipsoid boundary along the ray (G, and a
     runtime-length sort in the kernel).
   - https://arxiv.org/abs/2410.01804

6. **GRay: Ray Tracing 3D Gaussians Near the Speed of Splats** (Poirier-Ginter, Lalonde, Drettakis,
   PACMCGIT 9(1), 2026)
   - What: a ray tracer for 3D Gaussians that is nearly 4 times faster than 3DGRT and optimizes
     nearly 10 times faster (paper's claim). Many small Gaussians from a dense initialization slow a
     rasterizer and speed a ray tracer, because a ray meets only what it intersects.
   - Why here: evidence that ray tracing scales with the log of the Gaussian count, which favours
     option B for the large scenes a browser must hold.
   - Fits: option B, the build and leaf policy. Depth: host (BVH build). Cost: small to read.
   - https://arxiv.org/abs/2606.30869 , https://repo-sam.inria.fr/nerphys/gray

7. **Stochastic Ray Tracing for the Reconstruction of 3D Gaussian Splatting** (Xu et al., 2026)
   - What: a sorting-free, unbiased Monte Carlo estimator for ray-traced 3DGS. A ray evaluates a
     sampled subset of the Gaussians it crosses. The same estimator drives relightable 3DGS with
     fully ray-traced shadow rays.
   - Why here: it is the form that fits a progressive path tracer. With one Bernoulli choice for
     each Gaussian a ray crosses, the nearest accepted Gaussian is the alpha-compositing estimate.
     The walk is the existing nearest-hit BVH walk with a filter, so no k-buffer and no sort.
   - Fits: option B, the core of the kernel. Depth: kernel. Cost: small once the intersection
     exists.
   - Collisions: the Bernoulli test compares a random number with `opacity * exp(-q / 2)`. Under
     record 0005 rule 2 the falloff must come from products and sums (a polynomial on `[0, 9]`), or
     rule 2 is amended. The random number is a hash of the ray's key and the Gaussian's index, which
     is integer arithmetic (rule 1). The result is independent of the BVH's visiting order, so it is
     deterministic.
   - https://arxiv.org/abs/2603.23637

8. **Don't Splat your Gaussians: Volumetric Ray-Traced Primitives for Modeling and Rendering
   Scattering and Emissive Media** (Condor et al., arXiv 2024,
   revised 2025)
   - What: Gaussian (and Epanechnikov) kernels as a heterogeneous scattering medium, with closed-form
     transmittance and free-flight sampling, inside an off-the-shelf volumetric path tracer
     (Mitsuba 3). Forward and inverse rendering of smoke and clouds.
   - Why here: it is the path from Gaussians to milestone M3v (volumes). A cloud of kernels is an
     alternative to a dense density grid, with no 128 cubed limit.
   - Fits: M3v, after option B's BVH over Gaussians exists. Depth: kernel plus record (M3v's).
     Cost: medium.
   - Collisions: closed-form transmittance needs `erf` or `exp` in a decision (free-flight
     distance), which rule 2 forbids. The Epanechnikov kernel is a polynomial and avoids it
     (inference). Not proposed for record 0011.
   - https://arxiv.org/abs/2405.15425 ,
     https://arcanous98.github.io/projectPages/gaussianVolumes.html

9. **RaySplats: Ray Tracing based Gaussian Splatting** (arXiv 2501.19196, 2025)
   - What: ray-Gaussian intersection on the ellipsoid of a fixed confidence level, so meshes and
     Gaussians share light and shadow in one ray tracer.
   - Why here: a second witness that a mixed mesh and Gaussian ray tracer works.
   - Fits: option B. Depth: kernel. Cost: none beyond item 3.
   - https://arxiv.org/abs/2501.19196

### Sorting-free and stochastic raster

10. **StochasticSplats: Stochastic Rasterization for Sorting-Free 3D Gaussian Splatting**
    (Kheradmand et al., ICCV 2025)
    - What: an unbiased Monte Carlo estimate of the volume rendering equation by stochastic
      transparency in a rasterizer. No sort. The samples per pixel trade time for quality. More
      than 4 times faster than sorted raster at a reasonable quality (paper's claim).
    - Why here: the raster twin of item 7. In option A it removes the global sort. The progressive
      accumulation of radiance already averages noisy frames.
    - Fits: option A. Depth: kernel (fragment). Cost: small inside A.
    - Collisions: a depth test resolves the nearest accepted fragment, which is order-independent,
      so the image is deterministic for one random sequence. The Bernoulli test meets rule 2 as in
      item 7.
    - https://arxiv.org/abs/2503.24366

11. **Sort-free Gaussian Splatting via Weighted Sum Rendering** (Hou et al., ICLR 2025)
    - What: replaces alpha blending by a commutative weighted sum, so no sort. 1.23 times faster on
      a mobile GPU (paper's claim).
    - Why here: commutative blending suits additive hardware blend. It needs assets trained for it,
      so it does not render ordinary 3DGS assets correctly (inference).
    - Fits: none. Depth: kernel. Cost: small. Not proposed.
    - Collisions: float addition in the blender is not associative across a driver's fragment
      order, but WebGPU blends in primitive order, so one device gives one image (inference).
    - https://arxiv.org/abs/2410.18931

12. **StopThePop: Sorted Gaussian Splatting for View-Consistent Real-time Rendering** (Radl et al.,
    ACM TOG 43(4), SIGGRAPH 2024)
    - What: a hierarchical per-tile re-sort that removes the popping of a single global sort, 4 %
      slower than 3DGS on average (paper's claim).
    - Why here: the quality bar for option A. A ray tracer (item 3 or item 7) has no popping at all,
      because each ray orders its own hits.
    - Fits: option A. Cost: medium.
    - https://arxiv.org/abs/2402.00525

13. **Gaussian Point Splatting** (ACM TOG, 2026)
    - What: samples pixel-sized opaque points from the Gaussians and splats them with 64-bit atomics,
      for very large scenes.
    - Collisions: needs 64-bit atomics, which WGSL does not have (A). Not proposed.
    - https://dl.acm.org/doi/10.1145/3811272 , https://jorisar.nl/gaussian_point_splatting/

### Quality and training variants

14. **Mip-Splatting: Alias-free 3D Gaussian Splatting** (Yu, Chen, Huang, Sattler, Geiger, CVPR 2024)
    - What: a 3D smoothing filter on each Gaussian from the training views' sampling rate, and a 2D
      Mip filter in place of the 0.3 pixel dilation.
    - Why here: the 3D filter is a change of covariance and opacity that a loader can apply once, on
      the host, in f64. A ray tracer that averages many jittered samples a pixel needs no 2D filter
      (inference). `.spz` and SOG store an "antialias" flag for assets trained this way.
    - Fits: option B loader. Depth: host. Cost: small.
    - https://arxiv.org/abs/2311.16493

15. **3D Gaussian Splatting as Markov Chain Monte Carlo** (Kheradmand et al., NeurIPS 2024) and
    **Gaussian Opacity Fields** (Yu, Sattler, Geiger, SIGGRAPH Asia 2024)
    - What: better densification (MCMC) and surface extraction from Gaussians (GOF).
    - Why here: training methods only (option C). GOF's mesh extraction is a way to give a splat
      scene a mesh for shadows, outside the engine.
    - https://arxiv.org/abs/2404.09591 , https://arxiv.org/abs/2404.10772

16. **gsplat** (nerfstudio, CUDA library) and **WebDGS** (a browser training loop)
    - What: gsplat is the common CUDA trainer and rasterizer. WebDGS is a WebGPU implementation of
      the training loop: tiled forward, backward gradients, Adam.
    - Why here: evidence that training in the browser is possible, and of what it needs: a backward
      pass that scatters gradients to millions of parameters.
    - Collisions: the backward pass is reverse mode over millions of parameters (G) and sums into
      each Gaussian's gradient from many pixels (A, D). A deterministic form sorts the
      (pixel, Gaussian) pairs and reduces each segment in one order, which is a large kernel set.
    - https://docs.gsplat.studio/ , https://github.com/nerfstudio-project/gsplat ,
      https://github.com/krispy-kenay/WebDGS

### Mixing splats with path-traced meshes

17. **3DGRUT Playground** (NVIDIA, 2025)
    - Fact: inserts ray-traced meshes (glass, mirror, diffuse, PBR) into a 3DGRT scene, with
      environment maps, depth of field and path tracing of PBR meshes (Playground v2.0, 2025-06).
    - Why here: it is the product shape of option B: a captured scene, with path-traced objects
      that reflect it, refract it and are lit by it.
    - https://github.com/nv-tlabs/3dgrut/blob/main/threedgrut_playground/README.md

18. **Relightable 3D Gaussian** (Gao et al., ECCV 2024) and **GHPT, Real-Time Relightable Gaussian
    Splatting using Hybrid Path Tracing** (CVPR 2026)
    - What: Gaussians that carry a normal and BRDF parameters, decomposed from photographs, with a
      point BVH for visibility. GHPT reconstructs a mesh and materials, then path-traces visibility
      and indirect light on the mesh.
    - Why here: relighting needs a material per Gaussian, which ordinary assets do not have. The
      engine can shade a 2DGS surfel by its BSDF only if a trainer gives it albedo and roughness.
      So relighting is later than render-only (inference).
    - https://nju-3dv.github.io/projects/Relightable3DGaussian/ ,
      https://cvpr.thecvf.com/virtual/2026/poster/39867

**What mixes, and how, in a path tracer** (inference, from items 3, 7, 17 and 18). A plain 3DGS
asset holds radiance with the light of the capture baked in. In a path tracer it acts as an
emitter that also blocks light:

| Effect                                         | With a baked-radiance splat (option B, first step) | Needs                                   |
| ---------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| A mesh mirror or glass shows the splat         | Yes. A path that meets a splat takes its radiance  | Nothing more                            |
| The splat lights a mesh (colour bleeding)      | Yes, by BSDF sampling. No light sampling of it     | Nothing more. Noisy. MIS later          |
| The splat casts a shadow on a mesh             | Yes. A shadow ray is blocked stochastically        | Nothing more                            |
| A mesh casts a shadow on the splat             | No. The splat's light is baked                     | A relightable splat (albedo, normal)    |
| A new light changes the splat (relighting)     | No                                                 | Item 18's decomposition, or a 2DGS BSDF |
| Depth of field, motion blur, fisheye, panorama | Yes. Every camera ray is a ray                     | Nothing more (M3's thin lens for bokeh) |
| A splat in a volume (M3v), fog in front of it  | Yes, by the order of events on the path            | M3v                                     |

## The capture pipeline: from a video or photos to a trained 2DGS scene

The stages, with where each one can run. "Browser" is WebGPU in a page. "Host M7" is the Node plus
Dawn desktop host of plan milestone M7. "Server" is a process outside the engine.

| Stage         | Input                               | Output                                               | Browser                                       | Host M7 or server              |
| ------------- | ----------------------------------- | ---------------------------------------------------- | --------------------------------------------- | ------------------------------ |
| 1. Ingest     | A video file, or a set of photos    | 100 to 300 sharp frames, downscaled, with EXIF focal | Yes: WebCodecs decode, a GPU sharpness kernel | Yes                            |
| 2. Poses      | The frames, the EXIF intrinsics     | Intrinsics, a pose for each frame, sparse points     | Not practical today (below)                   | Yes: GLOMAP or COLMAP, or VGGT |
| 3. Initialise | The sparse points and their colours | The first surfels                                    | Yes                                           | Yes                            |
| 4. Optimise   | Frames, poses, surfels              | The trained surfels                                  | Yes, with a memory cap                        | Yes, larger scenes             |
| 5. Output     | The trained surfels                 | A `Splats` in the scene, a `.ply`, a glTF, a mesh    | Yes                                           | Yes                            |

### Ingest

19. **WebCodecs and MP4 demuxing.** `VideoDecoder` decodes H.264, HEVC, VP9 and AV1 frames in the
    browser. It needs the container's samples, and the W3C samples use mp4box.js for the demux.
    - Why here: frame extraction runs in the browser with no server. The demuxer is a dependency
      that the boundary refuses, so the engine writes a small ISO BMFF reader, or the owner admits
      one dependency.
    - https://w3c.github.io/webcodecs/samples/video-decode-display/ ,
      https://tguilbert-google.github.io/webcodecs/mp4-decode/index.html
20. **Frame selection.** The variance of the Laplacian of the luminance is the common sharpness
    score. A pipeline keeps the sharpest frame of each window of `k` frames, and drops frames that
    move too little. Photos carry EXIF: `FocalLengthIn35mmFilm` gives `fx = f35 / 36 * width`.
    - Why here: a sharpness score is a small compute kernel with one reduction a frame (record 0005,
      rule 5). EXIF is a small byte parser.
    - https://pyimagesearch.com/2015/09/07/blur-detection-with-opencv/

### Poses and the sparse start

21. **COLMAP** (Schoenberger and Frahm, 2016) and **GLOMAP** (Pan, Barath, Pollefeys, Schoenberger,
    ECCV 2024)
    - What: incremental (COLMAP) and global (GLOMAP) structure from motion: features, matches,
      poses, intrinsics, sparse points. GLOMAP is on par with COLMAP in accuracy and orders of
      magnitude faster (paper's claim). Both are BSD-licensed. COLMAP's sparse model is the input
      format of 3DGS, 2DGS, gsplat and Brush.
    - Where: native code with a CUDA option for features. No supported WebAssembly build is known
      (not found). So a server or the M7 host runs it.
    - https://colmap.github.io/ , https://arxiv.org/abs/2407.20219 ,
      https://github.com/colmap/glomap
22. **DUSt3R, MASt3R, MASt3R-SfM** (Naver, 2024)
    - What: networks that regress point maps from image pairs, then align them. MASt3R-SfM is a
      full SfM pipeline on top.
    - Collision: the code and weights are CC BY-NC-SA 4.0, non-commercial. Radiance is Apache-2.0.
      Not proposed.
    - https://arxiv.org/abs/2312.14132 , https://arxiv.org/abs/2406.09756 ,
      https://arxiv.org/abs/2409.19152 , https://github.com/naver/mast3r
23. **VGGT: Visual Geometry Grounded Transformer** (Wang et al., Meta and Oxford, CVPR 2025)
    - What: one feed-forward network that gives cameras, depth maps, point maps and tracks from one
      to hundreds of views, in under one second (paper's claim). About 1 billion parameters. Since
      2025-07-29 the licence permits commercial use, and `facebook/VGGT-1B-Commercial` is the
      checkpoint. An ONNX export exists in `fp32` and `fp16`.
    - Browser: ONNX Runtime Web caps WebAssembly memory at 4 GB and a protobuf at 2 GB (external
      data above it). The `fp16` weights alone are about 2.4 GB (inference from 1B parameters).
      Inference: possible on a large desktop browser at best, not a default. A server or the M7
      host runs it.
    - Why here: the fast path for a few photos, where SfM often fails. Its poses can seed GLOMAP or
      be refined in training.
    - https://arxiv.org/abs/2503.11651 , https://github.com/facebookresearch/vggt ,
      https://huggingface.co/facebook/VGGT-1B-Commercial , https://github.com/akretz/vggt-onnx ,
      https://onnxruntime.ai/docs/tutorials/web/large-models.html
24. **pi3, MapAnything, VGGT-Long** (2025)
    - What: successors of VGGT: permutation-equivariant (pi3), metric with optional known inputs
      (MapAnything), and chunked for long sequences (VGGT-Long).
    - Why here: the field moves monthly. The engine should fix a dataset contract, not a model.
    - https://arxiv.org/abs/2507.13347 , https://arxiv.org/abs/2509.13414 ,
      https://arxiv.org/abs/2507.16443
25. **InstantSplat** (2024) and **AnySplat** (SIGGRAPH Asia 2025)
    - What: pose-free splatting. InstantSplat starts from a feed-forward point map and optimises
      poses with the Gaussians. AnySplat predicts Gaussians and poses in one network pass.
    - Why here: evidence that joint pose refinement in training fixes rough feed-forward poses.
      A pose parameter in training is a later step.
    - https://arxiv.org/abs/2403.20309 , https://arxiv.org/abs/2505.23716

### Optimisation

26. **The 2DGS optimisation** (item 2's paper and its code)
    - What: surfels from SfM points, a perspective-correct tile rasterizer (ray-splat intersection
      per pixel), a photometric loss (L1 and D-SSIM) plus a depth-distortion loss and a
      normal-consistency loss, 3DGS-style densification, Adam. Mesh by TSDF fusion of rendered
      depth maps (Open3D).
    - Collision: the reference code inherits the Inria licence of 3DGS, which is non-commercial.
      The engine writes its own code from the paper. gsplat (Apache-2.0) has a 2DGS mode to read.
    - https://github.com/hbb1/2d-gaussian-splatting , https://github.com/hbb1/diff-surfel-rasterization
27. **Brush** (Apache-2.0, Rust, Burn on wgpu)
    - Fact: trains 3DGS "natively, on mobile, and in a browser", from COLMAP or nerfstudio data.
    - Why here: proof that training on WebGPU-class hardware in a browser works. Its gradients come
      from Burn's autodiff and hand-written kernels, not from a shading language.
    - https://github.com/ArthurBrussee/brush
28. **Taming 3DGS** (2024), **3DGS-MCMC** (item 15), **3DGS-LM** (ICCV 2025)
    - What: a fixed budget of Gaussians (Taming, MCMC) and a faster optimiser (Levenberg-Marquardt).
    - Why here: a browser has a hard memory cap. A fixed capacity, allocated once, suits it and the
      runtime's buffer pool.
    - https://arxiv.org/abs/2406.15643 , https://arxiv.org/abs/2409.12892

**Gradient accumulation without float atomics** (items 1, 16, 26 and the CUDA reports on
`atomicAdd`).

- The forward pass of a pixel reads many Gaussians (a gather). Its adjoint adds into many
  Gaussians (a scatter). CUDA trainers use float `atomicAdd`, whose result depends on the order
  (https://github.com/YihangChen-ee/FCGS/blob/main/docs/atomic_statement.md).
- **Recommended: fixed point with integer atomics.** Scale each contribution to an integer and add
  it with `atomicAdd` on `i32`. Integer addition is associative and commutative, so the sum does
  not depend on the order, and two runs are bit-identical. Where the range needs it, two words make
  a 64-bit sum: add the low word, and add the carry to the high word when the returned old value
  wraps. Record 0005 rule 4 forbids atomics on the accumulation path, so it needs an amendment that
  admits order-independent integer atomics in training kernels.
- **Optional speed path: subgroup pre-reduction.** `subgroupAdd` of the integers in a subgroup, then
  one `atomicAdd` a subgroup. An integer sum is exact, so the bits stay the same. Record 0005 rule 6
  forbids subgroups in gated kernels, and TypeShade defers subgroups to after 1.0.
- **WebGPU features as of Chrome 153 and 154 (September 2026).** Still no float atomic. Shipped and
  relevant to training: subgroups (Chrome 134), `subgroup_id` (144), `subgroup_uniformity` (145),
  `subgroup_size_control` with `@subgroup_size` (151 and 152), immediates (149 and 150, small
  push-constant-like values), synchronous buffer mapping in workers (145, experimental),
  `buffer_view` (153 and 154, typed views of a storage buffer), `linear_indexing` (147 and 148).
  Subgroups, `subgroup_size_control` and immediates are compiler-side needs (record 0011, C8).
  https://developer.chrome.com/docs/web-platform/webgpu/news
- Sorted gather: write each (pixel tile, Gaussian) contribution to its own slot, sort by Gaussian,
  and reduce each segment in one order (record 0005, rule 5). Deterministic, more memory and a
  second sort.
- A float compare-and-swap loop: order-dependent, so not deterministic. Not proposed.

**The tape.** Reverse mode needs the values of the forward pass. For alpha compositing the
reference trainers store the final transmittance and the count of contributors of each pixel, and
re-walk the list backwards, recovering each step's transmittance by division by `1 - alpha`
(3DGS's backward pass). That is recompute with an invertible state, not a stored tape.

## Formats

| Format                          | What it is                                                                                                                                                                                                                                    | Size (claims)                           | Decoder the browser has                                     | Proposal                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------- | ---------------------------- |
| `.ply` (INRIA)                  | Binary little-endian PLY, 62 `float` properties a Gaussian: `x y z`, `nx ny nz`, `f_dc_0..2`, `f_rest_0..44`, `opacity` (logit), `scale_0..2` (log), `rot_0..3`                                                                               | 248 bytes a Gaussian at degree 3        | None needed. A `DataView` reads it                          | First. Every tool exports it |
| compressed `.ply`               | PlayCanvas's chunked, quantized PLY (256 Gaussians a chunk, min and max a chunk, packed words)                                                                                                                                                | about 4 times smaller than `.ply`       | None needed                                                 | Later                        |
| `.splat` (antimatter15)         | 32 bytes a Gaussian: position 3 `f32`, scale 3 `f32`, RGBA 4 `u8`, rotation 4 `u8`. No SH beyond degree 0                                                                                                                                     | 32 bytes a Gaussian                     | None needed                                                 | Second, as it is trivial     |
| `.ksplat` (GaussianSplats3D)    | Mark Kellogg's compressed buffer for three.js                                                                                                                                                                                                 | smaller than `.ply`                     | None needed                                                 | No                           |
| `.spz` (Niantic)                | Quantized attribute streams. Versions 1 to 3 are one gzip stream. Version 4 is ZSTD streams with a 32-byte header                                                                                                                             | about 10 times smaller than `.ply`      | `DecompressionStream('gzip')` for v1 to v3. No ZSTD decoder | v2 and v3 second. v4 waits   |
| SOG (PlayCanvas, from SOGS)     | `meta.json` and lossless WebP images: positions in two 8-bit halves, scales by codebook, quaternions, SH by a palette (k-means)                                                                                                               | 15 to 20 times smaller than `.ply`      | A WebP decoder (image decode, not in Node)                  | Later, with an image decoder |
| `KHR_gaussian_splatting` (glTF) | A point primitive with attributes `KHR_gaussian_splatting:ROTATION`, `:SCALE`, `:OPACITY`, `:SH_DEGREE_l_COEF_n`. Kernel `ellipse`, a required `colorSpace`. Release candidate. `KHR_spz_gaussian_splats_compression` carries SPZ inside glTF | as `.ply` (uncompressed), or SPZ inside | The glTF loader of addons                                   | Second, in the glTF loader   |

Facts behind the table: https://github.com/graphdeco-inria/gaussian-splatting ,
https://github.com/antimatter15/splat , https://github.com/nianticlabs/spz ,
https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog ,
https://blog.playcanvas.com/playcanvas-adopts-sogs-for-20x-3dgs-compression ,
https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_gaussian_splatting/README.md ,
https://github.com/mkkellogg/GaussianSplats3D .

**Collisions.** A package imports only `typeshade/runtime` and its siblings (`CLAUDE.md`). A ZSTD
or WebP decoder is a dependency the boundary refuses, or code the engine writes. `.ply`, `.splat`
and gzip `.spz` need neither. Large files also meet record 0006 item 3 (raw bytes as a host value):
until it lands, the host converts every Gaussian to a typed array of `vec4` once.

**Colour.** Most assets are trained on sRGB photographs, so the SH colour is display-referred sRGB.
KHR's `colorSpace` names it (`srgb_rec709_display` or `lin_rec709_display`). The path tracer works
in linear light, so the kernel converts the colour at the hit, after the SH sum (inference). The
sRGB curve uses `pow`, a value-only use under rule 2.

## Web viewers

| Viewer                               | API                          | Sort                                              | Mixes with meshes                  | Notes                                                                                               |
| ------------------------------------ | ---------------------------- | ------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| antimatter15/splat                   | WebGL                        | CPU, in a web worker, about 4 Hz                  | No                                 | The first web viewer and the `.splat` format. No SH                                                 |
| huggingface/gsplat.js                | WebGL                        | CPU worker                                        | No                                 | "three.js for splats". Last release 1.2.9 (2025-07)                                                 |
| mkkellogg/GaussianSplats3D           | WebGL, three.js              | CPU worker (WASM)                                 | Yes, by depth with three.js meshes | The `.ksplat` format. Its README now points to Spark                                                |
| Spark (World Labs)                   | WebGL2, three.js             | GPU and worker                                    | Yes, in three.js's pipeline        | `.ply`, `.spz`, `.splat`, `.ksplat`, SOG. Edits, skeletal animation, a shader graph, paged LOD      |
| PlayCanvas engine and SuperSplat 3.0 | WebGPU only (SuperSplat 3.0) | GPU radix sort, compute projection, indirect draw | Yes, in the engine                 | Streamed SOG with LOD. "Stochastic Alpha", a sort-free mode (2026-09)                               |
| WebSplatter (2026)                   | WebGPU                       | A wait-free hierarchical radix sort               | No                                 | Deterministic sort without global atomics (paper's claim). 1.2 to 4.5 times faster than web viewers |

URLs: https://github.com/antimatter15/splat , https://github.com/huggingface/gsplat.js ,
https://github.com/mkkellogg/GaussianSplats3D , https://sparkjs.dev/ ,
https://github.com/sparkjsdev/spark , https://radiancefields.com/playcanvas-releases-supersplat-3.0 ,
https://arxiv.org/abs/2602.03207 .

**Inference.** Real-time raster viewing of splats in the browser is a crowded and mature field, on
WebGL2 and WebGPU, with three.js integration (Spark). None of these viewers path-traces meshes
beside the splats, checks the image against a CPU reference, or promises bit-identical images. That
is the gap radiance's axes (plan section 2) fill.

## The options, ranked

The owner's decisions (training is in, gradients from the compiler) change the ranking. The
recommended option is the whole pipeline, with option B as its output.

### Recommended: the capture pipeline, 2DGS trained on the compiler's reverse-mode `grad`, rendered as ray-traced surfels

- What: stages 1 to 5 above. The trained surfels become a `Splats` of kernel kind "surfel" in the
  path tracer's TLAS (option B below), so path-traced meshes reflect them, receive their light and
  their shadow. Export as `.ply` and glTF. An optional TSDF mesh.
- Why 2DGS and not 3DGS: a surfel is met by a plane test, the same formula in the training
  rasterizer and in the path tracer. So the trained scene renders by ray tracing much as it was
  trained (inference). 3DGS trains with the EWA projection, which a ray does not reproduce. 2DGS
  also gives the normals and depth that a mesh and a later relighting need.
- Where: ingest, initialise, optimise and output in the browser (WebGPU) or on the M7 host. Poses
  on a server or the M7 host first, behind a dataset contract (COLMAP sparse model or
  `transforms.json`). Browser-only poses later.
- Milestone: render first (M3g, after M3), capture after M5 (proposal: M5c), in a new package
  `@typeshade/radiance-capture` beside `@typeshade/radiance-fit`.
- Cost: large. The training kernels, the sort, the accumulation and the budgets are each a
  medium piece. The compiler change is the largest dependency.
- Collisions and answers:
  - G: training waits on reverse mode in the compiler. The owner's direction is to pull it before
    1.0. What it must settle for this use (the record lists it): the tape (store, recompute or
    checkpoint), reverse through a runtime-length loop, the adjoint of a gather as a deterministic
    scatter, the API (a backward entry over buffers, or `vjp` of a function), the oracle's
    gradient check against finite differences, and the WebGL2 limits of change 0054.
  - A, D: the scatter of adjoints uses fixed-point integer atomics (`i32` `atomicAdd`,
    order-independent), with subgroup pre-reduction as an optional speed path, or a sorted gather
    on a tier without atomics. Record 0005 needs an amendment: rule 4 forbids atomics on the accumulation path of the
    image, and training adds a new accumulation path.
  - D: a training run is bit-identical on one device and driver for one seed. Across devices the
    optimisation amplifies one-ulp differences, so the promise there is statistical (a PSNR band).
  - B: a training entry binds the parameters, the adjoints, the moments, the tile lists and the
    image. Packing keeps it under eight.
  - Memory: about 1.2 KB a surfel at degree 3 with the adjoints and Adam's moments (inference), so
    a browser cap of about 500,000 surfels.
- Compiler changes (proposals for typeshade/typeshade `changes/`, to be opened by the owner's
  procedure, not by this survey): reverse-mode `grad` before 1.0, a sort primitive or a radix sort
  package, atomics on the CPU oracle with a defined result, device limits (record 0006 item 1),
  GPU time (item 5), the cost of thousands of dispatches (plan section 9), and subgroups,
  `subgroup_size_control` and immediates.

### Interim alternative: hand-written backward kernels

- What: write the adjoint of each training kernel by hand, as gsplat, Brush and the 3DGS CUDA code
  do, and check it against forward-mode `grad` and finite differences on the oracle.
- Cost: the backward kernels are about as large as the forward ones, and every change to the
  forward pass needs its twin. A record of each pair, and a gradient check per kernel. It does not
  wait on the compiler.
- Ranking: an interim path only, if the compiler's reverse mode is late. The owner decides.

### Option B: Gaussians as a ray-traced primitive inside the path tracer

- What: a `Splats` object holds a set of Gaussians, built into its own BLAS. The TLAS holds it as
  an instance with a flag, as it holds the analytic `Sphere` (record 0001, Amendment 3). The kernel
  tests a surfel on its plane (item 2), or a 3D Gaussian at its point of largest response (item 3).
  Each Gaussian a ray crosses is accepted with the chance of its alpha, by a hash of the ray and the
  Gaussian's index (item 7). The nearest accepted Gaussian ends the path with its SH radiance. A
  shadow ray is blocked by an accepted Gaussian.
- Why: it is the output stage of the recommended pipeline, and it also renders imported 3DGS assets.
  It uses what only radiance has: a path tracer around the splats, a CPU oracle and the determinism
  promise. It adds no storage buffer, no atomics and no sort.
- Milestone and layer: L1 (`intersect.shade.ts`, a new `splat.shade.ts`), L2 (`SplatGeometry`,
  `Splats`, the pack, the BLAS build), L3 addons (the loaders). Proposal: M3g after M3.
- Cost: medium.
- Collisions and answers:
  - D: the Bernoulli test reads a falloff written from sums and products on `[0, 9]`. No `exp`
    decides. The walk's result does not depend on the order of visits.
  - A: none used. G: the walk is not differentiated. B: no new buffer.
  - R: overlapping Gaussians make a BVH with large overlaps (inference). The speed is unmeasured.
- Compiler changes: none at the pin 596c805 by reading. `unpack2x16float` is a builtin
  (`vendor/typeshade/src/core/builtins/coredef.ts`), and a probe of its three outputs is owed.

### Option A: a raster splat viewer in the real-time tier (L6)

- What: the 3DGS raster pipeline on the runtime's `render()`, or StochasticSplats (item 10).
- Why last: it competes with Spark and PlayCanvas on their ground, and plan section 2 names "a
  real-time raster game engine, head-on with three.js" as what radiance is not. Note: the training
  rasterizer of the recommended pipeline is a compute tile rasterizer, so a fast preview of a
  trained scene comes with it at no extra record (inference).
- Compiler changes: a radix sort package. Blend state and instanced draws exist at the pin
  (`vendor/typeshade/src/runtime/program.ts`). Indirect draw was not found in `src/runtime/`.

### Tiers (the owner's note of 2026-10-09)

Training and rendering are not WebGPU-only in principle. WebGL2 (the compiler's change 0054) and the
CPU (the oracle, or change 0042's WebAssembly tier) are acceptable fallbacks, slower but better than
a failure. Inference, from no measurement: WebGL2 runs a dispatch as passes over textures, so it is
3 to 30 times slower. The CPU oracle took 20 to 38 seconds for a 16 by 16 render at 256 samples, so
it is 100 to 10,000 times slower. A fixed-point adjoint sum is an integer sum, so every tier gives
the same sum from the same contributions, by atomics, a sorted gather or a loop. Record 0011 has
the tier table and the owner's decision on the CPU as a training path.

## Avoid, and why

- The k-buffer of 3DGRT in the kernel: a sorted per-ray array and a `while`, slower in software
  and outside `grad`. The stochastic test gives the same expected image.
- `exp` in the acceptance test: rule 2. Use the polynomial falloff.
- Float or 64-bit atomics for splatting (items 1, 13): A and D.
- ZSTD and WebP decoders inside the engine: the boundary. `.spz` v4 and SOG wait for a decoder
  that is written here or for a sibling package.
- The 0.3 pixel screen-space dilation of the rasterizer: it has no meaning for a ray. The loader
  keeps the file's values, and Mip-Splatting's 3D filter is an option (item 14).
