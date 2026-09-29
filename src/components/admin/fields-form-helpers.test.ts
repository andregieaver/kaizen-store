import { describe, expect, it } from "vitest";

import { newField, type FieldData, type FieldLookups } from "@/lib/custom-fields";

import {
  editableSubs,
  fileProblem,
  filterOptions,
  idsOf,
  linkOptions,
  ownView,
  relationOptions,
  relationValue,
  rowLimits,
  rowsNeeded,
  withCell,
} from "./fields-form-helpers";

const lookups: FieldLookups = {
  products: [
    { id: "p1", title: "Wool sock" },
    { id: "p2", title: "Crème brûlée set" },
  ],
  pages: [
    { id: "g1", title: "About", type: "page" },
    { id: "g2", title: "News", type: "article" },
  ],
  terms: [
    { id: "t1", name: "Socks", kind: "category" },
    { id: "t2", name: "Organic", kind: "tag" },
  ],
};

describe("the entry form's helpers (D118)", () => {
  it("lists what a link can point at, by kind", () => {
    expect(linkOptions("product", lookups).map((o) => o.label)).toEqual(["Wool sock", "Crème brûlée set"]);
    expect(linkOptions("page", lookups).map((o) => o.label)).toEqual(["About", "News (article)"]);
    expect(linkOptions("category", lookups)).toEqual([{ id: "t1", label: "Socks" }]);
    expect(linkOptions("tag", lookups)).toEqual([{ id: "t2", label: "Organic" }]);
  });

  it("lists what a relational field offers, a category or tag field by the kinds it allows", () => {
    expect(relationOptions({ type: "product" }, lookups)).toHaveLength(2);
    expect(relationOptions({ type: "term", termKinds: ["tag"] }, lookups)).toEqual([{ id: "t2", label: "Organic" }]);
    expect(relationOptions({ type: "term", termKinds: ["category"] }, lookups)).toEqual([{ id: "t1", label: "Socks" }]);
    // Both kinds: each is told apart.
    expect(relationOptions({ type: "term" }, lookups).map((o) => o.label)).toEqual([
      "Socks (category)",
      "Organic (tag)",
    ]);
    expect(relationOptions({ type: "term", termKinds: ["category", "tag"] }, lookups)).toHaveLength(2);
  });

  it("searches by every word, ignoring case and accents", () => {
    const options = linkOptions("product", lookups);
    expect(filterOptions(options, "")).toHaveLength(2);
    expect(filterOptions(options, "  ")).toHaveLength(2);
    expect(filterOptions(options, "SOCK")).toEqual([{ id: "p1", label: "Wool sock" }]);
    expect(filterOptions(options, "creme brulee").map((o) => o.id)).toEqual(["p2"]);
    expect(filterOptions(options, "wool brulee")).toEqual([]);
    expect(filterOptions(options, "zzz")).toEqual([]);
  });

  it("reads the ids of a relational value and makes one from ids", () => {
    expect(idsOf("a")).toEqual(["a"]);
    expect(idsOf("")).toEqual([]);
    expect(idsOf(["a", "b"])).toEqual(["a", "b"]);
    expect(idsOf(undefined)).toEqual([]);
    expect(idsOf(5)).toEqual([]);
    expect(relationValue([], false)).toBeUndefined();
    expect(relationValue([], true)).toBeUndefined();
    expect(relationValue(["a"], false)).toBe("a");
    expect(relationValue(["a", "b"], false)).toBe("a");
    expect(relationValue(["a", "b"], true)).toEqual(["a", "b"]);
  });

  it("leaves the main language's texts out of what another language reads as its own", () => {
    const data: FieldData = {
      values: { a: 1 },
      translations: { nb: { t: "Ull" }, sv: { t: "Ull sv" } },
    };
    expect(ownView(data, "nb", "nb")).toBe(data);
    expect(ownView(data, "sv", "nb")).toEqual({ values: { a: 1 }, translations: { sv: { t: "Ull sv" } } });
    // Nothing to leave out.
    const bare: FieldData = { values: {}, translations: {} };
    expect(ownView(bare, "sv", "nb")).toBe(bare);
    // The data given is not changed.
    expect(data.translations.nb).toEqual({ t: "Ull" });
  });

  it("changes a cell and takes an empty one away", () => {
    const cells = { id: "r_aaaaaa", a: "x" };
    expect(withCell(cells, "a", "y", false)).toEqual({ id: "r_aaaaaa", a: "y" });
    expect(withCell(cells, "a", "", true)).toEqual({ id: "r_aaaaaa" });
    expect(withCell(cells, "b", 2, false)).toEqual({ id: "r_aaaaaa", a: "x", b: 2 });
    expect(withCell(cells, "a", undefined, false)).toEqual({ id: "r_aaaaaa" });
    expect(cells).toEqual({ id: "r_aaaaaa", a: "x" });
  });

  it("offers a language only the fields it can change", () => {
    const subs = [newField("text"), newField("number"), newField("link"), newField("richText"), newField("select")];
    expect(editableSubs(subs, "nb", "nb")).toHaveLength(5);
    expect(editableSubs(subs, "sv", "nb").map((s) => s.type)).toEqual(["text", "link", "richText"]);
  });

  it("works out what a repeater may still do with its rows", () => {
    expect(rowLimits({}, 0)).toEqual({ canAdd: true, canRemove: false, missing: 0 });
    expect(rowLimits({ minRows: 2, maxRows: 3 }, 1)).toEqual({ canAdd: true, canRemove: false, missing: 1 });
    expect(rowLimits({ minRows: 2, maxRows: 3 }, 3)).toEqual({ canAdd: false, canRemove: true, missing: 0 });
    expect(rowLimits({ maxRows: 500 }, 100).canAdd).toBe(false);
    expect(rowsNeeded({ minRows: 1 }, 0)).toBe("At least 1 row is needed.");
    expect(rowsNeeded({ minRows: 3 }, 1)).toBe("At least 3 rows are needed.");
    expect(rowsNeeded({ minRows: 3 }, 3)).toBeNull();
    expect(rowsNeeded({}, 0)).toBeNull();
  });

  it("refuses a file that is empty or over 50 MB before it is sent", () => {
    expect(fileProblem({ name: "a.pdf", size: 1000 })).toBeNull();
    expect(fileProblem({ name: "a.pdf", size: 0 })).toMatch(/empty/);
    expect(fileProblem({ name: "a.pdf", size: 51 * 1024 * 1024 })).toMatch(/50 MB/);
  });
});
