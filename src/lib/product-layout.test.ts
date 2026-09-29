import { describe, expect, it } from "vitest";

import { HEADING_MAX, blockHasContent, blockText, pageBlocks, pageInput, parsePageContent, type PageBlock, type PageContent, type ProductBlock } from "./page-content";
import { localizePage, pageTexts } from "./page-translation";
import { DEFAULT_PRODUCT_LAYOUT, productBlocks } from "./product-layout";

const withBlocks = (blocks: unknown[]): unknown => ({
  ...DEFAULT_PRODUCT_LAYOUT,
  rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks }] }],
});

describe("product layouts (D79)", () => {
  it("draws the page as before with the built-in layout, which passes a page's checks", () => {
    const parsed = parsePageContent(DEFAULT_PRODUCT_LAYOUT);
    expect(parsed).not.toBeNull();
    expect(productBlocks(parsed!).map((block) => block.part)).toEqual([
      "back",
      "gallery",
      "title",
      "price",
      "campaigns",
      "notice",
      "host",
      "buy",
      "description",
      "fields",
      "withdrawal",
      "safety",
    ]);
  });

  it("checks product components' settings", () => {
    const ok = pageInput.safeParse(
      withBlocks([{ id: "a", type: "product", part: "related", limit: 6, heading: " Mer i stil ", columns: { mobile: 2, tablet: 3, desktop: 4 } }]),
    );
    expect(ok.success).toBe(true);
    expect((ok.data as PageContent).rows[0].columns[0].blocks[0]).toMatchObject({ heading: "Mer i stil" });
    expect(pageInput.safeParse(withBlocks([{ id: "a", type: "product", part: "reviews" }])).success).toBe(false);
    expect(pageInput.safeParse(withBlocks([{ id: "a", type: "product", part: "related", limit: 50 }])).success).toBe(false);
  });

  it("checks the custom fields parts' settings (D118)", () => {
    const group = "3f0c9c1e-6d5a-4f37-9d0a-0d7d1f2a9b11";
    const ok = pageInput.safeParse(
      withBlocks([
        { id: "a", type: "product", part: "fields", groupId: group, display: "cards", showLabel: false, showHeading: false },
        { id: "b", type: "product", part: "field", groupId: group, fieldId: "f_abc123", display: "list", heading: " Material " },
      ]),
    );
    expect(ok.success).toBe(true);
    expect((ok.data as PageContent).rows[0].columns[0].blocks[1]).toMatchObject({ part: "field", fieldId: "f_abc123", heading: "Material" });
    for (const bad of [{ groupId: "specs" }, { fieldId: "material" }, { display: "grid" }, { showLabel: "no" }]) {
      expect(pageInput.safeParse(withBlocks([{ id: "a", type: "product", part: "fields", ...bad }])).success).toBe(false);
    }
  });

  it("holds a page's custom fields component with the same settings (D118)", () => {
    const group = "3f0c9c1e-6d5a-4f37-9d0a-0d7d1f2a9b11";
    const block = { id: "cf1", type: "customField", groupId: group, fieldId: "f_abc123", display: "table", showLabel: false, showHeading: false, heading: " Facts " };
    const ok = pageInput.safeParse(withBlocks([block]));
    expect(ok.success).toBe(true);
    const parsed = parsePageContent(ok.data);
    expect(pageBlocks(parsed!)[0]).toMatchObject({ type: "customField", fieldId: "f_abc123", heading: "Facts", showLabel: false });
    expect(pageInput.safeParse(withBlocks([{ id: "cf2", type: "customField" }])).success).toBe(true);
    for (const bad of [{ groupId: "nope" }, { fieldId: "F_1" }, { display: "cards!" }, { heading: "x".repeat(HEADING_MAX + 1) }]) {
      expect(pageInput.safeParse(withBlocks([{ ...block, ...bad }])).success).toBe(false);
    }
    // Always something to place; what it draws is decided by the page's values.
    expect(blockHasContent(block as PageBlock)).toBe(true);
    expect(blockText(block as PageBlock)).toBe("");
  });

  it("translates a custom fields component's own heading only (D118)", () => {
    const block: PageBlock = { id: "cf", type: "customField", groupId: "3f0c9c1e-6d5a-4f37-9d0a-0d7d1f2a9b11", heading: "Fakta" };
    const page = withBlocks([block, { id: "p", type: "product", part: "fields" }]) as PageContent;
    const texts = pageTexts(page);
    expect([...texts.keys()].filter((key) => key.startsWith("block."))).toEqual(["block.cf.heading"]);
    const english = localizePage({ ...page, translations: { "en-IE": { "block.cf.heading": "Facts" } } }, "en-IE");
    expect(english.rows[0].columns[0].blocks[0]).toMatchObject({ heading: "Facts" });
  });

  it("counts the product's title as the page's main heading", () => {
    const twice = pageInput.safeParse(
      withBlocks([
        { id: "a", type: "product", part: "title" },
        { id: "b", type: "heading", text: "Om produktet", level: 1 },
      ]),
    );
    expect(twice.success).toBe(false);
    expect(twice.error?.issues.map((issue) => issue.message)).toContain("A page has one main heading (H1). Make the others H2 or smaller.");
  });

  it("translates a component's own heading, and nothing of the product's", () => {
    const related: ProductBlock = { id: "rel", type: "product", part: "related", heading: "Mer i stil" };
    const page = withBlocks([related, { id: "t", type: "product", part: "title" }]) as PageContent;
    const texts = pageTexts(page);
    expect([...texts.keys()].filter((key) => key.startsWith("block."))).toEqual(["block.rel.heading"]);
    expect(texts.get("block.rel.heading")?.value).toBe("Mer i stil");
    const english = localizePage({ ...page, translations: { "en-IE": { "block.rel.heading": "More in style" } } }, "en-IE");
    expect(english.rows[0].columns[0].blocks[0]).toMatchObject({ heading: "More in style" });
  });
});
