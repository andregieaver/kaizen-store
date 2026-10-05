import { backdropKey, buildReplica, type BuildInput, type BuildOutput, type PartInfo } from "./replicate-build";
import { walk, type Box, type PageCapture } from "./replicate-capture";
import { stretchMatch, type Raster } from "./replicate-diff";
import { renderStyles } from "./replicate-styles";

/**
 * Rows kept as a picture (D164). Some pages cannot be built from boxes and words (a hero of two pictures with a headline between, a slider, a video behind a card, a
 * collage). A row that, after the page was corrected by measuring, still matches the original under `BACKDROP_BELOW` is built as the strip of the original photographed
 * with its words not painted, with the original's words laid over it where they stood (`buildReplica()`'s `backdrop`). This chooses the rows.
 */

/**
 * A row that matches the original under this much, at computers' or at phones' width, is kept as a picture of the original with its words laid over it. Twice in a job:
 * first the rows that clearly fail, as soon as the page has been corrected once; then, on the last pass the measuring can still correct after, those that stayed under the higher one.
 */
export const BACKDROP_BELOW = { first: 70, last: 82 } as const;
/** Rows shorter than this are not worth a picture: a spacer or a rule. */
export const BACKDROP_MIN_HEIGHT = 40;

/** The photograph of the original and of the copy, as small pictures, at one width. */
export type Side = { original: Raster; copy: Raster; scale: number };

export type WeakRow = { part: PartInfo; desktop: number | null; phone: number | null };

const boxById = (capture: PageCapture, id: string): Box | null => {
  for (const n of walk(capture.root)) if (n.id === id) return n.box;
  return null;
};

/**
 * The rows of the copy that match the original under `below`: each row's place in the original against the same stretch of the copy at the row's own top (a row
 * below a taller one has drifted, which is for the measuring to correct, not a reason to throw the row away).
 */
export function weakRows(parts: PartInfo[], desktop: Side, phone: Side | null, copyDesktop: PageCapture, copyMobile: PageCapture | null, below: number): WeakRow[] {
  const found: WeakRow[] = [];
  for (const part of parts) {
    if (part.kind !== "row" || !part.target || part.target[3] < BACKDROP_MIN_HEIGHT) continue;
    const at = (side: Side | null, target: Box | null, copy: PageCapture | null) => {
      if (!side || !target || !copy) return null;
      const place = boxById(copy, part.id);
      return stretchMatch(side.original, side.copy, side.scale, target[1], target[3], place ? place[1] : target[1]);
    };
    const d = at(desktop, part.target, copyDesktop);
    const p = at(phone, part.targetM, copyMobile);
    if ((d !== null && d < below) || (p !== null && p < below)) found.push({ part, desktop: d, phone: p });
  }
  return found;
}

/**
 * The page built with its rows kept as pictures, fitted into the page's CSS: a row's words laid by their places cost rules (a row of a hundred words, with the phones' places, may
 * not fit in the 50 KB a page's CSS may hold). The page is built with every row as words over its picture; while the style would lose more than it did without any picture rows
 * (the phones' layout, or the last parts' sizes), the row with the most words becomes only its picture (with its words hidden, for screen readers and search), and the page is built again.
 */
export function buildFitted(input: BuildInput, newId: () => string): { built: BuildOutput; styled: ReturnType<typeof renderStyles>; plain: string[] } {
  const without = { ...input, backdrop: undefined, backdropPlain: undefined };
  const plainBuilt = buildReplica(without, newId);
  const baseline = renderStyles(plainBuilt.model, plainBuilt.shared).level;
  const allowed = Math.max(baseline, 1);
  const plain = new Set<string>(input.backdropPlain ?? []);
  for (;;) {
    const built = buildReplica({ ...input, backdropPlain: plain }, newId);
    const styled = renderStyles(built.model, built.shared);
    if (styled.level <= allowed) return { built, styled, plain: [...plain] };
    // The row with the most words among those that are still words over a picture.
    const cost = new Map<string, number>();
    for (const part of built.parts) {
      if (part.kind !== "row" || !part.target || !part.label?.includes("kept as a picture")) continue;
      const key = backdropKey(part.path, part.target[1]);
      if (plain.has(key) || !input.backdrop?.(key)?.plain) continue;
      cost.set(key, built.parts.filter((x) => x.kind === "block" && x.row === part.id).length);
    }
    const next = [...cost.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!next) return { built, styled, plain: [...plain] };
    plain.add(next[0]);
  }
}
