import Link from "next/link";
import { fillWords } from "@/lib/admin-fill";
import { reportsEn } from "@/lib/admin-messages/reports.en";
import type { ReportsMessages } from "@/lib/admin-messages/reports.en";
import type { ReactNode } from "react";

import { formatCount, formatDate, formatMonth, formatPercent, NO_FIGURE, safeRatio } from "@/lib/analytics-core";
import { formatAmount, formatDecimal } from "@/lib/analytics-format";
import { MIN_COHORT_SIZE, type RfmSegment } from "@/lib/analytics-customers";
import type { CustomersReport, TopCustomer } from "@/server/analytics-customers-data";

import { maxOf } from "./chart-math";
import { CohortTable, type CohortRow as CohortTableRow } from "./charts";
import { DataTable, ShareBar, type Column } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { AnalyticsSection, ChartCard, Note } from "./section";
import { CARD_CLASS } from "@/components/admin/ui";

/**
 * The Customers page's body (D152): everything under the page's header, drawn from the one report object it is handed and nothing
 * else (no data access, so it can be rendered on fixture data). It answers three things first (do customers come back, what is a
 * customer worth, who are the best), then the detail: new against returning, the repeat rate, lifetime value, customer groups and
 * cohorts, and the top customers. A figure that cannot be known is never drawn as zero: the card says what is missing and where to add it.
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type CustomersViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's first market's locale, for writing amounts. */
  locale: string;
  /** The store's time zone, for the date of a customer's last order. */
  timeZone: string;
  /** Only an owner can open Analytics settings and the localization settings. */
  isOwner: boolean;
  report: CustomersReport;
  /** The bonus program's feature is on (D178): advice that names bonus credit is given only then. */
  bonusOn?: boolean;
};

/** A repeat rate over fewer customers than this is called a rough guide. */
export const SMALL_BASE = 30;

const linkClass = "font-medium text-(--brand-text) underline-offset-2 hover:underline";

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

/** An amount of the main currency; a figure that is missing (or not a whole number of minor units) is the dash, never a zero. */
export function moneyOf(currency: string, locale: string): (minor: number | null | undefined) => string {
  return (minor) => {
    if (typeof minor !== "number" || !Number.isFinite(minor)) return NO_FIGURE;
    const whole = Math.round(minor);
    return Number.isSafeInteger(whole) ? formatAmount(whole, currency, locale) : NO_FIGURE;
  };
}

/** A figure with one decimal ("1.4", as every figure but an amount of money is written); the dash when it cannot be known. */
export function decimalOf(): (n: number | null | undefined) => string {
  return (n) => formatDecimal(n, 1);
}

/** "1 order", "3 orders". */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** `2026-03` as "Mar 2026" (the one month label every analytics page uses); anything that is not a month as it came. */
export function monthText(month: string): string {
  return formatMonth(month);
}

/** A column of the cohort table: month 0 is the month of the first order itself. */
export function cohortColumn(offset: number, w: CustomersWords = reportsEn.customers): string {
  return offset === 0 ? w.sameMonth : fillWords(w.monthN, { n: String(offset) });
}

/** The day of an order in the store's time zone, as "3 Oct 2026"; the dash when it is not a date. */
export function lastOrderText(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return NO_FIGURE;
  try {
    return formatDate(new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(ms)));
  } catch {
    return NO_FIGURE;
  }
}

/** The advice for a group: without the bonus program (D178) it never suggests bonus credit. */
export function segmentAction(segment: RfmSegment, bonusOn: boolean, w: CustomersWords = reportsEn.customers): string {
  if (segment === "Loyal" && !bonusOn) return w.loyalWithoutBonus;
  return w.segments[segment].action;
}

export type CustomersWords = ReportsMessages["customers"];

/** What each customer group means and what to do about it, in plain words (the groups are defined by `segmentOf()`). */
export const SEGMENT_COPY: Record<RfmSegment, { meaning: string; action: string }> = {
  VIP: {
    meaning: "Bought recently, buy often and have spent the most.",
    action: "Thank them. Give them early access to new products or a small gift; there is no need to discount for them.",
  },
  Loyal: {
    meaning: "Buy often and have ordered lately.",
    action: "Keep them happy: ask for a review, or reward them with bonus credit.",
  },
  Promising: {
    meaning: "Ordered recently, but not often or big yet.",
    action: "Help them order again: a follow-up email with products that go with what they bought.",
  },
  New: {
    meaning: "Their only order was in the last 30 days.",
    action: "Welcome them and make a second order easy: a thank-you email with ideas for what to buy next.",
  },
  "At risk": {
    meaning: "Used to order or spend well, but have gone quiet.",
    action: "Write to them before they are gone for good: a personal 'we miss you' email, maybe with a one-time offer.",
  },
  Lost: {
    meaning: "Quiet for a long time, with few and small orders.",
    action: "Try one last win-back email, then spend your effort on the other groups.",
  },
};

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Figure({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted" {...(help ? { title: help } : {})}>
        {label}
      </dt>
      <dd className="break-words text-lg font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function PeriodGroup({
  title,
  caption,
  customers,
  orders,
  revenue,
  customerShare,
  revenueShare,
  money,
  w,
}: {
  w: CustomersWords;
  title: string;
  caption: string;
  customers: number;
  orders: number;
  revenue: number;
  customerShare: number | null;
  revenueShare: number | null;
  money: (minor: number | null | undefined) => string;
}) {
  return (
    <div className={`min-w-0 p-4 ${CARD_CLASS}`}>
      <h3 className="text-body-strong text-ink">{title}</h3>
      <p className="mb-3 text-xs text-muted">{caption}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Figure label={w.fig.customers}>{formatCount(customers)}</Figure>
        <Figure label={w.fig.orders}>{formatCount(orders)}</Figure>
        <Figure label={w.fig.revenue} help={w.fig.revenueHelp}>
          {money(revenue)}
        </Figure>
        <Figure label={w.fig.averageOrder} help={w.fig.averageOrderHelp}>
          {money(safeRatio(revenue, orders))}
        </Figure>
        <Figure label={w.fig.customerShare}>{formatPercent(customerShare, 1)}</Figure>
        <Figure label={w.fig.revenueShare}>{formatPercent(revenueShare, 1)}</Figure>
      </dl>
    </div>
  );
}

/** The ways the predicted lifetime value cannot be worked out, in words. */
function predictionReason(report: CustomersReport, w: CustomersWords): string {
  const { predicted, inputs } = report.ltv;
  if (predicted.basis === null) return w.noOrdersYet;
  if (inputs.ordersPerYear === null || inputs.ordersPerYear <= 0) return w.noRecentOrders;
  return w.notEnough;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function CustomersView({
  base,
  locale,
  timeZone,
  isOwner,
  report,
  bonusOn = true,
  seesPeople = false,
  words: w = reportsEn.customers,
}: CustomersViewProps & { words?: CustomersWords; /** Whether the member may read customers: each type then opens its people (D380). */ seesPeople?: boolean }) {
  const money = moneyOf(report.currency, locale);
  const decimal = decimalOf();
  const settingsHref = `${base}/analytics/settings`;
  const cnt = (n: number, pair: { one: string; many: string }) => `${formatCount(n)} ${n === 1 ? pair.one : pair.many}`;
  const costsHref = `${base}/products`;
  const { newVsReturning: nvr, ltv, segments, cohorts, cohortTrend: trend, frequency } = report;

  // ---- notes about what the figures are and are not ----
  const notes: ReactNode[] = [];
  if (report.truncated) {
    notes.push(
      <Note key="truncated" tone="warning" title={w.truncatedTitle}>
        {fillWords(w.truncated, { cap: formatCount(report.cap) })}
      </Note>,
    );
  }
  if (report.unconverted > 0) {
    const currencies = report.missingRates.length > 0 ? report.missingRates.join(", ") : w.anotherCurrency;
    notes.push(
      <Note key="unconverted" tone="warning" title={w.unconvertedTitle}>
        {fillWords(w.unconverted, { customers: cnt(report.unconverted, w.n.customer), currencies })}{" "}
        {isOwner ? (
          <Link href={`${base}/settings/localization`} className={linkClass}>
            {w.addRate}
          </Link>
        ) : (
          w.ownerAddsRate
        )}
      </Note>,
    );
  }
  const noteBlock = notes.length > 0 ? <div className="space-y-3">{notes}</div> : null;

  // ---- an empty store: one calm message, no zeros ----
  if (report.customers === 0) {
    return (
      <div className="flex flex-col gap-8">
        {noteBlock}
        <AnalyticsSection id="cust-empty" title={w.emptyTitle} description={w.emptyDescription}>
          <div className="rounded-panel border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            <p className="font-medium text-ink">{w.emptyLead}</p>
            <p className="mx-auto mt-1 max-w-prose">
              {w.emptyBody}
            </p>
          </div>
        </AnalyticsSection>
      </div>
    );
  }

  // ---- the three things first ----
  const rate90 = report.repeatRates.find((r) => r.days === 90) ?? null;
  const hasPeriodCustomers = nvr.newCustomers + nvr.returningCustomers > 0;
  const periodCustomers = nvr.newCustomers + nvr.returningCustomers;

  const returningCard: KpiCardProps = hasPeriodCustomers
    ? {
        label: w.returningLabel,
        value: formatPercent(nvr.returningRevenueShare, 1),
        help: w.returningHelp,
        hint: fillWords(w.returningHint, { returning: formatCount(nvr.returningCustomers), all: formatCount(periodCustomers) }),
        href: "#cust-new-returning",
        emphasis: true,
      }
    : { label: w.returningLabel, value: null, state: "missing", missing: { text: w.nobodyOrdered }, help: w.returningHelp };

  const repeatCard: KpiCardProps =
    rate90 && rate90.rate !== null
      ? {
          label: w.repeat90Label,
          value: formatPercent(rate90.rate, 1),
          help: w.repeat90Help,
          hint: `${fillWords(w.repeat90Hint, { repeaters: formatCount(rate90.repeaters), base: formatCount(rate90.base) })}${rate90.base < SMALL_BASE ? w.roughSmall : ""}`,
          href: "#cust-repeat",
          emphasis: true,
        }
      : {
          label: w.repeat90Label,
          value: null,
          state: "missing",
          missing: { text: w.no90 },
          help: w.repeat90Help,
        };

  const predictedCard: KpiCardProps =
    ltv.predicted.minor !== null
      ? {
          label: ltv.predicted.label,
          value: money(ltv.predicted.minor),
          help: w.predictedHelp,
          hint: ltv.predicted.basis === "revenue" ? w.revenueNotProfit : fillWords(w.profitOver, { years: String(ltv.inputs.lifespanYears) }),
          href: "#cust-value",
          emphasis: true,
        }
      : {
          label: ltv.predicted.label,
          value: null,
          state: "missing",
          missing: { text: predictionReason(report, w) },
          help: w.predictedHelp,
        };

  // ---- repeat purchase ----
  const repeatCards = report.repeatRates.map((r): KpiCardProps => {
    const days = String(r.days);
    const label = fillWords(w.repeatLabel, { days });
    const help = fillWords(w.repeatHelp, { days });
    if (r.rate === null) {
      return { label, value: null, state: "missing", help, missing: { text: fillWords(w.repeatNone, { days }) } };
    }
    return {
      label,
      value: formatPercent(r.rate, 1),
      help,
      hint: `${fillWords(w.repeatHint, { repeaters: formatCount(r.repeaters), base: formatCount(r.base), days })}${r.base < SMALL_BASE ? w.roughGuide : ""}`,
    };
  });
  const frequencyCard: KpiCardProps =
    frequency.perCustomer !== null
      ? {
          label: w.freqLabel,
          value: decimal(frequency.perCustomer),
          help: w.freqHelp,
          hint: fillWords(w.freqHint, { orders: cnt(frequency.orders365, w.n.order), customers: cnt(frequency.customers365, w.n.customer) }),
        }
      : {
          label: w.freqLabel,
          value: null,
          state: "missing",
          missing: { text: w.freqNone },
          help: w.freqHelp,
        };

  // ---- lifetime value ----
  const costsAction = { label: w.enterCosts, href: costsHref };
  const historic = ltv.historic;
  const historicRevenueCard: KpiCardProps =
    historic.revenueMinor !== null
      ? {
          label: w.histRevenueLabel,
          value: money(historic.revenueMinor),
          help: w.histRevenueHelp,
          hint: fillWords(w.histRevenueHint, { customers: cnt(historic.customers, w.n.customer) }),
        }
      : { label: w.histRevenueLabel, value: null, state: "missing", missing: { text: w.histRevenueNone } };
  const historicProfitCard: KpiCardProps =
    historic.contributionMinor !== null
      ? {
          label: w.histProfitLabel,
          value: money(historic.contributionMinor),
          help: w.histProfitHelp,
          hint:
            historic.contributionCoverage !== null && historic.contributionCoverage < 1
              ? fillWords(w.histProfitPartial, { share: formatPercent(historic.contributionCoverage, 0) })
              : w.histProfitAll,
        }
      : {
          label: w.histProfitLabel,
          value: null,
          state: "missing",
          help: w.histProfitHelpShort,
          missing: { text: w.histProfitNone, action: costsAction },
        };

  const perOrder = ltv.predicted.basis === "contribution" ? ltv.inputs.contributionPerOrderMinor : ltv.inputs.revenuePerOrderMinor;
  const lifespan = fillWords(w.lifespan, { years: String(ltv.inputs.lifespanYears) });
  const partialContribution = ltv.predicted.basis === "contribution" && ltv.inputs.contributionCustomers < historic.customers;

  // ---- segments ----
  const segmentCards = segments.summary;

  // ---- cohorts ----
  const columns = cohorts.offsets.map((o) => cohortColumn(o, w));
  const retentionRows: CohortTableRow[] = cohorts.rows.map((r) => ({ label: monthText(r.cohort), size: r.size, values: r.retention }));
  const revenueRows: CohortTableRow[] = cohorts.rows.map((r) => ({ label: monthText(r.cohort), size: r.size, values: r.revenuePerCustomerMinor }));
  const revenueMax = maxOf(cohorts.rows.flatMap((r) => r.revenuePerCustomerMinor));
  const leftOut = { orders: report.unconverted, currencies: report.missingRates };
  const smallCohorts = cohorts.rows.some((r) => r.size < MIN_COHORT_SIZE);

  // ---- top customers ----
  const topColumns: Column<TopCustomer>[] = [
    {
      key: "customer",
      label: w.colCustomer,
      cell: (c) => (
        <Link href={`${base}/customers/${encodeURIComponent(c.customerId)}`} className={`${linkClass} block truncate`} title={c.email}>
          {c.name ?? c.email}
          <span className="block truncate text-xs font-normal text-muted">{`${c.name ? `${c.email} · ` : ""}${c.account ? w.hasAccount : w.guest}`}</span>
        </Link>
      ),
    },
    { key: "orders", label: w.colOrders, align: "right", cell: (c) => formatCount(c.orders) },
    { key: "revenue", label: w.colRevenue, align: "right", cell: (c) => money(c.revenueMinor) },
    { key: "lifetime", label: w.colLifetime, align: "right", cell: (c) => formatCount(c.lifetimeOrders) },
    { key: "last", label: w.colLast, align: "right", cell: (c) => lastOrderText(c.lastOrderAt, timeZone) },
  ];

  return (
    <div className="flex flex-col gap-8">
      {noteBlock}

      <AnalyticsSection id="cust-glance" title={w.glanceTitle} description={w.glanceDescription}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard {...returningCard} />
          <KpiCard {...repeatCard} />
          <KpiCard {...predictedCard} />
        </div>
      </AnalyticsSection>

      <AnalyticsSection
        id="cust-new-returning"
        title={w.nvrTitle}
        description={w.nvrDescription}
      >
        {hasPeriodCustomers ? (
          <div className="space-y-3">
            <div className="rounded-panel bg-sunken p-4">
              <p className="text-sm text-muted">{w.returningShare}</p>
              <p className="text-3xl font-medium tabular-nums">{formatPercent(nvr.returningRevenueShare, 1)}</p>
              <p className="text-sm text-muted">{fillWords(w.returningBrought, { returning: cnt(nvr.returningCustomers, w.n.returning), money: money(nvr.returningRevenueMinor), total: money(nvr.newRevenueMinor + nvr.returningRevenueMinor) })}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <PeriodGroup
                w={w}
                title={w.newTitle}
                caption={w.newCaption}
                customers={nvr.newCustomers}
                orders={nvr.newOrders}
                revenue={nvr.newRevenueMinor}
                customerShare={safeRatio(nvr.newCustomers, periodCustomers)}
                revenueShare={safeRatio(nvr.newRevenueMinor, nvr.newRevenueMinor + nvr.returningRevenueMinor)}
                money={money}
              />
              <PeriodGroup
                w={w}
                title={w.retTitle}
                caption={w.retCaption}
                customers={nvr.returningCustomers}
                orders={nvr.returningOrders}
                revenue={nvr.returningRevenueMinor}
                customerShare={nvr.returningShare}
                revenueShare={nvr.returningRevenueShare}
                money={money}
              />
            </div>
          </div>
        ) : (
          <div className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{w.nvrEmpty}</div>
        )}
      </AnalyticsSection>

      <AnalyticsSection
        id="cust-repeat"
        title={w.repeatTitle}
        description={w.repeatDescription}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {repeatCards.map((card, i) => (
            <KpiCard key={report.repeatRates[i].days} {...card} />
          ))}
          <KpiCard {...frequencyCard} />
        </div>
      </AnalyticsSection>

      <AnalyticsSection
        id="cust-value"
        title={w.valueTitle}
        description={w.valueDescription}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard {...historicRevenueCard} />
          <KpiCard {...historicProfitCard} />
          <KpiCard {...predictedCard} href={undefined} />
        </div>
        <div className="space-y-1 text-sm text-muted">
          {ltv.predicted.minor !== null ? (
            <p>
              {fillWords(w.howPredicted, { money: money(perOrder), basis: ltv.predicted.basis === "contribution" ? w.basisProfit : w.basisRevenue, orders: decimal(ltv.inputs.ordersPerYear), years: String(ltv.inputs.lifespanYears) })}
              {fillWords(w.assumes, { lifespan })}
              {isOwner ? (
                <>
                  , <Link href={settingsHref} className={linkClass}>{w.changedInSettings}</Link>.
                </>
              ) : (
                w.changedByOwner
              )}
            </p>
          ) : (
            <p>{predictionReason(report, w)}</p>
          )}
          {ltv.predicted.basis === "revenue" ? (
            <p>
              {w.revenueBasis}{" "}
              <Link href={costsHref} className={linkClass}>
                {w.enterCosts}
              </Link>{" "}
              {w.toSeeProfit}
            </p>
          ) : null}
          {partialContribution ? <p>{fillWords(w.partialProfit, { known: formatCount(ltv.inputs.contributionCustomers), all: formatCount(historic.customers) })}</p> : null}
        </div>
      </AnalyticsSection>

      <AnalyticsSection
        id="cust-groups"
        title={w.groupsTitle}
        description={w.groupsDescription}
      >
        {segments.enough ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {segmentCards.map((s) => {
              const copy = w.segments[s.segment];
              return (
                <li key={s.segment} data-segment={s.segment} className="flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h3 className="text-body-strong text-ink">{copy.name}</h3>
                    <p className="text-sm tabular-nums">
                      <span className="text-lg font-medium">{formatCount(s.customers)}</span>
                      <span className="text-muted">{` ${s.customers === 1 ? w.customerCount.one : w.customerCount.many}`}</span>
                      {s.customers > 0 ? <span className="text-muted">{` · ${formatPercent(s.customerShare, 0)}`}</span> : null}
                    </p>
                  </div>
                  <p className="text-sm text-muted">{copy.meaning}</p>
                  {s.customers > 0 ? (
                    <>
                      <div>
                        <p className="text-xs text-muted">{w.shareOfRevenue}</p>
                        <ShareBar share={s.revenueShare} text={formatPercent(s.revenueShare, 0)} label={w.shareOfRevenue} />
                      </div>
                      <p className="text-xs text-muted">{fillWords(w.segmentAverage, { money: money(s.averageRevenueMinor), orders: s.averageOrders === null ? NO_FIGURE : decimal(s.averageOrders), days: s.averageRecencyDays === null ? NO_FIGURE : formatCount(s.averageRecencyDays) })}</p>
                      <p className="text-sm">
                        <span className="font-medium">{w.whatToDo}</span>
                        {segmentAction(s.segment, bonusOn, w)}
                      </p>
                      {seesPeople && (
                        <a href={`${base}/segments/rfm/${encodeURIComponent(s.segment)}`} className="rounded-pill text-sm text-ink underline underline-offset-2">
                          {w.seeWho}
                        </a>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted">{w.emptyGroup}</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Note title={w.fewTitle}>
            {fillWords(w.few, { min: formatCount(segments.minCustomers), have: formatCount(segments.customers) })}
          </Note>
        )}
      </AnalyticsSection>

      <AnalyticsSection
        id="cust-cohorts"
        title={w.cohortsTitle}
        description={w.cohortsDescription}
      >
        <p className={trend.verdict === "unknown" ? "text-sm text-muted" : "text-sm font-medium"}>{trend.sentence}</p>
        <ChartCard title={w.retentionTitle} description={w.retentionDescription}>
          <CohortTable label={w.retentionLabel} columns={columns} rows={retentionRows} emptyText={w.noCohorts} exportId="customers.retention" exportLeftOut={leftOut} />
        </ChartCard>
        <ChartCard title={w.cohortRevenueTitle} description={w.cohortRevenueDescription}>
          <CohortTable
            label={w.cohortRevenueLabel}
            columns={columns}
            rows={revenueRows}
            format={(v) => money(v)}
            max={revenueMax}
            emptyText={w.noCohorts}
            exportId="customers.cohort_revenue"
            exportLeftOut={leftOut}
          />
        </ChartCard>
        {smallCohorts ? <p className="text-xs text-muted">{fillWords(w.smallCohorts, { n: String(MIN_COHORT_SIZE) })}</p> : null}
      </AnalyticsSection>

      <AnalyticsSection id="cust-top" title={w.topTitle} description={w.topDescription}>
        <DataTable
          caption={w.topCaption}
          columns={topColumns}
          rows={report.topCustomers}
          rowKey={(c) => c.key}
          empty={w.topEmpty}
          exportId="customers.top"
          exportLeftOut={leftOut}
        />
      </AnalyticsSection>

      <Note title={w.countedTitle}>
        {fillWords(w.counted, { currency: report.currency })}
      </Note>
    </div>
  );
}
