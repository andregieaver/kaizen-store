import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { newPageContent, type PageBlock, type PageContent, type PageRow } from "@/lib/page-content";

import { ModalRow, PageArticle } from "./page-article";

// The page's server-only sections are imported but not drawn here; the place's language is the store's Norwegian.
vi.mock("server-only", () => ({}));
vi.mock("@/server/place-lang", () => ({ placeLang: async () => "nb" }));

/**
 * What the live site marks for signed-in staff's "Edit text" (D192): the page's id on its article, and on each heading or text of the
 * page's own the kind of words and the block's id. The words themselves are never in a marker, and a visitor sees nothing different
 * (the markers are attributes, the editor is fetched only when staff turn the mode on).
 */

const PAGE = "11111111-1111-4111-8111-111111111111";
const para = (id: string, words: string): PageBlock => ({
  id,
  type: "richText",
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] },
});
const heading = (id: string, text: string, extra: Partial<PageBlock> = {}) => ({ id, type: "heading", text, level: 2, ...extra }) as PageBlock;
const row = (id: string, blocks: PageBlock[], extra: Partial<PageRow> = {}): PageRow => ({ id, type: "row", layout: "1", columns: [{ id: `${id}-c`, blocks }], ...extra });
const page = (...rows: PageRow[]): PageContent => ({ ...newPageContent(), title: "Page", rows });
const draw = (content: PageContent, over: { pageId?: string | null; preview?: boolean; editable?: boolean } = {}) =>
  renderToString(
    createElement(PageArticle, {
      content,
      place: { pageId: over.pageId === undefined ? PAGE : over.pageId, owner: null },
      inAdmin: over.preview ?? false,
      editable: over.editable ?? true,
    }),
  );

describe("a page on the live site", () => {
  const content = page(row("r1", [heading("h1", "Welcome"), para("t1", "Some words"), { id: "b1", type: "button", label: "Go", href: "/" } as PageBlock]));

  it("carries its id on the article and the kind and id of each heading and text it may be edited in", () => {
    const html = draw(content);
    expect(html).toContain(`<article class="flex flex-col gap-8" data-kz-page="${PAGE}"`);
    expect(html).toMatch(/data-kz-edit="heading"[^>]*data-kz-block="h1"/);
    expect(html).toMatch(/data-kz-edit="richText"[^>]*data-kz-block="t1"/);
  });

  it("marks only headings and texts: a button is edited in the page builder", () => {
    const html = draw(content);
    expect(html.match(/data-kz-edit="/g)).toHaveLength(2);
    expect(html).not.toMatch(/data-kz-block="b1"/);
  });

  it("never puts the words, or anything of the editor, in a marker", () => {
    const html = draw(content);
    for (const mark of html.match(/data-kz-[a-z]+="[^"]*"/g) ?? []) expect(mark).not.toMatch(/Welcome|Some words/);
    expect(html).not.toContain("Edit text");
  });

  it("marks nothing in a part shared with other pages, unless the page made it its own", () => {
    const shared = page(
      row("r1", [heading("h1", "Everywhere")], { global: "g-1" } as Partial<PageRow>),
      row("r2", [heading("h2", "Mine")], { global: "g-2" } as Partial<PageRow>),
    );
    // A block marked as the page's own inside a global's use is the page's.
    shared.rows[1].columns[0].blocks[0] = { ...shared.rows[1].columns[0].blocks[0], local: true } as PageBlock;
    const html = draw(shared);
    expect(html).not.toMatch(/data-kz-block="h1"/);
    expect(html).toMatch(/data-kz-block="h2"/);
  });

  it("marks nothing in a modal: its words are the modal's own, opened by a trigger", async () => {
    const inModal = row("m", [heading("mh", "In a window"), para("mt", "Words")], { modal: { key: "offer", triggers: { button: true }, frequency: "always", size: "md" } });
    const html = renderToString(await ModalRow({ row: inModal, place: { pageId: PAGE, owner: null }, inAdmin: false }));
    expect(html).toContain("In a window");
    expect(html).not.toMatch(/data-kz-edit/);
  });

  it("marks nothing where the page does not say staff edit its words in place: a header, a footer, a product's layout, a 404 page", () => {
    const html = draw(content, { editable: false });
    expect(html).not.toMatch(/data-kz-(edit|page|block)/);
    expect(html).toContain("Welcome");
  });

  it("marks nothing on a preview in the admin, nor without a page of its own", () => {
    expect(draw(content, { preview: true })).not.toMatch(/data-kz-(edit|page)/);
    const bare = draw(content, { pageId: null });
    expect(bare).not.toMatch(/data-kz-edit/);
    expect(bare).not.toMatch(/data-kz-page/);
  });
});
