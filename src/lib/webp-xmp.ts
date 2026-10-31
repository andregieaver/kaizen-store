/**
 * An XMP packet written into a WebP file without decoding or re-encoding its picture (AI Act Art. 50(2), `docs/ai-act.md`): the file's RIFF
 * chunks are rearranged, the image data is copied byte for byte. A simple file (`VP8 ` or `VP8L` alone) gets the extended header (`VP8X`)
 * the format asks for before metadata; an extended one has its XMP flag set and any earlier XMP replaced. Pure. (RFC 9649, the WebP
 * container: chunks are a four-letter code, a 32-bit little-endian size and the data, padded to an even length.)
 */

type Chunk = { code: string; data: Uint8Array };

const FLAG_XMP = 0x04;
const FLAG_ALPHA = 0x10;

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const readU32 = (bytes: Uint8Array, at: number) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

/** The file's chunks in order; throws on anything that is not a whole WebP file. */
function chunksOf(webp: Uint8Array): Chunk[] {
  if (webp.length < 20 || ascii(webp, 0, 4) !== "RIFF" || ascii(webp, 8, 4) !== "WEBP") throw new Error("Not a WebP file.");
  const end = Math.min(webp.length, 8 + readU32(webp, 4));
  const chunks: Chunk[] = [];
  let at = 12;
  while (at + 8 <= end) {
    const code = ascii(webp, at, 4);
    const size = readU32(webp, at + 4);
    if (at + 8 + size > end) throw new Error("A WebP chunk runs past the end of the file.");
    chunks.push({ code, data: webp.subarray(at + 8, at + 8 + size) });
    at += 8 + size + (size % 2);
  }
  if (chunks.length === 0) throw new Error("A WebP file without chunks.");
  return chunks;
}

function joined(chunks: Chunk[]): Uint8Array {
  const body = chunks.reduce((sum, c) => sum + 8 + c.data.length + (c.data.length % 2), 0);
  const out = new Uint8Array(12 + body);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 4 + body, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  let at = 12;
  for (const chunk of chunks) {
    for (let i = 0; i < 4; i++) out[at + i] = chunk.code.charCodeAt(i);
    view.setUint32(at + 4, chunk.data.length, true);
    out.set(chunk.data, at + 8);
    at += 8 + chunk.data.length + (chunk.data.length % 2);
  }
  return out;
}

/** The extended header for a simple file: XMP (and alpha when the picture has it), the canvas size less one in 24 bits each. */
function extendedHeader(canvas: { width: number; height: number; alpha: boolean }): Uint8Array {
  const { width, height } = canvas;
  if (!(width >= 1 && width <= 2 ** 24 && height >= 1 && height <= 2 ** 24)) throw new Error("A WebP canvas size out of range.");
  const data = new Uint8Array(10);
  data[0] = FLAG_XMP | (canvas.alpha ? FLAG_ALPHA : 0);
  const w = width - 1;
  const h = height - 1;
  data.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4);
  return data;
}

/** The file with `xmp` as its XMP metadata, the picture's own bytes unchanged. */
export function withWebpXmp(webp: Uint8Array, xmp: string, canvas: { width: number; height: number; alpha: boolean }): Uint8Array {
  const chunks = chunksOf(webp);
  const packet = { code: "XMP ", data: new TextEncoder().encode(xmp) };
  if (chunks[0].code === "VP8X") {
    const header = new Uint8Array(chunks[0].data);
    header[0] |= FLAG_XMP;
    return joined([{ code: "VP8X", data: header }, ...chunks.slice(1).filter((c) => c.code !== "XMP "), packet]);
  }
  if (chunks[0].code !== "VP8 " && chunks[0].code !== "VP8L") throw new Error("A WebP file of an unknown kind.");
  return joined([{ code: "VP8X", data: extendedHeader(canvas) }, ...chunks.filter((c) => c.code !== "XMP "), packet]);
}

/** The file's XMP packet as text, or null when it has none. */
export function webpHasXmp(webp: Uint8Array): string | null {
  const chunk = chunksOf(webp).find((c) => c.code === "XMP ");
  return chunk ? new TextDecoder().decode(chunk.data) : null;
}
