import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageBlockView } from "@/components/page-block";

import { copyWithUses } from "./global-parts";
import {
  EMPTY_DOC,
  FAQ_CHILDREN_MAX,
  blockText,
  faqShows,
  pageBlocks,
  pageInput,
  pageParts,
  type ButtonBlock,
  type FaqBlock,
  type PageBlock,
  type PageContent,
  type PageRow,
  type RichTextDoc,
} from "./page-content";
import { duplicateBlock, findBlock, insertChild, moveChild, newBlock, patchBlock, removeBlock } from "./page-rows";
import { partRules } from "./part-css";
import { blockTextFields } from "./page-translation";
import { sanitizeTemplate } from "./template-content";

/** An FAQ's answers holding components (D208). */

const doc = (text: string): RichTextDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const button = (id: string, label = "Book now"): ButtonBlock => ({ id, type: "button", label, href: "/book" });
const faq = (children: PageBlock[] = [button("b1")]): FaqBlock => ({
  id: "faq",
  type: "faq",
  items: [
    { id: "q1", title: "How do I book?", body: doc("Choose a time."), blocks: children },
    { id: "q2", title: "Where are you?", body: doc("In Oslo.") },
  ],
});
const rows = (block: PageBlock = faq()): PageRow[] => [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [block] }] }];
const page = (block: PageBlock = faq()): PageContent => ({
  title: "FAQ",
  slug: "faq",
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows: rows(block),
});
let n = 0;
const newId = () => `n${++n}`;

describe("an FAQ's answers hold components (D208)", () => {
  it("are found, changed, copied and taken out like a column's blocks", () => {
    const place = findBlock(rows(), "b1");
    expect(place?.parent).toEqual({ blockId: "faq", itemId: "q1" });
    const patched = patchBlock<ButtonBlock>(rows(), "b1", { label: "Book a time" });
    expect((findBlock(patched, "b1")?.block as ButtonBlock).label).toBe("Book a time");
    const doubled = duplicateBlock(rows(), "b1", newId);
    const items = (doubled[0].columns[0].blocks[0] as FaqBlock).items[0].blocks!;
    expect(items).toHaveLength(2);
    expect(items[1].id).not.toBe("b1");
    // The FAQ stays one block in its column.
    expect(doubled[0].columns[0].blocks).toHaveLength(1);
    const removed = removeBlock(rows(), "b1");
    expect((removed[0].columns[0].blocks[0] as FaqBlock).items[0].blocks).toBeUndefined();
  });

  it("are added only of the kinds an answer holds, up to the limit, and moved within it", () => {
    const at = { blockId: "faq", itemId: "q1" };
    expect(insertChild(rows(), at, newBlock("contentGrid", newId), 0)).toEqual(rows());
    const added = insertChild(rows(), at, newBlock("heading", newId), 0);
    const kids = (added[0].columns[0].blocks[0] as FaqBlock).items[0].blocks!;
    expect(kids.map((b) => b.type)).toEqual(["heading", "button"]);
    const moved = moveChild(added, "b1", 0);
    expect((moved[0].columns[0].blocks[0] as FaqBlock).items[0].blocks!.map((b) => b.id)[0]).toBe("b1");
    let full = rows(faq([]));
    for (let i = 0; i < FAQ_CHILDREN_MAX + 2; i++) full = insertChild(full, at, button(`x${i}`), i);
    expect((full[0].columns[0].blocks[0] as FaqBlock).items[0].blocks).toHaveLength(FAQ_CHILDREN_MAX);
  });

  it("a copied FAQ's components take ids of their own, also in a global's use", () => {
    const copy = copyWithUses("block", faq(), newId) as FaqBlock;
    expect(copy.items[0].blocks![0].id).not.toBe("b1");
  });

  it("are saved, and refused when they would move, be global, show to some only, or are of another kind", () => {
    expect(pageInput.safeParse(page()).success).toBe(true);
    const refused = (child: Record<string, unknown>) => pageInput.safeParse(page(faq([child as PageBlock]))).success;
    expect(refused({ ...button("b1"), motion: { enter: { effect: "fade" } } })).toBe(false);
    expect(refused({ ...button("b1"), global: crypto.randomUUID() })).toBe(false);
    expect(refused({ ...button("b1"), visibility: { show: { kind: "signedIn" } } })).toBe(false);
    expect(refused({ id: "g1", type: "contentGrid", source: { type: "pages" }, categories: [], tags: [] })).toBe(false);
    expect(pageInput.safeParse(page(faq(Array.from({ length: FAQ_CHILDREN_MAX + 1 }, (_, i) => button(`m${i}`))))).success).toBe(false);
    // An id used twice on the page, once in an answer, is refused like any other.
    expect(pageInput.safeParse(page(faq([button("faq")]))).success).toBe(false);
  });

  it("are parts of the page: walked, styled, read and translated", () => {
    expect(pageBlocks(page()).map((b) => b.id)).toContain("b1");
    expect(pageParts(rows()).map((p) => p.id)).toContain("b1");
    const styled = faq([{ ...button("b1"), style: { margin: { top: 12, right: 0, bottom: 0, left: 0 } } }]);
    // The answer's component has rules of its own, as a column's block has.
    expect(partRules(rows(styled), "site").length).toBeGreaterThan(partRules(rows(), "site").length);
    expect(blockText(faq([{ id: "t1", type: "richText", doc: doc("Bring your card.") }]))).toContain("Bring your card.");
    const fields = blockTextFields(faq());
    expect(fields.find((f) => f.key === "block.b1.label")?.label).toBe("Answer 1: Button text");
  });

  it("make a question show with no text of its own", () => {
    expect(faqShows({ id: "q", title: "Hours?", body: EMPTY_DOC, blocks: [button("b1")] })).toBe(true);
    expect(faqShows({ id: "q", title: "Hours?", body: EMPTY_DOC })).toBe(false);
  });

  it("go along with a template, cleaned as any block is", () => {
    const clean = sanitizeTemplate("block", faq([{ ...button("b1"), href: "https://example.com/x" }]), { hosts: [], slugs: [] } as never) as FaqBlock;
    expect(clean.items[0].blocks).toHaveLength(1);
  });

  it("are drawn under the answer's text, and their words are in the FAQPage data", () => {
    const html = renderToStaticMarkup(createElement(PageBlockView, { block: faq([button("b1"), { id: "t1", type: "richText", doc: doc("Bring your card.") }]) }));
    expect(html).toMatch(/Choose a time\.[\s\S]*kz-answer-parts[\s\S]*Book now/);
    expect(html).toContain('href="/book"');
    expect(html).toContain("Bring your card.");
    const data = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(data).toContain("Bring your card.");
  });
});
