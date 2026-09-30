import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The actions are server code (they import the database); the dialogs call them only when pressed.
vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/(gated)/(owner)/account/work/s/[store]/send-actions", () => ({}));

import { InvoiceExportSlot } from "./invoice-export-slot";
import { SendCreditNoteButton, SendInvoiceSlot } from "./invoice-send-slot";

const ID = "00000000-0000-4000-8000-000000000001";

describe("the Send button and dialog", () => {
  it("says Send by email before it went out, and Send again after", () => {
    const first = renderToStaticMarkup(
      createElement(SendInvoiceSlot, { storeSlug: "konsult", invoiceId: ID, clientEmail: "kunde@example.no" }),
    );
    expect(first).toContain("Send by email");
    expect(first).not.toContain("Send again");
    const again = renderToStaticMarkup(
      createElement(SendInvoiceSlot, {
        storeSlug: "konsult",
        invoiceId: ID,
        clientEmail: "kunde@example.no",
        sentTo: "kunde@example.no",
      }),
    );
    expect(again).toContain("Send again");
  });

  it("has a button for each credit note", () => {
    const html = renderToStaticMarkup(
      createElement(SendCreditNoteButton, {
        storeSlug: "konsult",
        creditNoteId: ID,
        documentNumber: "WCN-1",
        clientEmail: null,
      }),
    );
    expect(html).toContain("Send WCN-1 by email");
  });
});

describe("the CSV downloads", () => {
  it("links the register with the list's own filters and the payments", () => {
    const html = renderToStaticMarkup(
      createElement(InvoiceExportSlot, { storeSlug: "konsult", query: "?show=overdue&client=abc" }),
    );
    expect(html).toContain('href="/admin/account/work/s/konsult/invoices/export?show=overdue&amp;client=abc"');
    expect(html).toContain('href="/admin/account/work/s/konsult/payments/export"');
    expect(html).toContain("Export invoices (CSV)");
  });

  it("links the whole register when nothing is filtered", () => {
    const html = renderToStaticMarkup(createElement(InvoiceExportSlot, { storeSlug: "konsult", query: "" }));
    expect(html).toContain('href="/admin/account/work/s/konsult/invoices/export"');
  });
});
