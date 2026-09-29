import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The actions are server code (they import the database); the dialogs call them only when submitted.
vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/(gated)/[store]/work/invoice-actions", () => ({}));
vi.mock("@/app/admin/(gated)/[store]/work/invoice-view-actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { CreditForm, CreditInvoiceButton } from "./invoice-credit-dialog";
import { IssueDialog } from "./invoice-issue-dialog";
import { PaymentForm, RecordPaymentButton, ReversePaymentButton } from "./invoice-payments";
import { UnbilledTimeDialog } from "./invoice-unbilled-dialog";
import {
  ASSIGNMENT,
  CLIENT,
  INVOICE,
  LINE_A,
  LINE_B,
  STORE,
  TODAY,
  clean,
  issuedDetail,
  line,
  notReady,
  readyReadiness,
  secondLine,
} from "./invoice-test-support";

const html = (element: Parameters<typeof renderToString>[0]) => clean(renderToString(element));

describe("the issue dialog", () => {
  const base = (over: Partial<ComponentProps<typeof IssueDialog>> = {}): ComponentProps<typeof IssueDialog> => ({
    open: true,
    onClose: () => {},
    storeSlug: STORE,
    invoiceId: INVOICE,
    clientId: CLIENT,
    currency: "NOK",
    locale: "en",
    totalMinor: 325_000,
    readiness: readyReadiness,
    nextNumber: "W-13",
    today: TODAY,
    paymentDays: 14,
    fxSuggestion: null,
    fxRate: "",
    onFxRate: () => {},
    blocked: null,
    onNotReady: () => {},
    ...over,
  });
  const render = (over: Partial<ComponentProps<typeof IssueDialog>> = {}) =>
    html(createElement(IssueDialog, base(over)));

  it("renders nothing while shut", () => {
    expect(render({ open: false })).not.toContain("Issue as W-13");
  });

  it("says which number it will get, the date and when it falls due, and asks to confirm the total", () => {
    const out = render();
    expect(out).toContain("Issue invoice");
    expect(out).toContain("It will be issued as <strong>W-13</strong>.");
    expect(out).toContain("The number is taken when you issue, so deleting a draft never uses one.");
    expect(out).toContain("Issue date");
    expect(out).toMatch(/<input[^>]*type="date"[^>]*>/);
    expect(out).toContain('value="2026-09-29"');
    expect(out).toContain('max="2026-09-29"');
    expect(out).toContain("Due 10/13/2026 (14 days to pay). Today is 09/29/2026.");
    expect(out).toContain("NOK 3,250.00");
    expect(out).toContain("I have checked the lines and the total.");
    expect(out).toContain("Once issued, the invoice cannot be changed or deleted.");
    expect(out).toContain("credit note");
    expect(out).toContain("only an owner can");
    expect(out).toContain(">Issue as W-13<");
  });

  it("is off until the total is confirmed, and says why", () => {
    const out = render();
    expect(out).toMatch(
      /<button type="submit" disabled="">Issue as W-13|<button type="submit"[^>]*disabled=""[^>]*>Issue as W-13/,
    );
    expect(out).toContain("Not yet: Confirm the total.");
    expect(out).toContain('aria-live="polite"');
  });

  it("shows the checklist and stays off when the invoice is not ready", () => {
    const out = render({ readiness: notReady });
    expect(out).toContain("2 things to fix before you can issue this invoice.");
    expect(out).toContain("Add the bank account invoices are paid to.");
    expect(out).toContain("Fix what the list above says first.");
    expect(out).toMatch(/<button type="submit"[^>]*disabled=""/);
  });

  it("waits while changes are still being saved", () => {
    const out = render({ blocked: "Your changes are still being saved." });
    expect(out).toContain("Your changes are still being saved.");
    expect(out).toMatch(/<button type="submit"[^>]*disabled=""/);
  });

  it("asks for the exchange rate of a foreign-currency invoice, with a suggestion to use", () => {
    const out = render({
      readiness: { ...readyReadiness, needsFxRate: true, homeCurrency: "SEK" },
      fxSuggestion: "1.05000000",
    });
    expect(out).toContain("Exchange rate: 1 NOK in SEK");
    expect(out).toContain("The VAT is also stated in SEK.");
    expect(out).toContain("European Central Bank");
    expect(out).toContain("Use 1.05000000");
    expect(out).toContain("Enter the exchange rate, such as 11,50.");
    expect(
      render({ fxRate: "1,05", readiness: { ...readyReadiness, needsFxRate: true, homeCurrency: "SEK" } }),
    ).not.toContain("Enter the exchange rate");
    expect(render()).not.toContain("Exchange rate");
  });

  it("falls back to the next number in the series when it cannot be read", () => {
    const out = render({ nextNumber: null });
    expect(out).toContain("It will get the next number in your invoice series.");
    expect(out).toContain(">Issue invoice<");
  });
});

describe("recording and reversing payments", () => {
  const form = (over: Partial<ComponentProps<typeof PaymentForm>> = {}) =>
    html(
      createElement(PaymentForm, {
        storeSlug: STORE,
        invoiceId: INVOICE,
        currency: "NOK",
        locale: "en",
        outstandingMinor: 325_000,
        today: TODAY,
        onDone: () => {},
        ...over,
      }),
    );

  it("starts with the outstanding amount, today, and bank transfer, all labelled", () => {
    const out = form();
    expect(out).toContain("Outstanding: <strong");
    expect(out).toContain("NOK 3,250.00");
    expect(out).toContain('value="3250.00"');
    expect(out).toContain("Amount received (NOK)");
    expect(out).toMatch(/<input[^>]*type="date"[^>]*>/);
    expect(out).toContain('value="2026-09-29"');
    expect(out).toContain('max="2026-09-29"');
    expect(out).toContain("Received on");
    expect(out).toContain('<option value="bank" selected');
    for (const method of ["bank transfer", "card", "cash", "other"]) expect(out).toContain(method);
    expect(out).toContain("Reference (optional)");
    expect(out).toContain(">Record payment<");
    expect(out).toContain("A part payment is fine");
  });

  it("keeps the button shut until it is pressed", () => {
    const out = html(
      createElement(RecordPaymentButton, {
        storeSlug: STORE,
        invoiceId: INVOICE,
        currency: "NOK",
        locale: "en",
        outstandingMinor: 1,
        today: TODAY,
      }),
    );
    expect(out).toContain(">Record payment<");
    expect(out).not.toContain("Amount received");
  });

  it("names the payment on its Reverse button", () => {
    const out = html(
      createElement(ReversePaymentButton, {
        storeSlug: STORE,
        paymentId: "p1",
        label: "the NOK 1,250.00 payment of 09/20/2026",
      }),
    );
    expect(out).toContain('aria-label="Reverse the NOK 1,250.00 payment of 09/20/2026"');
    expect(out).toContain(">Reverse<");
  });
});

describe("the credit dialog", () => {
  const detail = issuedDetail({ lines: [line(), secondLine()] }, { paidMinor: 325_000, outstandingMinor: 0 });
  const props = (over: Partial<ComponentProps<typeof CreditForm>> = {}): ComponentProps<typeof CreditForm> => ({
    storeSlug: STORE,
    invoiceId: INVOICE,
    documentNumber: "W-12",
    currency: "NOK",
    locale: "en",
    lines: detail.lines,
    creditNotes: [],
    amounts: detail.amounts,
    today: TODAY,
    isOwner: true,
    onDone: () => {},
    ...over,
  });
  const form = (over: Partial<ComponentProps<typeof CreditForm>> = {}) => html(createElement(CreditForm, props(over)));

  it("credits all that is left by default, with a required, printed reason and the date", () => {
    const out = form();
    expect(out).toContain("What to credit");
    expect(out).toContain("All that is left: <span");
    expect(out).toContain("NOK 3,250.00");
    const radios = [...out.matchAll(/<input[^>]*name="kind"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('checked=""');
    expect(radios[1]).not.toContain("checked");
    expect(out).toContain("Reason");
    expect(out).toContain("Printed on the credit note.");
    expect(out).toContain("Credit note date");
    expect(out).toContain("The invoice is not changed.");
    expect(out).toContain("releases its logged time");
    expect(out).toContain(">Issue credit note<");
    expect(out).toContain("The credit note is for <strong");
  });

  it("offers to record the refund only when money has been received", () => {
    const out = form();
    expect(out).toContain("Money already received");
    expect(out).toContain("I have paid NOK 3,250.00 back to the client: record it");
    expect(out).toContain("does not move money");
    const unpaid = form({ amounts: { ...detail.amounts, paidMinor: 0, outstandingMinor: 325_000 } });
    expect(unpaid).not.toContain("Money already received");
  });

  it("shows only what is left of each line when part of an invoice was credited already", () => {
    const credited = [
      {
        id: "cn1",
        documentNumber: "WCN-1",
        issuedOn: "2026-09-20",
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
            unit: "hour" as const,
            quantityHundredths: 75,
            unitPriceMinor: 120_000,
            discountBp: 0,
            vatCategory: "standard" as const,
            vatBp: 2500,
            exclMinor: 90_000,
            vatMinor: 22_500,
            inclMinor: 112_500,
          },
        ],
        createdAt: "2026-09-20T08:00:00.000Z",
        createdByName: "Kari",
      },
    ];
    const out = form({
      creditNotes: credited,
      amounts: { totalMinor: 325_000, paidMinor: 0, creditedMinor: 112_500, outstandingMinor: 212_500 },
    });
    expect(out).toContain("NOK 2,125.00");
    expect(out).not.toContain("Money already received");
    expect(LINE_B).toBeTruthy();
  });

  it("gives an owner the button, and everyone else a disabled one that says why", () => {
    const owner = html(createElement(CreditInvoiceButton, props()));
    expect(owner).toContain(">Credit invoice<");
    expect(owner).not.toContain("Only an owner");
    expect(owner).not.toMatch(/ disabled=""/);
    const admin = html(createElement(CreditInvoiceButton, props({ isOwner: false })));
    expect(admin).toMatch(/<button type="button" disabled="" aria-describedby="[^"]+"[^>]*>Credit invoice/);
    expect(admin).toContain("Only an owner can credit an invoice.");
  });
});

describe("the unbilled time dialog", () => {
  it("reads the time when it opens, and says what adding does", () => {
    const out = html(
      createElement(UnbilledTimeDialog, {
        open: true,
        onClose: () => {},
        storeSlug: STORE,
        invoiceId: INVOICE,
        clientId: CLIENT,
        assignmentId: ASSIGNMENT,
        currency: "NOK",
        locale: "en",
        beforeAdd: async () => true,
      }),
    );
    expect(out).toContain("Add unbilled time");
    expect(out).toContain("Reading your unbilled time");
    expect(out).toContain("cannot be billed twice");
    expect(out).toContain("20 minutes is");
    expect(out).toContain("From date (optional)");
    expect(out).toContain("To date (optional)");
    expect(out).toMatch(/<button type="button"[^>]*disabled=""[^>]*>Add to the invoice/);
  });
});
