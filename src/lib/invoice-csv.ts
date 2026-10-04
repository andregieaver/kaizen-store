/**
 * The accountant's export of invoices and credit notes (D159, `docs/wave-1b-invoices.md` 2.3): one row per document, the amounts
 * as printed (a credit note's are its own, positive, in a file of its own), the VAT per rate as paired columns for every rate
 * present in the period, the VAT in the seller's currency with the rate used, and the treatment. Every text cell goes through
 * `toCsv()`, which neutralises formulas; amounts are decimals with a point. The export holds personal data (a buyer's name and
 * VAT number): the route is for `orders:write` and is written to the activity log (`invoice.exported`).
 */
import { decimalAmount, toCsv } from "./dac7";
import type { CreditNoteSnapshot } from "./credit-allocation";
import type { BucketBasis, OrderInvoiceSnapshot, SnapshotBucket } from "./invoice-snapshot";

const SUFFIX: Record<BucketBasis, string> = { standard: "", exempt: "_exempt", reverse_charge: "_rc", ioss: "_ioss" };

/** The column stem of a rate bucket: 25 % is `vat_25`, 12.5 % `vat_12_5`, reverse charge `vat_0_rc`, an exempt line `vat_0_exempt`. */
export function bucketColumn(bucket: Pick<SnapshotBucket, "rate" | "basis">): string {
  const percent = Math.round(bucket.rate * 10_000) / 100;
  return `vat_${String(percent).replace(".", "_")}${SUFFIX[bucket.basis]}`;
}

export type InvoiceCsvRow = { documentNumber: string; orderNumber: string; snapshot: OrderInvoiceSnapshot };
export type CreditNoteCsvRow = { documentNumber: string; orderNumber: string; snapshot: CreditNoteSnapshot };

type AnySnapshot = OrderInvoiceSnapshot | CreditNoteSnapshot;

/** The rate buckets present in a set of documents, highest rate first, so the columns are the same for every row. */
function columnsOf(rows: readonly { snapshot: AnySnapshot }[]): { rate: number; basis: BucketBasis; stem: string }[] {
  const seen = new Map<string, { rate: number; basis: BucketBasis; stem: string }>();
  for (const row of rows) {
    for (const b of row.snapshot.buckets) {
      const stem = bucketColumn(b);
      if (!seen.has(stem)) seen.set(stem, { rate: b.rate, basis: b.basis, stem });
    }
  }
  return [...seen.values()].sort((a, b) => b.rate - a.rate || a.stem.localeCompare(b.stem));
}

const money = (minor: number, currency: string) => decimalAmount(minor, currency);

function rowOf(row: { documentNumber: string; orderNumber: string; snapshot: AnySnapshot }, columns: ReturnType<typeof columnsOf>, extra: (string | number | null)[]): (string | number | null)[] {
  const s = row.snapshot;
  const home = s.vatHome;
  const perRate = columns.flatMap((c) => {
    const bucket = s.buckets.find((b) => bucketColumn(b) === c.stem);
    return bucket ? [money(bucket.netMinor, s.currency), money(bucket.vatMinor, s.currency)] : ["", ""];
  });
  return [
    row.documentNumber,
    s.issuedOn,
    ...extra.slice(0, 1),
    row.orderNumber,
    s.documentType,
    s.buyer.type,
    s.buyer.name,
    s.buyer.address.country,
    s.buyer.vatNumber,
    s.currency,
    money(s.totals.netMinor, s.currency),
    money(s.totals.vatMinor, s.currency),
    money(s.totals.grossMinor, s.currency),
    ...perRate,
    home ? home.currency : null,
    home ? money(home.vatMinor, home.currency) : null,
    home ? String(home.fxRate) : null,
    home ? home.asOf : null,
    s.treatment.kind,
    ...extra.slice(1),
  ];
}

const headerOf = (columns: ReturnType<typeof columnsOf>, tail: string[]) => [
  "number",
  "issue_date",
  "supply_date",
  "order_number",
  "document_type",
  "buyer_type",
  "buyer_name",
  "buyer_country",
  "buyer_vat_number",
  "currency",
  "net",
  "vat",
  "gross",
  ...columns.flatMap((c) => [`${c.stem}_net`, `${c.stem}_vat`]),
  "vat_home_currency",
  "vat_home",
  "vat_home_rate",
  "vat_home_rate_date",
  "treatment",
  ...tail,
];

export function invoiceCsv(rows: readonly InvoiceCsvRow[]): string {
  const columns = columnsOf(rows);
  return toCsv([headerOf(columns, []), ...rows.map((r) => rowOf(r, columns, [r.snapshot.supplyDate]))]);
}

export function creditNoteCsv(rows: readonly CreditNoteCsvRow[]): string {
  const columns = columnsOf(rows);
  return toCsv([
    headerOf(columns, ["credits_invoice", "credits_invoice_date", "reason"]),
    ...rows.map((r) => rowOf(r, columns, ["", r.snapshot.refersTo.invoiceNumber, r.snapshot.refersTo.invoiceIssuedOn, r.snapshot.reason.kind])),
  ]);
}
