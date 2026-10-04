import { describe, expect, it } from "vitest";

import {
  checkAgainSentence,
  countsSentence,
  dayLabel,
  documentPdfHref,
  documentPrintHref,
  exportProblemOf,
  invoicesHref,
  monthStart,
  parseInvoiceQuery,
  sentAgainSentence,
  vatKindLabel,
  WAITING_TITLES,
} from "./invoice-admin";
import { WAITING_REASONS } from "./invoice-readiness";

const TODAY = "2026-10-14";

describe("what the address asks the invoices page for", () => {
  it("is the invoices tab and this month, to today, when the address says nothing", () => {
    expect(parseInvoiceQuery({}, TODAY)).toEqual({ tab: "invoices", from: "2026-10-01", to: TODAY, q: "", all: false, page: 1 });
  });

  it("reads the tab, the days, the search and the page, and ignores what it cannot read", () => {
    expect(parseInvoiceQuery({ tab: "credit-notes", from: "2026-09-01", to: "2026-09-30", q: "  F-12 ", page: "3" }, TODAY)).toEqual({
      tab: "credit-notes",
      from: "2026-09-01",
      to: "2026-09-30",
      q: "F-12",
      all: false,
      page: 3,
    });
    expect(parseInvoiceQuery({ tab: "waiting" }, TODAY).tab).toBe("waiting");
    expect(parseInvoiceQuery({ tab: "drop table" }, TODAY).tab).toBe("invoices");
    expect(parseInvoiceQuery({ from: "yesterday", to: "2026-02-31", page: "-1" }, TODAY)).toMatchObject({ from: "2026-10-01", to: TODAY, page: 1 });
    expect(parseInvoiceQuery({ page: "0" }, TODAY).page).toBe(1);
  });

  it("puts a first day after the last right by swapping them, never refusing", () => {
    expect(parseInvoiceQuery({ from: "2026-10-10", to: "2026-10-02" }, TODAY)).toMatchObject({ from: "2026-10-02", to: "2026-10-10" });
  });

  it("asks for every period with all=1, and then has no days", () => {
    expect(parseInvoiceQuery({ all: "1", from: "2026-01-01" }, TODAY)).toMatchObject({ all: true, from: null, to: null });
  });

  it("takes the first of several values and cuts a long search", () => {
    expect(parseInvoiceQuery({ q: ["a", "b"] }, TODAY).q).toBe("a");
    expect(parseInvoiceQuery({ q: "x".repeat(300) }, TODAY).q).toHaveLength(100);
  });

  it("finds the first of the month of any day", () => {
    expect(monthStart("2026-12-31")).toBe("2026-12-01");
  });
});

describe("the addresses of the page and of a document", () => {
  const here = "/admin/kaffe/invoices";

  it("writes only what differs from the default", () => {
    expect(invoicesHref(here, {})).toBe(here);
    expect(invoicesHref(here, { tab: "invoices", from: "2026-10-01", to: TODAY }, TODAY)).toBe(here);
    expect(invoicesHref(here, { tab: "credit-notes" })).toBe(`${here}?tab=credit-notes`);
    expect(invoicesHref(here, { tab: "waiting" })).toBe(`${here}?tab=waiting`);
    expect(invoicesHref(here, { all: true, q: "F-1" })).toBe(`${here}?all=1&q=F-1`);
    expect(invoicesHref(here, { from: "2026-09-01", to: "2026-09-30", page: 2 }, TODAY)).toBe(`${here}?from=2026-09-01&to=2026-09-30&page=2`);
  });

  it("round-trips through the parser", () => {
    const query = parseInvoiceQuery({ tab: "credit-notes", from: "2026-09-01", to: "2026-09-30", q: "a b&c", page: "2" }, TODAY);
    const href = invoicesHref(here, query, TODAY);
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseInvoiceQuery(params, TODAY)).toEqual(query);
  });

  it("finds a document's PDF and printable view, the credit note's under the invoices", () => {
    expect(documentPdfHref("/admin/k", "invoice", "abc")).toBe("/admin/k/invoices/abc/pdf");
    expect(documentPdfHref("/admin/k", "credit_note", "abc")).toBe("/admin/k/invoices/credit-notes/abc/pdf");
    expect(documentPrintHref("/admin/k", "invoice", "abc")).toBe("/admin/k/invoices/abc/print");
    expect(documentPrintHref("/admin/k", "credit_note", "abc")).toBe("/admin/k/invoices/credit-notes/abc/print");
  });
});

describe("the words", () => {
  it("names every reason an order can wait, so the Waiting tab has a title for each", () => {
    for (const reason of [...WAITING_REASONS, "invoice_failed" as const]) expect(WAITING_TITLES[reason]).toMatch(/\w/);
  });

  it("says what needs a person first, and says so when nothing does", () => {
    expect(countsSentence({ waiting: 0, overdue: 0, pdfFailing: 0 })).toBe("Every paid order has its invoice.");
    expect(countsSentence({ waiting: 1, overdue: 0, pdfFailing: 0 })).toBe("1 paid order is waiting for an invoice.");
    expect(countsSentence({ waiting: 3, overdue: 2, pdfFailing: 1 })).toBe(
      "2 past the deadline for a reverse-charge invoice, 3 paid orders are waiting for an invoice, 1 PDF was not made.",
    );
  });

  it("says what Check again did", () => {
    expect(checkAgainSentence(0, 0)).toMatch(/Nothing new/);
    expect(checkAgainSentence(1, 0)).toBe("1 invoice issued.");
    expect(checkAgainSentence(2, 1)).toBe("2 invoices issued and 1 credit note issued.");
  });

  it("says what sending a document again did, and why not", () => {
    expect(sentAgainSentence("invoice", "sent")).toEqual({ ok: true, message: "The invoice was sent to the order's email address." });
    expect(sentAgainSentence("credit_note", "logged").ok).toBe(true);
    expect(sentAgainSentence("credit_note", "duplicate").ok).toBe(false);
    expect(sentAgainSentence("invoice", null).message).toMatch(/could not be sent/);
    expect(sentAgainSentence("invoice", "failed").ok).toBe(false);
  });

  it("writes a store day as the admin does, and leaves what is not a day as it is", () => {
    expect(dayLabel("2026-10-05")).toBe("5 Oct 2026");
    expect(dayLabel("2026-10-05T22:00:00Z")).toBe("5 Oct 2026");
    expect(dayLabel(null)).toBe("–");
    expect(dayLabel("soon")).toBe("soon");
  });

  it("labels the treatments, and shows a dash for none", () => {
    expect(vatKindLabel("reverse_charge")).toBe("Reverse charge");
    expect(vatKindLabel("ioss")).toBe("IOSS");
    expect(vatKindLabel(null)).toBe("–");
  });

  it("turns the CSV route's code into a fixed sentence, and nothing else", () => {
    expect(exportProblemOf("period")).toMatch(/Choose a period/);
    expect(exportProblemOf("too_many")).toMatch(/20,000/);
    expect(exportProblemOf("<script>")).toBeNull();
    expect(exportProblemOf("toString")).toBeNull();
    expect(exportProblemOf(undefined)).toBeNull();
  });
});
