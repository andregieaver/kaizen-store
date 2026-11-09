import { BUCKET_VAT, CARD_FEE_ACCOUNT, LEDGER_SERIES, PAYMENT_ACCOUNTS, SHOP_PAYMENT_ACCOUNTS, type LedgerEntryInput } from "./ledger";

/**
 * Kaizena Flow's own money in the books of the business behind it (C3 step 2 of `docs/platform-parity-plan.md`, D508). Pure: the entry a
 * sale makes (what reached Kaizena Flow's Stripe balance, against its income and its VAT), the entry its credit notes make, and the entry
 * a payout makes (the bank, Stripe's fees, against the balance), all in the book's currency.
 */

/** Where Kaizena Flow's sales go: a store in Norway pays 25 % MVA (code 3, its VAT on 2700); a business abroad buys a service without it (code 52). */
export const PLATFORM_INCOME = {
  norway: { account: 3000, code: BUCKET_VAT.standard_25.code ?? "3", vatAccount: BUCKET_VAT.standard_25.vatAccount ?? 2700 },
  abroad: { account: 3200, code: BUCKET_VAT.reverse_charge.code ?? "52" },
} as const;

/** Kaizena Flow's Stripe balance in the books: the same account a store's Stripe money waits on (1579). */
export const PLATFORM_STRIPE_ACCOUNT = SHOP_PAYMENT_ACCOUNTS.stripe;

export type BookedSale = {
  id: string;
  number: string | null;
  kind: "plan" | "theme" | "domain" | "other";
  paidOn: string;
  currency: string;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  creditedMinor: number;
  /** What reached the Stripe balance for it, in the balance's currency (null until read). */
  settledMinor: number | null;
  settledCurrency: string | null;
};

const KIND_TEXT: Record<BookedSale["kind"], string> = { plan: "abonnement", theme: "premiumtema", domain: "domene", other: "salg" };

export type BookProblem = "currency" | "nothing";

/**
 * A sale's amounts in the book's currency: as sold where that is the book's, else as Stripe settled it (its balance's currency must be the
 * book's), the VAT shared in the same proportion and the rest before VAT. None until Stripe has said what it settled.
 */
export function inBookOf(sale: Pick<BookedSale, "currency" | "netMinor" | "vatMinor" | "totalMinor" | "settledMinor" | "settledCurrency">, bookCurrency: string): { total: number; net: number; vat: number } | BookProblem {
  if (sale.currency === bookCurrency) return { total: sale.totalMinor, net: sale.netMinor, vat: sale.vatMinor };
  if (sale.settledMinor === null || sale.settledCurrency !== bookCurrency || sale.totalMinor <= 0) return "currency";
  const vat = Math.round((sale.vatMinor * sale.settledMinor) / sale.totalMinor);
  return { total: sale.settledMinor, net: sale.settledMinor - vat, vat };
}

/** The entry a sale makes on the day it was paid: its Stripe balance against its income and, for a store in Norway, its VAT. */
export function entryOfPlatformSale(sale: BookedSale, bookCurrency: string): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: BookProblem } {
  const amounts = inBookOf(sale, bookCurrency);
  if (typeof amounts === "string") return { ok: false, problem: amounts };
  if (amounts.total <= 0) return { ok: false, problem: "nothing" };
  const norway = sale.vatMinor > 0;
  const lines: LedgerEntryInput["lines"] = norway
    ? [
        { account: PLATFORM_STRIPE_ACCOUNT, amountMinor: amounts.total, vatCode: null },
        { account: PLATFORM_INCOME.norway.account, amountMinor: -amounts.net, vatCode: PLATFORM_INCOME.norway.code },
        { account: PLATFORM_INCOME.norway.vatAccount, amountMinor: -amounts.vat, vatCode: PLATFORM_INCOME.norway.code },
      ]
    : [
        { account: PLATFORM_STRIPE_ACCOUNT, amountMinor: amounts.total, vatCode: null },
        { account: PLATFORM_INCOME.abroad.account, amountMinor: -amounts.total, vatCode: PLATFORM_INCOME.abroad.code },
      ];
  return {
    ok: true,
    entry: {
      series: LEDGER_SERIES.sales,
      date: sale.paidOn,
      text: `Kaizena Flow ${KIND_TEXT[sale.kind]}${sale.number ? `, faktura ${sale.number}` : ""}`.slice(0, 200),
      source: { kind: "platform_sale", id: sale.id },
      lines: lines.filter((l) => l.amountMinor !== 0),
    },
  };
}

/** The entry a sale's credit notes make (what was credited, in the same shares), the sale's lines turned, on the day it is posted. */
export function entryOfPlatformCredit(sale: BookedSale, bookCurrency: string, day: string): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: BookProblem } {
  if (sale.creditedMinor <= 0) return { ok: false, problem: "nothing" };
  const share = (n: number) => Math.round((n * sale.creditedMinor) / sale.totalMinor);
  const credited = { ...sale, netMinor: sale.netMinor, vatMinor: share(sale.vatMinor), totalMinor: sale.creditedMinor, settledMinor: sale.settledMinor === null ? null : share(sale.settledMinor) };
  credited.netMinor = credited.totalMinor - credited.vatMinor;
  const made = entryOfPlatformSale(credited, bookCurrency);
  if (!made.ok) return made;
  return {
    ok: true,
    entry: {
      ...made.entry,
      date: day,
      text: `Kreditnota: ${made.entry.text}`.slice(0, 200),
      source: { kind: "platform_credit", id: `${sale.id}:${sale.creditedMinor}` },
      lines: made.entry.lines.map((l) => ({ ...l, amountMinor: -l.amountMinor })),
    },
  };
}

/** The entry a payout makes on the day it reached the bank: the bank and Stripe's fees against the Stripe balance (as a store's, D290). */
export function entryOfPlatformPayout(payout: { id: string; arrivalOn: string; currency: string; amountMinor: number; feeMinor: number }, bookCurrency: string): { ok: true; entry: LedgerEntryInput } | { ok: false; problem: BookProblem } {
  if (payout.currency !== bookCurrency) return { ok: false, problem: "currency" };
  const gross = payout.amountMinor + payout.feeMinor;
  const lines = [
    { account: PAYMENT_ACCOUNTS.bank, amountMinor: payout.amountMinor, vatCode: null },
    { account: CARD_FEE_ACCOUNT, amountMinor: payout.feeMinor, vatCode: null },
    { account: PLATFORM_STRIPE_ACCOUNT, amountMinor: -gross, vatCode: null },
  ].filter((l) => l.amountMinor !== 0);
  if (lines.length < 2) return { ok: false, problem: "nothing" };
  return {
    ok: true,
    entry: { series: LEDGER_SERIES.bank, date: payout.arrivalOn, text: "Utbetaling fra Stripe (Kaizena Flow)", source: { kind: "platform_payout", id: payout.id }, lines },
  };
}
