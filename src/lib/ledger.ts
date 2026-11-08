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
export const LEDGER_SERIES = { sales: "S", bank: "B", manual: "M", opening: "IB", purchases: "L" } as const;

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

/** How money for a Work invoice came in (`work_invoice_payments.method`). */
export type PaymentMethod = "bank" | "card" | "cash" | "other" | "stripe" | "prepaid";

/**
 * Where money received for an invoice is (D478 step 2c): the bank; the till; a card or Stripe payment with the payment provider until its
 * payout reaches the bank (other short-term receivables, which the payout clears, step 2c's payouts); a prepayment the client made earlier.
 */
export const PAYMENT_ACCOUNTS: Record<PaymentMethod, number> = { bank: 1920, other: 1920, cash: 1900, card: 1579, stripe: 1579, prepaid: 2900 };

/** Where the difference of exchange between an invoice's day and its payment's goes: a gain (agio) or a loss (disagio). */
export const FX_GAIN_ACCOUNT = 8060;
export const FX_LOSS_ACCOUNT = 8160;

/** A payment for a Work invoice, as posted: received (positive) or paid back (negative), in the invoice's currency. */
export type PaymentDoc = {
  id: string;
  invoiceNumber: string;
  counterparty: string | null;
  receivedOn: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  /** What it was posted from, when not a Work invoice's payment (`shop_payment`, `shop_refund`, step 2c). */
  sourceKind?: string;
  /** What the words name, when not "faktura {invoiceNumber}" (`ordre 1042`). */
  what?: string;
  /** Where the money is, when the method's account is not it (a refund to store credit is owed to the customer, 2900). */
  account?: number;
};

/**
 * A payment in another currency than the book's: units of the book's currency for one of the payment's, at the invoice's own rate (as its
 * receivable was posted) and on the payment's day (the ECB's, what the money was worth when it came).
 */
/**
 * What a payment in another currency is worth in the book's: the receivable at the invoice's own rate (`invoice`), the money at the day's
 * (`day`, the ECB's), or at what the payment provider settled it for in the book's currency (`moneyMinor`, a Stripe payout's line), which wins.
 */
export type PaymentRates = { invoice: string; day?: string; moneyMinor?: number };

export type PaymentProblem = "currency" | "nothing";

/**
 * A payment as an entry in the bank series on its day: the money where it is (`PAYMENT_ACCOUNTS`) against the receivable; a payment paid
 * back the same with the signs turned. In another currency, the money is worth what it was on the payment's day and the receivable what it
 * was posted at, and the difference is an exchange gain or loss. A reversal of a payment is not this: it turns the payment's own entry.
 */
export function entryOfPayment(
  payment: PaymentDoc,
  posting: Pick<LedgerPosting, "receivable">,
  bookCurrency: string,
  rates: PaymentRates | null = null,
): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: PaymentProblem } {
  if (!Number.isSafeInteger(payment.amountMinor) || payment.amountMinor === 0) return { ok: false, problem: "nothing" };
  const foreign = payment.currency.toUpperCase() !== bookCurrency.toUpperCase();
  let money = payment.amountMinor;
  let receivable = payment.amountMinor;
  if (foreign) {
    if (!rates) return { ok: false, problem: "currency" };
    const atInvoice = inBook(payment.amountMinor, payment.currency, bookCurrency, rates.invoice);
    const settled = rates.moneyMinor;
    const atDay =
      settled !== undefined
        ? Number.isSafeInteger(settled) && settled !== 0 && Math.sign(settled) === Math.sign(payment.amountMinor)
          ? settled
          : null
        : rates.day
          ? inBook(payment.amountMinor, payment.currency, bookCurrency, rates.day)
          : null;
    if (atInvoice === null || atDay === null) return { ok: false, problem: "currency" };
    receivable = atInvoice;
    money = atDay;
  }
  const difference = money - receivable;
  const lines: LedgerLineInput[] = [
    { account: payment.account ?? PAYMENT_ACCOUNTS[payment.method], amountMinor: money, vatCode: null },
    { account: posting.receivable, amountMinor: -receivable, vatCode: null },
    ...(difference > 0 ? [{ account: FX_GAIN_ACCOUNT, amountMinor: -difference, vatCode: null }] : []),
    ...(difference < 0 ? [{ account: FX_LOSS_ACCOUNT, amountMinor: -difference, vatCode: null }] : []),
  ].filter((l) => l.amountMinor !== 0);
  if (lines.length < 2) return { ok: false, problem: "nothing" };
  const word = payment.amountMinor > 0 ? "Innbetaling" : "Tilbakebetaling";
  return {
    ok: true,
    entry: {
      series: LEDGER_SERIES.bank,
      date: payment.receivedOn,
      text: clipText(`${word} ${payment.what ?? `faktura ${payment.invoiceNumber}`}${payment.counterparty ? `, ${payment.counterparty}` : ""}`, 200),
      source: { kind: payment.sourceKind ?? "work_payment", id: payment.id },
      lines,
    },
  };
}

/** Where a shop's payment is (step 2c): with the payment provider until its payout (Stripe), or where staff took it by hand (D173). */
export const SHOP_PAYMENT_ACCOUNTS: Record<string, number> = { stripe: 1579, cash: 1900, bank_transfer: 1920, other: 1920 };

/** What a refund to store credit is: owed to the customer until it is spent (D381). */
export const STORE_CREDIT_ACCOUNT = 2900;

/**
 * What gift cards owe their holders (D300): a card sold is posted here by its invoice's `voucher` line (`gift_card`, 2900), a refund to store
 * credit too (it is a card, D364), and a card spent at checkout takes it off again. One account, so what is left on it is what cards still owe.
 */
export const GIFT_CARD_ACCOUNT = STORE_CREDIT_ACCOUNT;

/**
 * Where a shop payment's money is, or a refund's goes (step 2c): Stripe's on the provider's balance until its payout; one taken by hand where
 * staff said (D173); a gift card's, store credit's too, off what cards owe (D300, D364); a refund to store credit owes it to the customer. An
 * exchange's payment and the refund it is paid from move no money (the old order's credit note and the new order's invoice meet on the
 * receivable), so nothing is posted (`skip`). A way of paying the books do not follow yet waits (`provider`), never guessed into the bank.
 */
export function shopMoneyAccount(
  input: { provider: string; method: string | null; refundKind?: string | null },
): { account: number } | { skip: true } | { wait: "provider" } {
  if (input.refundKind === "store_credit") return { account: STORE_CREDIT_ACCOUNT };
  if (input.provider === "exchange") return { skip: true };
  if (input.provider === "stripe") return { account: SHOP_PAYMENT_ACCOUNTS.stripe };
  if (input.provider === "gift_card") return { account: GIFT_CARD_ACCOUNT };
  if (input.provider === "manual") return { account: SHOP_PAYMENT_ACCOUNTS[input.method ?? "other"] ?? SHOP_PAYMENT_ACCOUNTS.other };
  return { wait: "provider" };
}

/** Where Stripe's fees are posted: bank and card charges. */
export const CARD_FEE_ACCOUNT = 7770;

/**
 * A dispute's money as the provider moved it (step 2c, D288): taken back from the provider's balance when a customer disputes a payment
 * (a negative payout line), the order's receivable open again as the customer has not paid after all; given back when the dispute is won
 * (a positive one), the receivable cleared again. The dispute's fee is the payout's, with its other fees (7770). A dispute lost leaves the
 * receivable open: writing it off as a loss is the owner's, with the accountant.
 */
export function entryOfDisputeLine(
  line: { id: string; day: string; amountMinor: number; orderNumber: string | null },
  posting: Pick<LedgerPosting, "receivable">,
): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: PaymentProblem } {
  if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor === 0) return { ok: false, problem: "nothing" };
  const order = line.orderNumber ? `, ordre ${line.orderNumber}` : "";
  return {
    ok: true,
    entry: {
      series: LEDGER_SERIES.bank,
      date: line.day,
      text: clipText(`${line.amountMinor < 0 ? "Tilbakeført ved innsigelse" : "Innsigelse vunnet, tilbakebetalt"}${order}`, 200),
      source: { kind: "dispute", id: line.id },
      lines: [
        { account: SHOP_PAYMENT_ACCOUNTS.stripe, amountMinor: line.amountMinor, vatCode: null },
        { account: posting.receivable, amountMinor: -line.amountMinor, vatCode: null },
      ],
    },
  };
}

/**
 * A payout from the payment provider to the bank (step 2c, D290): what reached the bank, what the provider kept as its fees, and the gross
 * that left the provider's balance (1579). A payout taking money back from the bank (negative) is the same with the signs turned.
 */
export function entryOfPayout(payout: { id: string; day: string; amountMinor: number; feeMinor: number; provider: string }): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: PaymentProblem } {
  if (!Number.isSafeInteger(payout.amountMinor) || !Number.isSafeInteger(payout.feeMinor)) return { ok: false, problem: "nothing" };
  const gross = payout.amountMinor + payout.feeMinor;
  const lines: LedgerLineInput[] = [
    { account: PAYMENT_ACCOUNTS.bank, amountMinor: payout.amountMinor, vatCode: null },
    { account: CARD_FEE_ACCOUNT, amountMinor: payout.feeMinor, vatCode: null },
    { account: SHOP_PAYMENT_ACCOUNTS.stripe, amountMinor: -gross, vatCode: null },
  ].filter((l) => l.amountMinor !== 0);
  if (lines.length < 2) return { ok: false, problem: "nothing" };
  const name = payout.provider === "stripe" ? "Stripe" : payout.provider;
  return {
    ok: true,
    entry: { series: LEDGER_SERIES.bank, date: payout.day, text: clipText(`Utbetaling fra ${name}`, 200), source: { kind: "payout", id: payout.id }, lines },
  };
}

/** An amount in another currency in the book's, at a rate (book units for one of the other), rounded to the book's minor unit; null for a rate that is not a positive number. */
function inBook(amountMinor: number, from: string, to: string, rate: string): number | null {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return null;
  try {
    const converted = Math.round(amountMinor * r * 10 ** (minorUnitDigits(to) - minorUnitDigits(from)));
    return Number.isSafeInteger(converted) && converted !== 0 ? converted : null;
  } catch {
    return null;
  }
}

/**
 * The reversal of a payment (`work_invoice_payments.reverses`): the payment's own entry with every line turned, on the reversal's day, so
 * what a mistaken payment moved is moved back to the øre, its exchange difference too.
 */
export function entryOfPaymentReversal(
  reversal: { id: string; invoiceNumber: string; counterparty: string | null; receivedOn: string },
  original: readonly { account: number; amountMinor: number }[],
): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: PaymentProblem } {
  const lines = original.filter((l) => l.amountMinor !== 0).map((l) => ({ account: l.account, amountMinor: -l.amountMinor, vatCode: null }));
  if (lines.length < 2) return { ok: false, problem: "nothing" };
  return {
    ok: true,
    entry: {
      series: LEDGER_SERIES.bank,
      date: reversal.receivedOn,
      text: clipText(`Reversert innbetaling faktura ${reversal.invoiceNumber}${reversal.counterparty ? `, ${reversal.counterparty}` : ""}`, 200),
      source: { kind: "work_payment", id: reversal.id },
      lines,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// A lost invoice (D500)
// ---------------------------------------------------------------------------------------------------------------------

/** Where a receivable found lost goes: losses on receivables. */
export const BAD_DEBT_ACCOUNT = 7830;

/**
 * The output VAT a lost receivable takes back, by the invoice's rate: Skatteetaten has it reported as a deduction on the purchase codes
 * (*tap på krav*, rule R038: codes 1, 11, 12 or 13), so it is posted as input VAT on the code's account.
 */
export const LOSS_VAT: Readonly<Record<number, { code: string; account: number }>> = {
  25: { code: "1", account: 2710 },
  15: { code: "11", account: 2711 },
  12: { code: "13", account: 2713 },
};

export type LossDoc = {
  id: string;
  day: string;
  /** What is written off, with VAT (the receivable's amount). */
  amountMinor: number;
  invoiceNumber: string;
  counterparty: string | null;
  /** The invoice's lines by VAT rate (percent): what they came to with VAT, and the VAT in that. */
  buckets: readonly { ratePercent: number; inclMinor: number; vatMinor: number }[];
};

/**
 * A lost receivable posted (D500): the receivable credited by what is written off; that shared over the invoice's VAT rates as its lines
 * were, each share's VAT taken back as a deduction on its rate's code and account (a rate without one, or no VAT, takes none), and the
 * rest a loss on 7830 under the same code, so the VAT return finds the deduction and its base. In the manual series, on the day written off.
 */
export function entryOfInvoiceLoss(loss: LossDoc, receivable: number): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: PaymentProblem } {
  if (!Number.isSafeInteger(loss.amountMinor) || loss.amountMinor <= 0) return { ok: false, problem: "nothing" };
  const buckets = loss.buckets.filter((b) => b.inclMinor > 0);
  const total = buckets.reduce((sum, b) => sum + b.inclMinor, 0);
  const lines: LedgerLineInput[] = [];
  const add = (account: number, amountMinor: number, vatCode: string | null) => {
    if (amountMinor === 0) return;
    const held = lines.find((l) => l.account === account && (l.vatCode ?? null) === vatCode);
    if (held) held.amountMinor += amountMinor;
    else lines.push({ account, amountMinor, vatCode });
  };
  let left = loss.amountMinor;
  buckets.forEach((b, i) => {
    const share = i === buckets.length - 1 ? left : Math.round((loss.amountMinor * b.inclMinor) / total);
    left -= share;
    const back = LOSS_VAT[b.ratePercent];
    const vat = back && b.vatMinor > 0 ? Math.round((share * b.vatMinor) / b.inclMinor) : 0;
    add(BAD_DEBT_ACCOUNT, share - vat, vat !== 0 ? back.code : null);
    if (vat !== 0) add(back.account, vat, back.code);
  });
  if (buckets.length === 0) add(BAD_DEBT_ACCOUNT, loss.amountMinor, null);
  lines.push({ account: receivable, amountMinor: -loss.amountMinor, vatCode: null });
  return {
    ok: true,
    entry: {
      series: LEDGER_SERIES.manual,
      date: loss.day,
      text: clipText(`Tap på krav, faktura ${loss.invoiceNumber}${loss.counterparty ? `, ${loss.counterparty}` : ""}`, 200),
      source: { kind: "work_invoice_loss", id: loss.id },
      lines,
    },
  };
}

/** A loss taken back (a mistake, or the money came after all): the loss's own entry turned, its VAT codes kept so the deduction goes too. */
export function entryOfLossReversal(
  reversal: { id: string; day: string; invoiceNumber: string; counterparty: string | null },
  original: readonly { account: number; amountMinor: number; vatCode: string | null }[],
): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: PaymentProblem } {
  const lines = original.filter((l) => l.amountMinor !== 0).map((l) => ({ account: l.account, amountMinor: -l.amountMinor, vatCode: l.vatCode }));
  if (lines.length < 2) return { ok: false, problem: "nothing" };
  return {
    ok: true,
    entry: {
      series: LEDGER_SERIES.manual,
      date: reversal.day,
      text: clipText(`Tilbakeført tap på krav, faktura ${reversal.invoiceNumber}${reversal.counterparty ? `, ${reversal.counterparty}` : ""}`, 200),
      source: { kind: "work_invoice_loss", id: reversal.id },
      lines,
    },
  };
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

// ---------------------------------------------------------------------------------------------------------------------
// Step 3b: the profit and loss, the balance sheet and VAT by code
// ---------------------------------------------------------------------------------------------------------------------

/** The lines of the profit and loss in NS 4102's classes, in their order (Norway's accounting act's form, regnskapsloven § 6-1, simplified). */
export const RESULT_GROUPS = ["sales", "other_income", "goods", "payroll", "depreciation", "other_costs", "financial_income", "financial_costs", "tax"] as const;
export type ResultGroup = (typeof RESULT_GROUPS)[number];

/**
 * Where an account of the profit and loss side is shown, by its NS 4102 class: 30–35 sales, 36–39 other operating income, 4 goods, 5 payroll,
 * 60 depreciation, 61–79 other operating costs, 80 financial income, 81 financial costs, 83–84 tax. 85–89 (the year's result carried and
 * what it is used for) is no line of it; neither is an account of the balance sheet. A sub-account (15001) is read by its first four digits.
 */
export function resultGroupOf(number: number): ResultGroup | null {
  const head = Number(String(number).slice(0, 4));
  if (head >= 3000 && head <= 3599) return "sales";
  if (head >= 3600 && head <= 3999) return "other_income";
  if (head >= 4000 && head <= 4999) return "goods";
  if (head >= 5000 && head <= 5999) return "payroll";
  if (head >= 6000 && head <= 6099) return "depreciation";
  if (head >= 6100 && head <= 7999) return "other_costs";
  if (head >= 8000 && head <= 8099) return "financial_income";
  if (head >= 8100 && head <= 8299) return "financial_costs";
  if (head >= 8300 && head <= 8499) return "tax";
  return null;
}

/** A line of a report: an account and its amount, income and what is owed shown as positive. */
export type ReportRow = { account: number; name: string; amount: number };

export type ProfitAndLoss = {
  groups: { group: ResultGroup; rows: ReportRow[]; total: number }[];
  /** Operating income less operating costs. */
  operating: number;
  /** Financial income less financial costs. */
  financial: number;
  beforeTax: number;
  /** The period's result after tax: a profit positive. */
  result: number;
};

const INCOME_GROUPS: ReadonlySet<ResultGroup> = new Set(["sales", "other_income", "financial_income"]);

/**
 * The profit and loss of a period from the trial balance's rows (what each account moved in the days): each group's accounts with their
 * amounts as a reader reads them (income and costs both positive), the operating and financial results, and the result after tax.
 */
export function profitAndLoss(rows: readonly (TrialRow & { after?: number })[]): ProfitAndLoss {
  const byGroup = new Map<ResultGroup, ReportRow[]>();
  for (const r of rows) {
    const group = resultGroupOf(r.account);
    const moved = r.debit + r.credit;
    if (!group || moved === 0) continue;
    const amount = INCOME_GROUPS.has(group) ? -moved : moved;
    byGroup.set(group, [...(byGroup.get(group) ?? []), { account: r.account, name: r.name, amount }]);
  }
  const groups = RESULT_GROUPS.flatMap((group) => {
    const groupRows = (byGroup.get(group) ?? []).sort((a, b) => a.account - b.account);
    return groupRows.length > 0 ? [{ group, rows: groupRows, total: groupRows.reduce((sum, r) => sum + r.amount, 0) }] : [];
  });
  const total = (group: ResultGroup) => groups.find((g) => g.group === group)?.total ?? 0;
  const operating = total("sales") + total("other_income") - total("goods") - total("payroll") - total("depreciation") - total("other_costs");
  const financial = total("financial_income") - total("financial_costs");
  const beforeTax = operating + financial;
  return { groups, operating, financial, beforeTax, result: beforeTax - total("tax") };
}

/** The groups of the balance sheet in NS 4102's classes (10–13 fixed assets, 14–19 current assets, 20 equity, 21–22 long-term, 23–29 short-term). */
export const BALANCE_GROUPS = ["fixed_assets", "current_assets", "equity", "long_term", "short_term"] as const;
export type BalanceGroup = (typeof BALANCE_GROUPS)[number];

export function balanceGroupOf(number: number): BalanceGroup | null {
  const head = Number(String(number).slice(0, 4));
  if (head >= 1000 && head <= 1399) return "fixed_assets";
  if (head >= 1400 && head <= 1999) return "current_assets";
  if (head >= 2000 && head <= 2099) return "equity";
  if (head >= 2100 && head <= 2299) return "long_term";
  if (head >= 2300 && head <= 2999) return "short_term";
  return null;
}

export type BalanceSheet = {
  groups: { group: BalanceGroup; rows: ReportRow[]; total: number }[];
  assets: number;
  /** The result not yet carried to equity: every profit and loss account's balance on the day, a profit positive. */
  unallocated: number;
  /** Equity, the result not yet carried and the debt: equal to the assets in a sound book. */
  equityAndLiabilities: number;
};

/**
 * The balance sheet on a day from the trial balance's rows (what each account holds after): the assets as they stand, equity and debt as
 * a reader reads them (positive), and the result of every day so far not yet carried to equity as a line of its own, so the two sides agree.
 */
export function balanceSheet(rows: readonly (TrialRow & { after: number })[]): BalanceSheet {
  const byGroup = new Map<BalanceGroup, ReportRow[]>();
  let unallocated = 0;
  for (const r of rows) {
    const group = balanceGroupOf(r.account);
    if (!group) {
      if (resultGroupOf(r.account) || Number(String(r.account).slice(0, 4)) >= 8500) unallocated -= r.after;
      continue;
    }
    if (r.after === 0) continue;
    const amount = group === "fixed_assets" || group === "current_assets" ? r.after : -r.after;
    byGroup.set(group, [...(byGroup.get(group) ?? []), { account: r.account, name: r.name, amount }]);
  }
  const groups = BALANCE_GROUPS.flatMap((group) => {
    const groupRows = (byGroup.get(group) ?? []).sort((a, b) => a.account - b.account);
    return groupRows.length > 0 ? [{ group, rows: groupRows, total: groupRows.reduce((sum, r) => sum + r.amount, 0) }] : [];
  });
  const sum = (names: readonly BalanceGroup[]) => groups.filter((g) => names.includes(g.group)).reduce((s, g) => s + g.total, 0);
  return { groups, assets: sum(["fixed_assets", "current_assets"]), unallocated, equityAndLiabilities: sum(["equity", "long_term", "short_term"]) + unallocated };
}

/** A posted line with its VAT code, for the VAT report. */
export type VatLine = { account: number; vatCode: string; amountMinor: number };

/**
 * One VAT code in a period: what it was charged on (the base) and the VAT, output VAT and sales positive. `spec` sets apart what the VAT
 * return reports on a line of its own: a lost receivable's VAT taken back (`tapPåKrav`, D500).
 */
export type VatRow = { code: string; base: number; vat: number; spec?: "tapPåKrav" };

/**
 * VAT by code for a period (the VAT return's lines, by SAF-T's standard codes): each code's base, from its lines on income and cost
 * accounts, and its VAT, from its lines on the VAT accounts (27xx). Sales and output VAT are shown positive, purchases and input VAT negative.
 */
export function vatByCode(lines: readonly VatLine[]): VatRow[] {
  const byCode = new Map<string, VatRow>();
  for (const l of lines) {
    const row = byCode.get(l.vatCode) ?? { code: l.vatCode, base: 0, vat: 0 };
    if (isVatAccount(l.account)) row.vat -= l.amountMinor;
    else row.base -= l.amountMinor;
    byCode.set(l.vatCode, row);
  }
  return [...byCode.values()].filter((r) => r.base !== 0 || r.vat !== 0).sort((a, b) => Number(a.code) - Number(b.code) || a.code.localeCompare(b.code));
}

/** Norway's VAT terms are two months each: the term a day is in, its first and last day (1: January–February, …, 6: November–December). */
export function vatTermOf(day: string): { term: number; from: string; to: string } {
  const [year, month] = day.split("-").map(Number);
  const term = Math.ceil(month / 2);
  const first = term * 2 - 1;
  const last = new Date(Date.UTC(year, first + 1, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { term, from: `${year}-${pad(first)}-01`, to: `${year}-${pad(first + 1)}-${pad(last)}` };
}

/** How many rows the form for an entry by hand has. */
export const HAND_ROWS = 8;

/** The series an entry made by hand is posted in: one by hand, or the opening balance of a book. */
export const HAND_SERIES = [LEDGER_SERIES.manual, LEDGER_SERIES.opening] as const;

/** A row of the form for an entry by hand, as typed: an account's number, a debit or a credit, and a VAT code where it has one. */
export type HandRow = { account: string; debit: string; credit: string; vatCode: string };

export type HandProblem = EntryProblem | "amount" | "both";

/**
 * An entry typed by hand (step 3b, for Lisa): its rows read as the form sent them, an empty row left out, each row a debit or a credit in
 * the book's currency (never both), its VAT code a standard one where given. What the form cannot be is said, row by row where it is a
 * row's; the entry's own rules (`entryProblems()`: balanced, two lines or more, a day, words) after.
 */
export function handEntryOf(
  input: { series: string; date: string; text: string; rows: readonly HandRow[] },
  currency: string,
  parse: (text: string, currency: string) => number | null,
): { ok: true; entry: LedgerEntryInput } | { ok: false; problems: HandProblem[]; rows: number[] } {
  const problems = new Set<HandProblem>();
  const badRows: number[] = [];
  const lines: LedgerLineInput[] = [];
  input.rows.forEach((row, i) => {
    const account = row.account.trim();
    const debit = row.debit.trim();
    const credit = row.credit.trim();
    if (!account && !debit && !credit) return;
    const number = Number(account);
    const debitMinor = debit ? parse(debit, currency) : 0;
    const creditMinor = credit ? parse(credit, currency) : 0;
    const vatCode = row.vatCode.trim();
    const found: HandProblem[] = [];
    if (!/^\d{4,6}$/.test(account)) found.push("account");
    if (debitMinor === null || creditMinor === null) found.push("amount");
    else if (debitMinor !== 0 && creditMinor !== 0) found.push("both");
    else if (debitMinor === 0 && creditMinor === 0) found.push("zero");
    if (vatCode && !isVatCode(vatCode)) found.push("vat_code");
    if (found.length > 0) {
      for (const f of found) problems.add(f);
      badRows.push(i);
      return;
    }
    lines.push({ account: number, amountMinor: (debitMinor ?? 0) - (creditMinor ?? 0), vatCode: vatCode || null });
  });
  if (!(HAND_SERIES as readonly string[]).includes(input.series)) problems.add("series");
  if (problems.size > 0) return { ok: false, problems: [...problems], rows: badRows };
  const entry: LedgerEntryInput = { series: input.series, date: input.date.trim(), text: input.text.trim(), source: null, lines };
  const ruled = entryProblems(entry);
  return ruled.length > 0 ? { ok: false, problems: ruled, rows: [] } : { ok: true, entry };
}

// ---------------------------------------------------------------------------------------------------------------------
// Step 4: compared with Tripletex
// ---------------------------------------------------------------------------------------------------------------------

/** An account of the VAT group (27xx in NS 4102), whose postings are compared as one VAT total. */
export const isVatAccount = (number: number): boolean => /^27\d{2,3}$/.test(String(number));

/** A posting of a Tripletex voucher as read back: its account's number, and its amount with VAT and without, in minor units. */
export type TheirPosting = { account: number; grossMinor: number; netMinor: number };

export type Difference = { account: number | "vat"; ours: number; theirs: number };

/**
 * One document's entry here against its voucher in Tripletex, account by account: every account but the VAT group by its amount without
 * VAT (the receivable's is its whole amount), and the VAT as one total (here the VAT accounts' lines, there what Tripletex worked out of
 * each gross amount, which holds whether or not it lists its VAT postings apart). They agree when nothing differs by even an øre.
 */
export function compareWithTheirs(ours: readonly { account: number; amountMinor: number }[], theirs: readonly TheirPosting[]): { agrees: boolean; differences: Difference[] } {
  const accounts = new Map<number, { ours: number; theirs: number }>();
  const at = (account: number) => accounts.get(account) ?? accounts.set(account, { ours: 0, theirs: 0 }).get(account)!;
  let ourVat = 0;
  let theirVat = 0;
  for (const line of ours) {
    if (isVatAccount(line.account)) ourVat += line.amountMinor;
    else at(line.account).ours += line.amountMinor;
  }
  for (const p of theirs) {
    theirVat += p.grossMinor - p.netMinor;
    if (!isVatAccount(p.account)) at(p.account).theirs += p.netMinor;
  }
  const differences: Difference[] = [...accounts.entries()]
    .filter(([, v]) => v.ours !== v.theirs)
    .sort(([a], [b]) => a - b)
    .map(([account, v]) => ({ account, ...v }));
  if (ourVat !== theirVat) differences.push({ account: "vat", ours: ourVat, theirs: theirVat });
  return { agrees: differences.length === 0, differences };
}

// ---------------------------------------------------------------------------------------------------------------------
// The opening balance, read from the system the store kept its books in (step 2d)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * An account as another system reads it at the switch (Tripletex's balance sheet), in minor units with debit positive: what it held at the
 * end of the day before the books open (`atOpeningMinor`), and what it moved from 1 January of that year to then (`yearToDateMinor`, read for
 * the profit and loss accounts, whose year starts again each 1 January).
 */
export type TheirBalance = { number: number; name: string; atOpeningMinor: number; yearToDateMinor: number };

/** Where the result of years before goes when it was never carried to equity there: other equity (NS 4102's 2050). */
export const UNCARRIED_RESULT_ACCOUNT = 2050;

export type OpeningProblem = "empty" | "unbalanced";

/** Whether an account is on the balance sheet (classes 1 and 2), whose balance carries over from year to year. */
const onBalanceSheet = (number: number) => String(number)[0] === "1" || String(number)[0] === "2";

/**
 * The opening balance from what another system holds (step 2d): each balance sheet account at what it held the day before the books open,
 * and, when they open during a year, each profit and loss account at what it moved since 1 January, so the year's result goes on. Their
 * trial balance must balance to the øre, else nothing is made (`unbalanced`, with by how much). A result of earlier years never carried to
 * equity there is what is left, and goes on other equity (`UNCARRIED_RESULT_ACCOUNT`) as a line of its own, said (`carriedMinor`).
 */
export function openingBalanceOf(
  theirs: readonly TheirBalance[],
): { ok: true; lines: (LedgerLineInput & { name: string })[]; carriedMinor: number } | { ok: false; problem: OpeningProblem; differenceMinor: number } {
  const total = theirs.reduce((sum, a) => sum + a.atOpeningMinor, 0);
  if (total !== 0) return { ok: false, problem: "unbalanced", differenceMinor: total };
  const byAccount = new Map<number, { name: string; amountMinor: number }>();
  for (const a of theirs) {
    const amount = onBalanceSheet(a.number) ? a.atOpeningMinor : a.yearToDateMinor;
    const held = byAccount.get(a.number);
    byAccount.set(a.number, { name: held?.name ?? a.name, amountMinor: (held?.amountMinor ?? 0) + amount });
  }
  const lines: (LedgerLineInput & { name: string })[] = [...byAccount.entries()]
    .filter(([, v]) => v.amountMinor !== 0)
    .sort(([a], [b]) => a - b)
    .map(([account, v]) => ({ account, name: v.name, amountMinor: v.amountMinor, vatCode: null }));
  const sum = lines.reduce((total, l) => total + l.amountMinor, 0);
  const carriedMinor = sum === 0 ? 0 : -sum;
  if (carriedMinor !== 0) {
    lines.push({ account: UNCARRIED_RESULT_ACCOUNT, name: "Annen egenkapital", amountMinor: carriedMinor, vatCode: null, text: "Resultat fra tidligere år, ikke overført til egenkapital" });
  }
  if (lines.length < 2) return { ok: false, problem: "empty", differenceMinor: 0 };
  return { ok: true, lines, carriedMinor };
}

/**
 * The standard account a number of the company's own reports as, for one that is not a standard account or a longer sub-account of one
 * (`standardOf()`): the nearest standard account at or below it in its ten, then in its hundred (Tripletex's 1921, a second bank account,
 * reports as 1920). Null for one in no standard account's hundred.
 */
export function nearestStandard(number: number): string | null {
  const own = standardOf(number);
  if (own) return own;
  if (!Number.isInteger(number) || number < 1000 || number > 9999) return null;
  for (const step of [10, 100]) {
    const base = Math.floor(number / step) * step;
    for (let n = number; n >= base; n -= 1) if (standardAccount(String(n))) return String(n);
  }
  return null;
}
