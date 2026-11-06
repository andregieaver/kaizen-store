import saft from "@/data/ledger/no-saft.json";

import { BOOKING_KEYS, clipText, type BookingDoc, type BookingKey } from "./accounting-docs";
import { minorUnitDigits } from "./money";

/**
 * Our own ledger (B2 of `docs/own-books-and-sales.md`, D478), pure: double-entry books, one for each legal entity a store has been
 * (a change of the business behind it, D473, closes one book and opens the next). An entry is numbered in its series and year, balanced to
 * the øre, never changed once posted and corrected only by a reversing entry; a book is locked through a day. Amounts are the book's
 * currency's minor units, a debit positive and a credit negative. The chart and the VAT codes come from the country's pack: Norway's from
 * Skatteetaten's SAF-T files (`src/data/ledger/no-saft.json`: the standard accounts, NS 4102's four digits, and the standard VAT codes).
 * Nothing here knows the database.
 */

export const LEDGER_KINDS = ["asset", "liability", "equity", "income", "expense"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type StandardAccount = { id: string; nb: string; en: string };
export type TaxCode = { code: string; nb: string; en: string; rate: string; compensation: boolean };

/** Skatteetaten's standard accounts (SAF-T's `StandardAccountID`, four digits) and standard VAT codes, as published. */
export const NO_STANDARD_ACCOUNTS: readonly StandardAccount[] = saft.accounts;
export const NO_TAX_CODES: readonly TaxCode[] = saft.taxCodes;

const standardById = new Map(NO_STANDARD_ACCOUNTS.map((a) => [a.id, a]));
const taxCodes = new Set(NO_TAX_CODES.map((c) => c.code));

export const standardAccount = (id: string): StandardAccount | null => standardById.get(id) ?? null;
export const isVatCode = (code: string): boolean => taxCodes.has(code);

/**
 * An account's kind in Norway's chart by its number (NS 4102's classes): 1 assets; 20 equity and the rest of 2 liabilities; 3 income; 4 to 7
 * costs; in 8, financial income (80) and the rest on the profit and loss side as costs (financial costs, tax, the year's result and its
 * transfers). A longer number (a sub-account Lisa makes, `15001`) reads by its first digits.
 */
export function noKindOf(number: number): LedgerKind {
  const digits = String(number);
  const first = digits[0];
  const two = digits.slice(0, 2);
  if (first === "1") return "asset";
  if (first === "2") return two === "20" ? "equity" : "liability";
  if (first === "3" || two === "80") return "income";
  return "expense";
}

/** The standard account a number reports as: itself when it is one, else its first four digits when those are. */
export function standardOf(number: number): string | null {
  const digits = String(number);
  if (standardById.has(digits)) return digits;
  const four = digits.slice(0, 4);
  return digits.length > 4 && standardById.has(four) ? four : null;
}

export type LedgerAccountSeed = { number: number; name: string; standard: string; kind: LedgerKind; vatCode: string | null };

/** The VAT code an account's postings take by default (SAF-T's standard codes): sales by their rate, purchases with deductible VAT. */
const STARTING_VAT: Record<number, string> = { 3000: "3", 3030: "31", 3050: "33", 3100: "5", 3105: "52", 3125: "52", 3200: "6", 4300: "1", 6800: "1", 6900: "1" };

/**
 * The accounts a new Norwegian book starts with: every account Kaizena Flow posts to (`NO_POSTING`, the VAT accounts) and those a small
 * business uses most. Any other standard account is added when needed.
 */
export const NO_STARTING_ACCOUNTS: readonly number[] = [
  1500, 1579, 1900, 1920, 2000, 2050, 2400, 2700, 2701, 2703, 2710, 2711, 2713, 2740, 2900, 2990, 3000, 3030, 3050, 3100, 3105, 3125, 3200,
  3900, 4300, 6300, 6700, 6705, 6800, 6900, 7140, 7320, 7770, 8050, 8060, 8150, 8160, 8800,
];

export function startingChart(): LedgerAccountSeed[] {
  return NO_STARTING_ACCOUNTS.map((number) => {
    const standard = standardAccount(String(number));
    if (!standard) throw new Error(`ledger: ${number} is not a standard account`);
    return { number, name: standard.nb, standard: standard.id, kind: noKindOf(number), vatCode: STARTING_VAT[number] ?? null };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------------------------------------

/** The series: `S` sales documents, `B` bank and payouts, `M` made by hand, `IB` opening balances. Others may be added (one to three capitals). */
export const LEDGER_SERIES = { sales: "S", bank: "B", manual: "M", opening: "IB" } as const;

export type LedgerLineInput = { account: number; amountMinor: number; vatCode?: string | null; text?: string | null };
export type LedgerEntryInput = {
  series: string;
  date: string;
  text: string;
  /** What it was posted from (a document, a payout), so it is posted once; null for one made by hand. */
  source: { kind: string; id: string } | null;
  lines: LedgerLineInput[];
};

export type EntryProblem = "series" | "date" | "text" | "lines" | "zero" | "balance" | "account" | "vat_code" | "too_large";

/** The most one line may be: a thousand billion of the currency's minor units, as the deals' estimates. */
const LINE_MAX = 1_000_000_000_000_000;

/** A real calendar day as `YYYY-MM-DD` (2027-02-30 is none). */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** What is wrong with an entry before it is posted (the database checks the same and more: accounts, periods, numbering). */
export function entryProblems(entry: LedgerEntryInput): EntryProblem[] {
  const problems = new Set<EntryProblem>();
  if (!/^[A-Z]{1,3}$/.test(entry.series)) problems.add("series");
  if (!isDay(entry.date)) problems.add("date");
  const text = entry.text.trim();
  if (text.length < 1 || text.length > 200) problems.add("text");
  if (entry.lines.length < 2 || entry.lines.length > 500) problems.add("lines");
  let sum = 0;
  for (const line of entry.lines) {
    if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor === 0) problems.add("zero");
    else if (Math.abs(line.amountMinor) > LINE_MAX) problems.add("too_large");
    if (!Number.isInteger(line.account) || line.account < 1000 || line.account > 99999) problems.add("account");
    if (line.vatCode != null && !isVatCode(line.vatCode)) problems.add("vat_code");
    sum += line.amountMinor;
  }
  if (sum !== 0) problems.add("balance");
  return [...problems];
}

/** How an entry is named where people read it: its series, year and number (`S2027-14`). */
export const entryName = (series: string, year: number, number: number): string => `${series}${year}-${number}`;

// ---------------------------------------------------------------------------------------------------------------------
// Posting a document
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Where a store's documents are posted: the receivable, and an income account for each VAT bucket (`BookingKey`). For the pilot they are
 * the store's Tripletex settings where it has them, so the two books can agree account by account; else Norway's defaults.
 */
export type LedgerPosting = { receivable: number; income: Partial<Record<BookingKey, number>> };

/** Norway's defaults: what Tripletex sets a new company up with (`DEFAULT_BOOKING`), the standard rates on 3000 with their own VAT codes. */
export const NO_POSTING: LedgerPosting = {
  receivable: 1500,
  income: { standard_25: 3000, standard_15: 3000, standard_12: 3000, standard_0: 3000, exempt: 3100, outside_scope: 3200, reverse_charge: 3200, gift_card: 2900 },
};

/**
 * Each bucket's VAT: its standard code (Skatteetaten's) and the output VAT account its VAT goes to, or none. A seller that is not VAT
 * registered (`standard_0`) and a gift card sold (a debt, not a sale) take no code; services to a business abroad are export (52)
 * [U: the accountant's choice, as for Tripletex].
 */
export const BUCKET_VAT: Record<BookingKey, { code: string | null; vatAccount: number | null }> = {
  standard_25: { code: "3", vatAccount: 2700 },
  standard_15: { code: "31", vatAccount: 2701 },
  standard_12: { code: "33", vatAccount: 2703 },
  standard_0: { code: null, vatAccount: null },
  exempt: { code: "5", vatAccount: null },
  outside_scope: { code: "6", vatAccount: null },
  reverse_charge: { code: "52", vatAccount: null },
  gift_card: { code: null, vatAccount: null },
};

export type DocProblem = "currency" | "vat_unmapped" | "totals" | "nothing";

/** The source kind a document is posted under, so it is posted once (`work_invoice`, `shop_credit_note`, …). */
export const docSourceKind = (doc: Pick<BookingDoc, "source" | "kind">): string => `${doc.source}_${doc.kind}`;

/**
 * A Kaizena Flow document as an entry in the sales series, on its issue day: the receivable for its total, each bucket's net on its income
 * account with its VAT code, and each rate's VAT on its output VAT account; a credit note the same with the signs turned. What cannot be
 * posted as it is waits for a person, with why: another currency than the book's (a rate is step 2's), a bucket with no account or VAT
 * where its bucket has none, totals that do not add up, or nothing to post.
 */
export function entryOfDoc(
  doc: BookingDoc,
  posting: LedgerPosting,
  bookCurrency: string,
  fx: DocRate | null = null,
): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: DocProblem } {
  const foreign = doc.currency.toUpperCase() !== bookCurrency.toUpperCase();
  if (foreign && !fx) return { ok: false, problem: "currency" };
  if (doc.lines.length === 0 || doc.totalMinor === 0) return { ok: false, problem: "nothing" };
  const income = new Map<string, LedgerLineInput>();
  const vat = new Map<string, LedgerLineInput>();
  let gross = 0;
  for (const line of doc.lines) {
    if (!line.key) return { ok: false, problem: "vat_unmapped" };
    const account = posting.income[line.key];
    if (!account) return { ok: false, problem: "vat_unmapped" };
    const { code, vatAccount } = BUCKET_VAT[line.key];
    const vatMinor = line.vatMinor ?? 0;
    const netMinor = line.netMinor ?? line.grossMinor - vatMinor;
    if (netMinor + vatMinor !== line.grossMinor) return { ok: false, problem: "totals" };
    if (vatMinor !== 0 && !vatAccount) return { ok: false, problem: "vat_unmapped" };
    gross += line.grossMinor;
    const incomeKey = `${account}|${code ?? ""}`;
    const had = income.get(incomeKey);
    income.set(incomeKey, { account, amountMinor: (had?.amountMinor ?? 0) + netMinor, vatCode: code });
    if (vatAccount && vatMinor !== 0) {
      const vatKey = `${vatAccount}|${code}`;
      const hadVat = vat.get(vatKey);
      vat.set(vatKey, { account: vatAccount, amountMinor: (hadVat?.amountMinor ?? 0) + vatMinor, vatCode: code });
    }
  }
  if (gross !== doc.totalMinor) return { ok: false, problem: "totals" };
  let incomeLines = [...income.values()];
  let vatLines = [...vat.values()];
  let total = doc.totalMinor;
  if (foreign && fx) {
    const converted = convertLines(incomeLines, vatLines, doc.currency, bookCurrency, fx);
    if (!converted) return { ok: false, problem: "currency" };
    ({ incomeLines, vatLines, total } = converted);
  }
  const sign = doc.kind === "invoice" ? 1 : -1;
  const lines: LedgerLineInput[] = [
    { account: posting.receivable, amountMinor: sign * total, vatCode: null },
    ...[...incomeLines, ...vatLines].map((l) => ({ ...l, amountMinor: -sign * l.amountMinor })),
  ].filter((l) => l.amountMinor !== 0);
  if (lines.length < 2) return { ok: false, problem: "nothing" };
  const word = doc.kind === "invoice" ? "Faktura" : "Kreditnota";
  return {
    ok: true,
    entry: {
      series: LEDGER_SERIES.sales,
      date: doc.issuedOn,
      text: clipText(`${word} ${doc.documentNumber}${doc.counterparty ? `, ${doc.counterparty}` : ""}`, 200),
      source: { kind: docSourceKind(doc), id: doc.id },
      lines,
    },
  };
}

/**
 * A document in another currency than the book's, as it was issued: its rate (units of the book's currency for one of the document's, as
 * the document froze it) and its VAT in the book's currency, as it was reported.
 */
export type DocRate = { rate: string; vatHomeMinor: number };

/**
 * A document's lines in the book's currency at the document's own rate: each converted and rounded, the VAT lines then made to add up to
 * the VAT the document reported in the book's currency (the difference of rounding on the largest), and the receivable their sum. Null when
 * the rate is not a positive number or VAT is reported where the document has none.
 */
function convertLines(
  incomeLines: LedgerLineInput[],
  vatLines: LedgerLineInput[],
  from: string,
  to: string,
  fx: DocRate,
): { incomeLines: LedgerLineInput[]; vatLines: LedgerLineInput[]; total: number } | null {
  const rate = Number(fx.rate);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(fx.vatHomeMinor)) return null;
  let factor: number;
  try {
    factor = rate * 10 ** (minorUnitDigits(to) - minorUnitDigits(from));
  } catch {
    return null;
  }
  const convert = (l: LedgerLineInput) => ({ ...l, amountMinor: Math.round(l.amountMinor * factor) });
  const income = incomeLines.map(convert);
  const vat = vatLines.map(convert);
  const vatSum = vat.reduce((sum, l) => sum + l.amountMinor, 0);
  if (vat.length === 0 && fx.vatHomeMinor !== 0) return null;
  if (vat.length > 0 && vatSum !== fx.vatHomeMinor) {
    const largest = vat.reduce((best, l, i) => (Math.abs(l.amountMinor) > Math.abs(vat[best].amountMinor) ? i : best), 0);
    vat[largest] = { ...vat[largest], amountMinor: vat[largest].amountMinor + (fx.vatHomeMinor - vatSum) };
  }
  const total = [...income, ...vat].reduce((sum, l) => sum + l.amountMinor, 0);
  return { incomeLines: income, vatLines: vat, total };
}

/** The posting a store's Tripletex settings make (its receivable and each bucket's account), over Norway's defaults. */
export function postingOfTripletex(settings: { receivableAccount: number; bookings: Partial<Record<BookingKey, { account: number }>> } | null): LedgerPosting {
  if (!settings) return NO_POSTING;
  const income: LedgerPosting["income"] = { ...NO_POSTING.income };
  for (const key of BOOKING_KEYS) {
    const booking = settings.bookings[key];
    if (booking) income[key] = booking.account;
  }
  return { receivable: settings.receivableAccount, income };
}

// ---------------------------------------------------------------------------------------------------------------------
// The trial balance
// ---------------------------------------------------------------------------------------------------------------------

/** An account in a trial balance: what it held before the period, its debits and credits in it, and what it holds after. */
export type TrialRow = { account: number; name: string; kind: LedgerKind; before: number; debit: number; credit: number };

export type TrialBalance = {
  rows: (TrialRow & { after: number })[];
  totals: { before: number; debit: number; credit: number; after: number };
  /** The period's result: income less costs (a profit positive), from the accounts on the profit and loss side. */
  result: number;
};

/** Sums a trial balance: every column of a sound book sums to zero (debits as positive, credits as negative), and the result is read off it. */
export function trialBalance(rows: readonly TrialRow[]): TrialBalance {
  const out = [...rows].sort((a, b) => a.account - b.account).map((r) => ({ ...r, after: r.before + r.debit + r.credit }));
  const totals = out.reduce((t, r) => ({ before: t.before + r.before, debit: t.debit + r.debit, credit: t.credit + r.credit, after: t.after + r.after }), { before: 0, debit: 0, credit: 0, after: 0 });
  const result = -out.filter((r) => r.kind === "income" || r.kind === "expense").reduce((sum, r) => sum + r.debit + r.credit, 0);
  return { rows: out, totals, result };
}
