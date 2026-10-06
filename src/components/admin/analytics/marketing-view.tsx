import Link from "next/link";
import type { ReactNode } from "react";

import { CHANNELS } from "@/lib/analytics-channels";
import { change, formatChange, formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import { formatTimes, formatUpTo } from "@/lib/analytics-format";
import { ltvToCac, STAFF_CHANNEL, UNKNOWN_CHANNEL, type ChannelRow } from "@/lib/analytics-traffic";
import { minorUnitDigits } from "@/lib/money";
import type { CustomersReport } from "@/server/analytics-customers-data";
import type { MarketingReport } from "@/server/analytics-traffic-data";

import { HorizontalBars, type BarRow } from "./charts";
import { DataTable, type Column, type DeltaView } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { moneyWriter } from "./overview-view";
import { AnalyticsSection, ChartCard, Note } from "./section";

/**
 * The Marketing page's body above the spend form (D152, docs/analytics.md): what it costs to win a customer and whether the channels pay
 * back, then the channel table. It is drawn from the report objects it is handed and nothing else (no data access, so it can be rendered
 * on fixture data). A figure that cannot be known is never drawn as zero: it says what is missing and where to add it. ROAS counts all
 * sales a channel brought, whatever the goods cost, so it can flatter a channel; the table puts profit ROAS beside it and says why.
 * The blended ROAS counts only the channels that have ad spend; MER (every sale over every ad krone) is a card of its own.
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** What the page takes from the customers report to work out LTV:CAC: the predicted lifetime value and what it is made of. */
export type MarketingLtv = {
  /** The predicted lifetime value in minor units; null when it cannot be worked out. */
  minor: number | null;
  /** What it is made of: an order's contribution, or (costs not entered) its revenue. */
  basis: "contribution" | "revenue" | null;
  /** One order's contribution or revenue, according to the basis. */
  perOrderMinor: number | null;
  ordersPerYear: number | null;
  lifespanYears: number;
};

export type MarketingViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  /** The first market's locale, for writing amounts. */
  locale: string;
  report: MarketingReport;
  /** The comparison period's report, or null when the comparison is off or could not be read. */
  comparison: { mode: "previous" | "year"; report: MarketingReport } | null;
  /** Null when the customers report could not be read: the LTV:CAC card then says so. */
  ltv: MarketingLtv | null;
};

/** The lifetime value of the customers report as the card needs it. */
export function marketingLtv(ltv: CustomersReport["ltv"]): MarketingLtv {
  const basis = ltv.predicted.basis;
  return {
    minor: ltv.predicted.minor,
    basis,
    perOrderMinor: basis === "contribution" ? ltv.inputs.contributionPerOrderMinor : basis === "revenue" ? ltv.inputs.revenuePerOrderMinor : null,
    ordersPerYear: ltv.inputs.ordersPerYear,
    lifespanYears: ltv.inputs.lifespanYears,
  };
}

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** A figure with two decimals at most and no trailing zero: 1.4, 0.75, 3. */
export function formatPlain(value: number | null | undefined, digits = 2): string {
  return formatUpTo(value, digits);
}

/** LTV:CAC as "3.1 : 1"; no figure when either side cannot be known. */
export function formatLtvToCac(ratio: number | null | undefined): string {
  return finite(ratio) ? `${formatPlain(ratio, 1)} : 1` : NO_FIGURE;
}

/** The generic note the report adds for spend outside the covered days; the view words it with the amount instead. */
export const OUTSIDE_SPEND_NOTE = "Spend entered for days with no counted visits is left out of CAC and ROAS.";

/** Which colour a channel keeps wherever it is drawn: its place in the list of channels, and the muted colour for what is not in it. */
export function channelColorIndex(key: string): number {
  const index = CHANNELS.findIndex((c) => c.key === key);
  return index < 0 ? 99 : index;
}

/** A row's contribution profit: what is left of its sales after goods, fees, shipping and its ad spend; null when the costs are not known. */
export function contributionProfit(row: Pick<ChannelRow, "contributionBeforeMarketingMinor" | "spendMinor">): number | null {
  return row.contributionBeforeMarketingMinor === null ? null : row.contributionBeforeMarketingMinor - row.spendMinor;
}

/** Why a figure that needs visit counting is missing, in a sentence. */
/** The currency's own word for one unit, for "every ad krone"; the code where the word is not known. */
export function adUnit(currency: string): string {
  const words: Record<string, string> = { NOK: "krone", DKK: "krone", SEK: "krona", EUR: "euro", GBP: "pound", USD: "dollar", CHF: "franc", PLN: "zloty", ISK: "krona", CZK: "koruna" };
  return words[currency.toUpperCase()] ?? currency.toUpperCase();
}

/** The words that say what MER is, in the store's currency: "every sale divided by every ad krone". */
export const merWords = (currency: string): string => `every sale divided by every ad ${adUnit(currency)}`;

function countingReason(report: MarketingReport): string {
  if (!report.coverage.counting) return "Visit counting is off, so orders cannot be matched to the channel they came from.";
  if (report.coverage.firstDay === null) return "No visit has been counted yet, so orders cannot be matched to a channel.";
  return "No day of this period has counted visits yet.";
}

const dash = (why: string): ReactNode => <span title={why}>{NO_FIGURE}</span>;

// ---------------------------------------------------------------------------
// The headline strip
// ---------------------------------------------------------------------------

const HELP = {
  cac: "Customer acquisition cost: what you spent on marketing for each new customer you won. Lower is better.",
  roas: "Return on ad spend: the sales from the channels you spent money on, for every 1 you spent on them. Direct and organic sales are not counted. It counts all of those sales, whatever the goods cost.",
  mer: "Marketing efficiency ratio: every sale, direct and organic included, divided by all the ad spend. It shows how the whole business does against its ad bill, and it flatters the ads, since sales that came without them are in it.",
  profitRoas: "Profit return on ad spend: what the sales from the channels you spent money on left after the goods, payment fees and shipping, for every 1 you spent. Above 1.0 means the spend was earned back.",
  ltvToCac: "Predicted lifetime value divided by CAC: how much a customer is expected to bring in for each 1 it costs to win them. A common rule of thumb is that it should be at least 3.",
};

/**
 * The four cards that answer "what does a customer cost, and does the marketing pay back?": blended CAC, ROAS, profit ROAS and LTV:CAC,
 * each with a reason and a next step when it cannot be known (no visit counting, no spend entered, no costs, no new customers).
 */
export function headlineCards({ base, currency, locale, report, comparison, ltv }: MarketingViewProps): KpiCardProps[] {
  const money = moneyWriter(currency, locale);
  const table = report.table;
  const blended = table?.blended ?? null;
  const spend = blended?.spendMinor ?? 0;
  const settingsHref = `${base}/analytics/settings`;
  const enterSpend = { label: "Enter your ad spend", href: "#spend" };

  /** Words for what is missing when the card has no figure and the table could not say why. */
  const noTable = { text: countingReason(report), action: { label: "Open analytics settings", href: settingsHref } };
  const noSpend = {
    text:
      report.spend.totalMinor > 0
        ? `No spend is entered for the days with counted visits (${money(report.spend.totalMinor)} is for other days).`
        : "Enter what you spent on ads to see this. We know your sales, but not your ad bills.",
    action: enterSpend,
  };
  const coverageHint = report.coverage.partial && report.coverage.days > 0 ? `Over the ${formatCount(report.coverage.days)} days with counted visits.` : null;

  const delta = (current: number | null, previous: number | null | undefined): DeltaView | null => {
    const d = change(current, previous);
    return d ? { text: formatChange(d), abs: d.abs } : null;
  };
  const compare = (current: number | null, key: "cac" | "roas" | "profitRoas" | "mer") => {
    if (!comparison) return {};
    const earlier = comparison.report.table;
    const d = delta(current, key === "mer" ? earlier?.mer : earlier?.blended[key]);
    return comparison.mode === "previous" ? { deltaPrevious: d } : { deltaLastYear: d };
  };

  // ---- CAC ----
  let cac: KpiCardProps;
  if (!blended) cac = { label: "Cost to win a customer (CAC)", value: null, state: "missing", missing: noTable, help: HELP.cac };
  else if (spend === 0) cac = { label: "Cost to win a customer (CAC)", value: null, state: "missing", missing: noSpend, help: HELP.cac };
  else if (blended.cac === null) {
    cac = {
      label: "Cost to win a customer (CAC)",
      value: null,
      state: "missing",
      missing: { text: `${money(spend)} was spent, but no new customer was won in the counted days, so there is nothing to divide it by.` },
      help: HELP.cac,
    };
  } else {
    cac = {
      label: "Cost to win a customer (CAC)",
      value: money(blended.cac),
      emphasis: true,
      good: "down",
      help: HELP.cac,
      hint: `${money(spend)} spent on ${formatCount(blended.newCustomers)} new ${blended.newCustomers === 1 ? "customer" : "customers"}.${coverageHint ? ` ${coverageHint}` : ""}`,
      ...compare(blended.cac, "cac"),
    };
  }

  // ---- ROAS ----
  const unit = 100 * 10 ** minorUnitDigits(currency);
  let roas: KpiCardProps;
  if (!blended) roas = { label: "Return on ad spend (ROAS)", value: null, state: "missing", missing: noTable, help: HELP.roas };
  else if (blended.roas === null) roas = { label: "Return on ad spend (ROAS)", value: null, state: "missing", missing: noSpend, help: HELP.roas };
  else {
    roas = {
      label: "Return on ad spend (ROAS)",
      value: formatTimes(blended.roas),
      emphasis: true,
      good: "up",
      help: HELP.roas,
      hint: `Every ${money(unit)} spent came with ${money(blended.roas * unit)} of sales from the channels that have ad spend. Direct and organic sales are not counted, and it counts sales, not what the goods cost.`,
      ...compare(blended.roas, "roas"),
    };
  }

  // ---- MER ----
  const merLabel = "Sales per ad spend (MER)";
  let mer: KpiCardProps;
  if (!blended || !table) mer = { label: merLabel, value: null, state: "missing", missing: noTable, help: HELP.mer };
  else if (table.mer === null) mer = { label: merLabel, value: null, state: "missing", missing: noSpend, help: HELP.mer };
  else {
    mer = {
      label: merLabel,
      value: formatTimes(table.mer),
      good: "up",
      help: HELP.mer,
      hint: `${money(blended.revenueMinor)} of sales against ${money(spend)} of ad spend: ${merWords(currency)}, direct and organic sales included.`,
      ...compare(table.mer, "mer"),
    };
  }

  // ---- profit ROAS ----
  let profitRoas: KpiCardProps;
  if (!blended) profitRoas = { label: "Profit return on ad spend", value: null, state: "missing", missing: noTable, help: HELP.profitRoas };
  else if (spend === 0) profitRoas = { label: "Profit return on ad spend", value: null, state: "missing", missing: noSpend, help: HELP.profitRoas };
  else if (blended.profitRoas === null) {
    profitRoas = {
      label: "Profit return on ad spend",
      value: null,
      state: "missing",
      missing:
        blended.orders === 0
          ? { text: "There were no orders in the counted days." }
          : { text: "Product costs are missing for some of the sales, so what they left cannot be worked out.", action: { label: "Add product costs", href: `${base}/products` } },
      help: HELP.profitRoas,
    };
  } else {
    profitRoas = {
      label: "Profit return on ad spend",
      value: formatTimes(blended.profitRoas),
      good: "up",
      help: HELP.profitRoas,
      hint: blended.profitRoas >= 1 ? "The sales left more than the spend, before fixed costs." : "The sales left less than the spend, before fixed costs.",
      ...compare(blended.profitRoas, "profitRoas"),
    };
  }

  // ---- LTV:CAC ----
  const label = "Lifetime value to cost (LTV:CAC)";
  let ratio: KpiCardProps;
  if (!blended) ratio = { label, value: null, state: "missing", missing: noTable, help: HELP.ltvToCac };
  else if (blended.cac === null) {
    ratio = { label, value: null, state: "missing", missing: spend === 0 ? noSpend : { text: "There is no cost per customer yet, so nothing to compare a customer's value with." }, help: HELP.ltvToCac };
  } else if (!ltv || ltv.minor === null) {
    ratio = {
      label,
      value: null,
      state: "missing",
      missing: { text: "A customer's predicted lifetime value cannot be worked out yet: it needs customers who have ordered more than once." },
      help: HELP.ltvToCac,
    };
  } else {
    const value = ltvToCac(ltv.minor, blended.cac);
    const how =
      ltv.perOrderMinor !== null && ltv.ordersPerYear !== null
        ? `Predicted lifetime value ${money(ltv.minor)} = ${money(ltv.perOrderMinor)} per order × ${formatPlain(ltv.ordersPerYear)} orders a year × ${formatPlain(ltv.lifespanYears, 0)} years.`
        : `Predicted lifetime value ${money(ltv.minor)}.`;
    ratio = {
      label,
      value: formatLtvToCac(value),
      good: "up",
      help: HELP.ltvToCac,
      hint:
        ltv.basis === "revenue"
          ? `${how} Product costs are not entered, so it uses revenue instead of profit, which flatters the ratio.`
          : how,
    };
  }

  return [cac, roas, mer, profitRoas, ratio];
}

// ---------------------------------------------------------------------------
// The channel table
// ---------------------------------------------------------------------------

const UNKNOWN_WHY =
  "Paid orders that cannot be tied to a counted visit: the shopper was not counted (they opted out or blocked it), bought on another day than the visit, or visits were not counted then. They are real sales, but no channel gets the credit.";

const STAFF_WHY =
  "Orders staff made from a draft order. They are real sales and are in the revenue, but they were not a visit, so no channel earns them and they are left out of conversion.";

/** The columns of the channel table, written for a row; the blended row's foot uses the same cells. */
export function channelColumns(money: (minor: number) => string): Column<ChannelRow>[] {
  const spend = (r: ChannelRow) => (r.spendMinor > 0 ? money(r.spendMinor) : dash("No ad spend entered for this channel"));
  return [
    {
      key: "channel",
      label: "Channel",
      cell: (r) =>
        r.channel === UNKNOWN_CHANNEL ? <span title={UNKNOWN_WHY}>Unknown</span> : r.channel === STAFF_CHANNEL ? <span title={STAFF_WHY}>{r.label}</span> : r.label,
    },
    { key: "sessions", label: "Sessions", align: "right", cell: (r) => (r.sessions === null ? dash("Visits are only counted for channels, not for unmatched orders") : formatCount(r.sessions)) },
    { key: "orders", label: "Orders", align: "right", cell: (r) => formatCount(r.orders) },
    { key: "revenue", label: "Revenue", align: "right", cell: (r) => money(r.revenueMinor) },
    { key: "conversion", label: "Conversion", align: "right", cell: (r) => (r.conversion === null ? dash("Needs counted sessions") : formatPercent(r.conversion)) },
    { key: "aov", label: "Avg order", align: "right", cell: (r) => (r.aov === null ? dash("No orders") : money(r.aov)) },
    { key: "newCustomers", label: "New customers", align: "right", cell: (r) => formatCount(r.newCustomers) },
    { key: "spend", label: "Ad spend", align: "right", cell: spend },
    { key: "cac", label: "CAC", align: "right", cell: (r) => (r.cac === null ? dash(r.spendMinor === 0 ? "No ad spend entered" : "No new customers") : money(r.cac)) },
    { key: "roas", label: "ROAS", align: "right", cell: (r) => (r.roas === null ? dash("No ad spend entered") : formatTimes(r.roas)) },
    {
      key: "profitRoas",
      label: "Profit ROAS",
      align: "right",
      cell: (r) => (r.profitRoas === null ? dash(r.spendMinor === 0 ? "No ad spend entered" : "Product costs are not known for these sales") : formatTimes(r.profitRoas)),
    },
    {
      key: "contribution",
      label: "Contribution profit",
      align: "right",
      cell: (r) => {
        const profit = contributionProfit(r);
        return profit === null ? dash(r.orders === 0 && r.spendMinor === 0 ? "No sales" : "Product costs are not known for these sales") : money(profit);
      },
    },
  ];
}

const GLOSSARY: readonly { term: string; meaning: string }[] = [
  { term: "Session", meaning: "One visitor on one day. Coming back the same day is not counted twice." },
  { term: "Conversion", meaning: "Orders divided by sessions: how many visits ended in a purchase." },
  { term: "New customers", meaning: "People whose first ever paid order came from this channel." },
  { term: "CAC", meaning: "Customer acquisition cost: the channel's ad spend divided by its new customers." },
  { term: "ROAS", meaning: "Return on ad spend: the channel's sales divided by its ad spend. 3.0× is 3 of sales for every 1 spent. On the All channels row it is over the channels that have ad spend only." },
  { term: "Profit ROAS", meaning: "What the sales left after the goods, payment fees and shipping, divided by the ad spend. Above 1.0× the spend was earned back. On the All channels row it is over the channels that have ad spend only." },
  { term: "MER", meaning: "Marketing efficiency ratio: every sale, direct and organic included, divided by all the ad spend. It is shown beside the headline figures, never as a ROAS." },
  { term: "Contribution profit", meaning: "What is left of the sales after the goods, payment fees, shipping and the ad spend, before fixed costs." },
];

function Glossary() {
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      {GLOSSARY.map((g) => (
        <div key={g.term}>
          <dt className="inline font-medium">{g.term}: </dt>
          <dd className="inline text-muted">{g.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChannelsSection({ base, currency, locale, report }: Pick<MarketingViewProps, "base" | "currency" | "locale" | "report">) {
  const money = moneyWriter(currency, locale);
  const table = report.table;
  const columns = channelColumns(money);
  const withRevenue: BarRow[] = (table?.rows ?? [])
    .filter((r) => r.revenueMinor > 0)
    .map((r) => ({
      key: r.channel,
      label: r.label,
      value: r.revenueMinor,
      valueText: money(r.revenueMinor),
      detail: `${formatCount(r.orders)} ${r.orders === 1 ? "order" : "orders"}`,
      colorIndex: channelColorIndex(r.channel),
    }));
  const withSpend: BarRow[] = report.spend.byChannel
    .filter((s) => s.amountMinor > 0)
    .map((s) => ({ key: s.channel, label: s.label, value: s.amountMinor, valueText: money(s.amountMinor), colorIndex: channelColorIndex(s.channel) }));
  const unknownRow = table?.rows.find((r) => r.channel === UNKNOWN_CHANNEL);
  const unknown = report.unknownOrders;
  const staffRow = table?.rows.find((r) => r.channel === STAFF_CHANNEL);

  return (
    <AnalyticsSection
      id="channels"
      title="Channels"
      description="Where visitors came from and what each channel earned. Revenue is sales without VAT, before refunds; fees and shipping are the estimates from your analytics settings."
    >
      {table === null ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          <p>{`No channel figures for this period. ${countingReason(report)}`}</p>
          <p className="mt-1">
            <Link href={`${base}/analytics/settings`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
              Open analytics settings
            </Link>
          </p>
        </div>
      ) : (
        <>
          <DataTable
            caption="Channels with sessions, orders, revenue, conversion, spend, CAC, ROAS and profit"
            columns={columns}
            rows={table.rows}
            rowKey={(r) => r.channel}
            empty="No visits, orders or ad spend on the days with counted visits."
            exportId="marketing.channels"
            exportLeftOut={{ orders: report.unconverted, currencies: report.missingCurrencies }}
            footer={
              table.rows.length > 0 ? (
                <tr>
                  {columns.map((c, i) => (
                    <td key={c.key} className={`px-3 py-1.5 ${c.align === "right" ? "text-right tabular-nums" : "text-left"}`}>
                      {i === 0 ? "All channels" : c.cell(table.blended)}
                    </td>
                  ))}
                </tr>
              ) : undefined
            }
          />
          <p className="max-w-prose text-sm text-muted">
            ROAS can flatter a channel: it counts every sale, whatever the goods cost. Profit ROAS counts what the goods cost, so use it to compare channels that sell different products. The All channels row counts only the channels that have ad spend; direct and organic sales are in MER ({table.mer === null ? "needs ad spend" : formatTimes(table.mer)}), which is every sale divided by all the ad spend. Profit is not estimated per channel: it counts what the goods cost where that is known, so a channel that sold products with no cost entered looks better than it is.
          </p>
          {unknownRow || unknown.orders > 0 ? (
            <Note title="What “Unknown” is">
              {`${UNKNOWN_WHY}${unknown.orders > 0 ? ` In this period: ${formatCount(unknown.orders)} ${unknown.orders === 1 ? "order" : "orders"}, ${money(unknown.revenueMinor)}.` : ""}`}
            </Note>
          ) : null}
          {staffRow ? (
            <Note title="What “Staff-made” is">
              {`${STAFF_WHY} In this period: ${formatCount(staffRow.orders)} ${staffRow.orders === 1 ? "order" : "orders"}, ${money(staffRow.revenueMinor)}.`}
            </Note>
          ) : null}
          {withRevenue.length > 0 || withSpend.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {withRevenue.length > 0 ? (
                <ChartCard title="Revenue by channel" description="Sales without VAT.">
                  <HorizontalBars label="Revenue by channel" rows={withRevenue} exportId="marketing.revenue_by_channel" exportLeftOut={{ orders: report.unconverted, currencies: report.missingCurrencies }} />
                </ChartCard>
              ) : null}
              {withSpend.length > 0 ? (
                <ChartCard title="Ad spend by channel" description="What you entered for the period, all days included.">
                  <HorizontalBars label="Ad spend by channel" rows={withSpend} exportId="marketing.spend_by_channel" />
                </ChartCard>
              ) : null}
            </div>
          ) : null}
          <details className="rounded-lg border border-border bg-background px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">What the columns mean</summary>
            <div className="mt-3">
              <Glossary />
            </div>
          </details>
        </>
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** The notes under the headline: what the report says it leaves out, and the spend that cannot be matched to visits, in words with the amount. */
export function marketingNotes(report: MarketingReport, money: (minor: number) => string): { tone: "info" | "warning"; text: string }[] {
  const notes: { tone: "info" | "warning"; text: string }[] = report.notes.filter((n) => n !== OUTSIDE_SPEND_NOTE).map((text) => ({ tone: "info", text }));
  const outside = report.spend.outsideCoverageMinor;
  if (outside > 0) {
    notes.push({
      tone: "warning",
      text:
        report.table === null
          ? `${money(outside)} of ad spend is entered for this period, but without counted visits it cannot be matched to sales, so it is not in any figure above.`
          : `${money(outside)} of the ad spend you entered is for days without counted visits, so it is not in the CAC and ROAS above.`,
    });
  }
  return notes;
}

export function MarketingView(props: MarketingViewProps) {
  const { base, currency, locale, report } = props;
  const money = moneyWriter(currency, locale);
  const cards = headlineCards(props);
  const notes = marketingNotes(report, money);
  const hasSpend = report.spend.totalMinor > 0;

  return (
    <>
      <AnalyticsSection
        id="headline"
        title="What a customer costs"
        description="What you spend on marketing for each new customer, whether the spend pays back, and how that compares with what a customer is worth."
      >
        {!hasSpend ? (
          <Note title="Enter your ad spend to see CAC and ROAS">
            We know your sales, but not what you paid for ads. <a href="#spend" className="font-medium text-(--brand-text) underline-offset-2 hover:underline">Enter it below</a> and these figures appear.
          </Note>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((c) => (
            <KpiCard key={c.label} {...c} />
          ))}
        </div>
        {notes.length > 0 ? (
          <div className="space-y-2">
            {notes.map((n) => (
              <Note key={n.text} tone={n.tone}>
                {n.text}
              </Note>
            ))}
          </div>
        ) : null}
      </AnalyticsSection>
      <ChannelsSection base={base} currency={currency} locale={locale} report={report} />
    </>
  );
}
