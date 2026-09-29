import { describe, expect, it } from "vitest";

import { pageInput, parsePageContent, type PageContent, type ProductBlock } from "./page-content";
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
