import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { vatIncluded } from "@/lib/checkout";
import { editCreditNote } from "@/lib/credit-allocation";
import { buildEditInvoiceSnapshot, buildInvoiceSnapshot, type InvoiceFacts, type InvoiceLineFacts } from "@/lib/invoice-snapshot";
import { documentText, editDocumentText } from "@/lib/invoice-text";
import { dayText, printLocale } from "@/lib/work-invoice-print";

import { OrderDocumentView } from "./order-document-view";

/**
 * A change's additional invoice and credit note as the customer reads them (hosted page, PDF, emails; wave 3 run 3, D174, spec 4.6; first written by the
 * law-lens review). VAT Directive Art. 219: an amending document refers specifically and unambiguously to the initial invoice; Art. 226(7): the date of
 * supply; and nothing on the document states a payment that is not true. Each case runs in nb, sv, da and en.
 */

const line = (id: string, title: string, unit: number, quantity: number, rate: number): InvoiceLineFacts => ({
  id, sku: id, title, quantity, unitPriceMinor: unit, totalMinor: unit * quantity, taxMinor: vatIncluded(unit * quantity, rate), taxRate: rate,
  delivery: "physical", gift: false, planned: false, bookedCount: null, vatCategory: "standard", booking: null,
});

const fx = { homeCurrency: "NOK", mainCurrency: "NOK", rates: { NOK: "11.7" }, ratesAuto: false, ratesAsOf: "2026-10-01" };

function originalFacts(locale: string): InvoiceFacts {
  const lines = [line("a", "Ullgenser", 90000, 2, 0.25)];
  const shipping = 4900;
  return {
    order: {
      id: "o1", number: "1001", marketCode: "NO", currency: "NOK", locale, email: "kari@example.com", placedOn: "2026-10-04", paidOn: "2026-10-04",
      shippingMinor: shipping, discountMinor: 0, taxMinor: lines.reduce((s, l) => s + l.taxMinor, 0) + vatIncluded(shipping, 0.25),
      totalMinor: lines.reduce((s, l) => s + l.totalMinor, 0) + shipping, memberDiscountMinor: 0, memberLabel: null, campaignDiscountMinor: 0, campaignLabel: null,
      creditMinor: 0, referralDiscountMinor: 0, staffDiscountMinor: 0, staffLabel: null, discountCode: null, vatKind: "standard", vatReliefMinor: 0,
      shippingTaxRate: 0.25, marketStandardRate: 0.25, companyName: null, organisationNumber: null, balanceMinor: 0,
      billingAddress: { name: "Kari Nordmann", line1: "Storgata 5", postalCode: "0182", city: "Oslo", country: "NO" }, shippingAddress: {},
      deliveryLabel: "Posten", onlineProvider: "stripe",
    },
    lines,
    seller: { legalName: "Fixture AS", organisationNumber: "923456789", postalAddress: "Storgata 1\n0155 Oslo", country: "NO", email: "post@fixture.example", footerNote: null },
    profile: { vatRegistered: true, vatNumber: "NO923456789MVA" },
    treatment: { reason: "consumer", sellerVatNumber: "NO923456789MVA", buyerVatNumber: null, iossNumber: null },
    fx,
  } as InvoiceFacts;
}

const LOCALES = [
  ["nb", "nb-NO"],
  ["sv", "sv-SE"],
  ["da", "da-DK"],
  ["en", "en-GB"],
] as const;

const words = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|\u00a0|\u202f/g, " ").replace(/\s+/g, " ");
const render = (snapshot: Parameters<typeof OrderDocumentView>[0]["snapshot"]) => words(renderToStaticMarkup(createElement(OrderDocumentView, { snapshot })));
const added = [line("b", "Lue", 30000, 1, 0.25)];

describe.each(LOCALES)("a change's documents in %s", (lang, locale) => {
  const original = buildInvoiceSnapshot(originalFacts(locale), { number: "F-17", issuedOn: "2026-10-04", supplyDate: "2026-10-04" });
  const t = documentText(lang);
  const edit = editDocumentText(lang);
  const day = (iso: string) => dayText(iso, printLocale(locale));

  describe("an additional invoice settled by what the customer had paid (a swap, difference <= 0)", () => {
    const snap = buildEditInvoiceSnapshot(
      { original: { id: "inv1", snapshot: original }, seq: 1, lines: added, shipping: null, payment: null, currency: "NOK", sellerCountry: "NO", fx },
      { number: "F-18", issuedOn: "2026-10-06", supplyDate: "2026-10-06" },
    );
    const text = render(snap);

    it("is titled an additional invoice and refers to the original invoice with its date (Art. 219)", () => {
      expect(text).toContain(`${edit.additionalInvoice} F-18`);
      expect(text).toContain(edit.amends("F-17"));
      expect(text).toContain(edit.amendsOf("F-17", day("2026-10-04")));
      expect(text).toContain(edit.reasonOrderEdit("E1"));
    });

    it("does not tell the customer to pay at the venue: the amount was settled by the order's payment", () => {
      expect(text).not.toContain(t.payAtVenue);
      expect(text).toContain(edit.settledByOrder("F-17"));
    });

    it("prints its supply date and says it is the day the change was made", () => {
      expect(text).toContain(t.supplyDate);
      expect(text).toContain(edit.supplyDateSettled);
      expect(text).not.toContain(t.supplyDateNoteVenue);
      expect(text).not.toContain(t.paidOn);
    });
  });

  describe("an additional invoice paid through the pay link two days after the order", () => {
    const snap = buildEditInvoiceSnapshot(
      { original: { id: "inv1", snapshot: original }, seq: 1, lines: added, shipping: null, payment: { provider: "stripe", method: null, differenceMinor: 30000 }, currency: "NOK", sellerCountry: "NO", fx },
      { number: "F-18", issuedOn: "2026-10-06", supplyDate: "2026-10-06" },
    );
    const text = render(snap);
    const html = renderToStaticMarkup(createElement(OrderDocumentView, { snapshot: snap }));

    it("dates the payment by the change's own payment, never the order's first payment day", () => {
      // The head's payment row is the change's (6 October), not the order's (4 October).
      const head = words(html.slice(0, html.indexOf("</header>")));
      expect(head).toContain(`${t.paidOn} ${day("2026-10-06")}`);
      expect(head).not.toContain(day("2026-10-04"));
      expect(text).toContain(edit.supplyDatePaid);
      expect(text).not.toContain(edit.settledByOrder("F-17"));
    });
  });

  describe("a change's credit note when nothing was refunded (items swapped, the customer paid the higher total)", () => {
    const result = editCreditNote({
      invoice: { id: "inv1", snapshot: original },
      earlier: [],
      removed: [{ lineId: "a", sku: "a", title: "Ullgenser", quantity: 1, totalMinor: 90000, taxMinor: vatIncluded(90000, 0.25), taxRate: 0.25 }],
      shipping: { grossMinor: 4900, vatMinor: vatIncluded(4900, 0.25), rate: 0.25, label: null },
      seq: 1,
      number: "K-3",
      issuedOn: "2026-10-06",
    });
    const text = render(result.snapshot!);

    it("gives the change as its reason, never a refund", () => {
      expect(text).toContain(edit.reasonOrderEdit("E1"));
      expect(text).not.toContain(` ${t.reasonRefund} `);
    });

    it("calls its rows removed from the order and a lower shipping charge, never returned goods or shipping refunded", () => {
      expect(text).toContain(`${edit.removedRow}: Ullgenser`);
      expect(text).toContain(edit.shippingLoweredRow);
      expect(text).not.toContain(t.creditRows.goods);
      expect(text).not.toContain(t.creditRows.delivery);
    });
  });
});

describe("an ordinary credit note keeps its own words", () => {
  const original = buildInvoiceSnapshot(originalFacts("nb-NO"), { number: "F-17", issuedOn: "2026-10-04", supplyDate: "2026-10-04" });
  it("an order's own invoice is still titled an invoice, with no change reference", () => {
    const text = render(original);
    expect(text).toContain(`${documentText("nb").invoice} F-17`);
    expect(text).not.toContain(editDocumentText("nb").additionalInvoice);
  });
});
