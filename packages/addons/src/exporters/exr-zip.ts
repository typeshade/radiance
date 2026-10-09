// === The ZIP form of an EXR block ===
//
// Design record 0010, Part 5 ('The zip form'). A ZIP block holds up to 16 scan lines. Its bytes
// are first reordered: the bytes at even positions, then the bytes at odd positions. A predictor
// then stores each byte as its difference from the byte before it, plus 128, modulo 256. The
// result is a zlib stream (RFC 1950), which the platform's `CompressionStream('deflate')` makes.
// The reordering, the predictor and the zlib stream follow the OpenEXR library's `ImfZip.cpp`.

/** The reordering and the predictor of the writer. `raw` is not changed. */
export function zipPrepare(raw: Uint8Array): Uint8Array {
  const n = raw.length;
  const t = new Uint8Array(n);
  const half = (n + 1) >> 1;
  for (let s = 0, a = 0, b = half; s < n;) {
    t[a++] = raw[s++]!;
    if (s < n) t[b++] = raw[s++]!;
  }
  // Backwards, so that each byte is read before its predecessor changes.
  for (let i = n - 1; i >= 1; i--) t[i] = (t[i]! - t[i - 1]! + 128) & 0xff;
  return t;
}

/** The inverse of `zipPrepare`: the predictor, then the reordering. */
export function zipRestore(t: Uint8Array): Uint8Array {
  const n = t.length;
  for (let i = 1; i < n; i++) t[i] = (t[i - 1]! + t[i]! - 128) & 0xff;
  const raw = new Uint8Array(n);
  const half = (n + 1) >> 1;
  for (let s = 0, a = 0, b = half; s < n;) {
    raw[s++] = t[a++]!;
    if (s < n) raw[s++] = t[b++]!;
  }
  return raw;
}

async function transform(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as never);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * The bytes of one ZIP block as the file stores them. The zlib stream when it is shorter than
 * `raw`, else `raw` itself, as OpenEXR stores whichever is smaller. The reader tells the two
 * apart by the packed size, which is `raw.length` for a block that is not compressed.
 */
export async function zipCompressBlock(raw: Uint8Array): Promise<Uint8Array> {
  const z = await transform(zipPrepare(raw), new CompressionStream('deflate'));
  return z.length < raw.length ? z : raw;
}

/** The raw bytes of a ZIP block whose packed form is `packed`, which holds `rawLength` bytes. */
export async function zipDecompressBlock(
  packed: Uint8Array,
  rawLength: number,
): Promise<Uint8Array> {
  const t = await transform(packed, new DecompressionStream('deflate'));
  if (t.length !== rawLength) {
    throw new Error(
      `EXRLoader: a ZIP block inflates to ${t.length} bytes, the header says ${rawLength}`,
    );
  }
  return zipRestore(t);
}

type GenericTransformStream = { readable: ReadableStream; writable: WritableStream };
