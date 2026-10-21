import { describe, expect, it } from "vitest";

import { cleanRichText, newPageContent, type PageContent, type RichTextDoc } from "./page-content";
import { findInPage, findPattern, replaceInPage } from "./page-find-replace";

const doc: RichTextDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Our coffee is " }, { type: "text", text: "fresh coffee", marks: [{ type: "bold" }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Coffeehouse" }] }] }] },
  ],
};

const page = (): PageContent => ({
  ...newPageContent(),
  title: "Coffee and more",
  slug: "coffee",
  rows: [
    {
      id: "row-1",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "col-1",
          blocks: [
            { id: "h-1", type: "heading", text: 'Fresh <span class="coffee">coffee</span> daily', level: 2 },
            { id: "t-1", type: "richText", doc },
            { id: "b-1", type: "button", label: "Buy coffee", href: "/products", style: "primary" } as never,
          ],
        },
      ],
    },
  ],
});

describe("find and replace in a page", () => {
  it("finds words in every text, case as asked, never in markup", () => {
    const found = findInPage(page(), "coffee");
    expect(found.map((f) => [f.key, f.count])).toEqual([
      ["title", 1],
      ["block.h-1.text", 1],
      ["block.t-1.doc", 3],
      ["block.b-1.label", 1],
    ]);
    expect(found[1]).toMatchObject({ label: "Heading", match: "coffee" });
    expect(findInPage(page(), "coffee", { matchCase: true }).map((f) => f.key)).not.toContain("title");
    expect(findInPage(page(), "coffee", { wholeWords: true }).find((f) => f.key === "block.t-1.doc")?.count).toBe(2);
  });

  it("replaces in the chosen texts only, keeping marks and markup, in one new page", () => {
    const { content, replaced, tooLong } = replaceInPage(page(), "coffee", "tea", { wholeWords: true }, new Set(["block.h-1.text", "block.t-1.doc"]));
    expect(replaced).toBe(3);
    expect(tooLong).toEqual([]);
    const blocks = content.rows[0].columns[0].blocks as never as [{ text: string }, { doc: RichTextDoc }, { label: string }];
    expect(blocks[0].text).toBe('Fresh <span class="coffee">tea</span> daily');
    expect(JSON.stringify(blocks[1].doc)).toContain('{"type":"text","text":"fresh tea","marks":[{"type":"bold"}]}');
    expect(JSON.stringify(blocks[1].doc)).toContain("Coffeehouse");
    expect(blocks[2].label).toBe("Buy coffee");
    expect(content.title).toBe("Coffee and more");
  });

  it("leaves a text that would grow too long, and says which", () => {
    const { content, tooLong } = replaceInPage(page(), "Buy", "x".repeat(99));
    expect(tooLong).toEqual(["block.b-1.label"]);
    expect((content.rows[0].columns[0].blocks[2] as never as { label: string }).label).toBe("Buy coffee");
  });

  it("takes the words literally and keeps rich text valid when a run is emptied", () => {
    expect(findPattern("a.b(c)")?.test("a.b(c)")).toBe(true);
    expect(findPattern("")).toBeNull();
    const { content } = replaceInPage(page(), "fresh coffee", "", {});
    const text = content.rows[0].columns[0].blocks[1] as never as { doc: RichTextDoc };
    expect(cleanRichText(text.doc).ok).toBe(true);
    expect(JSON.stringify(text.doc)).not.toContain('"text":""');
    // The replacement is put in as written, `$` and all.
    expect(replaceInPage(page(), "Coffee and", "$& $1", {}).content.title).toBe("$& $1 more");
  });

  it("gives the same page back when nothing is found", () => {
    const before = page();
    expect(replaceInPage(before, "nothing here", "x").content).toBe(before);
  });
});
