import { describe, expect, it } from "vitest";

import { DESIGN_SNAPSHOT_VERSION, parseDesignSnapshot } from "./design-presets";
import { applyPart, partChanges } from "./experiment-parts";
import { globalContent, newUse, withoutUses } from "./global-parts";
import { newPageContent, pageInput, type PageBlock, type PageContent, type PageRow } from "./page-content";
import { copyBlock, copyColumn, copyRow } from "./page-rows";
import { savedPartInput } from "./saved-parts";
import { sanitizeTemplate } from "./template-content";
import { templateSettings, themeSettingsSchema } from "./theme";

/**
 * A part's settings by screen size (`at`) and its visibility (`visibility.hideAt`) are part of the part (D179 phase 2,
 * `docs/responsive-editing.md` 5): every way a part is copied, saved for reuse, shared as a template, made global or
 * tested keeps them, and a design profile carries the theme's screen sizes.
 */

let n = 0;
const id = () => `id-${++n}`;

const sized: PageBlock = {
  id: "b1",
  type: "heading",
  text: "Hello",
  level: 2,
  // Its typography (D179 phase 3), with a size's own: kept by every copy as the rest is.
  typography: { text: { align: "right", family: "Lora", size: { value: 40, unit: "px" }, textShadow: { color: "#000000", x: 1, y: 2, blur: 3 } } },
  at: {
    md: { radius: 0, border: null, typography: { text: { align: "center", letterSpacing: { value: 0.05, unit: "em" } } } },
    sm: { style: { margin: { top: 4, right: 0, bottom: 4, left: 0 } }, typography: { text: { size: { value: 1.5, unit: "rem" }, textShadow: null } } },
  },
  // Who sees it (D179 phase 4) is part of the part too.
  visibility: { hideAt: ["sm"], show: "signedIn" },
} as PageBlock;
const row: PageRow = {
  id: "r1",
  type: "row",
  layout: "2",
  gap: 24,
  at: { sm: { stack: false, gap: 8, typography: { text: { transform: "uppercase" } } } },
  visibility: { hideAt: ["xl"], show: { rules: [[{ fact: "hour", op: "between", value: { from: "09:00", to: "17:00" } }], [{ fact: "language", op: "in", value: ["en"] }]] } },
  typography: { text: { weight: 300, style: "italic" } },
  columns: [
    { id: "c1", blocks: [sized], width: 2, at: { md: { width: 1, order: -1 } }, visibility: { hideAt: ["md"], show: "never" } },
    { id: "c2", blocks: [] },
  ],
};
const responsive = (part: { at?: unknown; visibility?: unknown; typography?: unknown }) => ({ at: part.at, visibility: part.visibility, typography: part.typography });

describe("copies keep the settings by size and the visibility", () => {
  it("duplicating a row, a column or a component", () => {
    const copy = copyRow(row, id);
    expect(copy.id).not.toBe(row.id);
    expect(responsive(copy)).toEqual(responsive(row));
    expect(responsive(copy.columns[0])).toEqual(responsive(row.columns[0]));
    expect(copy.columns[0].width).toBe(2);
    expect(responsive(copy.columns[0].blocks[0])).toEqual(responsive(sized));
    expect(responsive(copyColumn(row.columns[0], id))).toEqual(responsive(row.columns[0]));
    expect(responsive(copyBlock(sized, id))).toEqual(responsive(sized));
  });

  it("a page and a saved part, through their schemas (none at a size kept as null)", () => {
    const content: PageContent = { ...newPageContent(), title: "Sizes", slug: "sizes", rows: [row] };
    const page = pageInput.parse(content);
    expect(responsive(page.rows[0])).toEqual(responsive(row));
    expect(page.rows[0].columns[0]).toMatchObject({ width: 2, at: row.columns[0].at, visibility: row.columns[0].visibility });
    expect(responsive(page.rows[0].columns[0].blocks[0])).toEqual(responsive(sized));
    const saved = savedPartInput.parse({ kind: "row", name: "Sized", content: row });
    expect(responsive(saved.content as PageRow)).toEqual(responsive(row));
  });

  it("a template made for another store, and a global and its uses", () => {
    const template = sanitizeTemplate("row", row, { id: "other", slug: "other", hosts: [] }) as PageRow;
    expect(responsive(template)).toEqual(responsive(row));
    expect(responsive(template.columns[0].blocks[0])).toEqual(responsive(sized));
    const global = globalContent("row", row);
    expect(responsive(global)).toEqual(responsive(row));
    const use = newUse({ id: "g1", kind: "row", content: global, translations: {} }, "use-1") as PageRow;
    expect(responsive(use)).toEqual(responsive(row));
    expect(responsive(use.columns[0].blocks[0])).toEqual(responsive(sized));
    expect(responsive(withoutUses("row", use) as PageRow)).toEqual(responsive(row));
  });

  it("an A/B test of a part: a change by size is a change of that part, and applying it takes it", () => {
    const original: PageContent = { ...newPageContent(), title: "Sizes", slug: "sizes", rows: [row, { ...row, id: "r2", columns: [{ id: "c3", blocks: [] }, { id: "c4", blocks: [] }] }] };
    const changed = (block: PageBlock) => ({ ...original, rows: [{ ...row, columns: [{ ...row.columns[0], blocks: [block] }, row.columns[1]] }, original.rows[1]] });
    const version = changed({ ...sized, at: { sm: { align: "left" } }, visibility: undefined } as PageBlock);
    expect(partChanges(original, version, { kind: "block", id: "b1" })).toBe("ok");
    // The same change is outside a test of the other row.
    expect(partChanges(original, version, { kind: "row", id: "r2" })).toBe("outside");
    const applied = applyPart(original, version, { kind: "block", id: "b1" });
    expect(applied?.rows[0].columns[0].blocks[0]).toMatchObject({ at: { sm: { align: "left" } } });
    expect(applied?.rows[0].columns[0].blocks[0].visibility).toBeUndefined();
  });
});

describe("design profiles", () => {
  it("carry the theme's screen sizes", () => {
    const settings = { ...templateSettings("warm"), breakpoints: { md: 800, lg: 1100, xl: 1440 } };
    expect(themeSettingsSchema.parse(settings).breakpoints).toEqual({ md: 800, lg: 1100, xl: 1440 });
    const snapshot = parseDesignSnapshot({
      v: DESIGN_SNAPSHOT_VERSION,
      theme: { base: "warm", settings },
      header: null,
      footer: null,
      productLayout: null,
      css: "",
    });
    expect(snapshot?.theme.settings.breakpoints).toEqual({ md: 800, lg: 1100, xl: 1440 });
  });
});
