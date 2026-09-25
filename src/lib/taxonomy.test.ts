import { describe, expect, it } from "vitest";

import { categoryTree, knownIds, selfAndDescendants, termInput, withDescendants, type Term } from "./taxonomy";

const term = (id: string, name: string, parentId: string | null = null, kind: Term["kind"] = "category"): Term => ({
  id,
  kind,
  parentId,
  name,
  slug: id,
});

const terms = [
  term("lamps", "Lamps"),
  term("desk", "Desk lamps", "lamps"),
  term("floor", "Floor lamps", "lamps"),
  term("reading", "Reading", "desk"),
  term("chairs", "Chairs"),
  term("orphan", "Orphan", "gone"),
  term("sale", "Sale", null, "tag"),
];

describe("categories and tags (D50)", () => {
  it("lists categories each after its parent, siblings by name, with their depth", () => {
    expect(categoryTree(terms).map((t) => `${t.depth}:${t.id}`)).toEqual([
      "0:chairs",
      "0:lamps",
      "1:desk",
      "2:reading",
      "1:floor",
      "0:orphan",
    ]);
  });

  it("includes subcategories, however deep, when filtering by a category", () => {
    expect(withDescendants(terms, ["lamps"]).sort()).toEqual(["desk", "floor", "lamps", "reading"]);
    expect(withDescendants(terms, ["chairs"])).toEqual(["chairs"]);
    expect(selfAndDescendants(terms, "desk")).toEqual(new Set(["desk", "reading"]));
  });

  it("keeps only known ids of a kind, once", () => {
    expect(knownIds(terms, "tag", ["sale", "sale", "lamps", "gone"])).toEqual(["sale"]);
  });

  it("makes an address from the name, and keeps tags flat", () => {
    expect(termInput.parse({ kind: "category", name: " Blåbær & Co " })).toMatchObject({ name: "Blåbær & Co", slug: "blabaer-co" });
    expect(termInput.parse({ kind: "tag", name: "New", parentId: "00000000-0000-4000-8000-000000000000" }).parentId).toBeNull();
    expect(termInput.safeParse({ kind: "tag", name: "New", slug: "Not ok" }).success).toBe(false);
    expect(termInput.safeParse({ kind: "tag", name: "!!!" }).success).toBe(false);
    expect(termInput.safeParse({ kind: "tag", name: "" }).success).toBe(false);
  });
});
