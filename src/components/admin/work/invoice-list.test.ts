import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { parseInvoiceListParams } from "@/lib/work-invoice-ui";
import type { InvoiceList } from "@/server/work-invoices";
import type { NewInvoiceChoices } from "@/server/work-invoice-screens";

// The actions are server code (they import the database); the screens call them only when a button is pressed.
vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/(gated)/[store]/work/invoice-actions", () => ({}));
vi.mock("@/app/admin/(gated)/[store]/work/invoice-view-actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { NewInvoiceLoader } from "./invoice-create-dialog";
import { InvoicesListView, tabCount } from "./invoices-list";
import { ASSIGNMENT, CLIENT, STORE, TODAY, clean, listRow } from "./invoice-test-support";

const choices: NewInvoiceChoices = {
  clients: [
    { id: CLIENT, name: "Acme AB", currency: "SEK", rateMinor: 110_000 },
    { id: "c2", name: "Bolag AS", currency: "NOK", rateMinor: null },
  ],
  assignments: [
    { id: ASSIGNMENT, clientId: CLIENT, name: "Website rebuild", draftInvoiceId: null },
    { id: "a2", clientId: CLIENT, name: "Support", draftInvoiceId: "d1" },
  ],
  currencies: ["EUR", "NOK", "SEK"],
};

const list = (over: Partial<InvoiceList> = {}): InvoiceList => ({
  rows: [
    listRow({ id: "i-draft", status: "draft", documentNumber: null, issuedOn: null, dueOn: null, outstandingMinor: 0 }),
    listRow({
      id: "i-late",
      documentNumber: "W-10",
      dueOn: "2026-09-10",
      outstandingMinor: 200_000,
      paidMinor: 125_000,
      overdue: true,
      daysOverdue: 19,
    }),
    listRow({ id: "i-soon", documentNumber: "W-11", dueOn: "2026-10-03" }),
    listRow({ id: "i-ok", documentNumber: "W-12", dueOn: "2026-10-29" }),
    listRow({ id: "i-paid", documentNumber: "W-9", status: "paid", outstandingMinor: 0, paidMinor: 325_000 }),
    listRow({ id: "i-void", documentNumber: "W-8", status: "void", outstandingMinor: 0, creditedMinor: 325_000 }),
  ],
  total: 6,
  page: 1,
  pageSize: 25,
  today: TODAY,
  counts: { draft: 1, sent: 3, paid: 1, void: 1, overdue: 1 },
  ...over,
});

const view = (over: Partial<Parameters<typeof InvoicesListView>[0]> = {}) =>
  clean(
    renderToString(
      createElement(InvoicesListView, {
        storeSlug: STORE,
        locale: "en",
        list: list(),
        params: parseInvoiceListParams({}),
        clients: [
          { id: CLIENT, name: "Acme AB" },
          { id: "c2", name: "Bolag AS" },
        ],
        choices,
        ...over,
      }),
    ),
  );

describe("the invoices list", () => {
  it("has a tab for each status with its count, and marks the one shown", () => {
    const html = view({ params: parseInvoiceListParams({ show: "overdue" }) });
    for (const [label, count] of [
      ["All", 6],
      ["Drafts", 1],
      ["Issued", 3],
      ["Overdue", 1],
      ["Paid", 1],
      ["Void", 1],
    ] as const) {
      expect(html).toMatch(new RegExp(`>${label}<span[^>]*>${count}</span>`));
    }
    expect(html).toMatch(
      /href="\/admin\/kaffe\/work\/invoices\?show=overdue"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/kaffe\/work\/invoices\?show=overdue"/,
    );
    expect(html).toContain('href="/admin/kaffe/work/invoices?show=drafts"');
    expect(html).toContain('aria-label="Invoice status"');
    expect(tabCount("all", list().counts)).toBe(6);
  });

  it("shows each invoice with its number, client, dates, amounts and a status in words", () => {
    const html = view();
    expect(html).toContain('href="/admin/kaffe/work/invoices/i-late"');
    for (const word of ["Draft", "Overdue", "19 days late", "Due soon", "Due in 4 days", "Issued", "Paid", "Void"])
      expect(html).toContain(word);
    expect(html).toContain("W-10");
    expect(html).toContain("Acme AB");
    expect(html).toContain("Website rebuild");
    expect(html).toContain("09/15/2026");
    expect(html).toContain("NOK 3,250.00");
    // Outstanding only for issued ones; a credited one says so.
    expect(html).toContain("NOK 2,000.00");
    expect(html).toContain("NOK 3,250.00 credited");
    // A table for larger screens, cards for phones.
    expect(html).toContain("<table");
    expect(html).toContain('aria-label="Invoices"');
  });

  it("keeps the filters in a labelled form that searches by address, and offers to clear them", () => {
    const plain = view();
    for (const label of ["Client", "Issued from", "Issued to", "Search"]) expect(plain).toContain(label);
    expect(plain).toContain('method="get"');
    expect(plain).not.toContain(">Clear<");
    const filtered = view({ params: parseInvoiceListParams({ show: "paid", client: CLIENT, q: "acme" }) });
    expect(filtered).toContain('type="hidden" name="show" value="paid"');
    expect(filtered).toContain(">Clear<");
    expect(filtered).toContain('value="acme"');
    expect(filtered).toContain(`<option value="${CLIENT}" selected`);
  });

  it("pages, with links that keep the filters", () => {
    const paged = view({
      list: list({ total: 60, page: 2, pageSize: 25 }),
      params: parseInvoiceListParams({ show: "sent", page: "2" }),
    });
    expect(paged).toContain("Page 2 of 3, 60 invoices");
    expect(paged).toContain('href="/admin/kaffe/work/invoices?show=sent"');
    expect(paged).toContain('href="/admin/kaffe/work/invoices?show=sent&amp;page=3"');
    expect(view()).not.toContain("Page 1 of");
  });

  it("says why it is empty: nothing yet, or nothing matches", () => {
    const none = view({
      list: list({ rows: [], total: 0, counts: { draft: 0, sent: 0, paid: 0, void: 0, overdue: 0 } }),
    });
    expect(none).toContain("No invoices yet.");
    const nothing = view({ list: list({ rows: [], total: 0 }), params: parseInvoiceListParams({ q: "zzz" }) });
    expect(nothing).toContain("No invoice matches.");
    expect(nothing).not.toContain("<table");
  });

  it("has the New invoice button, shut until it is pressed", () => {
    const html = view();
    expect(html).toContain(">New invoice<");
    expect(html).toContain("<h1");
    expect(html).not.toContain("Start the draft");
  });

  it("opens the New invoice dialog at once when the overview sends people to start one", () => {
    expect(view({ openNew: true })).toContain("Start the draft");
  });
});

describe("the new invoice dialog", () => {
  const open = (props: Partial<Parameters<typeof NewInvoiceLoader>[0]> = {}) =>
    clean(renderToString(createElement(NewInvoiceLoader, { storeSlug: STORE, choices, onClose: () => {}, ...props })));

  it("asks for the client, an optional assignment and the currency, all labelled", () => {
    const html = open();
    for (const label of ["Client", "Assignment (optional)", "Currency"]) expect(html).toContain(label);
    expect(html).toContain("Choose a client");
    expect(html).toContain("None: an invoice on its own");
    expect(html).toContain(">Start the draft<");
    expect(html).toContain("gets its number when you issue");
    // The assignments of a client are offered once it is chosen.
    expect(html).not.toContain("Website rebuild");
  });

  it("starts from a client's page with the client chosen and its currency", () => {
    const html = open({ clientId: CLIENT });
    expect(html).toContain(`<option value="${CLIENT}" selected`);
    expect(html).toContain('<option value="SEK" selected');
    expect(html).toContain("Website rebuild");
    expect(html).toContain("Support (has a draft)");
  });

  it("offers to open the draft an assignment already has, instead of starting another", () => {
    const html = open({ clientId: CLIENT, assignmentId: "a2" });
    expect(html).toContain("This assignment already has a draft invoice.");
    expect(html).toContain('href="/admin/kaffe/work/invoices/d1"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start the draft/);
  });

  it("sends a store without clients to add one", () => {
    const html = open({ choices: { clients: [], assignments: [], currencies: ["EUR"] } });
    expect(html).toContain("There is no client to invoice yet.");
    expect(html).toContain('href="/admin/kaffe/work/clients"');
  });

  it("reads its choices itself when the page did not bring them", () => {
    expect(open({ choices: undefined })).toContain("Reading your clients");
  });
});
