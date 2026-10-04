import "server-only";

import { formatMoney } from "@/lib/money";
import { addDays } from "@/lib/analytics-period";
import type { OwnerToolInput } from "@/lib/owner-tools";
import type { ConversionGroup, ReturnData } from "@/lib/oss-return";
import { IOSS_OFF_TEXT } from "@/lib/oss-return";
import { CAUSE_LABEL, type CurrencyBridge } from "@/lib/tax-reconciliation";
import { ratePercent } from "@/lib/tax-report";
import { NOT_A_RETURN, resolveReturnPeriod, resolveVatRange } from "@/lib/tax-report-tools";
import { longDate, periodLabel } from "@/lib/tax-periods";

import { OwnerToolError } from "./owner-tool-error";
import { taxSnapshot } from "./tax-reconciliation";
import { returnView, storeToday } from "./tax-reports";
import type { Store } from "./stores";

/**
 * The AI manager's two tax-report tools (D161, `docs/wave-1c-reports.md` 2.2 and 5.4): `vat_report` and `oss_return_data`. Read only: they
 * call the functions the VAT page calls (`taxSnapshot()`, `returnView()`), write the amounts with `formatMoney`, and make
 * no number and no file. The CSV is the owner's, exported on the page (`analytics:write`), and the figures are the owner's own, for their
 * accountant: every answer says it is not a tax return and that Kaizen files nothing. Served to Kaizen Life's assistant through the store's
 * MCP server like every owner tool; the tool-permission table gives both `analytics:read`. The answer holds no buyer field: the documents are
 * read only as sums (`commerce.tax_document_groups()`).
 */

type Ctx = { store: Store };

const mainLocale = (store: Store) => store.markets[0]?.locale ?? "en";
const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;
const money = (store: Store, minor: number, currency: string) => formatMoney(minor, currency, mainLocale(store));
/** An amount that may not be known: what is missing, never a zero. */
const moneyOr = (store: Store, minor: number | null, currency: string, missing: string) => (minor === null ? { not_known: missing } : money(store, minor, currency));

const MAX_ROWS = 60;

/** A bridge's lines as words and amounts: Finance's VAT, each named difference, then the report's VAT. */
function bridgeWords(store: Store, bridge: Pick<CurrencyBridge, "lines">, currency: string) {
  return bridge.lines.map((l) => ({ line: l.label, ...(l.orders > 0 ? { orders: l.orders } : {}), vat: money(store, l.taxMinor, currency), what: l.text }));
}

/** VAT per delivery country, rate and basis from the store's documents, and how it agrees with Finance. */
export async function vatReportTool({ store }: Ctx, input: OwnerToolInput<"vat_report">) {
  const choice = resolveVatRange(input, storeToday(store));
  if (!choice.ok) throw new OwnerToolError(choice.problem);
  const { range } = choice;
  // The figures and the reconciliation from one snapshot, so the tool never states a bridge its own table contradicts.
  const { view, reconciliation: recon } = await taxSnapshot(store, range);
  const { report } = view;
  const main = report.mainCurrency;
  const t = report.totals;
  const noRate = "These documents have no stored exchange rate to the main currency, so they are left out of the main-currency figures.";

  const rows = report.rows.slice(0, MAX_ROWS).map((r) => ({
    country: r.country,
    rate: `${ratePercent(r.rate)} %`,
    basis: r.basis,
    currency: r.currency,
    reported_in: r.reportedIn,
    invoices: r.invoices,
    credit_notes: r.creditNotes,
    net: money(store, r.netMinor, r.currency),
    vat_charged: money(store, r.vatMinor, r.currency),
    vat_credited: money(store, r.creditVatMinor, r.currency),
    vat_after_credits: money(store, r.vatAfterMinor, r.currency),
    vat_after_credits_in_main_currency: r.currency === main ? undefined : moneyOr(store, r.vatAfterMainMinor, main, noRate),
  }));

  return {
    period: { label: choice.label, from: range.from, to: addDays(range.to, -1) },
    not_a_tax_return: NOT_A_RETURN,
    basis: `Made from the store's invoices (by supply date) and credit notes (by the day issued), never from orders. The main currency is ${main}: each document is converted at the rate stored on it.`,
    made_from: { invoices: t.invoices, credit_notes: t.creditNotes, orders_with_an_invoice: t.orders },
    ...(recon.undocumented.orders > 0
      ? {
          paid_orders_without_a_document: {
            count: recon.undocumented.orders,
            why: Object.entries(recon.undocumented.byCause).map(([cause, n]) => `${n} ${CAUSE_LABEL[cause as keyof typeof CAUSE_LABEL] ?? cause}`),
            page: adminLink(store, "/invoices?tab=waiting"),
            note: "These orders are not in the figures below. See the reconciliation for each cause.",
          },
        }
      : {}),
    totals_in_main_currency: {
      currency: main,
      vat_charged: money(store, t.vatChargedMainMinor, main),
      vat_credited: money(store, t.vatCreditedMainMinor, main),
      vat_after_credits: money(store, t.vatAfterMainMinor, main),
      net_sales_after_credits: money(store, t.netAfterMainMinor, main),
      gross_after_credits: money(store, t.grossAfterMainMinor, main),
    },
    ...(report.notConverted.invoices + report.notConverted.creditNotes > 0
      ? { not_in_the_main_currency_figures: { invoices: report.notConverted.invoices, credit_notes: report.notConverted.creditNotes, currencies: report.notConverted.currencies, why: noRate } }
      : {}),
    per_document_currency: report.byCurrency.map((c) => ({
      currency: c.currency,
      invoices: c.invoices,
      credit_notes: c.creditNotes,
      vat_charged: money(store, c.vatMinor, c.currency),
      vat_credited: money(store, c.creditVatMinor, c.currency),
      vat_after_credits: money(store, c.vatMinor - c.creditVatMinor, c.currency),
    })),
    by_country_rate_and_basis: rows,
    ...(report.rows.length > rows.length ? { more: `${report.rows.length - rows.length} more rows; the VAT page and its CSV show all of them.` } : {}),
    reconciliation_with_finance: {
      result: recon.sentence,
      equal: recon.balanced,
      per_currency: recon.bridges.map((b) => ({ currency: b.currency, balanced: b.balanced, lines: bridgeWords(store, b, b.currency) })),
      in_main_currency: { currency: recon.main.currency, lines: bridgeWords(store, recon.main, recon.main.currency), ...(recon.main.notConverted.length > 0 ? { left_out_no_rate_today: recon.main.notConverted } : {}) },
      refunds_note: recon.refunds.map((r) => `${r.currency}: ${r.text}`),
    },
    ...(report.flagCounts.seller_assumed > 0 ? { note_assumed_seller: `${report.flagCounts.seller_assumed} document lines are of orders that did not record the store's country and OSS member state; they are classed with today's settings.` } : {}),
    ...(report.flagCounts.mixed_goods_download > 0 ? { note_mixed_baskets: `${report.flagCounts.mixed_goods_download} document lines hold goods and downloads together; the VAT page says how they are classed.` } : {}),
    page: adminLink(store, `/analytics/tax?view=vat`),
    export: "The owner exports the CSV for their accountant on that page; you cannot make a file.",
  };
}

const part = (p: ConversionGroup["part"]) =>
  ({
    "2a": "Part 2a: services from the Member State of identification",
    "2b": "Part 2b: goods dispatched from the Member State of identification",
    "2d": "Part 2d: goods dispatched from another Member State",
    NU: "Non-Union scheme",
    IOSS: "Import scheme (IOSS)",
  })[p];

/** The rate a conversion used, in words. */
function rateWords(card: ReturnData["rates"][number]) {
  if (!card.choice) return { currency: card.currency, day: card.day, rate: { not_known: `No euro rate is stored for ${card.currency} on ${card.day}. The owner fetches the ECB's rate or enters their own, on the VAT page.` } };
  return {
    currency: card.currency,
    for_day: card.day,
    rate: `1 EUR = ${card.choice.rate} ${card.currency}`,
    rate_date: card.choice.date,
    source: card.choice.source === "ecb" ? "The European Central Bank's reference rate" : `The owner's own rate: ${card.choice.reason ?? "no reason given"}`,
    used_for: card.for === "correction" ? "a correction of an earlier period" : "this period",
  };
}

/** The data of an OSS return (a quarter) or an IOSS return (a month), in euro, in a mode. */
export async function ossReturnDataTool({ store }: Ctx, input: OwnerToolInput<"oss_return_data">) {
  const today = storeToday(store);
  const choice = resolveReturnPeriod(input.scheme, input.period, today);
  if (!choice.ok) throw new OwnerToolError(choice.problem);
  const { period } = choice;
  const view = await returnView(store, input.scheme, period, input.mode, { today });
  const { data } = view;
  const eur = (minor: number | null, missing = "A euro rate is missing (see missing_rates).") => moneyOr(store, minor, "EUR", missing);
  const label = input.scheme === "oss" ? "OSS" : "IOSS";
  const page = adminLink(store, `/analytics/tax?view=${input.scheme}&${input.scheme === "oss" ? "quarter" : "month"}=${period.key}&mode=${input.mode}`);
  const head = {
    scheme: label,
    period: { key: period.key, label: periodLabel(period), from: period.from, to: period.lastDay },
    mode: input.mode,
    not_a_tax_return: NOT_A_RETURN,
  };

  if (input.scheme === "ioss" && view.state === "off") {
    return { ...head, state: "off", words: IOSS_OFF_TEXT, fix_at: adminLink(store, "/settings/tax"), page };
  }
  const intermediary = input.scheme === "ioss" && view.profile.iossIntermediary ? `The store's IOSS number names an intermediary (${view.profile.iossIntermediary}), who normally files the return: this data is what to give them.` : null;

  return {
    ...head,
    mode_explained: input.mode === "filing" ? "What a return for the period holds: a credit note of a later period is a correction (Part 3) of the period of its sale." : "The books' view: every credit note counts in the period it was made, so a part can be negative. It is not what a return holds.",
    registration: data.registration === "none" ? "No registration is recorded in Settings > Tax, so these are the figures a return would hold." : `The profile records ${data.registration === "union" ? "the Union scheme" : data.registration === "non_union" ? "the non-Union scheme" : "an IOSS number"}.`,
    ...(view.state === "history" ? { ioss_history: "The store had sales marked IOSS but has no IOSS number now." } : {}),
    ...(intermediary ? { intermediary } : {}),
    deadline: view.deadline.sentence,
    complete: !data.incomplete,
    ...(data.incomplete
      ? { missing_rates: data.missing.map((m) => `${m.currency} on ${longDate(m.day)}`), incomplete_note: "A euro rate is missing, so the figures that need it are not known and are not shown as zero. The owner fetches the ECB's rate or enters their own on the VAT page; the Return data CSV is refused until then." }
      : {}),
    made_from: { invoices: data.totals.documents, credit_notes: data.totals.creditNotes },
    part_2_supplies: data.part2.map((l) => ({
      part: part(l.part),
      member_state: l.memberState,
      ...(l.dispatchState ? { member_state_of_dispatch: l.dispatchState } : {}),
      rate: `${ratePercent(l.rate)} % (${l.rateKind})`,
      taxable_amount: eur(l.taxableEur),
      vat: eur(l.vatEur),
    })),
    part_3_corrections: data.part3.map((l) => ({
      corrects: l.correctionPeriod,
      member_state: l.memberState,
      vat: eur(l.vatEur),
      ...(l.late ? { note: "This period ended more than three years before this return: a correction that old is made with the Member State directly. Ask the accountant." } : {}),
    })),
    part_4_balance_per_member_state: data.part4.map((b) => ({
      member_state: b.memberState,
      part_2: eur(b.part2VatEur),
      part_3: eur(b.part3VatEur),
      balance: eur(b.balanceEur),
      ...(b.reimbursed ? { note: "A negative balance is reimbursed by that Member State and is never set off against another." } : {}),
    })),
    part_5_total_to_pay: eur(data.part5Eur),
    totals_of_part_2: { vat: eur(data.totals.vatEur), taxable_amount: eur(data.totals.taxableEur) },
    euro_rates_used: data.rates.map(rateWords),
    not_in_this_return: data.notIncluded.map((n) => ({ why: n.text, currency: n.currency, document_lines: n.documentLines, taxable_amount: money(store, n.taxableMinor, n.currency), vat: money(store, n.vatMinor, n.currency) })),
    does_the_registration_fit: data.notes.length === 0 ? "Nothing in the sales conflicts with the registration the profile records." : data.notes.map((n) => n.message),
    ...(view.documentLines === 0 ? { nothing_to_report: "The store has no invoice or credit note dated in this period." } : {}),
    page,
    export: "The owner exports Return data and Conversion detail as CSV for their accountant on that page; you cannot make a file.",
  };
}
