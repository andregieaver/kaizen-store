import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContractAuditView, ContractDocumentView, type ContractAudit } from "@/components/documents/contract-document-view";

import { fillContract, type ContractBlock } from "./contract-fields";
import { starterTemplate } from "./contract-templates";
import { staticMarkup } from "./static-markup";

/**
 * The documents' renderer (D695): every view a PDF draws is written exactly as `renderToStaticMarkup()` writes it, with text that needs
 * escaping, line breaks, optional clauses left out, formatted words (lists, bold, italic, underline), a quote's lines and both languages. The order documents are held to it in their own
 * tests (`order-document-view*.test.ts`).
 */

const same = (element: Parameters<typeof staticMarkup>[0]) => expect(staticMarkup(element)).toBe(renderToStaticMarkup(element));

const tricky = 'Kunde & Sønn <AS> "Øst" \'Vest\'';

function snapshot(language: "nb" | "en", withQuote: boolean) {
  const template = starterTemplate(language === "nb" ? "nb-NO" : "en-GB");
  const blocks: ContractBlock[] = [
    ...template.blocks,
    { type: "paragraph", text: `Linje én\nLinje to med ${tricky}` },
    { type: "clause", id: "extra", title: "Valgfri", text: "Utelatt.", optional: true, included: false },
    {
      type: "clause",
      id: "formatted",
      title: "Formatert",
      text: "",
      optional: false,
      included: true,
      doc: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Til " }, { type: "text", text: "{customer.name}", marks: [{ type: "bold" }, { type: "underline" }] }, { type: "hardBreak" }, { type: "text", text: tricky, marks: [{ type: "italic" }] }] },
          { type: "paragraph" },
          { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Tre" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Under" }] }] }] }] }] },
        ],
      },
    },
    ...(withQuote ? [{ type: "quote_lines" } as ContractBlock] : []),
  ];
  const values = Object.fromEntries(
    ["customer.name", "customer.email", "customer.phone", "customer.address", "company.name", "company.org_number", "store.name", "store.org_number", "store.address", "deal.title", "deal.value", "contract.date", "contract.expires", "contract.title", "quote.number", "quote.total"].map((k) => [k, `${k} ${tricky}`]),
  );
  return fillContract(
    {
      title: `Avtale ${tricky}`,
      language,
      blocks,
      parties: { store: { name: "Butikken AS", orgNumber: "999 888 777", address: "Storgata 1\n0182 Oslo" }, customer: { name: tricky, orgNumber: null, address: null } },
      signers: [{ role: "store", name: "Selger" }, { role: "customer", name: tricky }],
    },
    { values, quote: withQuote ? { lines: [{ name: `Oppsett ${tricky}`, quantity: 2, unitPrice: "1 000,00 kr", total: "2 000,00 kr" }], total: "2 500,00 kr" } : null },
  ).snapshot;
}

const audit = (language: "nb" | "en"): ContractAudit => ({
  title: `Avtale ${tricky}`,
  language,
  contractId: "00000000-0000-4000-8000-000000000001",
  documentSha256: "a".repeat(64),
  sentAt: "2026-11-19T09:00:00Z",
  completedAt: "2026-11-19T10:00:00Z",
  timeZone: "Europe/Oslo",
  signers: [
    { role: "store", name: "Selger", email: "s@example.com", signedName: "Selger", signedAt: "2026-11-19T09:10:00Z", method: "admin_session", ip: null },
    { role: "customer", name: tricky, email: "k@example.com", signedName: tricky, signedAt: "2026-11-19T10:00:00Z", method: "email_code", ip: "203.0.113.9" },
  ],
  events: [
    { kind: "sent", at: "2026-11-19T09:00:00Z", who: "Selger", ip: null },
    { kind: "viewed", at: "2026-11-19T09:30:00Z", who: tricky, ip: "203.0.113.9" },
    { kind: "completed", at: "2026-11-19T10:00:00Z", who: null, ip: null },
  ],
  sealFingerprint: "b".repeat(64),
});

describe("static markup (D695)", () => {
  it("writes a contract as renderToStaticMarkup does, in both languages, with and without a quote", () => {
    for (const language of ["nb", "en"] as const) {
      for (const withQuote of [true, false]) {
        same(createElement(ContractDocumentView, { snapshot: snapshot(language, withQuote) }));
        same(createElement(ContractDocumentView, { snapshot: snapshot(language, withQuote), level: 2 } as Parameters<typeof ContractDocumentView>[0]));
      }
    }
  });

  it("writes the signing record as renderToStaticMarkup does", () => {
    same(createElement(ContractAuditView, { audit: audit("nb") }));
    same(createElement(ContractAuditView, { audit: audit("en") }));
  });

  it("writes the parts the views use as React does: text, numbers, styles, void elements, aria, fragments and a style block", () => {
    same(
      createElement(
        "div",
        { className: "a", "aria-label": tricky, "data-document": "x", style: { marginTop: 3, fontSize: "9pt", textAlign: "right", lineHeight: 1.4, display: "contents" } },
        createElement("style", null, ".a > b { content: \"&\" }"),
        createElement(Fragment, null, "one ", 2, " ", null, false, tricky, [createElement("br", { key: "b" }), createElement("col", { key: "c", style: { width: "46%" } })]),
        createElement("td", { colSpan: 2, scope: "row", lang: "nb" }, 0),
      ),
    );
  });
});
