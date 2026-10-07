/**
 * The reconciliation of the VAT report against Finance and the orders (D161, `docs/wave-1c-reports.md` 2.2.1 and 4.7). Pure: the server
 * brings the sums, this says how they bridge. Per document currency and period, in integer minor units with no conversion:
 *
 *   R = F + timing_in + not_captured + edit_in + edit_credited - timing_out - edit_out - invoicing_off - test_mode - waiting - edit_waiting - other
 *
 * where F is Finance's VAT (the sum of `tax_minor` of the paid orders placed in the period: `analytics-sql.ts`'s `PAID`, never a copied or
 * a host's order) and R the report's VAT charged (the invoices whose supply date is in the period). Finance dates an order by the day it
 * was placed, a document by its tax date; an order with no invoice (invoicing off, waiting, paid in test mode) is in Finance only. The
 * identity is exact in every currency; a bridge that does not balance is a bug and says so. Needs review: accountant (section 8, item 5).
 *
 * Order changes (D174, `docs/wave-3-fulfilment.md` 4.6 and 4.7): Finance reads an edited order at its amounts as they are now, dated by the day it
 * was placed, while the change is documented by an additional invoice and a credit note dated by the change. The four `edit_*` causes name what that
 * moves: an additional invoice dated in the period of an order placed in another (`edit_in`), one of this period's orders dated in another
 * (`edit_out`), the VAT a change took off (`edit_credited`: Finance's order is already lower, the report's VAT charged does not subtract the change's
 * credit note, which is in VAT credited) and a change whose documents wait (`edit_waiting`, its VAT moved, which can be below zero).
 */

export const CAUSES = ["timing_in", "not_captured", "edit_in", "edit_credited", "timing_out", "edit_out", "invoicing_off", "test_mode", "waiting", "edit_waiting", "other"] as const;
export type Cause = (typeof CAUSES)[number];

/** `+1` adds to Finance's figure on the way to the report's, `-1` takes away. */
const SIGN: Record<Cause, 1 | -1> = {
  timing_in: 1,
  not_captured: 1,
  edit_in: 1,
  edit_credited: 1,
  timing_out: -1,
  edit_out: -1,
  invoicing_off: -1,
  test_mode: -1,
  waiting: -1,
  edit_waiting: -1,
  other: -1,
};

export const CAUSE_LABEL: Record<Cause, string> = {
  timing_in: "Invoices dated in this period for orders placed before it",
  not_captured: "Invoices for orders Finance does not count as paid",
  edit_in: "Additional invoices of order changes dated in this period, for orders placed in another",
  edit_credited: "VAT an order change took off (in the report's credit notes, not in its VAT charged)",
  timing_out: "Paid orders placed in this period whose invoice is dated after it",
  edit_out: "Order changes of this period's orders whose additional invoice is dated in another period",
  invoicing_off: "Paid orders with no invoice: invoicing was off",
  test_mode: "Orders paid in Stripe's test mode (never invoiced)",
  waiting: "Paid orders whose invoice is waiting or failed",
  edit_waiting: "Order changes whose documents are waiting or failed",
  other: "Other orders with no invoice",
};

export const CAUSE_TEXT: Record<Cause, string> = {
  timing_in: "Finance counts an order on the day it was placed; an invoice is dated by the day of payment. These were placed earlier and paid in this period.",
  not_captured:
    "A booking confirmed at the venue, or a payment not captured: invoiced, but not counted as a paid order in Finance.",
  edit_in:
    "An order changed after purchase is counted by Finance at its new amount on the day it was placed; the change's additional invoice is dated by the change. These orders were placed in another period and changed in this one.",
  edit_credited:
    "Finance reads an order after its change, so the VAT on what the change removed is already gone from Finance's figure. The report shows it as the change's credit note, under VAT credited, not as less VAT charged.",
  timing_out: "Placed in this period and paid after it ended: Finance has them here, the invoice is in the next period. They are equal and opposite in the two periods.",
  edit_out:
    "Placed in this period and changed after it ended: Finance has the added VAT here, at the order's new amount; the change's additional invoice is in the period of the change.",
  invoicing_off: "Invoicing was switched off, or the order was paid before it was switched on: there is no invoice, so its VAT is in Finance only.",
  test_mode: "Paid with Stripe's test cards. Finance counts them; an invoice is never made for a test payment.",
  waiting: "The order is paid but its invoice is waiting (for example, the seller details are incomplete) or failed. See Invoices > Waiting.",
  edit_waiting:
    "The order's change is applied but its additional invoice or credit note is waiting or failed: Finance has the VAT the change moved (below zero when the change took VAT off). See Invoices > Waiting.",
  other: "Orders with no invoice for another reason (nothing to pay, or not paid).",
};

export type Sum = { orders: number; taxMinor: number };

/** What the server found for one document currency in one period. */
export type CurrencySums = {
  currency: string;
  finance: Sum;
  report: Sum;
  causes: Partial<Record<Cause, Sum>>;
};

export type ReconLine = {
  kind: "finance" | "cause" | "report" | "exchange_rate" | "rounding" | "no_stored_rate";
  cause: Cause | null;
  label: string;
  text: string;
  /** +1 or -1 for a cause (its direction on the way from Finance to the report), 0 for the end points and closing lines. */
  sign: 1 | -1 | 0;
  orders: number;
  taxMinor: number;
};

export type CurrencyBridge = {
  currency: string;
  lines: ReconLine[];
  financeMinor: number;
  reportMinor: number;
  /** Finance's VAT with every named cause applied. */
  computedMinor: number;
  /** `reportMinor - computedMinor`: zero when every difference is named. */
  differenceMinor: number;
  balanced: boolean;
};

export function reconcile(sums: CurrencySums): CurrencyBridge {
  const lines: ReconLine[] = [
    { kind: "finance", cause: null, label: "Finance's VAT", text: "Orders paid and placed in the period (the VAT card of Finance), before conversion.", sign: 0, orders: sums.finance.orders, taxMinor: sums.finance.taxMinor },
  ];
  let computed = sums.finance.taxMinor;
  for (const cause of CAUSES) {
    const sum = sums.causes[cause];
    if (!sum || (sum.orders === 0 && sum.taxMinor === 0)) continue;
    lines.push({ kind: "cause", cause, label: CAUSE_LABEL[cause], text: CAUSE_TEXT[cause], sign: SIGN[cause], orders: sum.orders, taxMinor: sum.taxMinor });
    computed += SIGN[cause] * sum.taxMinor;
  }
  lines.push({ kind: "report", cause: null, label: "This report's VAT charged", text: "Invoices whose supply date is in the period.", sign: 0, orders: sums.report.orders, taxMinor: sums.report.taxMinor });
  const difference = sums.report.taxMinor - computed;
  return { currency: sums.currency, lines, financeMinor: sums.finance.taxMinor, reportMinor: sums.report.taxMinor, computedMinor: computed, differenceMinor: difference, balanced: difference === 0 };
}

export type MainBridge = {
  currency: string;
  lines: ReconLine[];
  /** Finance's VAT in the main currency at today's rates. */
  financeMainMinor: number;
  /** The report's VAT charged: each document at its own stored rate. */
  reportMainMinor: number;
  /** Currencies left out because they have no rate today: counted, never added silently. */
  notConverted: string[];
};

/** The VAT charged of invoices the report's main-currency figure leaves out because a document has no stored rate, per document currency. */
export type LeftOut = { currency: string; invoices: number; vatMinor: number };

/**
 * The same bridge in the main currency. Each line is converted at today's rates (as Finance does) by `toMain`, which gives null for a
 * currency with no rate: that currency is left out and listed. The report's own figure is at the stored rates (`reportStoredMainMinor`,
 * from the VAT report), and three named closing lines carry the rest: *No stored rate* (invoices the report's main-currency figure
 * leaves out because the document holds no conversion: their whole VAT, converted at today's rate, is not an exchange-rate effect),
 * *Rounding* (a sum converted against the converted parts) and *Exchange-rate difference* (stored rates against today's, of the
 * documents that have one), so the bridge closes by construction and each line says what it is.
 */
export function reconcileMain(
  mainCurrency: string,
  sums: readonly CurrencySums[],
  reportStoredMainMinor: number,
  toMain: (currency: string, minor: number) => number | null,
  leftOut: readonly LeftOut[] = [],
): MainBridge {
  const notConverted: string[] = [];
  const usable = sums.filter((s) => {
    const ok = s.currency === mainCurrency || toMain(s.currency, 1) !== null;
    if (!ok) notConverted.push(s.currency);
    return ok;
  });
  const conv = (currency: string, minor: number) => (currency === mainCurrency ? minor : (toMain(currency, minor) ?? 0));
  const orders = (pick: (s: CurrencySums) => number) => usable.reduce((n, s) => n + pick(s), 0);

  const lines: ReconLine[] = [];
  let finance = 0;
  for (const s of usable) finance += conv(s.currency, s.finance.taxMinor);
  lines.push({ kind: "finance", cause: null, label: "Finance's VAT", text: "At today's rates, as the Finance page converts it.", sign: 0, orders: orders((s) => s.finance.orders), taxMinor: finance });
  let computed = finance;
  for (const cause of CAUSES) {
    let minor = 0;
    let n = 0;
    for (const s of usable) {
      const sum = s.causes[cause];
      if (!sum) continue;
      minor += conv(s.currency, sum.taxMinor);
      n += sum.orders;
    }
    if (n === 0 && minor === 0) continue;
    lines.push({ kind: "cause", cause, label: CAUSE_LABEL[cause], text: CAUSE_TEXT[cause], sign: SIGN[cause], orders: n, taxMinor: minor });
    computed += SIGN[cause] * minor;
  }
  // Invoices with no stored rate are in the report's sums (original currency) but not in its main-currency figure: named on their own line.
  let noRate = 0;
  let noRateInvoices = 0;
  const noRateOf = new Map<string, number>();
  for (const out of leftOut) {
    if (!usable.some((s) => s.currency === out.currency)) continue;
    noRate += conv(out.currency, out.vatMinor);
    noRateInvoices += out.invoices;
    noRateOf.set(out.currency, out.vatMinor);
  }
  if (noRate !== 0 || noRateInvoices > 0) {
    lines.push({
      kind: "no_stored_rate",
      cause: null,
      label: "Invoices with no stored rate",
      text: "These invoices hold no conversion to the main currency, so the report's main-currency figure leaves them out. Their VAT is counted in the original currency above, and is not an exchange-rate difference.",
      sign: -1,
      orders: noRateInvoices,
      taxMinor: noRate,
    });
    computed -= noRate;
  }
  let reportToday = 0;
  for (const s of usable) reportToday += conv(s.currency, s.report.taxMinor - (noRateOf.get(s.currency) ?? 0));
  const rounding = reportToday - computed;
  const exchange = reportStoredMainMinor - reportToday;
  if (rounding !== 0) lines.push({ kind: "rounding", cause: null, label: "Rounding", text: "A sum converted at once against the same amounts converted line by line: at most a minor unit per line.", sign: 0, orders: 0, taxMinor: rounding });
  if (exchange !== 0) lines.push({ kind: "exchange_rate", cause: null, label: "Exchange-rate difference", text: "The report converts each document at the rate stored on it the day it was issued; Finance converts at today's rate.", sign: 0, orders: 0, taxMinor: exchange });
  lines.push({ kind: "report", cause: null, label: "This report's VAT charged", text: "Each document at its own stored rate.", sign: 0, orders: orders((s) => s.report.orders), taxMinor: reportStoredMainMinor });
  return { currency: mainCurrency, lines, financeMainMinor: finance, reportMainMinor: reportStoredMainMinor, notConverted: notConverted.sort() };
}

/** All currencies balance: the whole reconciliation is exact. */
export const allBalanced = (bridges: readonly CurrencyBridge[]): boolean => bridges.every((b) => b.balanced);

/** The sentence under a bridge: equal when every difference is named, otherwise the plain failure (a bug, never expected). */
export const bridgeSentence = (bridges: readonly CurrencyBridge[]): string =>
  allBalanced(bridges) ? "Equal: every difference is named." : "Does not reconcile";

export type RefundsLine = {
  financeMinor: number;
  creditNotesMinor: number;
  differenceMinor: number;
  refunds: number;
  /** The difference is no more than a minor unit per refund (rounding): nothing else is behind it. */
  withinRounding: boolean;
  text: string;
};

/**
 * The informational comparison of Finance's refunds without VAT with the credit notes' net amounts for refunds made in the period. It
 * has no identity: they differ by rounding (up to one minor unit per refund), by refunds of orders with no invoice, and by refunds that
 * are still pending.
 */
export function refundsLine(financeRefundsNetMinor: number, creditNotesNetMinor: number, refunds: number): RefundsLine {
  const difference = creditNotesNetMinor - financeRefundsNetMinor;
  const within = Math.abs(difference) <= refunds;
  return {
    financeMinor: financeRefundsNetMinor,
    creditNotesMinor: creditNotesNetMinor,
    differenceMinor: difference,
    refunds,
    withinRounding: within,
    text: within
      ? "Finance's refunds without VAT and the credit notes agree to within a minor unit per refund."
      : "They differ by more than rounding. Usual reasons: refunds of orders with no invoice, refunds still pending, or a refund counted in another period.",
  };
}
