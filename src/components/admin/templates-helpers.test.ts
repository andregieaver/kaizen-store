import { describe, expect, it } from "vitest";

import type { TemplateItem } from "@/lib/templates";

import {
  KIND_FILTERS,
  NO_FILTERS,
  activated,
  filterTemplates,
  groupTemplates,
  isFiltering,
  matchesQuery,
  noneActivated,
  nothingShared,
  patchTemplate,
} from "./templates-helpers";
import { item } from "./templates-test-support";

const ITEMS: TemplateItem[] = [
  item({
    id: "a",
    kind: "block",
    name: "Delivery promise",
    summary: "Text",
    publisher: "Kaizen",
    fromKaizen: true,
    active: true,
  }),
  item({ id: "b", kind: "row", name: "Hero with picture", summary: "2 columns: image, heading, button" }),
  item({
    id: "c",
    kind: "column",
    name: "Contact details",
    summary: "Heading, text",
    publisher: "Café Nord",
    active: true,
  }),
  item({ id: "d", kind: "row", name: "Three reasons", summary: "3 columns: icon list", active: true }),
];

describe("groupTemplates", () => {
  it("puts rows, then columns, then components, each in the order given", () => {
    const groups = groupTemplates(ITEMS);
    expect(groups.map((g) => g.label)).toEqual(["Rows", "Columns", "Components"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["b", "d"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["c"]);
    expect(groups[2].items.map((i) => i.id)).toEqual(["a"]);
  });

  it("leaves out a kind with nothing in it, and gives nothing for nothing", () => {
    expect(groupTemplates(ITEMS.filter((i) => i.kind === "column")).map((g) => g.kind)).toEqual(["column"]);
    expect(groupTemplates([])).toEqual([]);
  });
});

describe("filterTemplates", () => {
  it("shows everything with no filters", () => {
    expect(filterTemplates(ITEMS, NO_FILTERS)).toHaveLength(4);
    expect(isFiltering(NO_FILTERS)).toBe(false);
  });

  it("narrows by kind", () => {
    expect(filterTemplates(ITEMS, { ...NO_FILTERS, kind: "row" }).map((i) => i.id)).toEqual(["b", "d"]);
    expect(filterTemplates(ITEMS, { ...NO_FILTERS, kind: "block" }).map((i) => i.id)).toEqual(["a"]);
  });

  it("narrows to the activated ones", () => {
    expect(filterTemplates(ITEMS, { ...NO_FILTERS, activeOnly: true }).map((i) => i.id)).toEqual(["a", "c", "d"]);
    expect(activated(ITEMS).map((i) => i.id)).toEqual(["a", "c", "d"]);
  });

  it("searches name, publisher and summary, every word, without regard to case or accents", () => {
    const ids = (query: string) => filterTemplates(ITEMS, { ...NO_FILTERS, query }).map((i) => i.id);
    expect(ids("hero")).toEqual(["b"]);
    expect(ids("KAIZEN")).toEqual(["a"]);
    expect(ids("cafe nord")).toEqual(["c"]);
    expect(ids("columns icon")).toEqual(["d"]);
    expect(ids("columns nothing")).toEqual([]);
    expect(ids("   ")).toHaveLength(4);
  });

  it("combines the filters", () => {
    expect(filterTemplates(ITEMS, { kind: "row", activeOnly: true, query: "reasons" }).map((i) => i.id)).toEqual(["d"]);
    expect(filterTemplates(ITEMS, { kind: "column", activeOnly: true, query: "hero" })).toEqual([]);
    expect(isFiltering({ ...NO_FILTERS, query: " x " })).toBe(true);
    expect(isFiltering({ ...NO_FILTERS, activeOnly: true })).toBe(true);
  });

  it("does not change the list it was given", () => {
    const before = [...ITEMS];
    filterTemplates(ITEMS, { kind: "row", activeOnly: true, query: "x" });
    expect(ITEMS).toEqual(before);
  });
});

describe("the kind chips", () => {
  it("are All, then the kinds in the order of the groups", () => {
    expect(KIND_FILTERS.map((k) => k.label)).toEqual(["All", "Rows", "Columns", "Components"]);
    expect(KIND_FILTERS.map((k) => k.value)).toEqual(["all", "row", "column", "block"]);
  });
});

describe("patchTemplate", () => {
  it("changes one template and leaves the others as they were", () => {
    const next = patchTemplate(ITEMS, "b", { active: true });
    expect(next.find((i) => i.id === "b")?.active).toBe(true);
    expect(next.filter((i) => i.active)).toHaveLength(4);
    expect(ITEMS[1].active).toBe(false);
    expect(matchesQuery(next[1], "hero")).toBe(true);
  });
});

describe("the words for an empty list", () => {
  it("say where nothing is activated from, and what to do", () => {
    expect(noneActivated("stores").title).toBe("No templates activated from your other stores");
    expect(noneActivated("marketplace").title).toBe("No templates activated from the marketplace");
    expect(noneActivated("marketplace").hint).toContain("Browse");
  });

  it("say when a source has nothing at all", () => {
    expect(nothingShared("stores").title).toContain("have not shared");
    expect(nothingShared("marketplace").title).toContain("marketplace");
  });
});
