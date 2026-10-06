# Licences of the assets

Each file in this directory has its own licence. The Apache-2.0 licence of this repository does not cover them.

Each asset has a script under `scripts/assets/`. The script builds the file again from the public source. The script checks the SHA-256 of the source and of the result.

| File         | Source                                                                                                       | Licence                                                                            | Script                      | SHA-256 of the file                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `bunny.glb`  | The Stanford 3D Scanning Repository, "Stanford Bunny" (PLY)                                                  | Stanford terms: free mirror, research, no sale (below)                             | `scripts/assets/bunny.mjs`  | `c9fc2109db8f1c8c7f777a7c88c5cd5dfebca446390c096a33dec16219fbfef0` |
| `sponza.glb` | The Khronos glTF-Sample-Assets repository, model "Sponza", commit `edc7c9e67c639d230715049ee31f9a96a6babbbe` | Cryengine Limited License Agreement, (c) 2016 Crytek. Not Creative Commons (below) | `scripts/assets/sponza.mjs` | `162a13362fdd4d624e381555f2785004b2d617f90666350facf422a907ff6486` |

## bunny.glb

The file is the Stanford Bunny, the zippered reconstruction `bun_zipper.ply` of 35,947 vertices and 69,451 triangles. The Stanford Computer Graphics Laboratory made the model.

- Source: `https://graphics.stanford.edu/pub/3Dscanrep/bunny.tar.gz`, linked from `https://graphics.stanford.edu/data/3Dscanrep/`.
- SHA-256 of the source archive: `a5720bd96d158df403d153381b8411a727a1d73cff2f33dc9b212d6f75455b84`.
- Size of the file: 1,280,584 bytes.
- Credit: Stanford University Computer Graphics Laboratory.

The terms of the repository, as its page states them:

- You may use the models for research.
- You may mirror or redistribute them for free.
- You may publish images of them in a scholarly article or book, with credit to the Stanford Computer Graphics Laboratory.
- You may not use them for a commercial purpose, nor put them in a product for sale, without the permission of the laboratory.

This repository redistributes the file for free, with this credit. A commercial use of the file needs the permission of the Stanford Computer Graphics Laboratory.

The script converts the model and changes no vertex. It adds the vertex normals, one material and a node with a scale and a translation. Run `node scripts/assets/bunny.mjs --check` to compare the file with a new build.

## sponza.glb

The file is the geometry of the Atrium Sponza Palace, Dubrovnik, without a texture. It holds 227,327 triangles and 164,338 vertices in 22 primitives, one for each material.

- Source: `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/Sponza`. The files are `glTF/Sponza.gltf` and `glTF/Sponza.bin`.
- SHA-256 of `Sponza.gltf`: `646c10cbc8fab990ca29f363e90e2d65155f3a3569506852eb1434a9465b9501`.
- SHA-256 of `Sponza.bin`: `fdbdbfb6a76edeb6626f28a1401bc1536bb1c864131a64e90fbc3df2d2d191bd`.
- Size of the file: 5,324,768 bytes.
- Credit, from the README of the model: the Atrium Sponza Palace, Dubrovnik, by Frank Meinl (Crytek). It follows the Sponza model of Marko Dabrovic (RNA Studio, 2002). Morgan McGuire corrected it in 2011. The Khronos Group made the glTF file from the PBR texture pack of Alexandre Pestana.
- Copyright, from the `LICENSE.md` of the model: (c) 2016 Crytek, under the Cryengine Limited License Agreement (`LicenseRef-CRYENGINE-Agreement`, `https://www.cryengine.com/ce-terms`).

This licence is not Creative Commons. An earlier note in this repository (`docs/plan.md`, "Demo asset licences") says that Sponza is CC-BY. The model's own README and `LICENSE.md` do not say so. The Cryengine agreement licenses the CRYENGINE and the games made with it. It does not say whether a copy of the model may be redistributed on its own. This repository has not asked Crytek. The owner decides whether the site may publish the file before it is pushed.

The script keeps the vertices and the normals as the source has them. It leaves out the primitives of the three alpha-masked materials (14 primitives, 34,940 triangles), because a cut-out needs its texture. It joins the primitives that share a material, leaves out the texture coordinates and the tangents, and gives each material a flat colour. The colour is the mean of the material's diffuse texture. Run `node scripts/assets/sponza.mjs --check` to compare the file with a new build.
