import { matchInvoices } from "./bank-invoices";
import { LEDGER_SERIES, type LedgerEntryInput } from "./ledger";
import { costLinesOf, type PurchaseKind, type PurchaseVatRate } from "./purchases";

/**
 * A supplier's invoice, a bill (B3 of `docs/own-books-and-sales.md`, D492). Pure: the entry it makes when it comes (its cost and deductible VAT
 * as a purchase's, `costLinesOf()`, against what the store owes its suppliers, 2400, in the purchases series on the bill's day), the entry its
 * payment makes when the bank's statement shows it (what is owed against the bank, on the bank's day), and which unpaid bill a line of money
 * out pays: the bill's number or the supplier's name in the line and exactly the bill's amount (a bill is paid whole).
 */

/** What a store owes its suppliers (NS 4102's 2400). */
export const PAYABLE_ACCOUNT = 2400;

/** The bank's account a bill is paid from. */
const BANK = 1920;

/** A bill: `abroad` for a service bought from abroad, its VAT reckoned by the store (D502). */
export type BillFacts = { id: string; day: string; totalMinor: number; kind: PurchaseKind; vatRate: PurchaseVatRate; abroad?: boolean; text: string };

/** The entry a bill makes when it comes. */
export function entryOfBill(bill: BillFacts): LedgerEntryInput {
  return {
    series: LEDGER_SERIES.purchases,
    date: bill.day,
    text: bill.text.trim().slice(0, 200) || "Leverandørfaktura",
    source: { kind: "supplier_invoice", id: bill.id },
    lines: [...costLinesOf(bill.totalMinor, bill.kind, bill.vatRate, bill.abroad ?? false), { account: PAYABLE_ACCOUNT, amountMinor: -bill.totalMinor, vatCode: null }],
  };
}

/** The entry a bill's payment makes, from the bank line that paid it: null unless the line pays exactly the bill. */
export function entryOfBillPayment(line: { id: string; day: string; amountMinor: number }, bill: { totalMinor: number; text: string }): LedgerEntryInput | null {
  if (line.amountMinor >= 0 || -line.amountMinor !== bill.totalMinor) return null;
  return {
    series: LEDGER_SERIES.bank,
    date: line.day,
    text: `Betalt: ${bill.text}`.slice(0, 200),
    source: { kind: "bank_line", id: line.id },
    lines: [
      { account: PAYABLE_ACCOUNT, amountMinor: bill.totalMinor, vatCode: null },
      { account: BANK, amountMinor: -bill.totalMinor, vatCode: null },
    ],
  };
}

export type BankMoneyOut = { id: string; day: string; amountMinor: number; currency: string; text: string; reference: string | null; counterparty: string | null };
export type UnpaidBill = { id: string; number: string | null; supplier: string; currency: string; issuedOn: string; totalMinor: number };

/**
 * Which unpaid bill each line of money out most likely pays (`matchInvoices()` turned round: the line's amount as money paid), kept only where
 * the line pays exactly the bill: `certain` when its number is in the line, else offered.
 */
export function matchBills(lines: readonly BankMoneyOut[], bills: readonly UnpaidBill[]) {
  const totals = new Map(bills.map((b) => [b.id, b.totalMinor]));
  const amounts = new Map(lines.map((l) => [l.id, -l.amountMinor]));
  return matchInvoices(
    lines.filter((l) => l.amountMinor < 0).map((l) => ({ ...l, amountMinor: -l.amountMinor })),
    bills.map((b) => ({ id: b.id, printedNumber: b.number ?? "", number: null, client: b.supplier, currency: b.currency, issuedOn: b.issuedOn, outstandingMinor: b.totalMinor })),
  ).filter((m) => amounts.get(m.lineId) === totals.get(m.invoiceId));
}
