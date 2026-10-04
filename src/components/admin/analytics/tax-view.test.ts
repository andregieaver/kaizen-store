import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { reconcile, reconcileMain, bridgeSentence, refundsLine, type CurrencySums } from "@/lib/tax-reconciliation";
import { buildVatReport, type DocGroup } from "@/lib/tax-report";
import type { ReconciliationView } from "@/server/tax-reconciliation";

import { ExportButton, TaxStatement, TaxViewTabs } from "./tax-parts";
import { TaxSkeleton } from "./tax-skeletons";
import { ReconciliationPanel, TaxView, type TaxViewProps } from "./tax-view";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const seller = { country: "SE", ossMemberState: "SE" };

const g = (over: Partial<DocGroup> = {}): DocGroup => ({
  docKind: "invoice",
  taxDate: "2026-09-12",
  originalTaxDate: null,
  marketCode: "DE",
  marketInEu: true,
  currency: "EUR",
  mainCurrency: "SEK",
  fxState: "stored",
  fxRate: "11.2",
  vatKind: "standard",
  buyerType: "consumer",
  hasPhysical: true,
  hasDownload: false,
  hasService: false,
  dispatchCountry: "SE",
  dispatchSource: "order",
  sellerCountry: "SE",
  sellerOssMemberState: "SE",
  sellerSource: "order",
  rate: 0.19,
  basis: "standard",
  standardRate: 0.19,
  documents: 1,
  orders: 1,
  currencyOrders: 1,
  kindDocuments: 1,
  netMinor: 10000,
  vatMinor: 1900,
  grossMinor: 11900,
  netMainMinor: 112000,
  vatMainMinor: 21280,
  grossMainMinor: 133280,
  ...over,
});
const dk = g({ marketCode: "DK", currency: "DKK", rate: 0.25, standardRate: 0.25, netMinor: 100000, vatMinor: 25000, grossMinor: 125000, netMainMinor: 150000, vatMainMinor: 37500, grossMainMinor: 187500, fxRate: "1.5" });
const note = g({ docKind: "credit_note", taxDate: "2026-09-20", originalTaxDate: "2026-09-12", orders: 0, netMinor: 5000, vatMinor: 950, grossMinor: 5950, netMainMinor: 56000, vatMainMinor: 10640, grossMainMinor: 66640 });

const sums = (currency: string, over: Partial<CurrencySums> = {}): CurrencySums => ({
  currency,
  finance: { orders: 1, taxMinor: 1900 },
  report: { orders: 1, taxMinor: 1900 },
  causes: {},
  ...over,
});

function reconciliationOf(over: { balanced?: boolean } = {}): ReconciliationView {
  const eur = reconcile(sums("EUR"));
  const bridges = [over.balanced === false ? reconcile(sums("EUR", { report: { orders: 1, taxMinor: 2000 } })) : eur];
  return {
    range: { from: "2026-09-01", to: "2026-10-01" },
    bridges,
    main: reconcileMain("SEK", [sums("EUR")], 21280, (_c, minor) => minor * 11),
    balanced: bridges.every((b) => b.balanced),
    sentence: bridgeSentence(bridges),
    undocumented: { orders: 0, byCause: {} },
    refunds: [{ currency: "EUR", ...refundsLine(5000, 5000, 1) }],
  };
}

const props = (over: Partial<TaxViewProps> = {}): TaxViewProps => ({
  base: "/admin/shop",
  locale: "en",
  range: { from: "2026-09-01", to: "2026-10-01" },
  report: buildVatReport([g(), dk, note], seller, { mainCurrency: "SEK" }),
  reconciliation: reconciliationOf(),
  drift: null,
  canExport: true,
  exportProblem: null,
  ...over,
});

describe("the VAT view", () => {
  it("starts with the line that these are not a tax return, and says what the figures are made from", () => {
    const out = html(h(TaxView, props()));
    expect(out).toContain("They are not a tax return and Kaizen files nothing.");
    expect(out).toContain("Made from 2 invoices and 1 credit note.");
    expect(out).toContain("your own figures");
  });

  it("shows the cards in the main currency: VAT charged, credited, after credits and net sales after credits", () => {
    const out = html(h(TaxView, props()));
    for (const label of ["VAT charged", "VAT credited", "VAT after credits", "Net sales after credits", "Invoices", "Credit notes"]) expect(out).toContain(label);
    // 212.80 + 375.00 charged, 106.40 credited.
    expect(out).toMatch(/SEK\s*587\.80|587\.80/);
    expect(out).toMatch(/106\.40/);
  });

  it("has one row for each country, rate, basis and currency with the place the VAT is reported in", () => {
    const out = html(h(TaxView, props()));
    expect(out).toContain("VAT by country and rate");
    expect(out).toContain("OSS Union scheme, part 2b");
    expect(out).toContain(">DE<");
    expect(out).toContain(">DK<");
    expect(out).toContain("19 %");
    expect(out).toContain("25 %");
    expect(out).toContain("Reported in");
    expect(out).toContain("VAT credited");
  });

  it("draws the credit as a minus amount with the proper minus sign", () => {
    const out = html(h(TaxView, props()));
    expect(out).toContain("−");
  });

  it("puts a data table behind the chart, with the same countries", () => {
    const out = html(h(TaxView, props()));
    expect(out).toContain("Data behind the chart");
    expect(out).toContain("VAT after credits per country");
    expect(out).toMatch(/<table[^>]*>\s*<caption[^>]*>VAT after credits per country/);
  });

  it("lists a document with no stored rate as missing in the main currency, never as zero, and counts it", () => {
    const missing = g({ fxState: "missing", fxRate: null, netMainMinor: null, vatMainMinor: null, grossMainMinor: null });
    const out = html(h(TaxView, props({ report: buildVatReport([missing], seller, { mainCurrency: "SEK" }) })));
    expect(out).toContain("1 document is not in these figures");
    expect(out).toContain("never converted at today's rate");
    expect(out).toContain("No rate was stored for this currency");
  });

  it("says plainly when the period has no documents, and links the invoice settings", () => {
    const out = html(h(TaxView, props({ report: buildVatReport([], seller, { mainCurrency: "SEK" }), reconciliation: null })));
    expect(out).toContain("No invoice or credit note is dated in this period");
    expect(out).toContain("/admin/shop/settings/invoices");
    expect(out).toContain("No VAT to show for this period.");
  });

  it("counts the paid orders with no document and links the waiting invoices", () => {
    const base = reconciliationOf();
    const out = html(h(TaxView, props({ reconciliation: { ...base, undocumented: { orders: 3, byCause: { waiting: 2, invoicing_off: 1 } } } })));
    expect(out).toContain("3 paid orders in this period have no document and are not included (see Reconciliation).");
    expect(out).toContain("/admin/shop/invoices?tab=waiting");
    expect(out).toContain("2 are waiting for an invoice");
  });

  it("offers the exports to a member with write access and says what is needed otherwise", () => {
    const withWrite = html(h(TaxView, props()));
    expect(withWrite).toContain('action="/admin/shop/analytics/tax/export"');
    expect(withWrite).toContain('method="post"');
    expect(withWrite).toContain('name="kind" value="vat"');
    expect(withWrite).toContain('name="kind" value="reconciliation"');
    expect(withWrite).toContain('name="last" value="2026-09-30"');
    const readOnly = html(h(TaxView, props({ canExport: false })));
    expect(readOnly).not.toContain("analytics/tax/export");
    expect(readOnly).toContain("Exports need the analytics role with write access.");
  });

  it("says what changed when the period was exported and then changed, as advice", () => {
    const out = html(h(TaxView, props({ drift: "Changed since you exported this on 3 October 2026: VAT +SEK 10.00. If you have already filed it, the difference belongs in your next return as a correction." })));
    expect(out).toContain("This period has changed since you exported it");
    expect(out).toContain("belongs in your next return as a correction");
  });

  it("shows a fixed sentence when the export route sent the person back", () => {
    const out = html(h(TaxView, props({ exportProblem: "Exports need the analytics role with write access." })));
    expect(out).toContain("No file was made");
  });

  it("keeps the report when the reconciliation could not be read", () => {
    const out = html(h(TaxView, props({ reconciliation: null })));
    expect(out).toContain("The reconciliation could not be read");
    expect(out).toContain("VAT by country and rate");
  });

  it("sets no cookie or storage and has no script of its own", () => {
    const out = html(h(TaxView, props()));
    expect(out).not.toMatch(/localStorage|sessionStorage|document\.cookie|<script/);
  });
});

describe("the reconciliation panel", () => {
  const panel = (view: ReconciliationView, canExport = true) =>
    html(h(ReconciliationPanel, { view, base: "/admin/shop", locale: "en", range: { from: "2026-09-01", to: "2026-10-01" }, last: "2026-09-30", canExport }));

  it("shows Finance's VAT and this report's VAT in each currency and says every difference is named", () => {
    const out = panel(reconciliationOf());
    expect(out).toContain("Finance&#x27;s VAT".replace("&#x27;", "'"));
    expect(out).toContain("This report's VAT charged");
    expect(out).toContain("Equal: every difference is named.");
    expect(out).toContain("EUR, in the document currency");
    expect(out).toContain("SEK, your main currency");
    expect(out).not.toContain("Does not reconcile");
  });

  it("says Does not reconcile, and where, when a bridge does not balance", () => {
    const out = panel(reconciliationOf({ balanced: false }));
    expect(out).toContain("Does not reconcile");
    expect(out).not.toContain("Equal: every difference is named.");
    expect(out).toContain("Difference not named");
  });

  it("names each cause with its sign and count", () => {
    const view = reconciliationOf();
    const bridge = reconcile(sums("EUR", { finance: { orders: 3, taxMinor: 5700 }, report: { orders: 1, taxMinor: 1900 }, causes: { test_mode: { orders: 2, taxMinor: 3800 } } }));
    const out = panel({ ...view, bridges: [bridge], balanced: true, sentence: bridgeSentence([bridge]) });
    expect(out).toContain("Orders paid in Stripe's test mode (never invoiced)");
    expect(out).toContain("−");
  });

  it("lists the refunds against the credit notes as information, and offers the CSV only with write access", () => {
    expect(panel(reconciliationOf())).toContain("Refunds against credit notes (for information)");
    expect(panel(reconciliationOf())).toContain('name="kind" value="reconciliation"');
    expect(panel(reconciliationOf(), false)).not.toContain("analytics/tax/export");
  });
});

describe("the shared parts", () => {
  it("the statement is a note that is always the same line", () => {
    const out = html(h(TaxStatement));
    expect(out).toContain('role="note"');
    expect(out).toContain("Not a tax return");
  });

  it("the tabs are three links and mark the current one", () => {
    const out = html(h(TaxViewTabs, { current: "oss", hrefs: { vat: "/a", oss: "/b?view=oss", ioss: "/c?view=ioss" } }));
    expect(out).toContain('aria-current="page"');
    expect(out.match(/<a /g)).toHaveLength(3);
    expect(out).toContain("OSS return data");
  });

  it("an export is a POST form with its fields hidden, and can be held back", () => {
    const out = html(h(ExportButton, { base: "/admin/s", kind: "oss", fields: { period: "2026-Q3", mode: "filing" }, disabled: true, children: "Export" }));
    expect(out).toContain('method="post"');
    expect(out).toContain('name="period" value="2026-Q3"');
    expect(out).toContain("disabled");
  });

  it("the loading placeholder says the figures are not a tax return and sweeps", () => {
    const out = html(h(TaxSkeleton));
    expect(out).toContain("Not a tax return");
    expect(out).toContain("animate-pulse");
    expect(out).toContain('aria-busy="true"');
  });
});

describe("the note on an assumed seller", () => {
  it("says so when a document was classed with the live country and member state, and is silent when every order froze them", () => {
    const withAssumed = html(h(TaxView, props({ report: buildVatReport([g({ sellerSource: "profile", documents: 2 })], seller, { mainCurrency: "SEK" }) })));
    expect(withAssumed).toContain("did not record them when it was placed");
    expect(withAssumed).toContain("2 documents were");
    expect(html(h(TaxView, props({ report: buildVatReport([g()], seller, { mainCurrency: "SEK" }) })))).not.toContain("did not record them when it was placed");
  });
});

