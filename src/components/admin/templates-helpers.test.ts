import { describe, expect, it } from "vitest";

import type { TemplateItem } from "@/lib/templates";

import {
  KIND_FILTERS,
  NO_FILTERS,
  PREVIEW_DEVICES,
  activated,
  deviceWidth,
  filterTemplates,
  fitsPage,
  forLabel,
  forPage,
  groupTemplates,
  isFiltering,
  matchesQuery,
  noneActivated,
  nothingShared,
  patchTemplate,
  blockedReason,
} from "./templates-helpers";
import { item, layoutItem } from "./templates-test-support";

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
    expect(KIND_FILTERS.map((k) => k.label)).toEqual(["All", "Page layouts", "Rows", "Columns", "Components"]);
    expect(KIND_FILTERS.map((k) => k.value)).toEqual(["all", "page", "row", "column", "block"]);
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

describe("page layouts among the templates (D127)", () => {
  const LAYOUTS: TemplateItem[] = [
    layoutItem({ id: "p1", name: "Landing page", pageType: "page", active: true }),
    layoutItem({ id: "p2", name: "Story", pageType: "article", active: true }),
    layoutItem({ id: "p3", name: "Not switched on", pageType: "page", active: false }),
    ...ITEMS,
  ];

  it("come first among the groups, as Page layouts", () => {
    const groups = groupTemplates(LAYOUTS);
    expect(groups.map((g) => g.label)).toEqual(["Page layouts", "Rows", "Columns", "Components"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("can be picked out by their kind chip", () => {
    expect(filterTemplates(LAYOUTS, { ...NO_FILTERS, kind: "page" }).map((i) => i.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("fit only the kind of page they are made for; the other kinds fit anywhere", () => {
    expect(fitsPage(LAYOUTS[0], "page")).toBe(true);
    expect(fitsPage(LAYOUTS[0], "article")).toBe(false);
    expect(fitsPage(LAYOUTS[1], "article")).toBe(true);
    expect(fitsPage(ITEMS[1], "header")).toBe(true);
    // A layout that does not say what it is for fits nothing.
    expect(fitsPage({ kind: "page", pageType: null }, "page")).toBe(false);
  });

  it("are offered in the tab only when they are switched on and fit the page being edited", () => {
    expect(forPage(LAYOUTS, "page").map((i) => i.id)).toEqual(["p1", "a", "c", "d"]);
    expect(forPage(LAYOUTS, "article").map((i) => i.id)).toEqual(["p2", "a", "c", "d"]);
    expect(forPage(LAYOUTS, "footer").map((i) => i.id)).toEqual(["a", "c", "d"]);
  });

  it("say which kind of page they are for", () => {
    expect(forLabel(LAYOUTS[0])).toBe("For pages");
    expect(forLabel(LAYOUTS[1])).toBe("For articles");
    expect(forLabel({ kind: "page", pageType: "product_layout" })).toBe("For product layouts");
    expect(forLabel(ITEMS[1])).toBeNull();
  });
});

describe("why a template cannot be used", () => {
  const room = { pageType: "page", rowsFull: false, blocksFull: false } as const;

  it("names the kind of page a layout is for when it is another", () => {
    expect(blockedReason(layoutItem({ id: "x", pageType: "article" }), room)).toBe(
      "Made for articles, so it cannot be used on pages.",
    );
    expect(blockedReason(layoutItem({ id: "x", pageType: "page" }), room)).toBeNull();
    expect(blockedReason({ kind: "page", pageType: null }, room)).toMatch(/does not say/);
  });

  it("does not stop a page layout on a full page: replacing needs no room", () => {
    expect(blockedReason(layoutItem({ id: "x" }), { ...room, rowsFull: true, blocksFull: true })).toBeNull();
  });

  it("says when the page has no room for a row, column or component", () => {
    expect(blockedReason(ITEMS[0], { ...room, blocksFull: true })).toMatch(/no room for more blocks/);
    expect(blockedReason(ITEMS[1], { ...room, rowsFull: true })).toMatch(/no room for more rows/);
    expect(blockedReason(ITEMS[2], { ...room, rowsFull: true })).toMatch(/no room for more rows/);
    expect(blockedReason(ITEMS[1], { ...room, blocksFull: true })).toBeNull();
  });
});

describe("the preview's widths", () => {
  it("are the desktop's whole room, a tablet's 768 pixels and a phone's 390", () => {
    expect(PREVIEW_DEVICES.map((d) => d.key)).toEqual(["desktop", "tablet", "mobile"]);
    expect(deviceWidth("desktop")).toBe("100%");
    expect(deviceWidth("tablet")).toBe("768px");
    expect(deviceWidth("mobile")).toBe("390px");
  });
});
