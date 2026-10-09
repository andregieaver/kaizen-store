import { describe, expect, it } from "vitest";

import { newPageContent, pageExcerpt, pageInput, repeatedHtmlId, rowShows, type PageBlock, type PageContent, type PageRow } from "./page-content";
import { modalDomId, type RowModal } from "./page-modal";
import { duplicateRow, htmlIds, copyRow, patchRow } from "./page-rows";
import { headerOverlays } from "./site-layout";

/**
 * A row with a Modal setting (D121) on a page: what is saved and refused, what a copy of it is, and that it is
 * out of the page's flow for everything that counts rows.
 */

const rich = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});

const modal = (over: Partial<RowModal> = {}): RowModal => ({
  key: "promo",
  triggers: { timer: { seconds: 5 } },
  frequency: "session",
  size: "md",
  ...over,
});

const row = (id: string, text: string, extra: Partial<PageRow> = {}): PageRow => ({
  id,
  type: "row",
  layout: "1",
  columns: [{ id: `${id}-c`, blocks: [{ id: `${id}-b`, type: "richText", doc: rich(text) }] }],
  ...extra,
});

const page = (...rows: PageRow[]): PageContent => ({ ...newPageContent(), title: "Tilbud", slug: "tilbud", rows });

const refused = (content: PageContent) => {
  const parsed = pageInput.safeParse(content);
  return parsed.success ? null : parsed.error.issues.map((issue) => issue.message);
};

describe("a page with modal rows", () => {
  it("keeps the setting of a modal row, and a row without one as it was", () => {
    const content = page(row("a", "Page text"), row("m", "Sign up", { modal: modal({ name: "Newsletter" }) }));
    const parsed = pageInput.parse(content);
    expect(parsed.rows[1].modal).toEqual(modal({ name: "Newsletter" }));
    expect(parsed.rows[0]).not.toHaveProperty("modal");
    // A page saved before modals has no setting anywhere.
    expect(pageInput.parse(page(row("a", "Old page"))).rows[0]).not.toHaveProperty("modal");
  });

  it("takes a modal of every kind of opening", () => {
    const content = page(
      row("m", "Everything", {
        modal: modal({
          triggers: { button: true, className: "open-newsletter", exitIntent: true, timer: { seconds: 30 } },
          frequency: "days",
          days: 14,
          size: "lg",
          position: "bottom",
          overlay: "strong",
          closeOnOverlay: false,
        }),
      }),
    );
    expect(refused(content)).toBeNull();
  });

  it("refuses two modals with the same address name", () => {
    const content = page(row("a", "One", { modal: modal() }), row("b", "Two", { modal: modal() }));
    expect(refused(content)).toEqual(['Two modals on the page have the address name "promo". Give each its own.']);
    expect(
      refused(page(row("a", "One", { modal: modal() }), row("b", "Two", { modal: modal({ key: "other" }) }))),
    ).toBeNull();
  });

  it("refuses a custom id that is a modal's own", () => {
    const content = page(row("a", "One", { modal: modal() }), row("b", "Two", { htmlId: modalDomId("promo") }));
    expect(refused(content)?.[0]).toMatch(/id "modal-promo"/);
  });

  it("refuses a class that is not one safe class name", () => {
    for (const className of ["a b", "1x", "a.b", 'a"b', "x".repeat(41)]) {
      expect(refused(page(row("m", "Text", { modal: modal({ triggers: { className } }) }))), className).not.toBeNull();
    }
  });

  it("refuses a modal nothing opens, and one that cannot be closed", () => {
    expect(refused(page(row("m", "Text", { modal: modal({ triggers: {} }) })))?.[0]).toMatch(
      /at least one way to open/,
    );
    expect(
      refused(page(row("m", "Text", { modal: modal({ closeButton: false, closeOnOverlay: false }) })))?.[0],
    ).toMatch(/way to close/);
    expect(refused(page(row("m", "Text", { modal: modal({ closeButton: false }) })))).toBeNull();
  });

  it("does not count a modal's main heading as the page's", () => {
    const heading = (id: string): PageRow => ({
      id,
      type: "row",
      layout: "1",
      columns: [{ id: `${id}-c`, blocks: [{ id: `${id}-h`, type: "heading", text: "Heading", level: 1 }] }],
    });
    expect(refused(page(heading("a"), { ...heading("b"), modal: modal() }))).toBeNull();
    expect(refused(page(heading("a"), heading("b")))?.[0]).toMatch(/one main heading/);
  });

  it("leaves a modal's words out of the page's description", () => {
    const content = page(row("a", "Everything about our shop."), row("m", "Get 20% off today!", { modal: modal() }));
    expect(pageExcerpt(content)).toBe("Everything about our shop.");
  });

  it("is not the row a header lies over", () => {
    const overlay = { where: "everywhere" as const, categories: [], tags: [] };
    const background = { type: "color" as const, color: "#123456" };
    const at = (rows: PageRow[]) => headerOverlays(overlay, { front: false, categories: [], tags: [], rows });
    expect(at([row("hero", "Hero", { background }), row("x", "More")])).toBe(true);
    // A modal with a background before the hero does not take its place; and one alone leaves the page without a first row.
    expect(at([row("m", "Modal", { modal: modal(), background }), row("hero", "Hero", { background })])).toBe(true);
    expect(at([row("m", "Modal", { modal: modal(), background }), row("plain", "Plain")])).toBe(false);
    expect(at([row("m", "Modal", { modal: modal(), background })])).toBe(false);
  });
});

describe("a modal row that nothing in shows", () => {
  // A new newsletter or email form has no address to send to: the site leaves it out (D93), and a row of nothing else with it.
  const newsletter = (recipients: string[]): PageBlock => ({
    id: "n",
    type: "newsletter",
    recipients,
    placeholder: "",
    submitLabel: "",
    successMessage: "",
    consent: "",
  });
  const only = (block: PageBlock, extra: Partial<PageRow> = {}): PageRow => ({
    id: "m",
    type: "row",
    layout: "1",
    columns: [{ id: "m-c", blocks: [block] }],
    modal: modal({ key: "newsletter", triggers: { button: true } }),
    ...extra,
  });

  it("is not on the site: a form with nobody to send to leaves the row, and so the modal, out", () => {
    expect(rowShows(only(newsletter([])))).toBe(false);
    expect(rowShows(only(newsletter(["owner@example.com"])))).toBe(true);
  });

  it("is on the site once anything else in it shows, or the row has a background of its own", () => {
    const heading: PageBlock = { id: "h", type: "heading", text: "Join us", level: 2 };
    const both: PageRow = { ...only(newsletter([])), columns: [{ id: "m-c", blocks: [heading, newsletter([])] }] };
    expect(rowShows(both)).toBe(true);
    expect(rowShows(only(newsletter([]), { background: { type: "color", color: "#123456" } }))).toBe(true);
    expect(rowShows({ ...only(newsletter([])), columns: [{ id: "m-c", blocks: [newsletter([])], background: { type: "color", color: "#123456" } }] })).toBe(true);
  });
});

describe("copying a modal row", () => {
  let n = 0;
  const id = () => `n${++n}`;

  it("keeps its setting and gives the copy an address name of its own", () => {
    const original = row("m", "Sign up", { modal: modal({ name: "Newsletter", frequency: "days", days: 3 }) });
    const rows = duplicateRow([original], "m", id);
    expect(rows).toHaveLength(2);
    expect(rows[1].modal).toEqual({ ...modal({ name: "Newsletter", frequency: "days", days: 3 }), key: "promo-2" });
    expect(rows[0].modal?.key).toBe("promo");
    // Again: the next is free too, and the whole page saves.
    const more = duplicateRow(rows, "m", id);
    expect(more.map((r) => r.modal?.key)).toEqual(["promo", "promo-3", "promo-2"]);
    expect(refused(page(...more))).toBeNull();
  });

  it("takes a modal's id as a page id, so nothing else takes it", () => {
    const rows = [row("m", "Sign up", { modal: modal() }), row("h", "Text", { htmlId: "hero" })];
    expect([...htmlIds(rows)].sort()).toEqual(["hero", "modal-promo"]);
  });

  it("keeps the key when there is no clash: on another page, or from a saved row", () => {
    const copy = copyRow(row("m", "Sign up", { modal: modal() }), id, htmlIds([row("a", "Other page")]));
    expect(copy.modal?.key).toBe("promo");
    expect(copyRow(row("m", "Sign up", { modal: modal() }), id).modal?.key).toBe("promo");
  });

  it("is set and taken away as any setting of a row is", () => {
    let rows = [row("m", "Text")];
    rows = patchRow(rows, "m", { modal: modal() });
    expect(rows[0].modal?.key).toBe("promo");
    rows = patchRow(rows, "m", { modal: undefined });
    expect(rows[0]).not.toHaveProperty("modal");
  });

  it("stays out of the ids check when the page has none", () => {
    expect(repeatedHtmlId([row("m", "Text", { modal: modal() })])).toBeNull();
    expect(repeatedHtmlId([row("m", "Text", { modal: modal(), htmlId: "modal-promo" })])).toBe("modal-promo");
  });
});
