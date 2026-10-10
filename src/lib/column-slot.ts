/**
 * Where a dropped column goes among a row's columns, from where the pointer is on the canvas (D187, D189): the line it is in (else
 * the nearest) and how many of that line's columns come before it, as the columns lie there, side by side or one under another.
 * It works on the boxes the browser measured, so the gaps between columns, the room around them and the empty space under a
 * short column all count: a column dropped there goes in at that place, not last. Pure; the builder measures and draws.
 */

/** A box on the screen, as the browser measures it. */
export type Box = { left: number; right: number; top: number; bottom: number };
export type Point = { x: number; y: number };

/** One line of a row's columns on the canvas: their ids in order and where each is. */
export type SlotLine = { ids: readonly string[]; boxes: readonly Box[] };

/** The place a column takes: in `line`, with `index` columns of it before (0 is first, the line's length is last). */
export type ColumnSlot = { line: number; index: number };

/** Whether a line's columns lie one under another (a row that stacks, as on a phone) rather than side by side. */
export function isStacked(boxes: readonly Box[]): boolean {
  return boxes.length > 1 && boxes.every((box, i) => i === 0 || box.top >= boxes[i - 1].bottom - 1);
}

/** How far a point is from a line's band across the page (0 within it). */
function distanceTo(boxes: readonly Box[], y: number): number {
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return y < top ? top - y : y > bottom ? y - bottom : 0;
}

/**
 * The slot a pointer points at: the line whose band it is in (the nearest where it is between two or outside them), and in it the
 * number of columns whose middle is before the pointer (to its left, or above it where they are stacked). Null where there are
 * no columns to measure.
 */
export function columnSlotAt(lines: readonly SlotLine[], point: Point): ColumnSlot | null {
  let line = -1;
  let nearest = Infinity;
  lines.forEach((candidate, i) => {
    if (candidate.boxes.length === 0) return;
    const distance = distanceTo(candidate.boxes, point.y);
    if (distance < nearest) {
      nearest = distance;
      line = i;
    }
  });
  if (line < 0) return null;
  const { boxes } = lines[line];
  const stacked = isStacked(boxes);
  const index = boxes.filter((box) => (stacked ? (box.top + box.bottom) / 2 : (box.left + box.right) / 2) < (stacked ? point.y : point.x)).length;
  return { line, index };
}

/**
 * The column a drop indicator is drawn on for a slot: before the column that takes the slot's place, or after the line's last
 * where the slot is the end of it. Null for a line with no columns.
 */
export function slotAnchor(line: SlotLine | undefined, index: number): { id: string; after: boolean } | null {
  if (!line || line.ids.length === 0) return null;
  return index < line.ids.length ? { id: line.ids[index], after: false } : { id: line.ids[line.ids.length - 1], after: true };
}
