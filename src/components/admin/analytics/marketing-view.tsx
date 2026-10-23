import Link from "next/link";
import type { ReactNode } from "react";

import { CHANNELS } from "@/lib/analytics-channels";
import { change, formatChange, formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import { formatTimes, formatUpTo } from "@/lib/analytics-format";
import { EXCHANGE_CHANNEL, ltvToCac, STAFF_CHANNEL, UNKNOWN_CHANNEL, type ChannelRow } from "@/lib/analytics-traffic";
import { minorUnitDigits } from "@/lib/money";
import type { CustomersReport } from "@/server/analytics-customers-data";
import type { MarketingReport } from "@/server/analytics-traffic-data";
import { countWords, fillWords } from "@/lib/admin-fill";
import { reportsEn, type ReportsMessages } from "@/lib/admin-messages/reports.en";

/** The words of this view and a channel's name (D312 A9), English unless given. */
export type MarketingWords = ReportsMessages["marketing"];
export type ChannelWords = ReportsMessages["channels"];

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
  /** The words, in the account's language (D312 A9); English unless given. */
  words?: MarketingWords;
  /** A channel's name, in the account's language; English unless given. */
  channelWords?: ChannelWords;
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
export function adUnit(currency: string, w: MarketingWords = reportsEn.marketing): string {
  return w.adUnits[currency.toUpperCase()] ?? currency.toUpperCase();
}

/** The words that say what MER is, in the store's currency: "every sale divided by every ad krone". */
export const merWords = (currency: string, w: MarketingWords = reportsEn.marketing): string => fillWords(w.merWords, { unit: adUnit(currency, w) });

function countingReason(report: MarketingReport, w: MarketingWords = reportsEn.marketing): string {
  if (!report.coverage.counting) return w.countingOff;
  if (report.coverage.firstDay === null) return w.countingNone;
  return w.countingNoDay;
}

const dash = (why: string): ReactNode => <span title={why}>{NO_FIGURE}</span>;

// ---------------------------------------------------------------------------
// The headline strip
// ---------------------------------------------------------------------------


/**
 * The four cards that answer "what does a customer cost, and does the marketing pay back?": blended CAC, ROAS, profit ROAS and LTV:CAC,
 * each with a reason and a next step when it cannot be known (no visit counting, no spend entered, no costs, no new customers).
 */
export function headlineCards({ base, currency, locale, report, comparison, ltv, words: w = reportsEn.marketing }: MarketingViewProps): KpiCardProps[] {
  const money = moneyWriter(currency, locale);
  const HELP = w.help;
  const table = report.table;
  const blended = table?.blended ?? null;
  const spend = blended?.spendMinor ?? 0;
  const settingsHref = `${base}/analytics/settings`;
  const enterSpend = { label: w.enterSpend, href: "#spend" };

  /** Words for what is missing when the card has no figure and the table could not say why. */
  const noTable = { text: countingReason(report, w), action: { label: w.openSettings, href: settingsHref } };
  const noSpend = {
    text:
      report.spend.totalMinor > 0
        ? fillWords(w.spendOtherDays, { amount: money(report.spend.totalMinor) })
        : w.spendNone,
    action: enterSpend,
  };
  const coverageHint = report.coverage.partial && report.coverage.days > 0 ? fillWords(w.coverageHint, { n: formatCount(report.coverage.days) }) : null;

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
  if (!blended) cac = { label: w.cacLabel, value: null, state: "missing", missing: noTable, help: HELP.cac };
  else if (spend === 0) cac = { label: w.cacLabel, value: null, state: "missing", missing: noSpend, help: HELP.cac };
  else if (blended.cac === null) {
    cac = {
      label: w.cacLabel,
      value: null,
      state: "missing",
      missing: { text: fillWords(w.cacNoCustomer, { amount: money(spend) }) },
      help: HELP.cac,
    };
  } else {
    cac = {
      label: w.cacLabel,
      value: money(blended.cac),
      emphasis: true,
      good: "down",
      help: HELP.cac,
      hint: `${countWords(blended.newCustomers, w.cacHint, { n: formatCount(blended.newCustomers), amount: money(spend) })}${coverageHint ? ` ${coverageHint}` : ""}`,
      ...compare(blended.cac, "cac"),
    };
  }

  // ---- ROAS ----
  const unit = 100 * 10 ** minorUnitDigits(currency);
  let roas: KpiCardProps;
  if (!blended) roas = { label: w.roasLabel, value: null, state: "missing", missing: noTable, help: HELP.roas };
  else if (blended.roas === null) roas = { label: w.roasLabel, value: null, state: "missing", missing: noSpend, help: HELP.roas };
  else {
    roas = {
      label: w.roasLabel,
      value: formatTimes(blended.roas),
      emphasis: true,
      good: "up",
      help: HELP.roas,
      hint: fillWords(w.roasHint, { unit: money(unit), sales: money(blended.roas * unit) }),
      ...compare(blended.roas, "roas"),
    };
  }

  // ---- MER ----
  const merLabel = w.merLabel;
  let mer: KpiCardProps;
  if (!blended || !table) mer = { label: merLabel, value: null, state: "missing", missing: noTable, help: HELP.mer };
  else if (table.mer === null) mer = { label: merLabel, value: null, state: "missing", missing: noSpend, help: HELP.mer };
  else {
    mer = {
      label: merLabel,
      value: formatTimes(table.mer),
      good: "up",
      help: HELP.mer,
      hint: fillWords(w.merHint, { sales: money(blended.revenueMinor), spend: money(spend), words: merWords(currency, w) }),
      ...compare(table.mer, "mer"),
    };
  }

  // ---- profit ROAS ----
  let profitRoas: KpiCardProps;
  if (!blended) profitRoas = { label: w.profitLabel, value: null, state: "missing", missing: noTable, help: HELP.profitRoas };
  else if (spend === 0) profitRoas = { label: w.profitLabel, value: null, state: "missing", missing: noSpend, help: HELP.profitRoas };
  else if (blended.profitRoas === null) {
    profitRoas = {
      label: w.profitLabel,
      value: null,
      state: "missing",
      missing:
        blended.orders === 0
          ? { text: w.noOrdersCounted }
          : { text: w.costsMissing, action: { label: w.addCosts, href: `${base}/products` } },
      help: HELP.profitRoas,
    };
  } else {
    profitRoas = {
      label: w.profitLabel,
      value: formatTimes(blended.profitRoas),
      good: "up",
      help: HELP.profitRoas,
      hint: blended.profitRoas >= 1 ? w.profitAbove : w.profitBelow,
      ...compare(blended.profitRoas, "profitRoas"),
    };
  }

  // ---- LTV:CAC ----
  const label = w.ltvLabel;
  let ratio: KpiCardProps;
  if (!blended) ratio = { label, value: null, state: "missing", missing: noTable, help: HELP.ltvToCac };
  else if (blended.cac === null) {
    ratio = { label, value: null, state: "missing", missing: spend === 0 ? noSpend : { text: w.ltvNoCac }, help: HELP.ltvToCac };
  } else if (!ltv || ltv.minor === null) {
    ratio = {
      label,
      value: null,
      state: "missing",
      missing: { text: w.ltvNoValue },
      help: HELP.ltvToCac,
    };
  } else {
    const value = ltvToCac(ltv.minor, blended.cac);
    const how =
      ltv.perOrderMinor !== null && ltv.ordersPerYear !== null
        ? fillWords(w.ltvHow, { ltv: money(ltv.minor), perOrder: money(ltv.perOrderMinor), perYear: formatPlain(ltv.ordersPerYear), years: formatPlain(ltv.lifespanYears, 0) })
        : fillWords(w.ltvOnly, { ltv: money(ltv.minor) });
    ratio = {
      label,
      value: formatLtvToCac(value),
      good: "up",
      help: HELP.ltvToCac,
      hint:
        ltv.basis === "revenue"
          ? fillWords(w.ltvRevenue, { how })
          : how,
    };
  }

  return [cac, roas, mer, profitRoas, ratio];
}

// ---------------------------------------------------------------------------
// The channel table
// ---------------------------------------------------------------------------

/** The columns of the channel table, written for a row; the blended row's foot uses the same cells. */
export function channelColumns(
  money: (minor: number) => string,
  w: MarketingWords = reportsEn.marketing,
  names: ChannelWords = reportsEn.channels,
): Column<ChannelRow>[] {
  const l = w.columns;
  const why = w.why;
  const name = (r: ChannelRow) => names[r.channel] ?? r.label;
  const spend = (r: ChannelRow) => (r.spendMinor > 0 ? money(r.spendMinor) : dash(why.noSpend));
  return [
    {
      key: "channel",
      label: l.channel,
      cell: (r) =>
        r.channel === UNKNOWN_CHANNEL ? <span title={w.unknownWhy}>{name(r)}</span> : r.channel === STAFF_CHANNEL ? (
          <span title={w.staffWhy}>{name(r)}</span>
        ) : r.channel === EXCHANGE_CHANNEL ? (
          <span title={w.exchangeWhy}>{name(r)}</span>
        ) : (
          name(r)
        ),
    },
    { key: "sessions", label: l.sessions, align: "right", cell: (r) => (r.sessions === null ? dash(why.noSessions) : formatCount(r.sessions)) },
    { key: "orders", label: l.orders, align: "right", cell: (r) => formatCount(r.orders) },
    { key: "revenue", label: l.revenue, align: "right", cell: (r) => money(r.revenueMinor) },
    { key: "conversion", label: l.conversion, align: "right", cell: (r) => (r.conversion === null ? dash(why.needsSessions) : formatPercent(r.conversion)) },
    { key: "aov", label: l.aov, align: "right", cell: (r) => (r.aov === null ? dash(why.noOrders) : money(r.aov)) },
    { key: "newCustomers", label: l.newCustomers, align: "right", cell: (r) => formatCount(r.newCustomers) },
    { key: "spend", label: l.spend, align: "right", cell: spend },
    { key: "cac", label: l.cac, align: "right", cell: (r) => (r.cac === null ? dash(r.spendMinor === 0 ? why.noSpendEntered : why.noNewCustomers) : money(r.cac)) },
    { key: "roas", label: l.roas, align: "right", cell: (r) => (r.roas === null ? dash(why.noSpendEntered) : formatTimes(r.roas)) },
    {
      key: "profitRoas",
      label: l.profitRoas,
      align: "right",
      cell: (r) => (r.profitRoas === null ? dash(r.spendMinor === 0 ? why.noSpendEntered : why.costsUnknown) : formatTimes(r.profitRoas)),
    },
    {
      key: "contribution",
      label: l.contribution,
      align: "right",
      cell: (r) => {
        const profit = contributionProfit(r);
        return profit === null ? dash(r.orders === 0 && r.spendMinor === 0 ? why.noSales : why.costsUnknown) : money(profit);
      },
    },
  ];
}

function Glossary({ w }: { w: MarketingWords }) {
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      {w.glossary.map((g) => (
        <div key={g.term}>
          <dt className="inline font-medium">{g.term}: </dt>
          <dd className="inline text-muted">{g.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChannelsSection({
  base,
  currency,
  locale,
  report,
  words: w = reportsEn.marketing,
  channelWords: names = reportsEn.channels,
}: Pick<MarketingViewProps, "base" | "currency" | "locale" | "report" | "words" | "channelWords">) {
  const money = moneyWriter(currency, locale);
  const table = report.table;
  const columns = channelColumns(money, w, names);
  const withRevenue: BarRow[] = (table?.rows ?? [])
    .filter((r) => r.revenueMinor > 0)
    .map((r) => ({
      key: r.channel,
      label: names[r.channel] ?? r.label,
      value: r.revenueMinor,
      valueText: money(r.revenueMinor),
      detail: countWords(r.orders, w.orders, { n: formatCount(r.orders) }),
      colorIndex: channelColorIndex(r.channel),
    }));
  const withSpend: BarRow[] = report.spend.byChannel
    .filter((s) => s.amountMinor > 0)
    .map((s) => ({ key: s.channel, label: names[s.channel] ?? s.label, value: s.amountMinor, valueText: money(s.amountMinor), colorIndex: channelColorIndex(s.channel) }));
  const unknownRow = table?.rows.find((r) => r.channel === UNKNOWN_CHANNEL);
  const unknown = report.unknownOrders;
  const staffRow = table?.rows.find((r) => r.channel === STAFF_CHANNEL);
  const exchangeRow = table?.rows.find((r) => r.channel === EXCHANGE_CHANNEL);

  return (
    <AnalyticsSection
      id="channels"
      title={w.channelsTitle}
      description={w.channelsDescription}
    >
      {table === null ? (
        <div className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          <p>{fillWords(w.noChannels, { reason: countingReason(report, w) })}</p>
          <p className="mt-1">
            <Link href={`${base}/analytics/settings`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
              {w.openSettings}
            </Link>
          </p>
        </div>
      ) : (
        <>
          <DataTable
            caption={w.tableCaption}
            columns={columns}
            rows={table.rows}
            rowKey={(r) => r.channel}
            empty={w.tableEmpty}
            exportId="marketing.channels"
            exportLeftOut={{ orders: report.unconverted, currencies: report.missingCurrencies }}
            footer={
              table.rows.length > 0 ? (
                <tr>
                  {columns.map((c, i) => (
                    <td key={c.key} className={`px-3 py-1.5 ${c.align === "right" ? "text-right tabular-nums" : "text-left"}`}>
                      {i === 0 ? w.allChannels : c.cell(table.blended)}
                    </td>
                  ))}
                </tr>
              ) : undefined
            }
          />
          <p className="max-w-prose text-sm text-muted">
            {fillWords(w.roasNote, { mer: table.mer === null ? w.merNeedsSpend : formatTimes(table.mer) })}
          </p>
          {unknownRow || unknown.orders > 0 ? (
            <Note title={w.unknownTitle}>
              {`${w.unknownWhy}${unknown.orders > 0 ? countWords(unknown.orders, w.inPeriod, { n: formatCount(unknown.orders), amount: money(unknown.revenueMinor) }) : ""}`}
            </Note>
          ) : null}
          {staffRow ? (
            <Note title={w.staffTitle}>
              {`${w.staffWhy}${countWords(staffRow.orders, w.inPeriod, { n: formatCount(staffRow.orders), amount: money(staffRow.revenueMinor) })}`}
            </Note>
          ) : null}
          {exchangeRow ? (
            <Note title={w.exchangeTitle}>
              {`${w.exchangeWhy}${countWords(exchangeRow.orders, w.inPeriod, { n: formatCount(exchangeRow.orders), amount: money(exchangeRow.revenueMinor) })}`}
            </Note>
          ) : null}
          {withRevenue.length > 0 || withSpend.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {withRevenue.length > 0 ? (
                <ChartCard title={w.revenueByChannel} description={w.salesWithoutVat}>
                  <HorizontalBars label={w.revenueByChannel} rows={withRevenue} exportId="marketing.revenue_by_channel" exportLeftOut={{ orders: report.unconverted, currencies: report.missingCurrencies }} />
                </ChartCard>
              ) : null}
              {withSpend.length > 0 ? (
                <ChartCard title={w.spendByChannel} description={w.spendAllDays}>
                  <HorizontalBars label={w.spendByChannel} rows={withSpend} exportId="marketing.spend_by_channel" />
                </ChartCard>
              ) : null}
            </div>
          ) : null}
          <details className="rounded-panel border border-line bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">{w.columnsMean}</summary>
            <div className="mt-3">
              <Glossary w={w} />
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
export function marketingNotes(report: MarketingReport, money: (minor: number) => string, w: MarketingWords = reportsEn.marketing): { tone: "info" | "warning"; text: string }[] {
  const notes: { tone: "info" | "warning"; text: string }[] = report.notes.filter((n) => n !== OUTSIDE_SPEND_NOTE).map((text) => ({ tone: "info", text }));
  const outside = report.spend.outsideCoverageMinor;
  if (outside > 0) {
    notes.push({
      tone: "warning",
      text:
        report.table === null
          ? fillWords(w.outsideNoTable, { amount: money(outside) })
          : fillWords(w.outside, { amount: money(outside) }),
    });
  }
  return notes;
}

export function MarketingView(props: MarketingViewProps) {
  const { base, currency, locale, report } = props;
  const w = props.words ?? reportsEn.marketing;
  const money = moneyWriter(currency, locale);
  const cards = headlineCards(props);
  const notes = marketingNotes(report, money, w);
  const hasSpend = report.spend.totalMinor > 0;

  return (
    <>
      <AnalyticsSection
        id="headline"
        title={w.headlineTitle}
        description={w.headlineDescription}
      >
        {!hasSpend ? (
          <Note title={w.enterSpendTitle}>
            {w.enterSpendBefore}
            <a href="#spend" className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
              {w.enterSpendLink}
            </a>
            {w.enterSpendAfter}
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
      <ChannelsSection base={base} currency={currency} locale={locale} report={report} words={w} channelWords={props.channelWords} />
    </>
  );
}
