import { describe, expect, it } from "vitest";

import { dropDepth, menuMoves, moveItem, subtreeEnd } from "./menu-structure";
import { menuTree, soundDepths } from "./navigation";

/** A menu written as "name:depth". */
const menu = (...items: string[]) => items.map((item) => ({ name: item.split(":")[0], depth: Number(item.split(":")[1]) }));
const show = (items: { name: string; depth: number }[] | null) => items?.map((i) => `${i.name}:${i.depth}`) ?? null;

describe("menu structure (D85)", () => {
  const items = menu("A:0", "A1:1", "A2:1", "A2a:2", "B:0", "C:0", "C1:1");

  it("finds the items under an item", () => {
    expect(subtreeEnd(items, 0)).toBe(4);
    expect(subtreeEnd(items, 2)).toBe(4);
    expect(subtreeEnd(items, 4)).toBe(5);
  });

  it("moves an item with the items under it", () => {
    expect(show(moveItem(items, 0, 1, 0))).toEqual(["B:0", "A:0", "A1:1", "A2:1", "A2a:2", "C:0", "C1:1"]);
    // Dropped under B, A's items go one deeper with it; too deep is cut to the deepest there is.
    expect(show(moveItem(items, 0, 1, 1))).toEqual(["B:0", "A:1", "A1:2", "A2:2", "A2a:2", "C:0", "C1:1"]);
  });

  it("keeps a dropped item's depth between the item before and the one after", () => {
    // Between A2a and B: at most under A2 (2), at least B's (0).
    expect(dropDepth(items, 4, 4, 5)).toBe(2);
    expect(dropDepth(items, 4, 4, -1)).toBe(0);
    // Before A1, a child of A: at least as deep as A1, so A1 keeps its place.
    expect(dropDepth(items, 4, 1, 0)).toBe(1);
    // First in the menu: at the top.
    expect(dropDepth(items, 4, 0, 2)).toBe(0);
    // A with two levels under it can only sit at the top.
    expect(dropDepth(items, 0, 1, 1)).toBe(0);
  });

  it("offers WordPress's moves", () => {
    const b = menuMoves(items, 4);
    expect(show(b.up)).toEqual(["B:0", "A:0", "A1:1", "A2:1", "A2a:2", "C:0", "C1:1"]);
    expect(show(b.down)).toEqual(["A:0", "A1:1", "A2:1", "A2a:2", "C:0", "C1:1", "B:0"]);
    expect(show(b.under)).toEqual(["A:0", "A1:1", "A2:1", "A2a:2", "B:1", "C:0", "C1:1"]);
    expect(b.out).toBeNull();
    expect(show(b.top)).toEqual(["B:0", "A:0", "A1:1", "A2:1", "A2a:2", "C:0", "C1:1"]);

    const a1 = menuMoves(items, 1);
    expect(a1.up).toBeNull();
    // Out from under A, after A's other items, which stay under A.
    expect(show(a1.out)).toEqual(["A:0", "A2:1", "A2a:2", "A1:0", "B:0", "C:0", "C1:1"]);
    expect(show(a1.down)).toEqual(["A:0", "A2:1", "A2a:2", "A1:1", "B:0", "C:0", "C1:1"]);

    // A2 has a level under it already: under A1 would be too deep.
    expect(menuMoves(items, 2).under).toBeNull();
    expect(menuMoves(items, 0).top).toBeNull();
  });

  it("makes stored depths sound and builds the tree, lifting what is left out", () => {
    expect(show(soundDepths(menu("A:1", "B:3", "C:2")))).toEqual(["A:0", "B:1", "C:2"]);
    const tree = menuTree(items, (item) => item.name !== "A2");
    expect(tree.map((n) => [n.item.name, n.children.map((c) => c.item.name)])).toEqual([
      ["A", ["A1", "A2a"]],
      ["B", []],
      ["C", ["C1"]],
    ]);
  });
});
