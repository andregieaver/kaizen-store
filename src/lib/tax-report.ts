/**
 * The VAT report (D161, `docs/wave-1c-reports.md` 2.2 and 4.2): VAT per delivery country, rate and basis from the groups
 * `commerce.tax_document_groups()` returns (the store's invoices and credit notes, never recomputed from orders). Pure.
 *
 * The figures are the documents' own. The main-currency columns are what the database converted bucket by bucket with each document's
 * stored rate (`snapshot.vatMain.fxRate`), so an invoice's converted VAT is its stored `vatMain` figure exactly; a document with no
 * stored rate is counted in `notConverted` and left out of the main-currency figures, never converted at today's rate.
 *
 * A row is one `(country, rate, basis, currency, where it is reported)`: where a sale is reported is `classify()`'s
 * (`src/lib/tax-classes.ts`), so this table and the returns can never disagree about it. Needs review: accountant (section 8).
 */
import { classKey, classify, placeLabel, rateKind, type ClassFlag, type ClassResult, type ClassifyInput, type PartCounts, type Place, type ReturnPart } from "./tax-classes";

/** One row of `commerce.tax_document_groups()`: a group of documents with the same tax date, country, currency, rate, kind of buyer... */
export type DocGroup = {
  docKind: "invoice" | "credit_note";
  taxDate: string;
  originalTaxDate: string | null;
  marketCode: string;
  marketInEu: boolean;
  currency: string;
  mainCurrency: string;
  fxState: "same" | "stored" | "missing";
  fxRate: string | null;
  vatKind: string;
  buyerType: string;
  hasPhysical: boolean;
  hasDownload: boolean;
  hasService: boolean;
  dispatchCountry: string | null;
  dispatchSource: string;
  /**
   * The seller as the order froze it (the order's frozen VAT treatment): the country the store was established in and the member state it was
   * identified in for the Union scheme (null: none, so the country). `sellerSource` is `order`, or `profile` when the order did not freeze
   * them and the store's live settings were read instead (counted on the page).
   */
  sellerCountry: string | null;
  sellerOssMemberState: string | null;
  sellerSource: string;
  /** The bucket's rate as a fraction (`0.25`). */
  rate: number;
  basis: string;
  standardRate: number | null;
  documents: number;
  orders: number;
  currencyOrders: number;
  kindDocuments: number;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  netMainMinor: number | null;
  vatMainMinor: number | null;
  grossMainMinor: number | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Not a safe whole amount: ${String(v)}`);
  return n;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const dayText = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** A row as the driver gives it (bigint columns as strings or numbers, dates as strings or `Date`s) into a `DocGroup`. */
export function parseDocGroup(raw: Record<string, unknown>): DocGroup {
  return {
    docKind: raw.doc_kind === "credit_note" ? "credit_note" : "invoice",
    taxDate: dayText(raw.tax_date),
    originalTaxDate: raw.original_tax_date === null || raw.original_tax_date === undefined ? null : dayText(raw.original_tax_date),
    marketCode: String(raw.market_code).trim().toUpperCase(),
    marketInEu: raw.market_in_eu === true,
    currency: String(raw.currency),
    mainCurrency: String(raw.main_currency),
    fxState: raw.fx_state === "stored" ? "stored" : raw.fx_state === "same" ? "same" : "missing",
    fxRate: raw.fx_rate === null || raw.fx_rate === undefined ? null : String(raw.fx_rate),
    vatKind: String(raw.vat_kind),
    buyerType: String(raw.buyer_type),
    hasPhysical: raw.has_physical === true,
    hasDownload: raw.has_download === true,
    hasService: raw.has_service === true,
    dispatchCountry: raw.dispatch_country === null || raw.dispatch_country === undefined ? null : String(raw.dispatch_country).trim().toUpperCase(),
    dispatchSource: String(raw.dispatch_source),
    sellerCountry: raw.seller_country === null || raw.seller_country === undefined ? null : String(raw.seller_country).trim().toUpperCase() || null,
    sellerOssMemberState: raw.seller_oss_member_state === null || raw.seller_oss_member_state === undefined ? null : String(raw.seller_oss_member_state).trim().toUpperCase() || null,
    sellerSource: String(raw.seller_source),
    rate: Number(raw.rate),
    basis: String(raw.basis),
    standardRate: raw.standard_rate === null || raw.standard_rate === undefined ? null : Number(raw.standard_rate),
    documents: num(raw.documents),
    orders: num(raw.orders),
    currencyOrders: num(raw.currency_orders),
    kindDocuments: num(raw.kind_documents),
    netMinor: num(raw.net_minor),
    vatMinor: num(raw.vat_minor),
    grossMinor: num(raw.gross_minor),
    netMainMinor: numOrNull(raw.net_main_minor),
    vatMainMinor: numOrNull(raw.vat_main_minor),
    grossMainMinor: numOrNull(raw.gross_main_minor),
  };
}

/**
 * The class of a group's sale: the same call everywhere, so the VAT table and the returns agree. The seller is the one the document's
 * order froze (never the store's settings of today), so a later edit of the store's country or registration moves no filed period's sale.
 */
export function classOfGroup(g: DocGroup): ClassResult {
  return classify({
    vatKind: g.vatKind,
    buyerType: g.buyerType,
    market: g.marketCode,
    marketInEu: g.marketInEu,
    hasPhysical: g.hasPhysical,
    hasDownload: g.hasDownload,
    hasService: g.hasService,
    dispatchCountry: g.dispatchCountry,
    dispatchSource: g.dispatchSource,
    sellerSource: g.sellerSource,
    basis: g.basis,
    seller: { country: g.sellerCountry, ossMemberState: g.sellerOssMemberState },
  });
}

/** `0.25` as `25`, `0.075` as `7.5`: a rate in percent without trailing zeros. */
export function ratePercent(rate: number): string {
  return String(Math.round(rate * 10000) / 100);
}

export type VatRow = {
  country: string;
  rate: number;
  basis: string;
  currency: string;
  /** Where the VAT of this row is reported (`classify()`). */
  place: Place;
  part: ReturnPart | null;
  reason: ClassResult["reason"];
  reportedIn: string;
  flags: ClassFlag[];
  /** `standard` or `reduced` on the day of the documents (a zero rate counts as reduced). */
  rateKind: "standard" | "reduced";
  invoices: number;
  orders: number;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  creditNotes: number;
  creditNetMinor: number;
  creditVatMinor: number;
  creditGrossMinor: number;
  netAfterMinor: number;
  vatAfterMinor: number;
  grossAfterMinor: number;
  /** The main-currency figures, null when a document of the row has no stored rate (`mainConverted` false). */
  mainCurrency: string;
  mainConverted: boolean;
  netMainMinor: number | null;
  vatMainMinor: number | null;
  grossMainMinor: number | null;
  creditNetMainMinor: number | null;
  creditVatMainMinor: number | null;
  creditGrossMainMinor: number | null;
  netAfterMainMinor: number | null;
  vatAfterMainMinor: number | null;
  grossAfterMainMinor: number | null;
};

export type CurrencyTotal = {
  currency: string;
  invoices: number;
  creditNotes: number;
  orders: number;
  netMinor: number;
  vatMinor: number;
  creditNetMinor: number;
  creditVatMinor: number;
  creditGrossMinor: number;
  grossMinor: number;
};

export type VatReport = {
  rows: VatRow[];
  mainCurrency: string;
  /** The cards, in the main currency, over every document that has a stored conversion. */
  totals: {
    vatChargedMainMinor: number;
    vatCreditedMainMinor: number;
    vatAfterMainMinor: number;
    netAfterMainMinor: number;
    grossAfterMainMinor: number;
    invoices: number;
    creditNotes: number;
    /** Distinct orders with an invoice in the period. */
    orders: number;
  };
  /** The same, unconverted, per document currency (the CSV's and the reconciliation's figures). */
  byCurrency: CurrencyTotal[];
  /** Documents left out of the main-currency figures: their currency has no stored rate. */
  notConverted: {
    invoices: number;
    creditNotes: number;
    currencies: string[];
    /**
     * What the main-currency cards leave out, per document currency: the VAT charged (unconverted) and the invoices of every row that has
     * a document with no stored rate (such a row is left out whole). The reconciliation names it instead of calling it an exchange-rate effect.
     */
    leftOut: { currency: string; invoices: number; vatMinor: number }[];
  };
  /** Documents per part of a return, for `registrationNotes()` (a document with two rates counts in each). */
  partCounts: PartCounts;
  /** Per country: VAT after credits in the main currency, for the chart (the table behind it is the same numbers). */
  byCountry: { country: string; vatAfterMainMinor: number; netAfterMainMinor: number }[];
  /** Notes: documents classed with a dispatch country taken from the live profile, and baskets with goods and downloads. */
  flagCounts: Record<ClassFlag, number>;
};

type Acc = { row: VatRow };

/**
 * The VAT table from the groups of one period. `seller` is the store's own country today, used only to put its own country's rows first
 * (where a sale is reported comes from each document's frozen seller, `classOfGroup()`);
 * rows are ordered with the store's own country first, then by VAT after credits in the main currency (largest first), then by country.
 */
export function buildVatReport(groups: readonly DocGroup[], seller: Pick<ClassifyInput["seller"], "country">, opts: { mainCurrency?: string } = {}): VatReport {
  const rows = new Map<string, Acc>();
  const own = (seller.country ?? "").toUpperCase();
  let mainCurrency = opts.mainCurrency ?? "";
  const currencies = new Map<string, CurrencyTotal>();
  const orderSeen = new Map<string, number>();
  const kindSeen = new Map<string, number>();
  const missing = { invoices: 0, creditNotes: 0 };
  const missingCurrencies = new Set<string>();
  const partCounts: PartCounts = {};
  const flagCounts: Record<ClassFlag, number> = { mixed_goods_download: 0, dispatch_assumed: 0, seller_assumed: 0 };

  for (const g of groups) {
    if (!mainCurrency) mainCurrency = g.mainCurrency;
    const cls = classOfGroup(g);
    const key = [g.marketCode, g.rate, g.basis, g.currency, classKey(cls)].join("|");
    let acc = rows.get(key);
    if (!acc) {
      acc = {
        row: {
          country: g.marketCode,
          rate: g.rate,
          basis: g.basis,
          currency: g.currency,
          place: cls.place,
          part: cls.part,
          reason: cls.reason,
          reportedIn: placeLabel(cls),
          flags: [],
          rateKind: rateKind(g.rate, g.standardRate),
          invoices: 0,
          orders: 0,
          netMinor: 0,
          vatMinor: 0,
          grossMinor: 0,
          creditNotes: 0,
          creditNetMinor: 0,
          creditVatMinor: 0,
          creditGrossMinor: 0,
          netAfterMinor: 0,
          vatAfterMinor: 0,
          grossAfterMinor: 0,
          mainCurrency: g.mainCurrency,
          mainConverted: true,
          netMainMinor: 0,
          vatMainMinor: 0,
          grossMainMinor: 0,
          creditNetMainMinor: 0,
          creditVatMainMinor: 0,
          creditGrossMainMinor: 0,
          netAfterMainMinor: 0,
          vatAfterMainMinor: 0,
          grossAfterMainMinor: 0,
        },
      };
      rows.set(key, acc);
    }
    const r = acc.row;
    for (const f of cls.flags) if (!r.flags.includes(f)) r.flags.push(f);
    if (rateKind(g.rate, g.standardRate) === "standard") r.rateKind = "standard";
    const invoice = g.docKind === "invoice";
    if (invoice) {
      r.invoices += g.documents;
      r.orders += g.orders;
      r.netMinor += g.netMinor;
      r.vatMinor += g.vatMinor;
      r.grossMinor += g.grossMinor;
    } else {
      r.creditNotes += g.documents;
      r.creditNetMinor += g.netMinor;
      r.creditVatMinor += g.vatMinor;
      r.creditGrossMinor += g.grossMinor;
    }
    if (g.fxState === "missing") {
      r.mainConverted = false;
    } else {
      if (invoice) {
        r.netMainMinor = (r.netMainMinor ?? 0) + (g.netMainMinor ?? 0);
        r.vatMainMinor = (r.vatMainMinor ?? 0) + (g.vatMainMinor ?? 0);
        r.grossMainMinor = (r.grossMainMinor ?? 0) + (g.grossMainMinor ?? 0);
      } else {
        r.creditNetMainMinor = (r.creditNetMainMinor ?? 0) + (g.netMainMinor ?? 0);
        r.creditVatMainMinor = (r.creditVatMainMinor ?? 0) + (g.vatMainMinor ?? 0);
        r.creditGrossMainMinor = (r.creditGrossMainMinor ?? 0) + (g.grossMainMinor ?? 0);
      }
    }

    // One count per (kind, currency, conversion state) and per currency's orders: the same value repeats on every row of them.
    kindSeen.set(`${g.docKind}|${g.currency}|${g.fxState}`, g.kindDocuments);
    if (invoice) orderSeen.set(g.currency, g.currencyOrders);
    if (cls.part) partCounts[cls.part] = (partCounts[cls.part] ?? 0) + g.documents;
    for (const f of cls.flags) flagCounts[f] += g.documents;

    const c = currencies.get(g.currency) ?? { currency: g.currency, invoices: 0, creditNotes: 0, orders: 0, netMinor: 0, vatMinor: 0, creditNetMinor: 0, creditVatMinor: 0, creditGrossMinor: 0, grossMinor: 0 };
    if (invoice) {
      c.netMinor += g.netMinor;
      c.vatMinor += g.vatMinor;
      c.grossMinor += g.grossMinor;
    } else {
      c.creditNetMinor += g.netMinor;
      c.creditVatMinor += g.vatMinor;
      c.creditGrossMinor += g.grossMinor;
    }
    currencies.set(g.currency, c);
  }

  let invoices = 0;
  let creditNotes = 0;
  for (const [key, n] of kindSeen) {
    const [kind, currency, fx] = key.split("|");
    const c = currencies.get(currency)!;
    if (kind === "invoice") {
      invoices += n;
      c.invoices += n;
    } else {
      creditNotes += n;
      c.creditNotes += n;
    }
    if (fx === "missing") {
      if (kind === "invoice") missing.invoices += n;
      else missing.creditNotes += n;
      missingCurrencies.add(currency);
    }
  }
  let orders = 0;
  for (const [currency, n] of orderSeen) {
    orders += n;
    currencies.get(currency)!.orders = n;
  }

  const list: VatRow[] = [];
  for (const { row: r } of rows.values()) {
    r.netAfterMinor = r.netMinor - r.creditNetMinor;
    r.vatAfterMinor = r.vatMinor - r.creditVatMinor;
    r.grossAfterMinor = r.grossMinor - r.creditGrossMinor;
    if (r.mainConverted) {
      r.netAfterMainMinor = (r.netMainMinor ?? 0) - (r.creditNetMainMinor ?? 0);
      r.vatAfterMainMinor = (r.vatMainMinor ?? 0) - (r.creditVatMainMinor ?? 0);
      r.grossAfterMainMinor = (r.grossMainMinor ?? 0) - (r.creditGrossMainMinor ?? 0);
    } else {
      for (const k of ["netMainMinor", "vatMainMinor", "grossMainMinor", "creditNetMainMinor", "creditVatMainMinor", "creditGrossMainMinor", "netAfterMainMinor", "vatAfterMainMinor", "grossAfterMainMinor"] as const) r[k] = null;
    }
    list.push(r);
  }
  list.sort((a, b) => {
    const ao = a.country === own ? 0 : 1;
    const bo = b.country === own ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const av = a.vatAfterMainMinor ?? Number.NEGATIVE_INFINITY;
    const bv = b.vatAfterMainMinor ?? Number.NEGATIVE_INFINITY;
    if (av !== bv) return bv - av;
    return a.country.localeCompare(b.country) || b.rate - a.rate || a.basis.localeCompare(b.basis) || a.currency.localeCompare(b.currency) || a.reportedIn.localeCompare(b.reportedIn);
  });

  // The cards and the chart, from the rows that have a conversion.
  const totals = { vatChargedMainMinor: 0, vatCreditedMainMinor: 0, vatAfterMainMinor: 0, netAfterMainMinor: 0, grossAfterMainMinor: 0, invoices, creditNotes, orders };
  const country = new Map<string, { vat: number; net: number }>();
  const leftOut = new Map<string, { currency: string; invoices: number; vatMinor: number }>();
  for (const r of list) {
    if (!r.mainConverted) {
      const out = leftOut.get(r.currency) ?? { currency: r.currency, invoices: 0, vatMinor: 0 };
      out.invoices += r.invoices;
      out.vatMinor += r.vatMinor;
      leftOut.set(r.currency, out);
      continue;
    }
    totals.vatChargedMainMinor += r.vatMainMinor ?? 0;
    totals.vatCreditedMainMinor += r.creditVatMainMinor ?? 0;
    totals.vatAfterMainMinor += r.vatAfterMainMinor ?? 0;
    totals.netAfterMainMinor += r.netAfterMainMinor ?? 0;
    totals.grossAfterMainMinor += r.grossAfterMainMinor ?? 0;
    const c = country.get(r.country) ?? { vat: 0, net: 0 };
    c.vat += r.vatAfterMainMinor ?? 0;
    c.net += r.netAfterMainMinor ?? 0;
    country.set(r.country, c);
  }
  const byCountry = [...country].map(([code, c]) => ({ country: code, vatAfterMainMinor: c.vat, netAfterMainMinor: c.net })).sort((a, b) => b.vatAfterMainMinor - a.vatAfterMainMinor || a.country.localeCompare(b.country));

  return {
    rows: list,
    mainCurrency,
    totals,
    byCurrency: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    notConverted: {
      invoices: missing.invoices,
      creditNotes: missing.creditNotes,
      currencies: [...missingCurrencies].sort(),
      leftOut: [...leftOut.values()].filter((o) => o.invoices > 0 || o.vatMinor !== 0).sort((a, b) => a.currency.localeCompare(b.currency)),
    },
    partCounts,
    byCountry,
    flagCounts,
  };
}
