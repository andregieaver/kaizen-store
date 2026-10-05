import Link from "next/link";

import { formatCount, formatPercent, formatSigned, MINUS, NO_FIGURE, safeRatio } from "@/lib/analytics-core";
import { formatDecimal } from "@/lib/analytics-format";
import { addDays } from "@/lib/analytics-period";
import type { SubscriptionsReport } from "@/server/analytics-subscriptions-data";

import { HorizontalBars, type BarRow } from "./charts";
import { ExportButton } from "./export-scope";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { dayText, moneyWriter } from "./overview-view";
import { AnalyticsSection, Note } from "./section";

/**
 * The Subscriptions page's body (D152, docs/analytics.md): how much recurring revenue the store has, how it moved over the period, who
 * left, what is at risk and what renewals brought in. It is drawn from the report object and nothing else (no data access, so it can be
 * rendered on fixture data). Honesty first: Kaizen keeps only a subscription's status as it is today, so expansion, contraction and
 * reactivation are said to be unknown (never 0), past-due and paused are a snapshot, and a churn rate over few subscriptions says so.
 */

export type SubscriptionsViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  /** The first market's locale, for writing amounts. */
  locale: string;
  report: SubscriptionsReport;
};

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** An amount in the main currency; a figure that cannot be written is the dash, never a thrown error or the word NaN. */
export function safeMoney(currency: string, locale: string): (minor: number | null | undefined) => string {
  const write = moneyWriter(currency, locale);
  return (minor) => (finite(minor) && Number.isSafeInteger(Math.round(minor)) ? write(minor) : NO_FIGURE);
}

/** A change in an amount with its sign written out: "+1 200,00 kr", "−300,00 kr" (the proper minus, U+2212). */
export function signedMoney(money: (minor: number | null | undefined) => string, minor: number | null | undefined): string {
  if (!finite(minor)) return NO_FIGURE;
  return minor < 0 ? `${MINUS}${money(-minor)}` : minor === 0 ? money(0) : `+${money(minor)}`;
}

/** A length of time in days as a person says it: "12 days", "1 day", "about 3 months". */
export function durationText(days: number | null | undefined): string {
  if (!finite(days) || days < 0) return NO_FIGURE;
  if (days < 1) return "less than a day";
  const whole = Math.round(days);
  if (whole < 60) return `${formatCount(whole)} ${plural(whole, "day", "days")}`;
  const months = Math.round(whole / 30.44);
  if (months < 24) return `about ${formatCount(months)} months`;
  return `about ${formatDecimal(whole / 365.25, 1)} years`;
}

/** Whether the store has never had anything to report: no subscription, now or ever, no subscription order, and nothing left out. */
export function hasNoSubscriptions(r: SubscriptionsReport): boolean {
  return (
    r.active.count === 0 &&
    r.pastDue.count === 0 &&
    r.paused.count === 0 &&
    r.trialing.count === 0 &&
    r.cancelling.count === 0 &&
    r.new.count === 0 &&
    r.cancelled.count === 0 &&
    r.activeAtStart.count === 0 &&
    r.activeAtEnd.count === 0 &&
    r.duration.endedTotal === 0 &&
    r.renewals.orders === 0 &&
    r.firstOrders.orders === 0 &&
    r.unconverted.subscriptions === 0 &&
    r.unconverted.orders === 0 &&
    r.notes.length === 0
  );
}

/** The period as dates: "1 Sep 2026 to 30 Sep 2026" (the report's `to` is the day after the last one). */
export function periodText(period: { from: string; to: string }): string {
  const last = addDays(period.to, -1);
  return last <= period.from ? dayText(period.from) : `${dayText(period.from)} to ${dayText(last)}`;
}

const HELP = {
  mrr: "Monthly recurring revenue: what your active subscriptions bring in each month, without VAT. Yearly and weekly subscriptions are spread to a month.",
  arr: "Annual recurring revenue: twelve months of MRR. It is today's MRR times 12, not a forecast.",
  subscribers: "Subscriptions that are active or in failed payment today. A shopper with two subscriptions counts twice.",
  atRisk: "The monthly value of subscriptions whose last payment failed and has not been paid yet. A snapshot of today.",
  churn: "Churn rate: the share of the subscriptions that were active when the period began that were cancelled during it.",
  revenueChurn: "Revenue churn: the monthly value lost to cancellations as a share of MRR at the start of the period.",
  duration: "How long cancelled subscriptions lasted, from the day they began to the day they ended.",
  renewalRevenue: "What renewals brought in during the period: paid orders from a subscription other than the one it began with, without VAT.",
  firstOrders: "The paid order a subscription began with, without VAT. It is kept apart from renewals so a growing store does not look like a loyal one.",
  aov: "Average value of a paid subscription order in the period, first orders and renewals together, without VAT.",
};

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

/** MRR, ARR, subscribers and the MRR at risk: "how much recurring revenue do we have right now?". */
export function headlineCards({ base, currency, locale, report: r }: SubscriptionsViewProps): KpiCardProps[] {
  const money = safeMoney(currency, locale);
  const none = r.active.count === 0;
  const trials = r.trialing.count > 0 ? ` ${formatCount(r.trialing.count)} ${plural(r.trialing.count, "is", "are")} still in a free trial.` : "";
  const share = safeRatio(r.pastDue.mrrMinor, r.active.mrrMinor);
  return [
    {
      label: "Monthly recurring revenue (MRR)",
      value: money(r.active.mrrMinor),
      emphasis: true,
      help: HELP.mrr,
      hint: none ? "No active subscriptions today." : `From ${formatCount(r.active.count)} active ${plural(r.active.count, "subscription", "subscriptions")}, as they are today.${trials}`,
    },
    {
      label: "Annual recurring revenue (ARR)",
      value: money(r.active.arrMinor),
      emphasis: true,
      help: HELP.arr,
      hint: "Today's MRR times 12. Not a forecast.",
    },
    {
      label: "Active subscribers",
      value: formatCount(r.active.count),
      help: HELP.subscribers,
      hint:
        r.cancelling.count > 0
          ? `${formatCount(r.cancelling.count)} ${plural(r.cancelling.count, "is", "are")} set to end (${money(r.cancelling.mrrMinor)} a month).`
          : r.paused.count > 0
            ? `${formatCount(r.paused.count)} paused, not counted here.`
            : "Active and in failed payment, today.",
    },
    {
      label: "MRR at risk (failed payments)",
      value: money(r.pastDue.mrrMinor),
      help: HELP.atRisk,
      hint:
        r.pastDue.count === 0
          ? "No subscription is in failed payment today."
          : `${formatCount(r.pastDue.count)} ${plural(r.pastDue.count, "subscription", "subscriptions")}${share === null ? "" : `, ${formatPercent(share)} of MRR`}. A snapshot of today.`,
      ...(r.pastDue.count > 0 ? { href: `${base}/subscriptions` } : {}),
    },
  ];
}

/** Churn, revenue churn, how long subscriptions last and what is already set to end. */
export function churnCards({ base, currency, locale, report: r }: SubscriptionsViewProps): KpiCardProps[] {
  const money = safeMoney(currency, locale);
  const noBase = { text: "No subscription was active when this period began, so there is nothing to compare the cancellations with." };
  const low = r.churn.lowVolume && r.activeAtStart.count > 0 ? ` Only ${formatCount(r.activeAtStart.count)} ${plural(r.activeAtStart.count, "subscription was", "subscriptions were")} active at the start, so one cancellation moves this a lot.` : "";

  const churn: KpiCardProps =
    r.churn.rate === null
      ? { label: "Churn rate", value: null, state: "missing", missing: noBase, help: HELP.churn }
      : {
          label: "Churn rate",
          value: formatPercent(r.churn.rate),
          help: HELP.churn,
          good: "down",
          hint: `${formatCount(r.cancelled.count)} cancelled out of ${formatCount(r.activeAtStart.count)} active at the start.${low}`,
        };
  const revenueChurn: KpiCardProps =
    r.churn.revenueRate === null
      ? { label: "Revenue churn", value: null, state: "missing", missing: noBase, help: HELP.revenueChurn }
      : {
          label: "Revenue churn",
          value: formatPercent(r.churn.revenueRate),
          help: HELP.revenueChurn,
          good: "down",
          hint: `${money(r.cancelled.mrrMinor)} a month lost, out of ${money(r.activeAtStart.mrrMinor)} at the start.${low}`,
        };

  const days = r.duration.avgDaysInPeriod ?? r.duration.avgDaysTotal;
  const durationOf = r.duration.avgDaysInPeriod !== null ? r.duration.endedInPeriod : r.duration.endedTotal;
  const duration: KpiCardProps =
    days === null
      ? { label: "Average subscription length", value: null, state: "missing", missing: { text: "No subscription has ended yet, so there is no length to average." }, help: HELP.duration }
      : {
          label: "Average subscription length",
          value: durationText(days),
          help: HELP.duration,
          hint:
            r.duration.avgDaysInPeriod !== null
              ? `Of ${formatCount(durationOf)} ${plural(durationOf, "subscription", "subscriptions")} that ended in this period.${r.duration.avgDaysTotal !== null ? ` Over all time: ${durationText(r.duration.avgDaysTotal)}, from ${formatCount(r.duration.endedTotal)}.` : ""}`
              : `Over all time, from ${formatCount(durationOf)} ended ${plural(durationOf, "subscription", "subscriptions")}. None ended in this period.`,
        };

  const leaving: KpiCardProps = {
    label: "Already set to end",
    value: money(r.cancelling.mrrMinor),
    help: "Active subscriptions that are already set to end, at the end of the period they have paid for or at the end of their commitment. This MRR will leave without anyone cancelling again.",
    hint:
      r.cancelling.count === 0
        ? "No active subscription is set to end."
        : `${formatCount(r.cancelling.count)} ${plural(r.cancelling.count, "subscription", "subscriptions")}, still in the MRR today.`,
    ...(r.cancelling.count > 0 ? { href: `${base}/subscriptions` } : {}),
  };
  return [churn, revenueChurn, duration, leaving];
}

/** Renewal revenue, subscription order value, first orders: "what did subscriptions earn in this period?". */
export function renewalCards({ currency, locale, report: r }: SubscriptionsViewProps): KpiCardProps[] {
  const money = safeMoney(currency, locale);
  const orders = r.renewals.orders + r.firstOrders.orders;
  const noOrders = { text: "No subscription order was paid in this period." };
  return [
    r.renewals.orders === 0
      ? { label: "Renewal revenue", value: null, state: "missing", missing: { text: "No renewal was paid in this period." }, help: HELP.renewalRevenue }
      : {
          label: "Renewal revenue",
          value: money(r.renewals.revenueMinor),
          emphasis: true,
          help: HELP.renewalRevenue,
          hint: `From ${formatCount(r.renewals.orders)} paid ${plural(r.renewals.orders, "renewal", "renewals")}${r.renewals.aovMinor === null ? "" : `, ${money(r.renewals.aovMinor)} each`}.`,
        },
    r.firstOrders.orders === 0
      ? { label: "First orders of new subscriptions", value: null, state: "missing", missing: { text: "No subscription began with a paid order in this period." }, help: HELP.firstOrders }
      : {
          label: "First orders of new subscriptions",
          value: money(r.firstOrders.revenueMinor),
          help: HELP.firstOrders,
          hint: `From ${formatCount(r.firstOrders.orders)} paid ${plural(r.firstOrders.orders, "first order", "first orders")}. Not counted as renewals.`,
        },
    r.aovMinor === null || orders === 0
      ? { label: "Average subscription order", value: null, state: "missing", missing: noOrders, help: HELP.aov }
      : { label: "Average subscription order", value: money(r.aovMinor), help: HELP.aov, hint: `Over ${formatCount(orders)} paid ${plural(orders, "order", "orders")}, first orders and renewals together.` },
  ];
}

// ---------------------------------------------------------------------------
// The MRR bridge
// ---------------------------------------------------------------------------

export type BridgeRow = {
  key: "start" | "new" | "expansion" | "contraction" | "reactivation" | "churned" | "other" | "end";
  label: string;
  /** Null: not tracked, shown as a dash and a reason, never as 0. */
  amountMinor: number | null;
  /** A short line under the label. */
  detail: string;
  subtotal?: boolean;
};

/** The bridge from MRR at the start of the period to MRR at its end, one row for each step, the untracked ones included. */
export function bridgeRows(report: SubscriptionsReport): BridgeRow[] {
  const m = report.movements;
  const why = (key: "expansion" | "contraction" | "reactivation") => report.notTracked.find((n) => n.key === key)?.why ?? "Not tracked.";
  const endsNow = report.activeAtEnd.basis === "now";
  const count = (n: number, one: string, many: string) => `${formatCount(n)} ${plural(n, one, many)}`;
  return [
    { key: "start", label: "MRR at the start", amountMinor: m.start, detail: count(report.activeAtStart.count, "subscription", "subscriptions") + " active", subtotal: true },
    { key: "new", label: "New subscriptions", amountMinor: m.new, detail: count(report.new.count, "subscription began", "subscriptions began") },
    { key: "expansion", label: "Expansion", amountMinor: m.expansion, detail: why("expansion") },
    { key: "contraction", label: "Contraction", amountMinor: m.contraction, detail: why("contraction") },
    { key: "reactivation", label: "Reactivation", amountMinor: m.reactivation, detail: why("reactivation") },
    { key: "churned", label: "Churned", amountMinor: -m.churned, detail: count(report.cancelled.count, "subscription ended", "subscriptions ended") },
    {
      key: "other",
      label: "Other changes",
      amountMinor: m.otherMinor,
      detail: "Paused or failed-payment subscriptions, price changes and rounding, which cannot be told apart.",
    },
    {
      key: "end",
      label: endsNow ? "MRR today" : "MRR at the end",
      amountMinor: m.end,
      detail: `${count(report.activeAtEnd.count, "subscription", "subscriptions")} active${endsNow ? ", as they are today" : ""}`,
      subtotal: true,
    },
  ];
}

/** The growth of MRR over the period in a sentence. */
export function growthLine(report: SubscriptionsReport, money: (minor: number | null | undefined) => string): string {
  const m = report.movements;
  if (m.start <= 0 && m.end <= 0) return "There was no recurring revenue at the start or the end of this period.";
  if (m.growth === null) return `There was no recurring revenue when this period began, so there is no growth rate. MRR is ${money(m.end)} at the end.`;
  const change = m.end - m.start;
  if (change === 0) return `MRR did not change over this period: ${money(m.end)}.`;
  return `MRR ${change > 0 ? "grew" : "fell"} by ${money(Math.abs(change))} (${formatSigned(m.growth)}) over this period, from ${money(m.start)} to ${money(m.end)}.`;
}

function BridgeTable({ report, money }: { report: SubscriptionsReport; money: (minor: number | null | undefined) => string }) {
  const rows = bridgeRows(report);
  return (
    <>
    <div className="relative overflow-x-auto rounded-lg border border-border bg-background">
      <table data-export-id="subscriptions.bridge" className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">{`How monthly recurring revenue moved over ${periodText(report.period)}, one row for each step`}</caption>
        <thead>
          <tr>
            <th scope="col" className="whitespace-nowrap border-b border-border px-3 py-2 text-left">
              Step
            </th>
            <th scope="col" className="whitespace-nowrap border-b border-border px-3 py-2 text-right">
              Monthly amount
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-step={row.key} className={`border-b border-border last:border-b-0 ${row.subtotal ? "bg-surface font-semibold" : ""}`}>
              <th scope="row" className="px-3 py-2 text-left align-top font-[inherit]">
                <span className="block">{row.label}</span>
                <span className="mt-0.5 block max-w-md text-xs font-normal text-muted">{row.detail}</span>
              </th>
              <td className="px-3 py-2 text-right align-top tabular-nums">
                {row.amountMinor === null ? (
                  <span className="text-muted" title="Not tracked">
                    <span aria-hidden="true">{NO_FIGURE}</span>
                    <span className="sr-only">Not tracked</span>
                  </span>
                ) : row.subtotal ? (
                  money(row.amountMinor)
                ) : (
                  signedMoney(money, row.amountMinor)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="mt-1 flex justify-end empty:hidden">
      <ExportButton exportId="subscriptions.bridge" />
    </div>
    </>
  );
}

/** The bridge as bars: the start, what was won, what was lost and the end. */
export function bridgeBars(report: SubscriptionsReport, money: (minor: number | null | undefined) => string): BarRow[] {
  const m = report.movements;
  const rows: BarRow[] = [
    { key: "start", label: "MRR at the start", value: m.start, valueText: money(m.start), colorIndex: 0 },
    { key: "new", label: "New subscriptions", value: m.new, valueText: signedMoney(money, m.new), colorIndex: 1 },
    { key: "churned", label: "Churned", value: -m.churned, valueText: signedMoney(money, -m.churned) },
  ];
  if (m.otherMinor !== 0) rows.push({ key: "other", label: "Other changes", value: m.otherMinor, valueText: signedMoney(money, m.otherMinor), colorIndex: 3 });
  rows.push({ key: "end", label: report.activeAtEnd.basis === "now" ? "MRR today" : "MRR at the end", value: m.end, valueText: money(m.end), colorIndex: 0 });
  return rows;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

function EmptyStore({ base }: { base: string }) {
  return (
    <AnalyticsSection id="empty" title="No subscriptions yet" description="Subscriptions are products a shopper buys again on a schedule.">
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        <p className="mx-auto max-w-prose">
          This store has no subscriptions, so there is no recurring revenue to show. Once a shopper subscribes, this page shows monthly recurring revenue (MRR), how it moves, who cancels and which payments fail.
        </p>
        <p className="mt-3 space-x-4">
          <Link href={`${base}/products`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
            Add a purchase option to a product
          </Link>
          <Link href={`${base}/subscriptions`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
            Open subscriptions
          </Link>
        </p>
      </div>
    </AnalyticsSection>
  );
}

export function SubscriptionsView(props: SubscriptionsViewProps) {
  const { base, currency, locale, report } = props;
  if (hasNoSubscriptions(report)) return <EmptyStore base={base} />;

  const money = safeMoney(currency, locale);
  const m = report.movements;
  const period = periodText(report.period);
  const endsNow = report.activeAtEnd.basis === "now";

  return (
    <>
      <AnalyticsSection
        id="now"
        title="Recurring revenue today"
        description="How much comes in every month from subscriptions that are running now. These figures are today's, whatever period is picked."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {headlineCards(props).map((c) => (
            <KpiCard key={c.label} {...c} />
          ))}
        </div>
        {report.pastDue.count > 0 ? (
          <Note tone="warning" title="Failed payments are a snapshot">
            {`${formatCount(report.pastDue.count)} ${plural(report.pastDue.count, "subscription is", "subscriptions are")} in failed payment today, worth ${money(report.pastDue.mrrMinor)} a month. Kaizen keeps no history of failed payments, so there is no trend to show. `}
            <Link href={`${base}/subscriptions`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
              Open subscriptions
            </Link>
          </Note>
        ) : null}
        {report.notes.length > 0 ? (
          <div className="space-y-2">
            {report.notes.map((n) => (
              <Note key={n} tone="warning">
                {n}
              </Note>
            ))}
          </div>
        ) : null}
      </AnalyticsSection>

      <AnalyticsSection
        id="movement"
        title="How MRR moved"
        description={`From the start of the period to ${endsNow ? "today" : "its end"}: what was won, what was lost, and what Kaizen cannot see. ${period}.`}
      >
        <p className="max-w-prose text-sm">{growthLine(report, money)}</p>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <BridgeTable report={report} money={money} />
          <div className="min-w-0 rounded-lg border border-border bg-background p-4">
            <h3 className="mb-3 text-sm font-semibold">MRR, start to end</h3>
            <HorizontalBars label="MRR at the start, what was added and lost, and MRR at the end" rows={bridgeBars(report, money)} exportId="subscriptions.mrr_bridge" />
          </div>
        </div>
        <Note title="Expansion, contraction and reactivation are not tracked">
          {`Kaizen keeps a subscription's price, quantity and status only as they are today. A price increase cannot be told from a new subscription, a decrease cannot be seen, and a returning subscriber cannot be told from a new one. These rows show a dash, not 0. Their effect, if any, is inside "Other changes"${m.otherMinor === 0 ? ", which is 0 here" : ""}.`}
        </Note>
      </AnalyticsSection>

      <AnalyticsSection
        id="churn"
        title="Who left"
        description="How many subscriptions were cancelled, how much monthly revenue went with them, and how long subscriptions last."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {churnCards(props).map((c) => (
            <KpiCard key={c.label} {...c} />
          ))}
        </div>
      </AnalyticsSection>

      <AnalyticsSection
        id="renewals"
        title="What subscriptions earned"
        description={`Paid subscription orders in ${period}, without VAT. A renewal is a paid order of a subscription other than the one it began with.`}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {renewalCards(props).map((c) => (
            <KpiCard key={c.label} {...c} />
          ))}
        </div>
      </AnalyticsSection>

      <AnalyticsSection id="not-tracked" title="What this page cannot see" description="Left out on purpose, so a missing figure is never mistaken for a zero.">
        <ul className="space-y-1.5 text-sm">
          {report.notTracked.map((n) => (
            <li key={n.key}>
              <span className="font-medium">{n.label}: </span>
              <span className="text-muted">{n.why}</span>
            </li>
          ))}
        </ul>
      </AnalyticsSection>
    </>
  );
}
