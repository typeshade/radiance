# Licences of the assets

Each file in this directory has its own licence. The Apache-2.0 licence of this repository does not cover them.

Each asset has a script under `scripts/assets/`. The script builds the file again from the public source. The script checks the SHA-256 of the source and of the result.

| File        | Source                                                      | Licence                                                | Script                     | SHA-256 of the file                                                |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------ |
| `bunny.glb` | The Stanford 3D Scanning Repository, "Stanford Bunny" (PLY) | Stanford terms: free mirror, research, no sale (below) | `scripts/assets/bunny.mjs` | `c9fc2109db8f1c8c7f777a7c88c5cd5dfebca446390c096a33dec16219fbfef0` |

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
