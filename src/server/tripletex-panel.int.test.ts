import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { TripletexAccountingCard, TripletexDocumentsPanel } = await import("@/components/admin/tripletex-panel");

import type { DocumentInTripletex, TripletexConnection } from "./tripletex";

/**
 * Tripletex on a Work invoice's page and on Work's settings (D453): each document with its voucher number or why it waits, in the
 * owner's language; Try again only for an owner and only where a person is needed; the card's one link, to set up or to manage.
 */

const documents = [
  { kind: "work_invoice" as const, localId: "00000000-0000-4000-8000-000000000001", number: "W-1042" },
  { kind: "work_credit_note" as const, localId: "00000000-0000-4000-8000-000000000002", number: "WCN-3" },
  { kind: "work_credit_note" as const, localId: "00000000-0000-4000-8000-000000000003", number: "WCN-4" },
  { kind: "work_credit_note" as const, localId: "00000000-0000-4000-8000-000000000004", number: "WCN-5" },
];

const states = new Map<string, DocumentInTripletex>([
  ["work_invoice:00000000-0000-4000-8000-000000000001", { state: "synced", voucher: "2026/145", errorKey: null, detail: null, attached: false }],
  ["work_credit_note:00000000-0000-4000-8000-000000000002", { state: "blocked", voucher: null, errorKey: "closed_period", detail: "date: Perioden er lukket", attached: false }],
  ["work_credit_note:00000000-0000-4000-8000-000000000004", { state: "drifted", voucher: "2026/150", errorKey: "http_404", detail: null, attached: false }],
]);

const render = (lang: "en" | "nb", owner: boolean) =>
  renderToStaticMarkup(createElement(TripletexDocumentsPanel, { lang, storeSlug: "shop", documents, states, owner }));

describe("Tripletex on a document's own page (D453)", () => {
  it("says where each one stands, and why one waits, with what Tripletex said", () => {
    const html = render("en", true);
    expect(html).toContain("Invoice W-1042");
    expect(html).toContain("In Tripletex as voucher 2026/145");
    expect(html).toContain("Credit note WCN-3");
    expect(html).toContain("Tripletex has closed the accounting period for this date.");
    expect(html).toContain("Tripletex said: date: Perioden er lukket");
    // Issued before Tripletex was started: never sent, and said so.
    expect(html).toContain("Not sent: issued before Tripletex was started");
    expect(html).toContain('href="/admin/shop/integrations/tripletex"');
  });

  it("offers an owner Try again for the one that waits, Post again for one deleted in Tripletex and Check for one booked, and nobody else anything", () => {
    const buttons = (html: string) => html.match(/<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const owner = buttons(render("en", true)).map((b) => b.replace(/<[^>]+>/g, "").trim());
    expect(owner).toEqual(["Check in Tripletex", "Try again", "Post again"]);
    expect(buttons(render("en", false))).toHaveLength(0);
    expect(render("en", true)).toContain("This was deleted in Tripletex. Post it again, or leave it out.");
  });

  it("speaks the owner's language", () => {
    const html = render("nb", true);
    expect(html).toContain("Faktura W-1042");
    expect(html).toContain("I Tripletex som bilag 2026/145");
    expect(html).toContain("Prøv igjen");
    expect(html).not.toContain("In Tripletex");
  });
});

describe("Tripletex on Work's settings", () => {
  const connection = { mode: "live", state: "on", company: { id: 1, name: "Human Web AS", organizationNumber: "912345678" } } as unknown as TripletexConnection;

  it("invites to connect a store that is not, and leads a connected one to its page", () => {
    const none = renderToStaticMarkup(createElement(TripletexAccountingCard, { lang: "en", storeSlug: "shop", connection: null, needYou: 0 }));
    expect(none).toContain("Connect Tripletex");
    const on = renderToStaticMarkup(createElement(TripletexAccountingCard, { lang: "en", storeSlug: "shop", connection, needYou: 0 }));
    expect(on).toContain("Connected to Human Web AS");
    expect(on).toContain("Open Tripletex");
    const waiting = renderToStaticMarkup(createElement(TripletexAccountingCard, { lang: "nb", storeSlug: "shop", connection, needYou: 2 }));
    expect(waiting).toContain("På · trenger deg");
  });
});
