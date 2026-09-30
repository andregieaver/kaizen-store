import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { vatNotesFor } from "@/lib/work-vat";
import type { CreditNoteSummary, InvoicePayment } from "@/server/work-invoices";

// The actions are server code (they import the database); the buttons call them only when pressed.
vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions", () => ({}));
vi.mock("@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-view-actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { IssuedInvoiceView } from "./invoice-issued";
import { STORE, clean, issuedDetail, line, secondLine, LINE_A } from "./invoice-test-support";
import { AssignmentInvoicesSlot, BillUnbilledTimeSlot, ClientInvoicesSlot } from "./invoice-slots";

type Props = ComponentProps<typeof IssuedInvoiceView>;

const render = (over: Partial<Props> = {}) =>
  clean(
    renderToString(
      createElement(IssuedInvoiceView, {
        storeSlug: STORE,
        locale: "en",
        timeZone: "Europe/Oslo",
        detail: issuedDetail(),
        isOwner: true,
        homeCurrency: "NOK",
        ...over,
      }),
    ),
  );

const payment = (over: Partial<InvoicePayment> = {}): InvoicePayment => ({
  id: "p1",
  amountMinor: 125_000,
  currency: "NOK",
  receivedOn: "2026-09-20",
  method: "bank",
  reference: "KID 123",
  reverses: null,
  reversed: false,
  refund: false,
  recordedByName: "Kari",
  createdAt: "2026-09-20T10:00:00.000Z",
  ...over,
});

const note = (over: Partial<CreditNoteSummary> = {}): CreditNoteSummary => ({
  id: "cn1",
  documentNumber: "WCN-1",
  issuedOn: "2026-09-22",
  currency: "NOK",
  reason: "Wrong hours",
  subtotalMinor: 90_000,
  vatMinor: 22_500,
  totalMinor: 112_500,
  lines: [
    {
      lineId: LINE_A,
      position: 0,
      description: "Design workshop",
      unit: "hour",
      quantityHundredths: 75,
      unitPriceMinor: 120_000,
      discountBp: 0,
      vatCategory: "standard",
      vatBp: 2500,
      exclMinor: 90_000,
      vatMinor: 22_500,
      inclMinor: 112_500,
    },
  ],
  createdAt: "2026-09-22T10:00:00.000Z",
  createdByName: "Kari",
  ...over,
});

describe("an issued invoice", () => {
  it("shows the document as it was issued, read-only: number, dates, parties and lines", () => {
    const html = render();
    expect(html).toContain("The document");
    expect(html).toContain("W-12");
    expect(html).toContain("09/15/2026");
    expect(html).toContain("09/29/2026");
    expect(html).toContain("14 days to pay");
    expect(html).toContain("PO-7");
    expect(html).toContain("Norwegian");
    // The buyer and seller are the snapshot, not the client's page.
    expect(html).toContain("Acme Aktiebolag");
    expect(html).toContain("Storgatan 1, 111 22 Stockholm, SE");
    expect(html).toContain("Kaffe AS");
    expect(html).toContain("Kaffegata 1, 0150 Oslo");
    expect(html).toContain("VAT number NO999888777MVA");
    expect(html).toContain("Account NO9386011117947, BIC DNBANOKK");
    expect(html).toContain("Changing the client or your settings later does not change it.");
    // No input on the lines or the header: an issued invoice cannot be edited.
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Add line");
    expect(html).not.toContain("Delete draft");
    expect(html).toContain("Design workshop");
    expect(html).toContain("1.75 h");
    expect(html).toContain("2 units");
    expect(html).toContain("NOK 2,625.00");
  });

  it("shows the amounts, and what is outstanding with how late it is", () => {
    const base = issuedDetail();
    const html = render({
      detail: issuedDetail(
        { overdue: true, daysOverdue: 5, invoice: { ...base.invoice, dueOn: "2026-09-24" } },
        { paidMinor: 125_000, outstandingMinor: 200_000 },
      ),
    });
    for (const label of ["Total with VAT", "Paid", "Credited", "Outstanding"]) expect(html).toContain(label);
    expect(html).toContain("NOK 3,250.00");
    expect(html).toContain("NOK 1,250.00");
    expect(html).toContain("NOK 2,000.00");
    expect(html).toContain("5 days overdue");
    expect(html).toContain("Overdue");
    expect(html).toContain("Amount without VAT");
    expect(html).toContain("VAT 25 %");
  });

  it("has the actions of an open invoice: record payment, credit, preview or print, and a place for sending", () => {
    const html = render();
    expect(html).toContain(">Record payment<");
    expect(html).toContain(">Credit invoice<");
    expect(html).toContain('href="/admin/account/work/s/kaffe/invoices/6f1c0f37-5f39-4d0e-9d55-7f0d0f6a3001/print"');
    expect(html).toContain("Preview or print");
  });

  it("lists payments with a way to reverse each received one, and marks reversals and refunds", () => {
    const html = render({
      detail: issuedDetail(
        {
          payments: [
            payment(),
            payment({ id: "p2", amountMinor: 50_000, reversed: true, receivedOn: "2026-09-21" }),
            payment({ id: "p3", amountMinor: -50_000, reverses: "p2", receivedOn: "2026-09-22" }),
            payment({ id: "p4", amountMinor: -10_000, refund: true, receivedOn: "2026-09-23" }),
          ],
        },
        { paidMinor: 125_000, outstandingMinor: 200_000 },
      ),
    });
    expect(html).toContain("KID 123");
    expect(html).toContain("Recorded by Kari.");
    expect(html).toContain("bank transfer");
    expect(html).toContain("Reversed");
    expect(html).toContain("Reversal");
    expect(html).toContain("Paid back");
    expect(html).toContain("−NOK 500.00");
    // Only a received payment that is not reversed can be reversed.
    expect(html.match(/>Reverse</g)).toHaveLength(1);
    expect(html).toContain('aria-label="Reverse the NOK 1,250.00 payment of 09/20/2026"');
    expect(render()).toContain("No payment has been recorded.");
  });

  it("lists credit notes with their reason and lines, and what is left to credit on a line", () => {
    const html = render({
      detail: issuedDetail(
        {
          creditNotes: [note()],
          credited: true,
          lines: [line({ creditedQuantityHundredths: 75 }), secondLine()],
        },
        { creditedMinor: 112_500, outstandingMinor: 212_500 },
      ),
    });
    expect(html).toContain("WCN-1");
    expect(html).toContain("09/22/2026");
    expect(html).toContain("Wrong hours");
    expect(html).toContain("Design workshop (0.75)");
    expect(html).toContain("Credited: 0.75");
    expect(html).toContain("Issued by Kari.");
    expect(html).toContain('href="/admin/account/work/s/kaffe/credit-notes/cn1/print"');
    expect(html).toContain("Preview or print WCN-1");
    expect(render()).toContain("This invoice has not been credited.");
  });

  it("shows the history as it happened, newest first, with who and when", () => {
    const html = render();
    expect(html).toContain("Issued as W-12");
    expect(html).toContain("Draft created");
    expect(html.indexOf("Issued as W-12")).toBeLessThan(html.indexOf("Draft created"));
    expect(html).toContain("Kari");
    expect(html).toContain("Sep 15, 2026");
  });

  it("keeps the credit button off for an admin and says an owner does it", () => {
    const html = render({ isOwner: false });
    expect(html).toMatch(/<button type="button" disabled="" aria-describedby="[^"]+"[^>]*>Credit invoice/);
    expect(html).toContain("Only an owner can credit an invoice.");
    expect(html).toContain(">Record payment<");
  });

  it("a paid invoice has no Record payment, and a void one takes no payment or credit", () => {
    const paid = render({
      detail: issuedDetail(
        { invoice: { ...issuedDetail().invoice, status: "paid", paidAt: "2026-09-28T10:00:00.000Z" } },
        { paidMinor: 325_000, outstandingMinor: 0 },
      ),
    });
    expect(paid).not.toContain(">Record payment<");
    expect(paid).toContain(">Credit invoice<");
    expect(paid).toContain("Paid");
    expect(paid).toContain("09/28/2026");
    const voided = render({
      detail: issuedDetail(
        { invoice: { ...issuedDetail().invoice, status: "void" }, creditNotes: [note()], credited: true },
        { creditedMinor: 325_000, outstandingMinor: 0 },
      ),
    });
    expect(voided).not.toContain(">Record payment<");
    expect(voided).not.toContain(">Credit invoice<");
    expect(voided).toContain("Void");
    expect(voided).toContain("Fully credited");
  });

  it("states the VAT in the seller's currency for a foreign-currency invoice, and the statutory note", () => {
    const base = issuedDetail();
    const html = render({
      homeCurrency: "SEK",
      detail: issuedDetail({
        invoice: {
          ...base.invoice,
          currency: "EUR",
          vatHomeMinor: 57_500,
          fxRate: "11.50000000",
          vatNotes: ["reverse_charge"],
        },
      }),
    });
    expect(html).toContain("VAT in SEK");
    expect(html).toContain("Exchange rate 11.50000000");
    expect(html).toContain("EUR");
    // The note is the document's own text, in the invoice's language (Norwegian here), not the editor's English.
    const [statutory] = vatNotesFor(["reverse_charge"], "nb", "NO");
    expect(statutory.text.length).toBeGreaterThan(10);
    expect(html).toContain(statutory.text.replace(/'/g, "&#x27;"));
  });

  it("stacks the lines as cards on a phone and a table for larger screens", () => {
    const html = render();
    expect(html).toContain("md:hidden");
    expect(html).toContain("hidden overflow-x-auto md:block");
    expect(html).toContain('scope="col"');
  });
});

describe("the places on the client and assignment pages", () => {
  it("draw the client's invoices with New invoice, the list streaming in", () => {
    const html = clean(
      renderToString(
        createElement(ClientInvoicesSlot, {
          storeSlug: STORE,
          clientId: "c1",
          clientName: "Acme AB",
          currency: "SEK",
          locale: "en",
          archived: false,
          unbilledMinutes: 0,
        }),
      ),
    );
    expect(html).toContain('data-slot="client-invoices"');
    expect(html).toContain(">Invoices<");
    expect(html).toContain(">New invoice<");
    expect(html).toContain('href="/admin/account/work/s/kaffe/invoices?client=c1"');
    const archived = clean(
      renderToString(
        createElement(ClientInvoicesSlot, {
          storeSlug: STORE,
          clientId: "c1",
          clientName: "Acme AB",
          currency: "SEK",
          locale: "en",
          archived: true,
          unbilledMinutes: 0,
        }),
      ),
    );
    expect(archived).not.toContain(">New invoice<");
  });

  it("draw the assignment's invoices, opening its draft instead of starting another", () => {
    const props = {
      storeSlug: STORE,
      assignmentId: "a1",
      assignmentName: "Website rebuild",
      clientId: "c1",
      currency: "SEK",
      locale: "en",
      issuedInvoices: 0,
      unbilledMinutes: 0,
      unbilledAmountMinor: 0,
    };
    const none = clean(renderToString(createElement(AssignmentInvoicesSlot, { ...props, draftInvoiceId: null })));
    expect(none).toContain('data-slot="assignment-invoices"');
    expect(none).toContain(">New invoice<");
    const draft = clean(renderToString(createElement(AssignmentInvoicesSlot, { ...props, draftInvoiceId: "d1" })));
    expect(draft).toContain('href="/admin/account/work/s/kaffe/invoices/d1"');
    expect(draft).toContain(">Open the draft<");
    expect(draft).not.toContain(">New invoice<");
    expect(draft).toContain("There is one draft at a time.");
  });

  it("draw Bill unbilled time only when there is time to bill, with what it comes to", () => {
    const none = clean(
      renderToString(
        createElement(BillUnbilledTimeSlot, {
          storeSlug: STORE,
          scope: { clientId: "c1" },
          currency: "SEK",
          locale: "en",
          unbilledMinutes: 0,
          unbilledAmountMinor: 0,
        }),
      ),
    );
    expect(none).toBe("");
    const some = clean(
      renderToString(
        createElement(BillUnbilledTimeSlot, {
          storeSlug: STORE,
          scope: { assignmentId: "a1" },
          currency: "SEK",
          locale: "en",
          unbilledMinutes: 200,
          unbilledAmountMinor: 366_667,
        }),
      ),
    );
    expect(some).toContain("3h 20m");
    expect(some).toContain("SEK 3,666.67");
    expect(some).toContain(">Bill unbilled time<");
    expect(some).toContain("without VAT");
  });
});
