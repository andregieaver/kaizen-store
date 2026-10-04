/**
 * The four CSV layouts of the VAT, OSS and IOSS reports (D161, `docs/wave-1c-reports.md` 4.8): fixed English headers (the interface to an
 * accountant's spreadsheet: a change to one is a change to the spec first), UTF-8, CRLF, one header row, NO totals row (an accountant
 * sums; a total mixed into data is a spreadsheet hazard). Formula-safe through `toCsv()`; amounts are decimals with a point
 * (`decimalAmount()`); credit amounts are negative. Pure: nothing here reads the database.
 *
 * These files are the owner's own data for the owner's accountant. They are not a tax return and are never filed by Kaizen.
 */
import { decimalAmount, toCsv } from "./dac7";
import { addDays } from "./analytics-period";
import type { ConversionGroup, ReturnData } from "./oss-return";
import type { CurrencyBridge, MainBridge, ReconLine } from "./tax-reconciliation";
import { ratePercent, type VatReport } from "./tax-report";
import type { ReturnPart } from "./tax-classes";

export const VAT_CSV_HEADER = [
  "period_from", "period_to", "country", "vat_rate_percent", "basis", "reported_in", "currency", "invoices", "orders", "net", "vat", "gross",
  "credit_notes", "credit_net", "credit_vat", "credit_gross", "net_after_credits", "vat_after_credits", "gross_after_credits",
  "currency_main", "net_after_credits_main", "vat_after_credits_main", "main_converted",
] as const;

export const RETURN_CSV_HEADER = [
  "scheme", "tax_period", "part", "member_state_of_consumption", "dispatch_member_state", "vat_rate_percent", "rate_kind", "taxable_amount_eur", "vat_amount_eur",
  "correction_period", "mode", "registration", "currency",
] as const;

export const DETAIL_CSV_HEADER = [
  "tax_period", "part", "member_state_of_consumption", "dispatch_member_state", "vat_rate_percent", "rate_kind", "original_currency", "taxable_amount_original",
  "vat_amount_original", "conversion_rate", "rate_date", "rate_source", "taxable_amount_eur", "vat_amount_eur", "invoices", "credit_notes",
  "correction_period",
] as const;

export const RECONCILIATION_CSV_HEADER = ["period_from", "period_to", "currency", "cause", "direction", "orders", "vat_original"] as const;

type Cell = string | number | null;

const money = (minor: number | null, currency: string): string => (minor === null ? "" : decimalAmount(minor, currency));

/** The last day included in a half-open period, for a file's `period_to`. */
const lastIncluded = (toExclusive: string) => addDays(toExclusive, -1);

/** The VAT report (one row per country, rate, basis, currency and place it is reported in). */
export function vatCsv(report: VatReport, period: { from: string; to: string }): string {
  const rows: Cell[][] = [[...VAT_CSV_HEADER]];
  const to = lastIncluded(period.to);
  for (const r of report.rows) {
    rows.push([
      period.from, to, r.country, ratePercent(r.rate), r.basis, r.reportedIn, r.currency, r.invoices, r.orders,
      money(r.netMinor, r.currency), money(r.vatMinor, r.currency), money(r.grossMinor, r.currency),
      r.creditNotes, money(-r.creditNetMinor, r.currency), money(-r.creditVatMinor, r.currency), money(-r.creditGrossMinor, r.currency),
      money(r.netAfterMinor, r.currency), money(r.vatAfterMinor, r.currency), money(r.grossAfterMinor, r.currency),
      r.mainConverted ? r.mainCurrency : "", money(r.netAfterMainMinor, r.mainCurrency), money(r.vatAfterMainMinor, r.mainCurrency), r.mainConverted ? "true" : "false",
    ]);
  }
  return toCsv(rows);
}

const schemeOfPart = (part: ReturnPart): "union" | "non_union" | "ioss" => (part === "NU" ? "non_union" : part === "IOSS" ? "ioss" : "union");
const schemeOfReturn = (data: ReturnData): "union" | "non_union" | "ioss" => (data.scheme === "ioss" ? "ioss" : data.registration === "non_union" ? "non_union" : "union");

export type CsvResult = { ok: true; csv: string; rows: number } | { ok: false; reason: string };

/** The reason a return's data is refused as a file, naming the currency and day of every missing rate. */
export function incompleteReason(data: ReturnData): string {
  const what = data.missing.map((m) => `${m.currency} on ${m.day}`).join(", ");
  return `The return is incomplete: no euro rate is stored for ${what}. Fetch the ECB's rate or enter your own on the page, then export again.`;
}

/**
 * The return data: Part 2 lines with a rate and both amounts, Part 3 corrections with the period corrected and only the VAT (the
 * guide's Part 3 has no taxable amount), Part 4 balances and Part 5 the total due. Always euro. Refused while a conversion group has no rate.
 */
export function returnCsv(data: ReturnData): CsvResult {
  if (data.incomplete) return { ok: false, reason: incompleteReason(data) };
  const base = (part: string, scheme: string): Cell[] => [scheme, data.period.key, part];
  const tail = (correction: string | null): Cell[] => [correction ?? "", data.mode, data.registration, "EUR"];
  const rows: Cell[][] = [[...RETURN_CSV_HEADER]];
  for (const l of data.part2) rows.push([...base(l.part, schemeOfPart(l.part)), l.memberState, l.dispatchState ?? "", ratePercent(l.rate), l.rateKind, money(l.taxableEur, "EUR"), money(l.vatEur, "EUR"), ...tail(null)]);
  for (const l of data.part3) rows.push([...base("3", schemeOfReturn(data)), l.memberState, "", "", "", "", money(l.vatEur, "EUR"), ...tail(l.correctionPeriod)]);
  for (const b of data.part4) rows.push([...base("4", schemeOfReturn(data)), b.memberState, "", "", "", "", money(b.balanceEur, "EUR"), ...tail(null)]);
  rows.push([...base("5", schemeOfReturn(data)), "", "", "", "", "", money(data.part5Eur, "EUR"), ...tail(null)]);
  return { ok: true, csv: toCsv(rows), rows: rows.length - 1 };
}

const detailRow = (data: ReturnData, g: ConversionGroup): Cell[] => {
  const c = g.conversion;
  const source = g.currency === "EUR" ? "none (euro)" : c ? (c.source === "owner" ? `owner: ${c.reason ?? ""}` : "ecb") : "missing";
  return [
    data.period.key, g.correctionPeriod ? "3" : g.part, g.memberState, g.dispatchState ?? "", ratePercent(g.rate), g.rateKind, g.currency, money(g.taxableMinor, g.currency), money(g.vatMinor, g.currency),
    g.currency === "EUR" ? "1" : (c?.rate ?? ""), c?.date ?? "", source, money(g.taxableEur, "EUR"), money(g.vatEur, "EUR"), g.invoices, g.creditNotes, g.correctionPeriod ?? "",
  ];
};

/** The conversion detail, one row per conversion group. Allowed while incomplete: it is the file that shows the gap (empty rate). */
export function detailCsv(data: ReturnData): CsvResult {
  const rows: Cell[][] = [[...DETAIL_CSV_HEADER], ...data.groups.map((g) => detailRow(data, g))];
  return { ok: true, csv: toCsv(rows), rows: rows.length - 1 };
}

/**
 * The reconciliation: one row per line of each currency's bridge (`finance`, each cause, `report`), unconverted. `vat_original` is always
 * a positive amount; `direction` says which way a cause moves it on the way from Finance's figure to the report's (1 adds, -1 takes away,
 * blank on the two end points), so a spreadsheet can check `finance + sum(direction * vat_original) = report` for each currency.
 */
export function reconciliationCsv(bridges: readonly CurrencyBridge[], period: { from: string; to: string }): string {
  const rows: Cell[][] = [[...RECONCILIATION_CSV_HEADER]];
  const to = lastIncluded(period.to);
  for (const b of bridges) {
    for (const l of b.lines) rows.push([period.from, to, b.currency, causeKey(l), l.kind === "cause" ? l.sign : null, l.orders, money(l.taxMinor, b.currency)]);
  }
  return toCsv(rows);
}

const causeKey = (l: ReconLine): string => (l.kind === "cause" ? (l.cause as string) : l.kind === "finance" ? "finance" : l.kind === "report" ? "report" : l.kind);

/** For the page's table of the main-currency bridge (not a file): its lines as labels and amounts. */
export const mainBridgeRows = (b: MainBridge): { label: string; amount: string; orders: number }[] => b.lines.map((l) => ({ label: l.label, amount: decimalAmount(l.taxMinor, b.currency), orders: l.orders }));

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

const safe = (text: string) => text.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "store";

export const vatFileName = (store: string, from: string, toExclusive: string) => `vat-${safe(store)}-${from}_${lastIncluded(toExclusive)}.csv`;
export const returnFileName = (store: string, data: Pick<ReturnData, "scheme" | "period" | "mode">, detail = false) =>
  `${data.scheme}${detail ? "-detail" : ""}-${safe(store)}-${data.period.key}-${data.mode}.csv`;
export const reconciliationFileName = (store: string, from: string, toExclusive: string) => `reconciliation-${safe(store)}-${from}_${lastIncluded(toExclusive)}.csv`;
