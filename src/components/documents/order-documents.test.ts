import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { documentHref, documentPdfHref, OrderDocuments, type OrderDocumentsProps } from "./order-documents";

const TOKEN_I = `inv_${"a".repeat(43)}`;
const TOKEN_C = `crn_${"b".repeat(43)}`;

const props = (over: Partial<OrderDocumentsProps> = {}): OrderDocumentsProps => ({
  lang: "en",
  locale: "en-IE",
  base: "/s/demo/ie",
  invoice: { id: "i1", documentNumber: "F-17", issuedOn: "2026-10-04", token: TOKEN_I },
  creditNotes: [{ id: "c1", documentNumber: "K-3", issuedOn: "2026-10-09", token: TOKEN_C }],
  testOrder: false,
  ...over,
});
const render = (p: OrderDocumentsProps) => renderToStaticMarkup(createElement(OrderDocuments, p));
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the documents of an order", () => {
  it("lists the invoice and each credit note with a link to read it and one to its PDF", () => {
    const html = render(props());
    expect(words(html)).toContain("Documents");
    expect(words(html)).toContain("Invoice F-17, 04/10/2026");
    expect(words(html)).toContain("Credit note K-3, 09/10/2026");
    expect(html).toContain(`href="/s/demo/ie/account/documents/${TOKEN_I}"`);
    expect(html).toContain(`href="/s/demo/ie/account/documents/${TOKEN_I}/pdf"`);
    expect(html).toContain(`href="/s/demo/ie/account/documents/${TOKEN_C}/pdf"`);
    expect(html).toContain('aria-labelledby="documents-heading"');
    expect(documentHref("/s/demo/ie", TOKEN_I)).toBe(`/s/demo/ie/account/documents/${TOKEN_I}`);
    expect(documentPdfHref("/s/demo/ie", TOKEN_I)).toBe(`/s/demo/ie/account/documents/${TOKEN_I}/pdf`);
  });

  it("gives each link a name that says which document it is (for a screen reader)", () => {
    const html = render(props());
    expect(html).toContain('<span class="sr-only">: Invoice F-17, 04/10/2026</span>');
    expect(html).toContain('<span class="sr-only">: Credit note K-3, 09/10/2026</span>');
  });

  it("reads in Norwegian, Swedish, Danish and English and in English for another language", () => {
    expect(words(render(props({ lang: "nb", locale: "nb-NO" })))).toContain("Dokumenter");
    expect(words(render(props({ lang: "nb", locale: "nb-NO" })))).toContain("Faktura F-17, 04.10.2026");
    expect(words(render(props({ lang: "nb", locale: "nb-NO" })))).toContain("Kreditnota K-3");
    expect(words(render(props({ lang: "sv", locale: "sv-SE" })))).toContain("Kreditfaktura K-3");
    expect(words(render(props({ lang: "da", locale: "da-DK" })))).toContain("Dokumenter");
    expect(words(render(props({ lang: "fi", locale: "fi-FI" })))).toContain("Credit note K-3");
  });

  it("shows only the invoice for an order with no refund, and an anonymised document without links", () => {
    expect(words(render(props({ creditNotes: [] })))).not.toContain("Credit note");
    const html = render(props({ invoice: { id: "i1", documentNumber: "F-17", issuedOn: "2026-10-04", token: null }, creditNotes: [] }));
    expect(words(html)).toContain("Invoice F-17");
    expect(html).not.toContain("<a ");
  });

  it("says nothing at all for an order with no invoice: copied, a host's, invoicing off or one still waiting", () => {
    expect(render(props({ invoice: null, creditNotes: [] }))).toBe("");
  });

  it("says that a test order has no invoice, in the shopper's language", () => {
    expect(words(render(props({ invoice: null, creditNotes: [], testOrder: true })))).toContain("Test order: no invoice.");
    expect(words(render(props({ invoice: null, creditNotes: [], testOrder: true, lang: "nb", locale: "nb-NO" })))).toContain("Testbestilling: ingen faktura.");
  });

  it("sets no cookie and uses no storage, and loads nothing from elsewhere", () => {
    const html = render(props());
    expect(html).not.toMatch(/<script|<img|<link|\ssrc=|https?:\/\//i);
  });
});
