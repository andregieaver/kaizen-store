import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { vatIncluded } from "@/lib/checkout";
import { creditNoteSnapshot, type ReturnWorking } from "@/lib/credit-allocation";
import { buildInvoiceSnapshot, type InvoiceFacts, type InvoiceLineFacts, type InvoiceOrderFacts, type OrderInvoiceSnapshot } from "@/lib/invoice-snapshot";
import { DOCUMENT_LANGUAGES, documentText } from "@/lib/invoice-text";

import { OrderDocumentView } from "./order-document-view";

/**
 * The invoice and the credit note as a shopper reads them (D159, `docs/wave-1b-invoices.md` 4.3 and 6.1): every field of the content list
 * is drawn from a snapshot and nothing else, as text, in the order's language, with no external resource.
 */

const order = (over: Partial<InvoiceOrderFacts> = {}): InvoiceOrderFacts => ({
  id: "o1",
  number: "1001",
  marketCode: "NO",
  currency: "NOK",
  locale: "nb-NO",
  email: "kari@example.com",
  placedOn: "2026-10-04",
  paidOn: "2026-10-04",
  shippingMinor: 4900,
  discountMinor: 0,
  taxMinor: 0,
  totalMinor: 0,
  memberDiscountMinor: 0,
  memberLabel: null,
  campaignDiscountMinor: 0,
  campaignLabel: null,
  creditMinor: 0,
  referralDiscountMinor: 0,
  discountCode: null,
  vatKind: "standard",
  vatReliefMinor: 0,
  shippingTaxRate: 0.25,
  marketStandardRate: 0.25,
  companyName: null,
  organisationNumber: null,
  balanceMinor: 0,
  billingAddress: { name: "Kari Nordmann", line1: "Storgata 5", postalCode: "0182", city: "Oslo", country: "NO" },
  shippingAddress: {},
  deliveryLabel: "Posten",
  onlineProvider: "stripe",
  ...over,
});

const line = (id: string, title: string, unit: number, quantity: number, rate: number, over: Partial<InvoiceLineFacts> = {}): InvoiceLineFacts => ({
  id,
  sku: id,
  title,
  quantity,
  unitPriceMinor: unit,
  totalMinor: unit * quantity,
  taxMinor: vatIncluded(unit * quantity, rate),
  taxRate: rate,
  delivery: "physical",
  gift: false,
  planned: false,
  bookedCount: null,
  vatCategory: "standard",
  booking: null,
  ...over,
});

function facts(lines: InvoiceLineFacts[], over: Partial<InvoiceOrderFacts> = {}, extra: Partial<InvoiceFacts> = {}): InvoiceFacts {
  const shipping = over.shippingMinor ?? 4900;
  const total = lines.reduce((s, l) => s + l.totalMinor, 0) + shipping;
  const tax = lines.reduce((s, l) => s + l.taxMinor, 0) + vatIncluded(shipping, 0.25);
  return {
    order: order({ totalMinor: total, taxMinor: tax, ...over }),
    lines,
    seller: { legalName: "Fixture AS", organisationNumber: "923456789", postalAddress: "Storgata 1\n0155 Oslo", country: "NO", email: "post@fixture.example", footerNote: "Bank 1234.56.78901" },
    profile: { vatRegistered: true, vatNumber: "NO923456789MVA" },
    treatment: { reason: "consumer", sellerVatNumber: "NO923456789MVA", buyerVatNumber: null, iossNumber: null },
    fx: { homeCurrency: "NOK", mainCurrency: "NOK", rates: { NOK: "11.7" }, ratesAuto: false, ratesAsOf: "2026-10-01" },
    ...extra,
  };
}

const ctx = { number: "F-17", issuedOn: "2026-10-05", supplyDate: "2026-10-04" };
const render = (snapshot: Parameters<typeof OrderDocumentView>[0]["snapshot"]) => renderToStaticMarkup(createElement(OrderDocumentView, { snapshot }));
/** The words on the page, as one line, as a reader sees them. */
const words = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;| | /g, " ")
    .replace(/\s+/g, " ");

const mixed = () => buildInvoiceSnapshot(facts([line("a", "Ullgenser", 90000, 2, 0.25), line("b", "Brød", 5000, 3, 0.15, { vatCategory: "food" })]), ctx);

describe("an invoice, in Norwegian", () => {
  const snap = mixed();
  const html = render(snap);
  const text = words(html);

  it("draws the content list: number, dates, seller, buyer, lines, per-rate VAT, totals and payment", () => {
    expect(html).toContain('lang="nb"');
    expect(html).toContain('data-document="invoice"');
    expect(text).toContain("Faktura F-17");
    expect(text).toContain("Fakturadato");
    expect(text).toContain("Leveringsdato");
    expect(text).toContain("Fixture AS");
    expect(text).toContain("923456789 MVA");
    expect(text).toContain("NO923456789MVA");
    expect(text).toContain("Kari Nordmann");
    expect(text).toContain("Storgata 5");
    expect(text).toContain("0182 Oslo");
    expect(text).toContain("Ullgenser");
    expect(text).toContain("Brød");
    expect(text).toContain("Mva. per sats");
    expect(text).toContain("25 %");
    expect(text).toContain("15 %");
    expect(text).toContain("Betalt på nett");
    expect(text).toContain("Bank 1234.56.78901");
    expect(text).toContain("Posten");
  });

  it("holds the snapshot's amounts and no others", () => {
    const money = (n: number) => words(renderToStaticMarkup(createElement("span", null, new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(n / 100))));
    expect(text).toContain(money(snap.totals.grossMinor));
    expect(text).toContain(money(snap.totals.vatMinor));
    for (const b of snap.buckets) {
      expect(text).toContain(money(b.netMinor));
      expect(text).toContain(money(b.vatMinor));
    }
  });

  it("has no external resource: no script, link, picture, font or address, so the PDF renderer can refuse every request", () => {
    expect(html).not.toMatch(/<script|<link|<img|<iframe|<object|\ssrc=|\shref=|url\(|https?:\/\//i);
  });

  it("does not print a buyer's VAT number on a consumer's invoice, nor VIES's name or address", () => {
    expect(snap.buyer.vatNumber).toBeNull();
    expect(text).not.toContain("Kjøpers mva-nr.");
    expect(text).not.toContain("Reverse charge");
    expect(text).not.toContain("Omvendt avgiftsplikt");
  });

  it("says so when the unit price is rounded for display", () => {
    const rounded = buildInvoiceSnapshot(facts([line("a", "Skruer", 3333, 3, 0.25)]), ctx);
    expect(rounded.notes).toContain("unit_price_rounded");
    expect(words(render(rounded))).toContain(documentText("nb").unitRounded);
    const exact = buildInvoiceSnapshot(facts([line("a", "Skruer", 10000, 2, 0.25)]), ctx);
    expect(exact.notes).not.toContain("unit_price_rounded");
    expect(words(render(exact))).not.toContain(documentText("nb").unitRounded);
  });
});

describe("what a title, a name and a note can do", () => {
  it("is drawn as text and never as HTML", () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const snap = buildInvoiceSnapshot(
      facts([line("a", evil, 10000, 1, 0.25)], { billingAddress: { name: evil, line1: evil, city: evil, country: "NO" } }, { seller: { legalName: evil, organisationNumber: "1", postalAddress: evil, country: "NO", email: null, footerNote: evil } }),
      ctx,
    );
    const html = render(snap);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("the statements the law asks for", () => {
  it("reverse charge: the statement and both VAT numbers, no VAT, total equal to the net", () => {
    const rc = (id: string, unit: number, rate: number) => {
      const relief = vatIncluded(unit, rate);
      return line(id, `Vare ${id}`, unit, 1, rate, { totalMinor: unit - relief, taxMinor: 0 });
    };
    const lines = [rc("a", 25000, 0.19)];
    const relief = vatIncluded(25000, 0.19) + vatIncluded(7500, 0.19);
    const f = facts(
      lines,
      { vatKind: "reverse_charge", shippingMinor: 7500, shippingTaxRate: 0.19, companyName: "Muster GmbH", organisationNumber: "HRB 1", marketCode: "DE", currency: "EUR", taxMinor: 0, totalMinor: lines[0].totalMinor + 7500 - vatIncluded(7500, 0.19), discountMinor: relief, vatReliefMinor: relief, locale: "en-IE" },
      { treatment: { reason: "reverse_charge", sellerVatNumber: "NO923456789MVA", buyerVatNumber: "DE123456789", iossNumber: null } },
    );
    const snap = buildInvoiceSnapshot(f, ctx);
    const text = words(render(snap));
    expect(snap.language).toBe("en");
    expect(text).toContain("Reverse charge");
    expect(text).toContain("Seller's VAT number: NO923456789MVA");
    expect(text).toContain("Buyer's VAT number: DE123456789");
    expect(text).toContain("Muster GmbH");
    expect(text).toContain("DE123456789");
    expect(text).toContain("Reverse charge");
    expect(snap.totals.vatMinor).toBe(0);
  });

  it("IOSS: the statement and the number", () => {
    const f = facts([line("a", "Vare", 9900, 1, 0.19)], { vatKind: "ioss", shippingTaxRate: 0.19, locale: "sv-SE" }, { treatment: { reason: "ioss", sellerVatNumber: null, buyerVatNumber: null, iossNumber: "IM5780000001" } });
    const text = words(render(buildInvoiceSnapshot(f, ctx)));
    expect(text).toContain("IM5780000001");
    expect(text).toContain("IOSS");
  });

  it("not registered for VAT: it says so", () => {
    const f = facts([line("a", "Vare", 10000, 1, 0)], { shippingMinor: 0, shippingTaxRate: 0, taxMinor: 0 }, { profile: { vatRegistered: false, vatNumber: null }, treatment: { reason: "consumer", sellerVatNumber: null, buyerVatNumber: null, iossNumber: null } });
    const snap = buildInvoiceSnapshot(f, ctx);
    expect(snap.treatment.statements).toContain("not_registered");
    expect(words(render(snap))).toContain(documentText("nb").notRegistered);
  });

  it("an order in euro in a Norwegian store: the VAT in kroner with the rate and its date", () => {
    const f = facts([line("a", "Wool", 12000, 1, 0.24)], { currency: "EUR", marketCode: "FI", shippingMinor: 0, shippingTaxRate: 0.24, locale: "en-IE" });
    const snap = buildInvoiceSnapshot(f, ctx);
    expect(snap.vatHome).toMatchObject({ currency: "NOK", fxRate: 11.7 });
    const text = words(render(snap));
    expect(text).toContain("VAT in NOK:");
    expect(text).toContain("rate 11.7 NOK per EUR");
    expect(text).toContain("01/10/2026");
  });
});

describe("a booking, a deferred trial line and a venue balance", () => {
  it("shows the booked time, what is not on this invoice, and what is still to pay at the venue", () => {
    const room = line("r", "Room", 180000, 1, 0.12, { delivery: "service", bookedCount: 2, booking: { startsAt: "2026-10-12T14:00", endsAt: "2026-10-14T11:00" } });
    const trial = line("t", "Monthly box", 0, 1, 0.25, { planned: true, totalMinor: 0, taxMinor: 0 });
    const snap = buildInvoiceSnapshot(facts([room, trial], { balanceMinor: 100000, shippingMinor: 0, locale: "en-IE" }), ctx);
    const text = words(render(snap));
    expect(text).toContain("12/10/2026 14:00 – 14/10/2026 11:00");
    expect(text).toContain("Not on this invoice");
    expect(text).toContain("Monthly box");
    expect(text).toContain("To pay at the venue");
    expect(text).toContain("Paid online");
  });
});

describe("a booking left wholly for the venue", () => {
  it("asserts no payment: no paid date, no supply date equal to a payment day, no \"to pay\" total", () => {
    const room = line("r", "Rom", 180000, 1, 0.12, { delivery: "service", bookedCount: 2, booking: { startsAt: "2026-10-12T14:00", endsAt: "2026-10-14T11:00" } });
    const snap = buildInvoiceSnapshot(facts([room], { balanceMinor: 180000, shippingMinor: 0 }), ctx);
    expect(snap.payments.map((p) => p.kind)).toEqual(["pay_at_venue"]);
    const text = words(render(snap));
    const nb = documentText("nb");
    expect(text).toContain(nb.payAtVenue);
    expect(text).not.toContain(nb.paidOn);
    expect(text).not.toContain(nb.paidOnline);
    expect(text).not.toContain(nb.supplyDate);
    expect(text).not.toContain(nb.supplyDateNote);
    expect(text).toContain(nb.supplyDateNoteVenue);
    expect(text).toContain("12.10.2026 14:00");
    expect(text).not.toMatch(/Å betale totalt|Total to pay/);
  });

  it("a partly paid booking still dates the online payment", () => {
    const room = line("r", "Rom", 180000, 1, 0.12, { delivery: "service", bookedCount: 2, booking: { startsAt: "2026-10-12T14:00", endsAt: "2026-10-14T11:00" } });
    const text = words(render(buildInvoiceSnapshot(facts([room], { balanceMinor: 100000, shippingMinor: 0 }), ctx)));
    expect(text).toContain(documentText("nb").paidOn);
    expect(text).toContain(documentText("nb").supplyDate);
  });

  it("a paid order's total is a plain total, never \"to pay\", in every language", () => {
    for (const lang of DOCUMENT_LANGUAGES) {
      expect(documentText(lang).total).not.toMatch(/betale|betala|pay/i);
    }
  });
});

describe("a seller that is not registered for VAT", () => {
  const unregistered = () =>
    buildInvoiceSnapshot(
      facts([line("a", "Vare", 10000, 2, 0)], { shippingMinor: 4900, shippingTaxRate: 0, taxMinor: 0, marketCode: "DK", currency: "DKK", locale: "da-DK" }, { profile: { vatRegistered: false, vatNumber: null }, treatment: { reason: "consumer", sellerVatNumber: null, buyerVatNumber: null, iossNumber: null }, fx: { homeCurrency: "DKK", mainCurrency: "DKK", rates: { DKK: "1" }, ratesAuto: false, ratesAsOf: "2026-10-01" } }),
      ctx,
    );

  it("an invoice carries no VAT rate, VAT amount, VAT table or incl.-VAT wording, and says that VAT is not stated", () => {
    const snap = unregistered();
    const text = words(render(snap));
    const da = documentText("da");
    expect(text).toContain(da.notRegistered);
    for (const forbidden of [da.vatRate, da.vatAmount, da.vatByRate, da.totalVat, da.totalExVat, da.amountInclVat, da.amountExVat, da.unitPriceExVat, da.discountExVat, da.taxableAmount]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toMatch(/%/);
    expect(text).toContain(da.amount);
    expect(text).toContain(da.total);
  });

  it("a credit note of it is drawn the same way", () => {
    const inv = unregistered();
    const snap = creditNoteSnapshot({ invoice: { id: "inv-1", snapshot: inv }, earlier: [], source: "refund", returnNumber: null, working: null, number: "K-1", issuedOn: "2026-10-09", refundMinor: 5000 }).snapshot!;
    const text = words(render(snap));
    const da = documentText("da");
    expect(text).toContain(da.notRegistered);
    for (const forbidden of [da.vatRate, da.vatAmount, da.vatByRate, da.totalVat, da.amountInclVat]) expect(text).not.toContain(forbidden);
    expect(text).not.toMatch(/%/);
  });

  it("a registered seller still gets the full VAT columns", () => {
    const text = words(render(mixed()));
    expect(text).toContain(documentText("nb").vatByRate);
    expect(text).toContain(documentText("nb").vatAmount);
  });
});

describe("a credit note", () => {
  const inv: OrderInvoiceSnapshot = mixed();
  const base = { invoice: { id: "inv-1", snapshot: inv }, earlier: [], source: "refund" as const, returnNumber: null, working: null, number: "K-3", issuedOn: "2026-10-09" };

  it("refers to its invoice by number and date and shows what is credited as negative amounts, with where the invoice stands", () => {
    const snap = creditNoteSnapshot({ ...base, refundMinor: 5000 }).snapshot!;
    const html = render(snap);
    const text = words(html);
    expect(html).toContain('data-document="credit_note"');
    expect(text).toContain("Kreditnota K-3");
    expect(text).toContain("Denne kreditnotaen gjelder faktura F-17 av 05.10.2026.");
    expect(text).toContain("Refusjon");
    expect(text).toMatch(/Kreditert totalt [−-]\s?50,00/);
    expect(text).not.toContain("Å betale totalt");
    expect(text).toContain("Fakturaens sum");
    expect(text).toContain("Igjen på fakturaen");
    expect(text).toContain("Mva. per sats");
    expect(text).not.toContain("Betalt på nett");
    expect(html).not.toMatch(/<script|<link|<img|\ssrc=|\shref=|https?:\/\//i);
  });

  it("a return: its number, the returned goods, the deduction and the return shipping as rows of their own", () => {
    const working: ReturnWorking = {
      lines: [{ lineId: "a", quantity: 1, valueMinor: 90000, deductionMinor: 9000 }],
      deliveryMinor: 4900,
      returnShippingMinor: 3900,
      adjustmentMinor: 0,
      amountMinor: 90000 - 9000 + 4900 - 3900,
      outside: false,
    };
    const snap = creditNoteSnapshot({ ...base, source: "return_outside", returnNumber: "1001-R1", working, refundMinor: working.amountMinor }).snapshot!;
    const text = words(render(snap));
    expect(text).toContain("Retur 1001-R1: refusjon");
    expect(text).toContain("Returnerte varer: Ullgenser");
    expect(text).toContain("Fradrag for redusert verdi: Ullgenser");
    expect(text).toContain("Frakt refundert");
    expect(text).toContain("Returfrakt betalt av kjøper");
  });

  it("a refund above what was left says that the note covers what was left", () => {
    const first = creditNoteSnapshot({ ...base, refundMinor: inv.totals.grossMinor - 1000 }).snapshot!;
    const second = creditNoteSnapshot({ ...base, earlier: [first.buckets], refundMinor: 5000, number: "K-4" }).snapshot!;
    expect(words(render(second))).toContain(documentText("nb").creditCapped);
  });

  it("carries a reverse-charge invoice's statement and both numbers", () => {
    const rc = line("a", "Vare", 25000 - vatIncluded(25000, 0.19), 1, 0.19, { totalMinor: 25000 - vatIncluded(25000, 0.19), taxMinor: 0 });
    const f = facts([rc], { vatKind: "reverse_charge", companyName: "Muster GmbH", marketCode: "DE", currency: "EUR", shippingMinor: 0, taxMinor: 0, totalMinor: rc.totalMinor, vatReliefMinor: vatIncluded(25000, 0.19), discountMinor: vatIncluded(25000, 0.19), locale: "en-IE" }, { treatment: { reason: "reverse_charge", sellerVatNumber: "NO923456789MVA", buyerVatNumber: "DE123456789", iossNumber: null } });
    const invoice = buildInvoiceSnapshot(f, ctx);
    const snap = creditNoteSnapshot({ ...base, invoice: { id: "inv-2", snapshot: invoice }, refundMinor: 5000 }).snapshot!;
    const text = words(render(snap));
    expect(text).toContain("Credit note K-3");
    expect(text).toContain("Reverse charge");
    expect(text).toContain("Buyer's VAT number: DE123456789");
  });
});

describe("the languages", () => {
  it("draw the same document in nb, sv, da and en with their own words, and any other language in English", () => {
    const heads = new Map<string, string>();
    for (const [locale, lang] of [["nb-NO", "nb"], ["sv-SE", "sv"], ["da-DK", "da"], ["en-IE", "en"], ["de-DE", "en"], ["fi-FI", "en"]] as const) {
      const snap = buildInvoiceSnapshot(facts([line("a", "Vare", 10000, 1, 0.25)], { locale }), ctx);
      expect(snap.language).toBe(lang);
      const text = words(render(snap));
      expect(text).toContain(`${documentText(lang).invoice} F-17`);
      expect(text).toContain(documentText(lang).vatByRate);
      heads.set(locale, documentText(lang).unitPriceExVat);
    }
    expect(new Set([heads.get("nb-NO"), heads.get("sv-SE"), heads.get("da-DK"), heads.get("en-IE")]).size).toBe(4);
    expect(heads.get("de-DE")).toBe(heads.get("en-IE"));
    expect(DOCUMENT_LANGUAGES).toEqual(["nb", "sv", "da", "en"]);
  });

  it("never fails on a buyer with no address: nothing is invented", () => {
    const snap = buildInvoiceSnapshot(facts([line("a", "Vare", 10000, 1, 0.25)], { billingAddress: null, shippingAddress: {} }), ctx);
    expect(snap.buyer.complete).toBe(false);
    const text = words(render(snap));
    expect(text).toContain("kari@example.com");
    expect(text).toContain("Faktura F-17");
  });
});
