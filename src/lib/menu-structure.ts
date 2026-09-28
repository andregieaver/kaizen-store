import { MENU_MAX_DEPTH, soundDepths } from "./navigation";

/**
 * Moving items in a menu's structure (D85), as the menu editor does: an
 * item always moves with the items under it, and depths stay sound (the
 * first at the top, none more than one deeper than the one before, none
 * deeper than `MENU_MAX_DEPTH`). Pure, so the editor and its tests share it.
 */

type Placed = { depth: number };

/** Where the items under `index` end: the first index after them. */
export function subtreeEnd(items: readonly Placed[], index: number): number {
  let end = index + 1;
  while (end < items.length && items[end].depth > items[index].depth) end++;
  return end;
}

/** How much deeper than the item the deepest item under it sits. */
function subtreeDepth(items: readonly Placed[], index: number): number {
  const end = subtreeEnd(items, index);
  let deepest = items[index].depth;
  for (let i = index + 1; i < end; i++) deepest = Math.max(deepest, items[i].depth);
  return deepest - items[index].depth;
}

/**
 * Moves the item at `from`, with the items under it, to `to` in the list
 * without them, at `depth` (the items under it keep their places under it).
 */
export function moveItem<T extends Placed>(items: readonly T[], from: number, to: number, depth: number): T[] {
  const end = subtreeEnd(items, from);
  const shift = depth - items[from].depth;
  const moving = items.slice(from, end).map((item) => (shift === 0 ? item : { ...item, depth: item.depth + shift }));
  const rest = [...items.slice(0, from), ...items.slice(end)];
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, ...moving);
  return soundDepths(rest);
}

/**
 * The depth a dragged item takes when dropped at `to` (in the list without
 * it and the items under it), from the depth the pointer suggests: at most
 * one under the item before it, and at least as deep as the item after it,
 * so that one keeps its place; its own items must still fit under it.
 */
export function dropDepth(items: readonly Placed[], from: number, to: number, wanted: number): number {
  const end = subtreeEnd(items, from);
  const rest = [...items.slice(0, from), ...items.slice(end)];
  const before = rest[to - 1];
  const after = rest[to];
  const most = before ? Math.min(before.depth + 1, MENU_MAX_DEPTH - subtreeDepth(items, from)) : 0;
  const least = after ? after.depth : 0;
  return Math.max(0, Math.min(Math.max(wanted, least), most));
}

/** The item at the same depth just before `index`, under the same parent, if any. */
export function previousSibling(items: readonly Placed[], index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].depth === items[index].depth) return i;
    if (items[i].depth < items[index].depth) return null;
  }
  return null;
}

/** The item at the same depth just after `index` and the items under it, under the same parent, if any. */
export function nextSibling(items: readonly Placed[], index: number): number | null {
  const end = subtreeEnd(items, index);
  return end < items.length && items[end].depth === items[index].depth ? end : null;
}

/** The item `index` sits under, if any. */
export function parentOf(items: readonly Placed[], index: number): number | null {
  for (let i = index - 1; i >= 0; i--) if (items[i].depth < items[index].depth) return i;
  return null;
}

/** The moves the editor offers for an item (as WordPress's menu editor does), each null where it cannot. */
export type MenuMoves<T> = { up: T[] | null; down: T[] | null; under: T[] | null; out: T[] | null; top: T[] | null };

export function menuMoves<T extends Placed>(items: readonly T[], index: number): MenuMoves<T> {
  const item = items[index];
  const before = previousSibling(items, index);
  const after = nextSibling(items, index);
  const parent = parentOf(items, index);
  return {
    // Before the sibling before it.
    up: before === null ? null : moveItem(items, index, before, item.depth),
    // After the sibling after it and the items under that one.
    down: after === null ? null : moveItem(items, index, subtreeEnd(items, after) - (subtreeEnd(items, index) - index), item.depth),
    // Under the sibling before it, after its own items.
    under:
      before === null || item.depth + 1 + subtreeDepth(items, index) > MENU_MAX_DEPTH
        ? null
        : moveItem(items, index, index, item.depth + 1),
    // Out from under its parent: just after the parent's other items, so they stay under it.
    out:
      parent === null
        ? null
        : moveItem(items, index, subtreeEnd(items, parent) - (subtreeEnd(items, index) - index), items[parent].depth),
    top: index === 0 ? null : moveItem(items, index, 0, 0),
  };
}
