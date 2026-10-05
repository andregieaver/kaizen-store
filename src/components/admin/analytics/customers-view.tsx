import Link from "next/link";
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
export function cohortColumn(offset: number): string {
  return offset === 0 ? "Same month" : `Month ${offset}`;
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
      <dd className="break-words text-lg font-semibold tabular-nums">{children}</dd>
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
}: {
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
    <div className="min-w-0 rounded-lg border border-border bg-background p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{caption}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Figure label="Customers">{formatCount(customers)}</Figure>
        <Figure label="Orders">{formatCount(orders)}</Figure>
        <Figure label="Revenue" help="Net revenue: after refunds, without VAT.">
          {money(revenue)}
        </Figure>
        <Figure label="Average order" help="Revenue divided by orders.">
          {money(safeRatio(revenue, orders))}
        </Figure>
        <Figure label="Share of customers">{formatPercent(customerShare, 1)}</Figure>
        <Figure label="Share of revenue">{formatPercent(revenueShare, 1)}</Figure>
      </dl>
    </div>
  );
}

/** The ways the predicted lifetime value cannot be worked out, in words. */
function predictionReason(report: CustomersReport): string {
  const { predicted, inputs } = report.ltv;
  if (predicted.basis === null) return "There are no paid orders to work from yet.";
  if (inputs.ordersPerYear === null || inputs.ordersPerYear <= 0) return "Nobody has ordered in the last 365 days, so how often customers buy is not known yet.";
  return "There is not enough to work it out yet.";
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function CustomersView({ base, locale, timeZone, isOwner, report }: CustomersViewProps) {
  const money = moneyOf(report.currency, locale);
  const decimal = decimalOf();
  const settingsHref = `${base}/analytics/settings`;
  const costsHref = `${base}/products`;
  const { newVsReturning: nvr, ltv, segments, cohorts, cohortTrend: trend, frequency } = report;

  // ---- notes about what the figures are and are not ----
  const notes: ReactNode[] = [];
  if (report.truncated) {
    notes.push(
      <Note key="truncated" tone="warning" title="Only the most recent customers are counted">
        This store has more than {formatCount(report.cap)} customers. The figures below use the {formatCount(report.cap)} with the latest orders, so the oldest customers are missing from them.
      </Note>,
    );
  }
  if (report.unconverted > 0) {
    const currencies = report.missingRates.length > 0 ? report.missingRates.join(", ") : "another currency";
    notes.push(
      <Note key="unconverted" tone="warning" title="Some amounts could not be converted">
        {countOf(report.unconverted, "customer")} bought in {currencies}, which has no exchange rate in this store, so they are left out of the lifetime value, the top customers and the amounts that need it. They are not counted as zero.{" "}
        {isOwner ? (
          <Link href={`${base}/settings/localization`} className={linkClass}>
            Add the rate in Languages and currencies
          </Link>
        ) : (
          "An owner can add the rate in Languages and currencies."
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
        <AnalyticsSection id="cust-empty" title="No customers yet" description="A customer shows up here after their first paid order.">
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
            <p className="font-medium text-foreground">Nothing to show yet.</p>
            <p className="mx-auto mt-1 max-w-prose">
              Once people have paid for orders, this page shows how many of them come back, what an average customer is worth, which customers are your best, and how well each month&apos;s new customers stay.
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
        label: "Revenue from returning customers",
        value: formatPercent(nvr.returningRevenueShare, 1),
        help: "The share of this period's revenue that came from people who had bought from you before.",
        hint: `${formatCount(nvr.returningCustomers)} of ${formatCount(periodCustomers)} customers who ordered in this period had bought before.`,
        href: "#cust-new-returning",
        emphasis: true,
      }
    : { label: "Revenue from returning customers", value: null, state: "missing", missing: { text: "Nobody ordered in this period." }, help: "The share of this period's revenue that came from people who had bought from you before." };

  const repeatCard: KpiCardProps =
    rate90 && rate90.rate !== null
      ? {
          label: "Customers who buy again within 90 days",
          value: formatPercent(rate90.rate, 1),
          help: "Of the customers whose first order is at least 90 days old, the share who ordered again within 90 days of it.",
          hint: `${formatCount(rate90.repeaters)} of ${formatCount(rate90.base)} customers.${rate90.base < SMALL_BASE ? " A small group, so a rough guide." : ""}`,
          href: "#cust-repeat",
          emphasis: true,
        }
      : {
          label: "Customers who buy again within 90 days",
          value: null,
          state: "missing",
          missing: { text: "No customer has been with you 90 days yet, so there is nothing to measure." },
          help: "Of the customers whose first order is at least 90 days old, the share who ordered again within 90 days of it.",
        };

  const predictedCard: KpiCardProps =
    ltv.predicted.minor !== null
      ? {
          label: ltv.predicted.label,
          value: money(ltv.predicted.minor),
          help: "What an average customer is expected to bring in over the years they stay with you. An estimate, not a promise.",
          hint: ltv.predicted.basis === "revenue" ? "Revenue, not profit: product costs are not entered." : `Profit after costs, over ${ltv.inputs.lifespanYears} years.`,
          href: "#cust-value",
          emphasis: true,
        }
      : {
          label: ltv.predicted.label,
          value: null,
          state: "missing",
          missing: { text: predictionReason(report) },
          help: "What an average customer is expected to bring in over the years they stay with you. An estimate, not a promise.",
        };

  // ---- repeat purchase ----
  const repeatCards = report.repeatRates.map((r): KpiCardProps => {
    const label = `Bought again within ${r.days} days`;
    const help = `Of the customers whose first order is at least ${r.days} days old, the share who ordered again within ${r.days} days of it.`;
    if (r.rate === null) {
      return { label, value: null, state: "missing", help, missing: { text: `No customer has been with you ${r.days} days yet, so there is nothing to measure.` } };
    }
    return {
      label,
      value: formatPercent(r.rate, 1),
      help,
      hint: `${formatCount(r.repeaters)} of ${formatCount(r.base)} customers whose first order is at least ${r.days} days old.${r.base < SMALL_BASE ? " Only a small group, so treat it as a rough guide." : ""}`,
    };
  });
  const frequencyCard: KpiCardProps =
    frequency.perCustomer !== null
      ? {
          label: "Orders per customer per year",
          value: decimal(frequency.perCustomer),
          help: "Paid orders in the last 365 days divided by the customers who placed them.",
          hint: `${countOf(frequency.orders365, "order")} from ${countOf(frequency.customers365, "customer")} in the last 365 days.`,
        }
      : {
          label: "Orders per customer per year",
          value: null,
          state: "missing",
          missing: { text: "No paid orders in the last 365 days." },
          help: "Paid orders in the last 365 days divided by the customers who placed them.",
        };

  // ---- lifetime value ----
  const costsAction = { label: "Enter what your products cost", href: costsHref };
  const historic = ltv.historic;
  const historicRevenueCard: KpiCardProps =
    historic.revenueMinor !== null
      ? {
          label: "Revenue per customer so far",
          value: money(historic.revenueMinor),
          help: "The average of what each customer has paid you to date: after refunds, without VAT.",
          hint: `Average over ${countOf(historic.customers, "customer")}, all their orders to date.`,
        }
      : { label: "Revenue per customer so far", value: null, state: "missing", missing: { text: "No customer has all their amounts in a currency with a known rate." } };
  const historicProfitCard: KpiCardProps =
    historic.contributionMinor !== null
      ? {
          label: "Profit per customer so far",
          value: money(historic.contributionMinor),
          help: "Contribution: what is left of a customer's revenue after the cost of goods, payment and platform fees and shipping, before marketing spend. The average of all customers whose costs are known.",
          hint:
            historic.contributionCoverage !== null && historic.contributionCoverage < 1
              ? `Known for ${formatPercent(historic.contributionCoverage, 0)} of customers; the others bought products with no cost entered.`
              : "Known for all customers.",
        }
      : {
          label: "Profit per customer so far",
          value: null,
          state: "missing",
          help: "Contribution: what is left of a customer's revenue after the cost of goods, payment and platform fees and shipping, before marketing spend.",
          missing: { text: "Product costs are not entered, so profit per customer cannot be worked out.", action: costsAction },
        };

  const perOrder = ltv.predicted.basis === "contribution" ? ltv.inputs.contributionPerOrderMinor : ltv.inputs.revenuePerOrderMinor;
  const lifespan = `${ltv.inputs.lifespanYears}-year lifespan`;
  const partialContribution = ltv.predicted.basis === "contribution" && ltv.inputs.contributionCustomers < historic.customers;

  // ---- segments ----
  const segmentCards = segments.summary;

  // ---- cohorts ----
  const columns = cohorts.offsets.map(cohortColumn);
  const retentionRows: CohortTableRow[] = cohorts.rows.map((r) => ({ label: monthText(r.cohort), size: r.size, values: r.retention }));
  const revenueRows: CohortTableRow[] = cohorts.rows.map((r) => ({ label: monthText(r.cohort), size: r.size, values: r.revenuePerCustomerMinor }));
  const revenueMax = maxOf(cohorts.rows.flatMap((r) => r.revenuePerCustomerMinor));
  const leftOut = { orders: report.unconverted, currencies: report.missingRates };
  const smallCohorts = cohorts.rows.some((r) => r.size < MIN_COHORT_SIZE);

  // ---- top customers ----
  const topColumns: Column<TopCustomer>[] = [
    {
      key: "customer",
      label: "Customer",
      cell: (c) => (
        <Link href={`${base}/customers/${encodeURIComponent(c.customerId)}`} className={`${linkClass} block truncate`} title={c.email}>
          {c.name ?? c.email}
          <span className="block truncate text-xs font-normal text-muted">{`${c.name ? `${c.email} · ` : ""}${c.account ? "Has an account" : "Guest"}`}</span>
        </Link>
      ),
    },
    { key: "orders", label: "Orders in period", align: "right", cell: (c) => formatCount(c.orders) },
    { key: "revenue", label: "Revenue in period", align: "right", cell: (c) => money(c.revenueMinor) },
    { key: "lifetime", label: "Orders to date", align: "right", cell: (c) => formatCount(c.lifetimeOrders) },
    { key: "last", label: "Last order", align: "right", cell: (c) => lastOrderText(c.lastOrderAt, timeZone) },
  ];

  return (
    <div className="flex flex-col gap-8">
      {noteBlock}

      <AnalyticsSection id="cust-glance" title="At a glance" description="Do they come back, and what is a customer worth? These three figures answer that; the rest of the page is the detail behind them.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard {...returningCard} />
          <KpiCard {...repeatCard} />
          <KpiCard {...predictedCard} />
        </div>
      </AnalyticsSection>

      <AnalyticsSection
        id="cust-new-returning"
        title="New and returning customers"
        description="A new customer placed their first paid order in this period; a returning customer had already bought before it. Revenue is after refunds and without VAT."
      >
        {hasPeriodCustomers ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-sm text-muted">Returning customers&apos; share of revenue</p>
              <p className="text-3xl font-semibold tabular-nums">{formatPercent(nvr.returningRevenueShare, 1)}</p>
              <p className="text-sm text-muted">{`${countOf(nvr.returningCustomers, "returning customer")} brought in ${money(nvr.returningRevenueMinor)} of ${money(nvr.newRevenueMinor + nvr.returningRevenueMinor)} in this period.`}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <PeriodGroup
                title="New customers"
                caption="First paid order in this period"
                customers={nvr.newCustomers}
                orders={nvr.newOrders}
                revenue={nvr.newRevenueMinor}
                customerShare={safeRatio(nvr.newCustomers, periodCustomers)}
                revenueShare={safeRatio(nvr.newRevenueMinor, nvr.newRevenueMinor + nvr.returningRevenueMinor)}
                money={money}
              />
              <PeriodGroup
                title="Returning customers"
                caption="Had bought before this period"
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
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Nobody placed a paid order in this period, so there is nothing to split into new and returning. Try a longer period.</div>
        )}
      </AnalyticsSection>

      <AnalyticsSection
        id="cust-repeat"
        title="Do customers buy again?"
        description="The repeat purchase rate: of the customers who have been with you long enough, the share who ordered a second time within that many days of their first order. Customers who are newer than the window are left out, so the rate is not pulled down by people who have not had time yet."
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
        title="What a customer is worth"
        description="Lifetime value is what an average customer brings in over the time they stay with you. The first two figures are what customers have already been worth; the third is a prediction."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <KpiCard {...historicRevenueCard} />
          <KpiCard {...historicProfitCard} />
          <KpiCard {...predictedCard} href={undefined} />
        </div>
        <div className="space-y-1 text-sm text-muted">
          {ltv.predicted.minor !== null ? (
            <p>
              {`How the prediction is made: ${money(perOrder)} ${ltv.predicted.basis === "contribution" ? "profit (contribution)" : "revenue"} per order × ${decimal(ltv.inputs.ordersPerYear)} orders per customer a year × ${ltv.inputs.lifespanYears} years. `}
              {`It assumes a ${lifespan}`}
              {isOwner ? (
                <>
                  , <Link href={settingsHref} className={linkClass}>changed in settings</Link>.
                </>
              ) : (
                ", changed in the analytics settings by an owner."
              )}
            </p>
          ) : (
            <p>{predictionReason(report)}</p>
          )}
          {ltv.predicted.basis === "revenue" ? (
            <p>
              Product costs are not entered, so this is based on revenue and says so. It is not profit.{" "}
              <Link href={costsHref} className={linkClass}>
                Enter what your products cost
              </Link>{" "}
              to see profit.
            </p>
          ) : null}
          {partialContribution ? <p>{`Profit per order is worked out from ${formatCount(ltv.inputs.contributionCustomers)} of ${formatCount(historic.customers)} customers: those whose products all have a cost entered.`}</p> : null}
        </div>
      </AnalyticsSection>

      <AnalyticsSection
        id="cust-groups"
        title="Customer groups"
        description="RFM sorts customers by how Recently they bought, how Frequently and how much Money they have spent. Each customer is scored against all your other customers, so the groups show who stands out in your own store."
      >
        {segments.enough ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {segmentCards.map((s) => {
              const copy = SEGMENT_COPY[s.segment];
              return (
                <li key={s.segment} data-segment={s.segment} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h3 className="text-base font-semibold">{s.segment}</h3>
                    <p className="text-sm tabular-nums">
                      <span className="text-lg font-semibold">{formatCount(s.customers)}</span>
                      <span className="text-muted">{` ${s.customers === 1 ? "customer" : "customers"}`}</span>
                      {s.customers > 0 ? <span className="text-muted">{` · ${formatPercent(s.customerShare, 0)}`}</span> : null}
                    </p>
                  </div>
                  <p className="text-sm text-muted">{copy.meaning}</p>
                  {s.customers > 0 ? (
                    <>
                      <div>
                        <p className="text-xs text-muted">Share of all revenue</p>
                        <ShareBar share={s.revenueShare} text={formatPercent(s.revenueShare, 0)} label="Share of all revenue" />
                      </div>
                      <p className="text-xs text-muted">{`Average ${money(s.averageRevenueMinor)} spent in ${s.averageOrders === null ? NO_FIGURE : decimal(s.averageOrders)} orders; last order ${s.averageRecencyDays === null ? NO_FIGURE : formatCount(s.averageRecencyDays)} days ago on average.`}</p>
                      <p className="text-sm">
                        <span className="font-medium">What to do: </span>
                        {copy.action}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted">No customers in this group right now.</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Note title="Too few customers to sort into groups">
            Groups only mean something with at least {formatCount(segments.minCustomers)} customers, and you have {formatCount(segments.customers)} so far. They show up here as more people buy.
          </Note>
        )}
      </AnalyticsSection>

      <AnalyticsSection
        id="cust-cohorts"
        title="Do new customers stay?"
        description="A cohort is the group of customers who placed their first order in the same month. Each row follows one group; each column is how many months after that first order, and the figure is the share who had bought again by then."
      >
        <p className={trend.verdict === "unknown" ? "text-sm text-muted" : "text-sm font-medium"}>{trend.sentence}</p>
        <ChartCard title="Share who had bought again" description="Cumulative: Month 3 counts everyone who ordered again at any time up to the end of the third month after their first order. A month that is not over yet is left blank.">
          <CohortTable label="Share of each month's new customers who had bought again, by months since their first order" columns={columns} rows={retentionRows} emptyText="No cohorts yet." exportId="customers.retention" exportLeftOut={leftOut} />
        </ChartCard>
        <ChartCard title="Revenue per customer" description="What each customer in the group had spent in total by then, after refunds and without VAT.">
          <CohortTable
            label="Revenue per customer of each month's new customers, by months since their first order"
            columns={columns}
            rows={revenueRows}
            format={(v) => money(v)}
            max={revenueMax}
            emptyText="No cohorts yet."
            exportId="customers.cohort_revenue"
            exportLeftOut={leftOut}
          />
        </ChartCard>
        {smallCohorts ? <p className="text-xs text-muted">{`Months with fewer than ${MIN_COHORT_SIZE} new customers swing a lot with a single order. Read them as a guide, not a result.`}</p> : null}
      </AnalyticsSection>

      <AnalyticsSection id="cust-top" title="Top customers" description="Ranked by what they spent in this period, after refunds and without VAT. Each name opens the customer.">
        <DataTable
          caption="Top customers by revenue in this period"
          columns={topColumns}
          rows={report.topCustomers}
          rowKey={(c) => c.key}
          empty="Nobody placed a paid order in this period."
          exportId="customers.top"
          exportLeftOut={leftOut}
        />
      </AnalyticsSection>

      <Note title="How customers are counted">
        A customer is a person by their email: an account&apos;s orders go together, and a guest is told apart by the email they gave. Someone who orders with two different emails counts as two customers. Amounts are in {report.currency} without VAT, after refunds, and orders in other currencies are converted at today&apos;s rates. Refunds made only in Stripe&apos;s own dashboard are not seen.
      </Note>
    </div>
  );
}
