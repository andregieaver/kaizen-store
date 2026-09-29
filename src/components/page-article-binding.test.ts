import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ShownGroup } from "@/lib/custom-fields";
import { bindPage } from "@/lib/field-binding";
import { newPageContent, type PageBlock, type PageContent } from "@/lib/page-content";

import { PageArticle } from "./page-article";

// The page's server-only sections are imported but not drawn here.
vi.mock("server-only", () => ({}));

/**
 * A page with blocks bound to custom fields (D118) draws the field's value once it has been through `bindPage()`, and
 * where no fields are read a bound block draws only when it keeps its own content.
 */

const field = (id: string, type: "text" | "image" | "file", over: object) =>
  ({ id, name: id, label: id, type, value: "", text: "", ...over }) as ShownGroup["fields"][number];
const groups: ShownGroup[] = [
  {
    id: "g1",
    name: "Specs",
    slug: "specs",
    position: "normal" as never,
    fields: [
      field("f_title00", "text", { value: "Oak table", text: "Oak table" }),
      field("f_pict000", "image", {
        value: { url: "https://cdn.example.com/oak.webp", thumbnailUrl: null, alt: "An oak table" },
      }),
      field("f_sheet00", "file", {
        links: [{ label: "Data sheet", href: "https://cdn.example.com/sheet.pdf", newTab: true }],
      }),
    ],
  },
];

const page = (...blocks: PageBlock[]): PageContent => ({
  ...newPageContent(),
  title: "Page",
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks }] }],
});

const blocks: PageBlock[] = [
  { id: "h1", type: "heading", text: "Own heading", level: 2, bind: { fieldId: "f_title00" } },
  { id: "i1", type: "image", image: null, caption: "", bind: { fieldId: "f_pict000" } },
  { id: "b1", type: "button", label: "", href: "", bind: { fieldId: "f_sheet00" } },
  { id: "h2", type: "heading", text: "Kept heading", level: 3, bind: { fieldId: "f_none000", fallback: true } },
  { id: "h3", type: "heading", text: "Dropped heading", level: 3, bind: { fieldId: "f_none000" } },
];

describe("a page with bound blocks", () => {
  it("draws the fields' values, and each block's own content only where it keeps it", () => {
    const html = renderToString(createElement(PageArticle, { content: bindPage(page(...blocks), groups) }));
    expect(html).toContain("Oak table");
    expect(html).not.toContain("Own heading");
    expect(html).toContain("https://cdn.example.com/oak.webp");
    expect(html).toContain('alt="An oak table"');
    expect(html).toContain('href="https://cdn.example.com/sheet.pdf"');
    expect(html).toContain("Data sheet");
    expect(html).toContain("Kept heading");
    expect(html).not.toContain("Dropped heading");
  });

  it("with no fields read, draws only what keeps its own content", () => {
    const html = renderToString(createElement(PageArticle, { content: page(...blocks) }));
    expect(html).toContain("Kept heading");
    expect(html).not.toContain("Own heading");
    expect(html).not.toContain("Dropped heading");
    expect(html).not.toContain("oak.webp");
  });

  it("shows the blocks' own content in a preview", () => {
    const html = renderToString(createElement(PageArticle, { content: page(...blocks), inAdmin: true }));
    expect(html).toContain("Own heading");
    expect(html).toContain("Dropped heading");
  });
});
