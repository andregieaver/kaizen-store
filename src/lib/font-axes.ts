/**
 * A font file's variation axes (D59), read from its `fvar` table, and the part of the weight axis a site's family needs: what
 * `trimFontFiles()` cuts a self-hosted variable family to (`docs/performance.md`, Fonts found late). Pure: the bytes are an
 * uncompressed font (TrueType or OpenType, after woff2 is undone).
 */

export type FontAxis = { tag: string; min: number; default: number; max: number };

/** A font's variation axes, in its own order; none for a static font or bytes that are not a font. */
export function fontAxes(sfnt: Uint8Array): FontAxis[] {
  if (sfnt.byteLength < 12) return [];
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const tag = (at: number) => String.fromCharCode(...sfnt.subarray(at, at + 4));
  const tables = view.getUint16(4);
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (record + 16 > sfnt.byteLength) return [];
    if (tag(record) !== "fvar") continue;
    const offset = view.getUint32(record + 8);
    const end = offset + view.getUint32(record + 12);
    if (offset + 16 > end || end > sfnt.byteLength) return [];
    // The header: version (4 bytes), where the axes start, a reserved word, how many axes and each one's size.
    const first = offset + view.getUint16(offset + 4);
    const count = view.getUint16(offset + 8);
    const size = view.getUint16(offset + 10);
    const axes: FontAxis[] = [];
    for (let a = 0; a < count && size >= 20; a++) {
      const at = first + a * size;
      if (at + 20 > end) break;
      // Each value is a 16.16 fixed-point number.
      const fixed = (o: number) => view.getInt32(at + o) / 65536;
      axes.push({ tag: tag(at), min: fixed(4), default: fixed(8), max: fixed(12) });
    }
    return axes;
  }
  return [];
}

/**
 * The part of a font's weight axis to keep for a family installed in `weights` (the lightest to the heaviest of its styles), or null
 * when there is nothing to cut: no weight axis, one already within them, or one that misses them (left as Google sent it). A range of
 * one weight makes the file that weight alone.
 */
export function trimRange(axes: readonly FontAxis[], weights: { min: number; max: number }): { min: number; max: number } | null {
  const wght = axes.find((axis) => axis.tag === "wght");
  if (!wght) return null;
  const min = Math.max(wght.min, weights.min);
  const max = Math.min(wght.max, weights.max);
  if (min > max || (min === wght.min && max === wght.max)) return null;
  return { min, max };
}
