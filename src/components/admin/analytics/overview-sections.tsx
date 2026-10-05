import Link from "next/link";
import type { ReactNode } from "react";

import { formatCount, formatPercent, MINUS, NO_FIGURE } from "@/lib/analytics-core";
import { COVERAGE_WARN, costsKnown, estimateText, formatKpi, KPI_CARDS, kpiChange, kpiMissing, kpiValue, type KpiCard as KpiCardDef } from "@/lib/analytics-kpi";
import { periodHref, type AnalyticsParams } from "@/lib/analytics-period";
import type { ChannelRow } from "@/lib/analytics-traffic";
import type { OverviewHead, PeriodFigures, TopProducts } from "@/server/analytics-totals";
import type { MarketingReport, TrafficReport } from "@/server/analytics-traffic-data";

import { Funnel, HorizontalBars, LineChart, Meter, type BarRow } from "./charts";
import { DataTable, StatusPill, type Column, type DeltaView } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { AnalyticsSection, ChartCard, Note } from "./section";
import { dayText, factorRows, forecastLines, formatTimes, moneyLines, moneySignals, moneyWriter, noSales, plural, targetLines, type OverviewDiagnosis, type OverviewForecast, type OverviewTarget } from "./overview-text";

/**
 * The Overview's sections (D152): each one is drawn from the plain props it is handed and nothing else (no data access), so it can be
 * rendered on fixture data, and so the page can load each section's data on its own and stream it in (`overview-streams.tsx`). The
 * page's order is `OverviewLayout`'s; `OverviewView` fills it from complete data. A figure that cannot be known is never drawn as
 * zero: the card or panel says what is missing and where to add it.
 */

/** What every section needs to write amounts and make links. */
export type OverviewFrame = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  /** The store's first market's locale, for writing amounts. */
  locale: string;
  /** Only an owner can open Analytics settings. */
  isOwner: boolean;
  /** The period and comparison the page shows; a drill-down opens on them. */
  params: AnalyticsParams;
};

const linkClass = "font-medium text-(--brand-text) underline-offset-2 hover:underline";

/** A drill-down opens on the period and comparison this page shows (docs/analytics.md: they are kept in the address). */
const drillTo = (frame: OverviewFrame, path: string) => periodHref(`${frame.base}${path}`, frame.params);

/** The four figures that answer "are we making money?" and are drawn larger. */
const PRIMARY = new Set(["revenue", "netRevenue", "orders", "conversion"]);

// ---------------------------------------------------------------------------
// The page's order
// ---------------------------------------------------------------------------

/** Where each part of the Overview goes; a slot is whatever fills it (the part itself, or a `<Suspense>` around it while it loads). */
export type OverviewSlots = {
  alerts: ReactNode;
  answer: ReactNode;
  why: ReactNode;
  charts: ReactNode;
  funnel: ReactNode;
  products: ReactNode;
  channels: ReactNode;
  target: ReactNode;
  forecast: ReactNode;
};

/** The Overview's body in its order: what needs you, are we making money, why did sales change, the charts, the funnel, the best sellers, the channels, the target and the forecast. */
export function OverviewLayout({ currency, slots }: { currency: string; slots: OverviewSlots }) {
  return (
    <div className="flex flex-col gap-8">
      {slots.alerts}
      {slots.answer}
      {slots.why}
      {slots.charts}
      {slots.funnel}
      {slots.products}
      {slots.channels}
      {slots.target}
      {slots.forecast}
      <p className="text-xs text-muted">All amounts are in {currency} without VAT. Refunds made only in Stripe&apos;s dashboard are not counted. History is valued at today&apos;s exchange rates.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// While a section loads, and when it cannot
// ---------------------------------------------------------------------------

const pulse = "animate-pulse rounded-lg bg-background";

/** The sizes a section's placeholder keeps, about those of the section it stands in for, so little moves when it arrives. */
const SKELETON_HEIGHT = { alerts: "h-32", why: "h-64", funnel: "h-72", products: "h-64", channels: "h-56", target: "h-40", forecast: "h-36" } as const;

export type OverviewSkeletonKind = keyof typeof SKELETON_HEIGHT;

/** What stands in for a section while its data is read: a heading and a body of the section's usual height, in the admin's placeholder style. */
export function SectionSkeleton({ kind, label }: { kind: OverviewSkeletonKind; label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-skeleton={kind} className="space-y-3">
      <span className="sr-only">Loading {label}…</span>
      <div aria-hidden="true" className={`${pulse} h-6 w-56`} />
      <div aria-hidden="true" className={`${pulse} ${SKELETON_HEIGHT[kind]}`} />
    </div>
  );
}

/** What a section says when its data could not be read: calm, and the rest of the page is as it was. */
export function SectionUnavailable({ id, title }: { id: string; title: string }) {
  return (
    <AnalyticsSection id={id} title={title}>
      <Note title="This part could not be loaded.">Reload the page to try again. The rest of the page is not affected.</Note>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** What a figure or panel that needs visit counting says: what it gives, that it sets no cookie, and (for an owner) where to switch it on. */
function VisitCountingOff({ base, isOwner, gives }: { base: string; isOwner: boolean; gives: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border px-4 py-5 text-sm">
      <p className="font-medium">Turn on visit counting</p>
      <p className="text-muted">
        {gives} Visit counting sets no cookies and needs no consent banner. It only counts from the day it is switched on.
      </p>
      {isOwner ? (
        <Link href={`${base}/analytics/settings`} className={linkClass}>
          Switch it on in Analytics settings
        </Link>
      ) : (
        <p className="text-muted">An owner of the store can switch it on in Analytics settings.</p>
      )}
    </div>
  );
}

function Stat({ label, caption, value, reason }: { label: string; caption: string; value: string | null; reason: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-3">
      <dt className="text-xs font-medium text-muted" title={caption}>
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value ?? NO_FIGURE}</dd>
      <p className="mt-0.5 text-xs text-muted">{value === null ? reason : caption}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Are we making money? (the first screen: the figures and cards, with what they are not)
// ---------------------------------------------------------------------------

/** The sentence and cards that answer "are we making money?", and under them what the figures are and are not. */
export function AnswerSection({ frame, data, visitCounting }: { frame: OverviewFrame; data: OverviewHead; visitCounting: boolean }) {
  const { base, currency, locale, isOwner } = frame;
  const money = moneyWriter(currency, locale);
  const settingsHref = `${base}/analytics/settings`;
  const { current, params } = data;
  const compare = params.compare.mode;
  const { sales, coverage, costsMissing } = moneySignals(data);

  // ---- notes about what the figures are and are not ----
  const notes: ReactNode[] = [...data.notes];
  if (current.visitsFrom) notes.push(`Visits have been counted since ${dayText(current.visitsFrom)}, so conversion and the per-visit figures cover only the days from then.`);
  if (sales && coverage !== null && coverage > 0 && coverage < COVERAGE_WARN) {
    notes.push(
      costsKnown(coverage)
        ? `Profit figures are ${estimateText(coverage)}: the rest sold without a product cost entered, so its cost of goods is taken to be in the same proportion. Add the missing costs in the product editor to make them exact.`
        : `Product costs are known for only ${formatPercent(coverage, 0)} of sales, too few to estimate profit from, so it is not shown. Add the missing costs in the product editor.`,
    );
  }
  if (sales && !costsMissing && !data.settings.saved) {
    notes.push(
      isOwner ? (
        <>
          Payment fees, shipping costs and fixed costs are not entered, so they count as nothing and profit may look better than it is.{" "}
          <Link href={settingsHref} className={linkClass}>
            Enter them in Analytics settings
          </Link>
          .
        </>
      ) : (
        "Payment fees, shipping costs and fixed costs are not entered, so they count as nothing and profit may look better than it is. An owner can enter them in Analytics settings."
      ),
    );
  }

  // ---- the cards ----
  const visitsText = (card: KpiCardDef, fallback: string): { text: string; action?: { label: string; href: string } } => {
    if (visitCounting) return { text: "No visits were counted in this period." };
    return isOwner ? { text: card.missingText ?? fallback, action: { label: "Switch on visit counting", href: settingsHref } } : { text: "Visit counting is off. An owner can switch it on in Analytics settings." };
  };
  const cards: (KpiCardProps & { id: string })[] = KPI_CARDS.map((card) => {
    const value = kpiValue(card, current.derived);
    const base0 = { id: card.id, label: card.label, good: card.good, help: card.help, emphasis: PRIMARY.has(card.id) };
    const missing = kpiMissing(card, current.derived);
    const noOrders = !sales && (card.id === "grossProfit" || card.id === "grossMargin");
    if (missing || noOrders) {
      if (noOrders || missing?.kind === "no-data") return { ...base0, value: null, state: "missing" as const, missing: { text: "No orders in this period yet." } };
      if (missing!.kind === "visits") return { ...base0, value: null, state: "missing" as const, missing: visitsText(card, missing!.text) };
      return {
        ...base0,
        value: null,
        state: "missing" as const,
        missing: { text: isOwner ? missing!.text : "Product costs are not entered. An owner can add them.", ...(isOwner ? { action: { label: "Add what your products cost", href: settingsHref } } : {}) },
      };
    }
    const delta = (from: PeriodFigures, needSales: boolean): DeltaView | null => {
      if (needSales && noSales(from)) return null;
      const c = kpiChange(card, value, kpiValue(card, from.derived));
      return c.abs === null ? null : { text: c.text, abs: c.abs, verdict: c.verdict };
    };
    const series = data.sparklines[card.id];
    const profitCard = card.id === "grossProfit" || card.id === "grossMargin";
    const hint = profitCard && coverage !== null && coverage > 0 ? data.costCoverageText : card.id === "conversion" && current.visitsFrom ? `Counted since ${dayText(current.visitsFrom)}` : undefined;
    return {
      ...base0,
      value: formatKpi(card, value, currency, locale),
      href: drillTo(frame, `/analytics/${card.page}`),
      ...(compare === "none" ? {} : { deltaPrevious: delta(data.previous, false), deltaLastYear: delta(data.lastYear, true) }),
      ...(series.length >= 2 ? { series } : {}),
      ...(hint ? { hint } : {}),
    };
  });

  return (
    <>
      <AnalyticsSection id="overview-making-money" title="Are we making money?" description={`${params.period.label}, in ${currency} without VAT. Each figure links to the page that explains it.`}>
        <div className="space-y-1 rounded-lg border border-border bg-surface p-4 text-sm">
          {moneyLines(data, money).map((line, i) => (
            <p key={i} className={i === 0 ? "text-base font-medium" : "text-muted"}>
              {line}
            </p>
          ))}
          {costsMissing && isOwner ? (
            <p>
              <Link href={settingsHref} className={linkClass}>
                Add what your products cost
              </Link>
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(({ id, ...props }) => (
            <KpiCard key={id} {...props} />
          ))}
        </div>
      </AnalyticsSection>

      {/* What the figures above are and are not (costs missing, visits counted only since...): under them, not between the page's title and its answer. */}
      {notes.length > 0 ? (
        <div className="space-y-2">
          {notes.map((n, i) => (
            <Note key={i} tone="warning">
              {n}
            </Note>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Net revenue and contribution profit over time, with the comparison dashed. */
export function ChartsSection({ frame, data }: { frame: OverviewFrame; data: OverviewHead }) {
  const { base, currency, locale, isOwner } = frame;
  const money = moneyWriter(currency, locale);
  const settingsHref = `${base}/analytics/settings`;
  const compare = data.params.compare.mode;
  const { sales, costsMissing } = moneySignals(data);

  const labels = data.series.current.map((p) => p.label);
  const comparison = data.series.comparison;
  const anySales =
    data.series.current.some((p) => p.orders > 0 || p.revenueMinor !== 0 || p.refundsMinor !== 0) || (comparison?.some((p) => p && (p.orders > 0 || p.revenueMinor !== 0 || p.refundsMinor !== 0)) ?? false);
  const previousLabel = compare === "year" ? "Same period last year" : "Previous period";
  const per = data.bucket;

  return (
    <AnalyticsSection id="overview-sales" title="Sales and profit over time" description={`Each point is one ${per}. The dashed line is ${compare === "none" ? "off: no comparison is chosen" : previousLabel.toLowerCase()}.`}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Net revenue" description="Revenue less refunds, without VAT.">
          {anySales ? (
            <LineChart
              label={`Net revenue per ${per}`}
              labels={labels}
              series={[{ key: "net", label: "Net revenue", values: data.series.current.map((pt) => pt.netRevenueMinor), ...(comparison ? { previous: comparison.map((pt) => (pt ? pt.netRevenueMinor : null)) } : {}) }]}
              format={money}
              previousLabel={previousLabel}
              area
              exportId="overview.net_revenue"
              exportLeftOut={{ orders: data.unconverted, currencies: data.missingCurrencies }}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">No sales in this period yet. Net revenue by {per} shows here once orders are paid.</p>
          )}
        </ChartCard>
        {costsMissing ? (
          <ChartCard title="Contribution profit" description="What is left of net revenue after what the sales cost.">
            <div className="space-y-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm">
              <p className="font-medium">Add what your products cost to see profit</p>
              <p className="text-muted">Until costs are entered for enough of your sales, profit would only be revenue under another name, so none is shown.</p>
              {isOwner ? (
                <Link href={settingsHref} className={linkClass}>
                  Open Analytics settings
                </Link>
              ) : (
                <p className="text-muted">An owner of the store can add them.</p>
              )}
            </div>
          </ChartCard>
        ) : (
          <ChartCard
            title="Contribution profit"
            description={sales ? `Net revenue less cost of goods, payment and platform fees, shipping and ad spend, ${data.costCoverageText}. Fees and shipping are estimates from your settings.` : "Net revenue less what the sales cost."}
          >
            {sales ? (
              <LineChart
                label={`Contribution profit per ${per}`}
                labels={labels}
                series={[{ key: "profit", label: "Contribution profit", values: data.series.current.map((pt) => pt.contributionMinor), ...(comparison ? { previous: comparison.map((pt) => (pt ? pt.contributionMinor : null)) } : {}) }]}
                format={money}
                previousLabel={previousLabel}
                area
                exportId="overview.contribution"
                exportLeftOut={{ orders: data.unconverted, currencies: data.missingCurrencies }}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">No sales in this period yet, so there is no profit to show.</p>
            )}
          </ChartCard>
        )}
      </div>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Why did sales change?
// ---------------------------------------------------------------------------

/** Why revenue changed against the period it is compared with. Draws nothing when the explanation could not be worked out. */
export function DiagnosisSection({ frame, diagnosis }: { frame: OverviewFrame; diagnosis: OverviewDiagnosis | null }) {
  if (!diagnosis) return null;
  const money = moneyWriter(frame.currency, frame.locale);
  return (
    <AnalyticsSection
      id="overview-why"
      title="Why did sales change?"
      description={`${frame.params.period.label} against ${diagnosis.comparedWith}. ${diagnosis.basis}, worked out from the figures, not guessed.`}
      action={
        diagnosis.explanation.lookAt ? (
          <Link href={drillTo(frame, diagnosis.explanation.lookAt.href)} className={linkClass}>
            {diagnosis.explanation.lookAt.text}
          </Link>
        ) : null
      }
    >
      {diagnosis.explanation.direction === "unknown" ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{diagnosis.explanation.reason ?? diagnosis.explanation.sentences[0]}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="What moved revenue" description="Each factor's own change. Together they make the change in revenue.">
            <HorizontalBars label="Change in each factor" rows={factorRows(diagnosis.explanation)} exportId="overview.factors" />
          </ChartCard>
          <div className="min-w-0 space-y-2 rounded-lg border border-border bg-background p-4 text-sm">
            {diagnosis.explanation.sentences.map((line, i) => (
              <p key={i} className={i === 0 ? "text-base font-medium" : "text-muted"}>
                {line}
              </p>
            ))}
            <p className="text-xs text-muted">
              Change in revenue: <span className="tabular-nums">{diagnosis.explanation.changeMinor < 0 ? MINUS : "+"}{money(Math.abs(diagnosis.explanation.changeMinor))}</span>
            </p>
          </div>
        </div>
      )}
      {diagnosis.notes.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted">
          {diagnosis.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// From visit to purchase
// ---------------------------------------------------------------------------

export function FunnelSection({ frame, traffic }: { frame: OverviewFrame; traffic: TrafficReport }) {
  const countingOn = traffic.counting;
  const f = traffic.funnel;
  const funnelNotes: string[] = [];
  if (traffic.sessions !== null && traffic.coverage.partial && traffic.coverage.firstDay) funnelNotes.push(`Visits have been counted since ${dayText(traffic.coverage.firstDay)}, so the funnel covers only the days from then.`);
  if (traffic.sessions !== null && traffic.uncoveredOrders.orders > 0) {
    funnelNotes.push(`${formatCount(traffic.uncoveredOrders.orders)} paid ${plural(traffic.uncoveredOrders.orders, "order falls", "orders fall")} outside the days with counted visits and ${plural(traffic.uncoveredOrders.orders, "is", "are")} left out of the rates.`);
  }
  funnelNotes.push(...f.notes);

  return (
    <AnalyticsSection
      id="overview-funnel"
      title="From visit to purchase"
      description="Where visitors drop off on the way to buying."
      action={
        <Link href={drillTo(frame, "/analytics/traffic")} className={linkClass}>
          Traffic details
        </Link>
      }
    >
      {traffic.sessions === null ? (
        countingOn ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">No visits were counted in this period, so there is no funnel to show yet.</p>
        ) : (
          <VisitCountingOff base={frame.base} isOwner={frame.isOwner} gives="It shows how many people visit, look at a product, add to the cart and check out, and where they leave." />
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="The way to a purchase" description="Each step counts visitor-days: one visitor on one day.">
            <Funnel label="Sales funnel" stages={f.stages.map((s) => ({ label: s.label, value: s.count }))} format={formatCount} exportId="overview.funnel" />
          </ChartCard>
          <div className="space-y-3">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stat label="Product view rate" caption="Visits that looked at a product." value={f.productViewRate === null ? null : formatPercent(f.productViewRate)} reason="No visits yet." />
              <Stat label="Add-to-cart rate" caption="Visits that put something in the cart." value={f.addToCartRate === null ? null : formatPercent(f.addToCartRate)} reason="No visits yet." />
              <Stat label="Cart abandonment" caption="Of the carts made, the share that never became a purchase." value={f.cartAbandonment === null ? null : formatPercent(f.cartAbandonment)} reason="No carts were made." />
              <Stat label="Checkout abandonment" caption="Of those who reached checkout, the share who did not buy." value={f.checkoutAbandonment === null ? null : formatPercent(f.checkoutAbandonment)} reason="Nobody reached checkout." />
              <Stat label="Purchase conversion" caption="Visits that ended in a paid order." value={f.purchaseConversion === null ? null : formatPercent(f.purchaseConversion)} reason="No visits yet." />
            </dl>
            {funnelNotes.length > 0 ? (
              <ul className="space-y-1 text-xs text-muted">
                {funnelNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Best sellers and channels
// ---------------------------------------------------------------------------

export function ProductsSection({ frame, top }: { frame: OverviewFrame; top: TopProducts }) {
  const money = moneyWriter(frame.currency, frame.locale);
  const settingsHref = `${frame.base}/analytics/settings`;
  const revenueRows: BarRow[] = top.byRevenue.map((p) => ({ key: p.productId, label: p.name, value: p.revenueMinor, valueText: money(p.revenueMinor), ...(p.units > 0 ? { detail: `${formatCount(p.units)} sold` } : {}) }));
  const profitRows: BarRow[] = top.byProfit.map((p) => ({
    key: p.productId,
    label: p.name,
    value: p.profitMinor,
    valueText: p.profitMinor === null ? NO_FIGURE : money(p.profitMinor),
    ...(p.costCoverage !== null && p.costCoverage < 1 ? { detail: `${formatPercent(p.costCoverage, 0)} costed` } : {}),
  }));
  return (
    <AnalyticsSection
      id="overview-products"
      title="Best sellers"
      description="The five products that brought in the most, and the five that left the most after their cost."
      action={
        <Link href={drillTo(frame, "/analytics/products")} className={linkClass}>
          All products
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="By revenue" description="Without VAT, after discounts.">
          <HorizontalBars label="Top products by revenue" rows={revenueRows} emptyText="No products were sold in this period." exportId="overview.top_revenue" />
        </ChartCard>
        <ChartCard title="By profit" description="Revenue less the cost of what was sold, before refunds.">
          {revenueRows.length > 0 && profitRows.length === 0 ? (
            <div className="space-y-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm">
              <p className="font-medium">Add what your products cost to rank them by profit</p>
              {frame.isOwner ? (
                <Link href={settingsHref} className={linkClass}>
                  Open Analytics settings
                </Link>
              ) : (
                <p className="text-muted">An owner of the store can add them.</p>
              )}
            </div>
          ) : (
            <HorizontalBars label="Top products by profit" rows={profitRows} emptyText="No products were sold in this period." exportId="overview.top_profit" />
          )}
        </ChartCard>
      </div>
      {top.truncated ? <p className="text-xs text-muted">The store has many products, so a rank near the bottom of a list may be a little off.</p> : null}
    </AnalyticsSection>
  );
}

export function ChannelsSection({ frame, marketing }: { frame: OverviewFrame; marketing: MarketingReport }) {
  const money = moneyWriter(frame.currency, frame.locale);
  const channelRows = (marketing.table?.rows ?? []).filter((r) => r.revenueMinor > 0 || r.orders > 0).slice(0, 5);
  const channelColumns: Column<ChannelRow>[] = [
    { key: "channel", label: "Channel", align: "left", cell: (r) => r.label },
    { key: "revenue", label: "Revenue", align: "right", cell: (r) => money(r.revenueMinor) },
    { key: "orders", label: "Orders", align: "right", cell: (r) => formatCount(r.orders) },
    {
      key: "conversion",
      label: "Conversion",
      align: "right",
      cell: (r) => (r.conversion === null ? <span title="Visits are not known for these orders">{NO_FIGURE}</span> : formatPercent(r.conversion)),
    },
    { key: "roas", label: "ROAS", align: "right", cell: (r) => (r.roas === null ? <span title="No ad spend entered for this channel">{NO_FIGURE}</span> : formatTimes(r.roas)) },
  ];
  return (
    <AnalyticsSection
      id="overview-channels"
      title="Where sales come from"
      description="The channels that brought in the most revenue."
      action={
        <Link href={drillTo(frame, "/analytics/marketing")} className={linkClass}>
          Marketing details
        </Link>
      }
    >
      {marketing.table === null ? (
        marketing.counting ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">No visits were counted in this period, so orders cannot be tied to a channel yet.</p>
        ) : (
          <VisitCountingOff base={frame.base} isOwner={frame.isOwner} gives="It shows which channels (search, social, email and so on) your visits and orders come from." />
        )
      ) : (
        <div className="space-y-2">
          <DataTable caption="Top channels by revenue" columns={channelColumns} rows={channelRows} rowKey={(r) => r.channel} empty="No paid order could be tied to a channel in this period." exportId="overview.channels" exportLeftOut={{ orders: marketing.unconverted, currencies: marketing.missingCurrencies }} />
          <p className="text-xs text-muted">
            <span title="Return on ad spend">ROAS</span> is the revenue a channel brought in for each 1 spent on it; {NO_FIGURE} means no ad spend is entered. Unknown holds the orders no counted visit explains.
            {marketing.spend.totalMinor === 0 ? " No ad spend is entered for this period." : ""}
          </p>
        </div>
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// The target and the forecast
// ---------------------------------------------------------------------------

export function TargetSection({ frame, target }: { frame: OverviewFrame; target: OverviewTarget }) {
  const money = moneyWriter(frame.currency, frame.locale);
  const p = target.progress;
  const lines = targetLines(p, money);
  return (
    <AnalyticsSection id="overview-target" title={`Target for ${target.monthLabel}`} description="Net revenue so far this month against the month's target, whatever period is picked above.">
      {p.status === "no_target" ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border px-4 py-5 text-sm">
          <p className="font-medium">No target is set for {target.monthLabel}</p>
          <p className="text-muted">
            A target shows whether the month is on pace. So far this month the store has {money(p.actualMinor)} in net revenue.
          </p>
          {frame.isOwner ? (
            <Link href={`${frame.base}/analytics/settings`} className={linkClass}>
              Set a monthly target
            </Link>
          ) : (
            <p className="text-muted">An owner of the store can set one in Analytics settings.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-border bg-background p-4">
          <Meter label={`Net revenue against the target for ${target.monthLabel}`} value={p.actualMinor} target={p.targetMinor} expected={p.tooEarly ? null : p.expectedByTodayMinor} format={money} />
          <ul className="space-y-1 text-sm text-muted">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </AnalyticsSection>
  );
}

/** The forecast under the target. Draws nothing when it could not be worked out. */
export function ForecastSection({ frame, forecast }: { frame: OverviewFrame; forecast: OverviewForecast | null }) {
  if (!forecast) return null;
  const money = moneyWriter(frame.currency, frame.locale);
  return (
    <AnalyticsSection
      id="overview-forecast"
      title={`Forecast for ${forecast.monthLabel}`}
      description="Where the month's net revenue is heading if the last weeks' pace holds. An estimate, not a promise."
      action={<StatusPill tone="neutral">Estimate</StatusPill>}
    >
      <div className="space-y-2 rounded-lg border border-border bg-background p-4 text-sm">
        {forecastLines(forecast, money).map((line, i) => (
          <p key={i} className={i === 0 ? "text-base font-medium" : "text-muted"}>
            {line}
          </p>
        ))}
        {forecast.forecast.expectedMinor !== null && forecast.forecast.notes.length > 0 ? (
          <ul className="space-y-1 pt-1 text-xs text-muted">
            {forecast.forecast.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </AnalyticsSection>
  );
}
