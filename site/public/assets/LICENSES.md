# Licences of the assets

Each file in this directory has its own licence. The Apache-2.0 licence of this repository does not cover them.

Each asset has a script under `scripts/assets/`. The script builds the file again from the public source. The script checks the SHA-256 of the source and of the result.

| File         | Source                                                                                | Licence                                                          | Script                      | SHA-256 of the file                                                |
| ------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `bunny.glb`  | The Stanford 3D Scanning Repository, "Stanford Bunny" (PLY)                           | Stanford terms: free mirror, research, no sale (below)           | `scripts/assets/bunny.mjs`  | `c9fc2109db8f1c8c7f777a7c88c5cd5dfebca446390c096a33dec16219fbfef0` |
| `sponza.glb` | The Computer Graphics Archive of Morgan McGuire, model "Crytek Sponza" (`sponza.zip`) | CC BY 3.0, (c) 2010 Frank Meinl, Crytek. Credit required (below) | `scripts/assets/sponza.mjs` | `581b0eb4817fb92223412f1be15a39557c115d6555c099ce7f114885fce7f5bd` |

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

The file is the geometry of the Atrium Sponza Palace, Dubrovnik, without a texture. It holds 227,327 triangles and 147,804 vertices in 22 primitives, one for each material.

- Source: `https://casual-effects.com/g3d/data10/common/model/crytek_sponza/sponza.zip`, the "Crytek Sponza" model of the Computer Graphics Archive of Morgan McGuire (`https://casual-effects.com/data/`). The script reads `sponza.obj` and `sponza.mtl` from the archive.
- SHA-256 of `sponza.zip`: `da005cbee0be2df2abc8513f3ceb61bcb6f69aac112babcd9c00169a27c2770c`.
- SHA-256 of `sponza.obj`: `dc9d77fa783772e92f47e67ddef8344858fa14e224711b5dd7d39f7db7042493`.
- SHA-256 of `sponza.mtl`: `7e5d765a00bf2af1c0cae1696051fdf04c5bb358cf2bc5cc2634ea8715669d9b`.
- Size of the file: 4,928,084 bytes.
- Licence: Creative Commons Attribution 3.0 Unported (`https://creativecommons.org/licenses/by/3.0/`). The archive describes the model in `https://casual-effects.com/g3d/data10/common/model/crytek_sponza/info.js`, read on 2026-10-06. That description gives the copyright as "(c) 2010 Frank Meinl, Crytek" and the licence as "CC BY 3.0".
- Credit: the Atrium Sponza Palace, Dubrovnik, by Frank Meinl (Crytek), 2010. It follows the Sponza model of Marko Dabrovic (RNA Studio, 2002). Morgan McGuire corrected it in 2011 and made the archive file. This repository changed it as the last paragraph of this section says.

A second source gives the same geometry under another licence. The Khronos glTF-Sample-Assets repository lists its Sponza model under the Cryengine Limited License Agreement (`LicenseRef-CRYENGINE-Agreement`, (c) 2016 Crytek). That agreement does not say whether a copy of the model may be redistributed on its own. This repository does not use that source. It uses the archive file, whose licence is CC BY 3.0. The two statements differ. The owner approved the archive source for the site on 2026-10-06.

The script keeps the positions of the source. It scales the normals to length 1. It leaves out the faces of the three alpha-masked materials (34,940 triangles), because a cut-out needs its texture. It splits each quad into two triangles and joins the faces that share a material. It leaves out the texture coordinates and gives each material a flat colour. The colour is the mean of the material's diffuse texture. Run `bun scripts/assets/sponza.mjs --check` to compare the file with a new build.
