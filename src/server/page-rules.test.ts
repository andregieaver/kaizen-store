import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { newPageContent, type PageBlock, type PageContent, type PageType } from "@/lib/page-content";

import { pageRulesProblem } from "./page-rules";

const withBlock = (block: PageBlock): PageContent => ({
  ...newPageContent(),
  rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [block] }] }],
});
const fields: PageBlock = { id: "cf", type: "customField" };
const store = "3f0c9c1e-6d5a-4f37-9d0a-0d7d1f2a9b11";

describe("where a custom fields component may be (D118)", () => {
  it("belongs in a store's pages and articles", () => {
    expect(pageRulesProblem(store, "page", withBlock(fields))).toBeNull();
    expect(pageRulesProblem(store, "article", withBlock(fields))).toBeNull();
  });

  it("is refused on Kaizen's own pages, headers, footers and product layouts", () => {
    expect(pageRulesProblem(null, "page", withBlock(fields))).toMatch(/store's pages and articles/);
    expect(pageRulesProblem(store, "product_layout", withBlock(fields))).toMatch(/store's pages and articles/);
    // A header or footer is refused for other reasons first; never accepted.
    for (const type of ["header", "footer"] as PageType[]) {
      expect(pageRulesProblem(store, type, withBlock(fields))).not.toBeNull();
    }
  });

  it("does not stop a page without one", () => {
    expect(pageRulesProblem(null, "page", withBlock({ id: "h", type: "heading", text: "Hi", level: 2 }))).toBeNull();
  });
});
