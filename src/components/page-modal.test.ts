import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { newPageContent, type PageContent, type PageRow } from "@/lib/page-content";
import type { RowModal } from "@/lib/page-modal";

import { ModalRow, PageRowView, pageRoomClass } from "./page-article";
import { PageModal } from "./page-modal";

// The page's server-only sections are imported but not drawn here; the place's language is the store's Norwegian.
vi.mock("server-only", () => ({}));
vi.mock("@/server/place-lang", () => ({ placeLang: async () => "nb" }));

/**
 * A modal row (D121) as the server draws it: a closed dialog holding the row's content, named, closable, made of the
 * site's own colours; and not in the page's flow.
 */

const modal = (over: Partial<RowModal> = {}): RowModal => ({
  key: "newsletter",
  triggers: { timer: { seconds: 5 }, button: true },
  frequency: "session",
  size: "md",
  ...over,
});

const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});

const row = (id: string, text: string, extra: Partial<PageRow> = {}): PageRow => ({
  id,
  type: "row",
  layout: "1",
  columns: [
    {
      id: `${id}-c`,
      blocks: [
        { id: `${id}-h`, type: "heading", text: `Heading ${id}`, level: 2 },
        { id: `${id}-b`, type: "richText", doc: doc(text) },
      ],
    },
  ],
  ...extra,
});

const labels = { close: "Lukk", dialog: "Dialogvindu" };
const html = (config: RowModal, props: { panelStyle?: object; children?: string } = {}) =>
  renderToString(
    createElement(
      PageModal,
      { config, storeId: null, auto: true, labels, panelStyle: props.panelStyle } as ComponentProps<typeof PageModal>,
      createElement("p", null, props.children ?? "Sign up for the newsletter"),
    ),
  ).replace(/<!-- -->/g, "");

describe("a modal on the server", () => {
  it("is a closed native dialog with the content in it, named and closable", () => {
    const out = html(modal());
    expect(out).toMatch(/^<dialog /);
    expect(out).not.toMatch(/<dialog[^>]* open/);
    expect(out).toContain('id="modal-newsletter"');
    expect(out).toContain('data-page-modal="newsletter"');
    expect(out).toContain('aria-label="Dialogvindu"');
    expect(out).toContain("Sign up for the newsletter");
    expect(out).toMatch(/<button[^>]*type="button"[^>]*aria-label="Lukk"/);
    // The panel can take focus when the dialog opens.
    expect(out).toMatch(/<div[^>]*tabindex="-1"[^>]*class="page-modal-panel/);
  });

  it("gets its size and dimming from the setting, in variables the stylesheet reads", () => {
    expect(html(modal({ size: "sm" }))).toContain("--modal-width:24rem");
    expect(html(modal({ size: "lg", overlay: "strong" }))).toContain("--modal-width:56rem;--modal-dim:0.75");
    expect(html(modal())).toContain("--modal-dim:0.5");
    expect(html(modal({ position: "bottom" }))).toContain('data-position="bottom"');
    expect(html(modal())).not.toContain("data-position");
  });

  it("has no close button when the setting turns it off (Escape and a click outside still close it)", () => {
    expect(html(modal({ closeButton: false }))).not.toContain("<button");
    expect(html(modal({ closeButton: false }))).not.toContain("Lukk");
  });

  it("is drawn in the site's own colours, never fixed ones", () => {
    const out = html(modal());
    expect(out).toContain("bg-background");
    expect(out).toContain("text-foreground");
    expect(out).toContain("border-border");
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(out).not.toMatch(/rgba?\(/);
  });

  it("gives the panel the row's border, corners and shadow", () => {
    const out = html(modal(), { panelStyle: { borderRadius: "12px", boxShadow: "0 1px 2px black" } });
    expect(out).toContain("border-radius:12px");
    expect(out).toContain("box-shadow");
  });
});

describe("a modal row on a page", () => {
  it("is drawn by its row in the place's language, with the row's own content inside the panel", async () => {
    const element = await ModalRow({
      row: row("m", "Twenty per cent off", {
        modal: modal(),
        style: {
          padding: { top: 24, right: 24, bottom: 24, left: 24 },
          margin: { top: 50, right: 0, bottom: 50, left: 0 },
        },
        radius: 16,
        shadow: "lg",
      }),
      place: { pageId: "p", owner: null },
      inAdmin: false,
    });
    const out = renderToString(element).replace(/<!-- -->/g, "");
    expect(out).toContain('aria-label="Dialogvindu"');
    expect(out).toContain('aria-label="Lukk"');
    expect(out).toContain("Twenty per cent off");
    expect(out).toContain("Heading m");
    // The frame is the panel's; inside it the row has its padding, and no margin of its own.
    expect(out).toMatch(/class="page-modal-panel[^"]*"[^>]*style="[^"]*border-radius:16px/);
    expect(out).toContain("padding-top:24px");
    expect(out).not.toContain("margin-top:50px");
  });

  it("is not in the page's flow: it does not take the place of the first or last row", () => {
    const background = { type: "color" as const, color: "#123456" };
    const content = (...rows: PageRow[]): PageContent => ({ ...newPageContent(), title: "Tilbud", rows });
    const hero = row("hero", "Hero");
    const modalWithBackground = row("m", "Popup", { modal: modal(), background });
    // A modal first or last with a background is not the row that meets the header or footer.
    expect(pageRoomClass(content(modalWithBackground, hero, modalWithBackground), "pt-8", "pb-8")).toBe("pt-8 pb-8");
    // The page's own first and last row, with a background, meets the header and footer as before.
    expect(pageRoomClass(content(modalWithBackground, { ...hero, background }), "pt-8", "pb-8")).toBe("");
  });

  it("leaves an ordinary row as it was", () => {
    const out = renderToString(
      createElement(PageRowView, { row: row("a", "Plain row"), place: { pageId: "p", owner: null } }),
    );
    expect(out).toContain("Plain row");
    expect(out).not.toContain("<dialog");
  });
});
