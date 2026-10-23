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
import { CARD_CLASS } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { reportsEn, type ReportsMessages } from "@/lib/admin-messages/reports.en";

/** The words of this view (D312 A9), English unless given. */
export type SubscriptionsWords = ReportsMessages["subscriptions"];

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
  /** The words, in the account's language (D312 A9); English unless given. */
  words?: SubscriptionsWords;
};

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

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
export function durationText(days: number | null | undefined, w: SubscriptionsWords = reportsEn.subscriptions): string {
  if (!finite(days) || days < 0) return NO_FIGURE;
  if (days < 1) return w.lessThanDay;
  const whole = Math.round(days);
  if (whole < 60) return countWords(whole, w.days, { n: formatCount(whole) });
  const months = Math.round(whole / 30.44);
  if (months < 24) return fillWords(w.aboutMonths, { n: formatCount(months) });
  return fillWords(w.aboutYears, { n: formatDecimal(whole / 365.25, 1) });
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
export function periodText(period: { from: string; to: string }, w: SubscriptionsWords = reportsEn.subscriptions): string {
  const last = addDays(period.to, -1);
  return last <= period.from ? dayText(period.from) : fillWords(w.periodRange, { from: dayText(period.from), to: dayText(last) });
}


// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

/** MRR, ARR, subscribers and the MRR at risk: "how much recurring revenue do we have right now?". */
export function headlineCards({ base, currency, locale, report: r, words: w = reportsEn.subscriptions }: SubscriptionsViewProps): KpiCardProps[] {
  const money = safeMoney(currency, locale);
  const HELP = w.help;
  const none = r.active.count === 0;
  const trials = r.trialing.count > 0 ? countWords(r.trialing.count, w.trials, { n: formatCount(r.trialing.count) }) : "";
  const share = safeRatio(r.pastDue.mrrMinor, r.active.mrrMinor);
  return [
    {
      label: w.mrr,
      value: money(r.active.mrrMinor),
      emphasis: true,
      help: HELP.mrr,
      hint: none ? w.noActive : countWords(r.active.count, w.mrrHint, { n: formatCount(r.active.count), trials }),
    },
    {
      label: w.arr,
      value: money(r.active.arrMinor),
      emphasis: true,
      help: HELP.arr,
      hint: w.arrHint,
    },
    {
      label: w.subscribers,
      value: formatCount(r.active.count),
      help: HELP.subscribers,
      hint:
        r.cancelling.count > 0
          ? countWords(r.cancelling.count, w.cancellingHint, { n: formatCount(r.cancelling.count), amount: money(r.cancelling.mrrMinor) })
          : r.paused.count > 0
            ? fillWords(w.pausedHint, { n: formatCount(r.paused.count) })
            : w.subscribersHint,
    },
    {
      label: w.atRisk,
      value: money(r.pastDue.mrrMinor),
      help: HELP.atRisk,
      hint:
        r.pastDue.count === 0
          ? w.noneFailed
          : countWords(r.pastDue.count, w.atRiskHint, { n: formatCount(r.pastDue.count), share: share === null ? "" : fillWords(w.ofMrr, { pct: formatPercent(share) }) }),
      ...(r.pastDue.count > 0 ? { href: `${base}/subscriptions` } : {}),
    },
  ];
}

/** Churn, revenue churn, how long subscriptions last and what is already set to end. */
export function churnCards({ base, currency, locale, report: r, words: w = reportsEn.subscriptions }: SubscriptionsViewProps): KpiCardProps[] {
  const money = safeMoney(currency, locale);
  const HELP = w.help;
  const noBase = { text: w.noBase };
  const low = r.churn.lowVolume && r.activeAtStart.count > 0 ? countWords(r.activeAtStart.count, w.lowVolume, { n: formatCount(r.activeAtStart.count) }) : "";

  const churn: KpiCardProps =
    r.churn.rate === null
      ? { label: w.churnRate, value: null, state: "missing", missing: noBase, help: HELP.churn }
      : {
          label: w.churnRate,
          value: formatPercent(r.churn.rate),
          help: HELP.churn,
          good: "down",
          hint: fillWords(w.churnHint, { cancelled: formatCount(r.cancelled.count), active: formatCount(r.activeAtStart.count), low }),
        };
  const revenueChurn: KpiCardProps =
    r.churn.revenueRate === null
      ? { label: w.revenueChurn, value: null, state: "missing", missing: noBase, help: HELP.revenueChurn }
      : {
          label: w.revenueChurn,
          value: formatPercent(r.churn.revenueRate),
          help: HELP.revenueChurn,
          good: "down",
          hint: fillWords(w.revenueChurnHint, { lost: money(r.cancelled.mrrMinor), start: money(r.activeAtStart.mrrMinor), low }),
        };

  const days = r.duration.avgDaysInPeriod ?? r.duration.avgDaysTotal;
  const durationOf = r.duration.avgDaysInPeriod !== null ? r.duration.endedInPeriod : r.duration.endedTotal;
  const duration: KpiCardProps =
    days === null
      ? { label: w.averageLength, value: null, state: "missing", missing: { text: w.noneEnded }, help: HELP.duration }
      : {
          label: w.averageLength,
          value: durationText(days, w),
          help: HELP.duration,
          hint:
            r.duration.avgDaysInPeriod !== null
              ? countWords(durationOf, w.lengthInPeriod, {
                  n: formatCount(durationOf),
                  total: r.duration.avgDaysTotal !== null ? fillWords(w.lengthTotal, { length: durationText(r.duration.avgDaysTotal, w), n: formatCount(r.duration.endedTotal) }) : "",
                })
              : countWords(durationOf, w.lengthAllTime, { n: formatCount(durationOf) }),
        };

  const leaving: KpiCardProps = {
    label: w.setToEnd,
    value: money(r.cancelling.mrrMinor),
    help: HELP.leaving,
    hint: r.cancelling.count === 0 ? w.noneSetToEnd : countWords(r.cancelling.count, w.setToEndHint, { n: formatCount(r.cancelling.count) }),
    ...(r.cancelling.count > 0 ? { href: `${base}/subscriptions` } : {}),
  };
  return [churn, revenueChurn, duration, leaving];
}

/** Renewal revenue, subscription order value, first orders: "what did subscriptions earn in this period?". */
export function renewalCards({ currency, locale, report: r, words: w = reportsEn.subscriptions }: SubscriptionsViewProps): KpiCardProps[] {
  const money = safeMoney(currency, locale);
  const HELP = w.help;
  const orders = r.renewals.orders + r.firstOrders.orders;
  const noOrders = { text: w.noOrders };
  return [
    r.renewals.orders === 0
      ? { label: w.renewalRevenue, value: null, state: "missing", missing: { text: w.noRenewal }, help: HELP.renewalRevenue }
      : {
          label: w.renewalRevenue,
          value: money(r.renewals.revenueMinor),
          emphasis: true,
          help: HELP.renewalRevenue,
          hint: countWords(r.renewals.orders, w.renewalHint, {
            n: formatCount(r.renewals.orders),
            each: r.renewals.aovMinor === null ? "" : fillWords(w.each, { amount: money(r.renewals.aovMinor) }),
          }),
        },
    r.firstOrders.orders === 0
      ? { label: w.firstOrders, value: null, state: "missing", missing: { text: w.noFirstOrder }, help: HELP.firstOrders }
      : {
          label: w.firstOrders,
          value: money(r.firstOrders.revenueMinor),
          help: HELP.firstOrders,
          hint: countWords(r.firstOrders.orders, w.firstOrdersHint, { n: formatCount(r.firstOrders.orders) }),
        },
    r.aovMinor === null || orders === 0
      ? { label: w.averageOrder, value: null, state: "missing", missing: noOrders, help: HELP.aov }
      : { label: w.averageOrder, value: money(r.aovMinor), help: HELP.aov, hint: countWords(orders, w.averageOrderHint, { n: formatCount(orders) }) },
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
export function bridgeRows(report: SubscriptionsReport, w: SubscriptionsWords = reportsEn.subscriptions): BridgeRow[] {
  const m = report.movements;
  const b = w.bridge;
  const why = (key: "expansion" | "contraction" | "reactivation") =>
    w.notTrackedRows[key]?.why ?? report.notTracked.find((n) => n.key === key)?.why ?? w.notTracked;
  const endsNow = report.activeAtEnd.basis === "now";
  const count = (n: number, words: { one: string; many: string }) => countWords(n, words, { n: formatCount(n) });
  return [
    { key: "start", label: b.start, amountMinor: m.start, detail: count(report.activeAtStart.count, w.activeCount), subtotal: true },
    { key: "new", label: b.new, amountMinor: m.new, detail: count(report.new.count, w.began) },
    { key: "expansion", label: b.expansion, amountMinor: m.expansion, detail: why("expansion") },
    { key: "contraction", label: b.contraction, amountMinor: m.contraction, detail: why("contraction") },
    { key: "reactivation", label: b.reactivation, amountMinor: m.reactivation, detail: why("reactivation") },
    { key: "churned", label: b.churned, amountMinor: -m.churned, detail: count(report.cancelled.count, w.ended) },
    { key: "other", label: b.other, amountMinor: m.otherMinor, detail: w.otherDetail },
    {
      key: "end",
      label: endsNow ? b.today : b.end,
      amountMinor: m.end,
      detail: `${count(report.activeAtEnd.count, w.activeCount)}${endsNow ? w.asToday : ""}`,
      subtotal: true,
    },
  ];
}

/** The growth of MRR over the period in a sentence. */
export function growthLine(report: SubscriptionsReport, money: (minor: number | null | undefined) => string, w: SubscriptionsWords = reportsEn.subscriptions): string {
  const m = report.movements;
  if (m.start <= 0 && m.end <= 0) return w.growthNone;
  if (m.growth === null) return fillWords(w.growthNoStart, { amount: money(m.end) });
  const change = m.end - m.start;
  if (change === 0) return fillWords(w.growthSame, { amount: money(m.end) });
  return fillWords(change > 0 ? w.grew : w.fell, { amount: money(Math.abs(change)), pct: formatSigned(m.growth), start: money(m.start), end: money(m.end) });
}

function BridgeTable({ report, money, w }: { report: SubscriptionsReport; money: (minor: number | null | undefined) => string; w: SubscriptionsWords }) {
  const rows = bridgeRows(report, w);
  return (
    <>
    <div className={`relative overflow-x-auto ${CARD_CLASS}`}>
      <table data-export-id="subscriptions.bridge" className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">{fillWords(w.bridgeCaption, { period: periodText(report.period, w) })}</caption>
        <thead>
          <tr>
            <th scope="col" className="whitespace-nowrap border-b border-line px-3 py-2 text-left">
              {w.step}
            </th>
            <th scope="col" className="whitespace-nowrap border-b border-line px-3 py-2 text-right">
              {w.monthlyAmount}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-step={row.key} className={`border-b border-line last:border-b-0 ${row.subtotal ? "bg-sunken font-medium" : ""}`}>
              <th scope="row" className="px-3 py-2 text-left align-top font-[inherit]">
                <span className="block">{row.label}</span>
                <span className="mt-0.5 block max-w-md text-xs font-normal text-muted">{row.detail}</span>
              </th>
              <td className="px-3 py-2 text-right align-top tabular-nums">
                {row.amountMinor === null ? (
                  <span className="text-muted" title={w.notTrackedShort}>
                    <span aria-hidden="true">{NO_FIGURE}</span>
                    <span className="sr-only">{w.notTrackedShort}</span>
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
export function bridgeBars(report: SubscriptionsReport, money: (minor: number | null | undefined) => string, w: SubscriptionsWords = reportsEn.subscriptions): BarRow[] {
  const m = report.movements;
  const b = w.bridge;
  const rows: BarRow[] = [
    { key: "start", label: b.start, value: m.start, valueText: money(m.start), colorIndex: 0 },
    { key: "new", label: b.new, value: m.new, valueText: signedMoney(money, m.new), colorIndex: 1 },
    { key: "churned", label: b.churned, value: -m.churned, valueText: signedMoney(money, -m.churned) },
  ];
  if (m.otherMinor !== 0) rows.push({ key: "other", label: b.other, value: m.otherMinor, valueText: signedMoney(money, m.otherMinor), colorIndex: 3 });
  rows.push({ key: "end", label: report.activeAtEnd.basis === "now" ? b.today : b.end, value: m.end, valueText: money(m.end), colorIndex: 0 });
  return rows;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

function EmptyStore({ base, w }: { base: string; w: SubscriptionsWords }) {
  return (
    <AnalyticsSection id="empty" title={w.emptyTitle} description={w.emptyDescription}>
      <div className="rounded-panel border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
        <p className="mx-auto max-w-prose">{w.emptyText}</p>
        <p className="mt-3 space-x-4">
          <Link href={`${base}/products`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
            {w.addOption}
          </Link>
          <Link href={`${base}/subscriptions`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
            {w.openSubscriptions}
          </Link>
        </p>
      </div>
    </AnalyticsSection>
  );
}

export function SubscriptionsView(props: SubscriptionsViewProps) {
  const { base, currency, locale, report } = props;
  const w = props.words ?? reportsEn.subscriptions;
  if (hasNoSubscriptions(report)) return <EmptyStore base={base} w={w} />;

  const money = safeMoney(currency, locale);
  const m = report.movements;
  const period = periodText(report.period, w);
  const endsNow = report.activeAtEnd.basis === "now";

  return (
    <>
      <AnalyticsSection
        id="now"
        title={w.nowTitle}
        description={w.nowDescription}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {headlineCards(props).map((c) => (
            <KpiCard key={c.label} {...c} />
          ))}
        </div>
        {report.pastDue.count > 0 ? (
          <Note tone="warning" title={w.failedTitle}>
            {countWords(report.pastDue.count, w.failedText, { n: formatCount(report.pastDue.count), amount: money(report.pastDue.mrrMinor) })}
            <Link href={`${base}/subscriptions`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
              {w.openSubscriptions}
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
        title={w.movementTitle}
        description={fillWords(endsNow ? w.movementToday : w.movementEnd, { period })}
      >
        <p className="max-w-prose text-sm">{growthLine(report, money, w)}</p>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <BridgeTable report={report} money={money} w={w} />
          <div className={`min-w-0 p-4 ${CARD_CLASS}`}>
            <h3 className="mb-3 text-body-strong text-ink">{w.barsTitle}</h3>
            <HorizontalBars label={w.barsLabel} rows={bridgeBars(report, money, w)} exportId="subscriptions.mrr_bridge" />
          </div>
        </div>
        <Note title={w.notTrackedTitle}>{fillWords(w.notTrackedText, { zero: m.otherMinor === 0 ? w.otherZero : "" })}</Note>
      </AnalyticsSection>

      <AnalyticsSection
        id="churn"
        title={w.churnTitle}
        description={w.churnDescription}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {churnCards(props).map((c) => (
            <KpiCard key={c.label} {...c} />
          ))}
        </div>
      </AnalyticsSection>

      <AnalyticsSection
        id="renewals"
        title={w.renewalsTitle}
        description={fillWords(w.renewalsDescription, { period })}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {renewalCards(props).map((c) => (
            <KpiCard key={c.label} {...c} />
          ))}
        </div>
      </AnalyticsSection>

      <AnalyticsSection id="not-tracked" title={w.cannotSeeTitle} description={w.cannotSeeDescription}>
        <ul className="space-y-1.5 text-sm">
          {report.notTracked.map((n) => (
            <li key={n.key}>
              <span className="font-medium">{w.notTrackedRows[n.key]?.label ?? n.label}: </span>
              <span className="text-muted">{w.notTrackedRows[n.key]?.why ?? n.why}</span>
            </li>
          ))}
        </ul>
      </AnalyticsSection>
    </>
  );
}
