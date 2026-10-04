import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InvoicesView } from "./invoices-view";
import { actions, counts, failing, note, noteRow, plain, query, row, TODAY, waiting } from "./test-fixtures";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

type Props = Partial<Parameters<typeof InvoicesView>[0]>;

const draw = (over: Props = {}) => {
  const html = renderToString(
    h(InvoicesView, {
      base: "/admin/s",
      query: query(),
      today: TODAY,
      counts: counts(),
      invoicingOn: true,
      canWrite: true,
      canSettings: true,
      documents: { rows: [row()], total: 1 },
      waiting: [],
      waitingNotes: [],
      failing: [],
      actions,
      ...over,
    }),
  );
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the invoices tab", () => {
  it("lists an invoice with its number, date, order, buyer, amounts and the links to view and download it", () => {
    const { html, text } = draw();
    expect(text).toContain("F-17");
    expect(text).toContain("5 Oct 2026");
    expect(text).toContain("#1001");
    expect(html).toContain('href="/admin/s/orders/33333333-3333-4333-8333-333333333333"');
    expect(text).toContain("Kari Nordmann");
    expect(text).toContain("Norway");
    expect(text).toContain("NOK 800.00");
    expect(text).toContain("NOK 1,000.00");
    expect(html).toContain('href="/admin/s/invoices/22222222-2222-4222-8222-222222222222/print"');
    expect(html).toContain('href="/admin/s/invoices/22222222-2222-4222-8222-222222222222/pdf"');
    expect(text).toContain("Standard");
  });

  it("says a PDF is made on first download when none is stored yet", () => {
    expect(draw({ documents: { rows: [row({ hasPdf: false })], total: 1 } }).text).toContain("Made on first download");
    expect(draw().text).not.toContain("Made on first download");
  });

  it("shows an anonymised invoice without the buyer, keeping its number and amounts", () => {
    const { text } = draw({ documents: { rows: [row({ anonymised: true, buyerName: "[removed]", hasPdf: false })], total: 1 } });
    expect(text).toContain("Removed after the retention period");
    expect(text).not.toContain("[removed]");
    expect(text).toContain("F-17");
    expect(text).not.toContain("Made on first download");
  });

  it("marks a reverse-charge invoice, and shows the buyer's country by name", () => {
    const { text } = draw({ documents: { rows: [row({ vatKind: "reverse_charge", buyerCountry: "DE", vatMinor: 0 })], total: 1 } });
    expect(text).toContain("Reverse charge");
    expect(text).toContain("Germany");
  });

  it("filters by period and search with a form that reads back what was asked, and offers every period", () => {
    const { html, text } = draw({ query: query({ q: "F-1", from: "2026-09-01", to: "2026-09-30" }) });
    expect(html).toContain('action="/admin/s/invoices"');
    expect(html).toContain('value="2026-09-01"');
    expect(html).toContain('value="F-1"');
    expect(html).toContain('href="/admin/s/invoices?all=1&amp;q=F-1"');
    expect(text).toContain("1 Sep 2026 to 30 Sep 2026");
    expect(text).toContain("1 invoice");
    expect(draw({ query: query({ all: "1" }) }).text).toContain("All periods");
  });

  it("says nothing matched, and what a month with no invoices means", () => {
    expect(draw({ documents: { rows: [], total: 0 }, query: query({ q: "zzz" }) }).text).toContain("No invoices match. Change the period or the search.");
    expect(draw({ documents: { rows: [], total: 0 } }).text).toContain("No invoices this month.");
  });

  it("pages the list when there are more than a page, with links that keep the filter", () => {
    const { html, text } = draw({ documents: { rows: [row()], total: 120 }, query: query({ q: "F", page: "2" }) });
    expect(text).toContain("Page 2 of 3");
    expect(html).toContain("page=3");
    expect(html).toContain('href="/admin/s/invoices?q=F"');
    expect(draw().text).not.toContain("Page 1 of");
  });
});

describe("the credit notes tab", () => {
  it("lists a credit note with the invoice it credits and where it came from, linking its own PDF", () => {
    const { html, text } = draw({ query: query({ tab: "credit-notes" }), documents: { rows: [noteRow()], total: 1 } });
    expect(text).toContain("K-3");
    expect(text).toContain("Credits F-17");
    expect(text).toContain("Refund");
    expect(html).toContain('href="/admin/s/invoices/credit-notes/44444444-4444-4444-8444-444444444444/pdf"');
    expect(html).toContain('name="tab" value="credit-notes"');
    expect(text).toContain("1 credit note");
  });

  it("names a return refunded outside Kaizen", () => {
    expect(draw({ query: query({ tab: "credit-notes" }), documents: { rows: [noteRow({ source: "return_outside" })], total: 1 } }).text).toContain("Return refunded outside Kaizen");
  });

  it("explains an empty month", () => {
    expect(draw({ query: query({ tab: "credit-notes" }), documents: { rows: [], total: 0 } }).text).toContain("No credit notes this month.");
  });
});

describe("the CSV for the accountant", () => {
  it("is a POST form to the export route with the period and the kind, for members who may change orders", () => {
    const { html } = draw({ query: query({ from: "2026-09-01", to: "2026-09-30" }) });
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/admin/s/invoices/export"');
    expect(html).toContain('name="type" value="invoices"');
    expect(html).toContain("Download CSV");
    expect(draw({ query: query({ tab: "credit-notes" }), documents: { rows: [], total: 0 } }).html).toContain('name="type" value="credit_notes"');
  });

  it("is not offered to a member who may only read orders", () => {
    const { html, text } = draw({ canWrite: false });
    expect(html).not.toContain("Download CSV");
    expect(text).toContain("for members who may change orders");
  });

  it("shows why the route sent the person back, as a fixed sentence", () => {
    const { html } = draw({ exportProblem: "Choose a period: a first and a last day, the first not after the last." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Choose a period");
  });
});

describe("what needs a person first", () => {
  it("says every paid order has its invoice when nothing waits", () => {
    expect(draw().text).toContain("Every paid order has its invoice.");
  });

  it("counts what waits in the sentence, the figures and the tab", () => {
    const { html, text } = draw({ counts: counts({ waiting: 2, overdue: 1, pdfFailing: 1 }), waiting: [waiting(), waiting({ orderId: "77777777-7777-4777-8777-777777777777", orderNumber: "1003" })], failing: [failing()] });
    expect(text).toContain("1 past the deadline for a reverse-charge invoice, 2 paid orders are waiting for an invoice, 1 PDF was not made.");
    expect(html).toContain('href="/admin/s/invoices?tab=waiting"');
    expect(text).toContain("Waiting for an invoice");
    expect(text).toContain("PDF not made");
  });

  it("tells an owner, and only an owner, where to switch invoicing on", () => {
    const owner = draw({ invoicingOn: false });
    expect(owner.text).toContain("Invoicing is switched off for this store");
    expect(owner.html).toContain('href="/admin/s/settings/invoices"');
    const member = draw({ invoicingOn: false, canSettings: false });
    expect(member.text).toContain("An owner can switch it on");
    expect(member.html).not.toContain("/settings/invoices");
    expect(draw().text).not.toContain("switched off");
  });
});

describe("the Waiting tab", () => {
  const tab = (over: Props = {}) => draw({ query: query({ tab: "waiting" }), documents: null, counts: counts({ waiting: 1 }), ...over });

  it("says nothing is waiting when nothing is", () => {
    expect(tab({ counts: counts() }).text).toContain("Nothing is waiting.");
  });

  it("lists an order that waits with its payment day, total, why, and where to fix it", () => {
    const { html, text } = tab({ waiting: [waiting()] });
    expect(text).toContain("#1002");
    expect(text).toContain("6 Oct 2026");
    expect(text).toContain("Business details missing");
    expect(text).toContain("Complete your business details.");
    expect(html).toContain('href="/admin/s/settings/company"');
    expect(html).toContain('href="/admin/s/orders/55555555-5555-4555-8555-555555555555"');
    expect(text).toContain("Check again");
  });

  it("flags a reverse-charge invoice past its deadline in alert colours, with the day it was due", () => {
    const { html, text } = tab({ waiting: [waiting({ vatKind: "reverse_charge", overdue: true, deadline: "2026-10-15", reason: "tax_profile_missing", fixAt: "/settings/tax" })] });
    expect(text).toContain("Past the deadline: a reverse-charge invoice is due by 15 Oct 2026.");
    expect(html).toContain("text-red-700");
    expect(text).toContain("Reverse charge");
  });

  it("names a reason with no page to fix it, without a Fix it link", () => {
    const { html, text } = tab({ waiting: [waiting({ reason: "invoice_failed", words: "Making the invoice failed; it is tried again every five minutes.", fixAt: null })] });
    expect(text).toContain("Making the invoice failed");
    expect(html).not.toContain("Fix it");
  });

  it("lists a refund with no credit note, and one credited only in part", () => {
    const { text } = tab({ waitingNotes: [note(), note({ state: "short", refundId: "88888888-8888-4888-8888-888888888888", amountMinor: 2_500 })] });
    expect(text).toContain("No credit note yet");
    expect(text).toContain("Credited in part: the invoice had less left");
    expect(text).toContain("the refund");
    expect(text).toContain("left uncredited");
  });

  it("lists a PDF that could not be made with the tries, the error cut short, and a Try again for members who may change orders", () => {
    const { html, text } = tab({ failing: [failing()] });
    expect(text).toContain("F-17");
    expect(text).toContain("Chromium could not start");
    expect(text).toContain("Try again");
    expect(html).toContain('name="type" value="invoice"');
    expect(html).toContain('name="id" value="22222222-2222-4222-8222-222222222222"');
    expect(html).toContain('href="/admin/s/invoices/22222222-2222-4222-8222-222222222222/print"');
  });

  it("offers neither Check again nor Try again to a member who may only read orders", () => {
    const { html, text } = tab({ canWrite: false, waiting: [waiting()], failing: [failing()] });
    expect(html).not.toContain("Check again</button>");
    expect(html).not.toContain("Try again</button>");
    expect(text).toContain("Members who may change orders can press Check again");
  });
});

describe("what the page leaves out", () => {
  it("draws no free text from an address, and no buyer field beyond the name and the country", () => {
    const { html } = draw({ documents: { rows: [row({ buyerName: "<img src=x onerror=alert(1)>" })], total: 1 } });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
