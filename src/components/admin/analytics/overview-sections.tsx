import Link from "next/link";
import type { ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import { formatCount, formatPercent, MINUS, NO_FIGURE } from "@/lib/analytics-core";
import { analyticsWords, countText } from "@/lib/analytics-words";
import { COVERAGE_WARN, costsKnown, estimateText, formatKpi, KPI_CARDS, kpiChange, kpiMissing, kpiValue, type KpiCard as KpiCardDef } from "@/lib/analytics-kpi";
import { periodHref, type AnalyticsParams } from "@/lib/analytics-period";
import type { ChannelRow } from "@/lib/analytics-traffic";
import type { OverviewHead, PeriodFigures, TopProducts } from "@/server/analytics-totals";
import type { MarketingReport, TrafficReport } from "@/server/analytics-traffic-data";

import { Funnel, HorizontalBars, LineChart, Meter, type BarRow } from "./charts";
import { DataTable, StatusPill, type Column, type DeltaView } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { AnalyticsSection, ChartCard, Note } from "./section";
import { dayText, factorRows, forecastLines, formatTimes, metricWriter, moneyLines, moneySignals, moneyWriter, noSales, ordersForecastLine, periodTargetLines, targetLines, type OverviewDiagnosis, type OverviewForecast, type OverviewTarget } from "./overview-text";
import { isSumMetric } from "@/lib/analytics-targets";
import { CARD_CLASS } from "@/components/admin/ui";

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
      <p className="text-xs text-muted">{fillWords(analyticsWords().overview.footer, { currency })}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// While a section loads, and when it cannot
// ---------------------------------------------------------------------------

const pulse = "animate-pulse rounded-lg bg-card";

/** The sizes a section's placeholder keeps, about those of the section it stands in for, so little moves when it arrives. */
const SKELETON_HEIGHT = { alerts: "h-32", why: "h-64", funnel: "h-72", products: "h-64", channels: "h-56", target: "h-40", forecast: "h-36" } as const;

export type OverviewSkeletonKind = keyof typeof SKELETON_HEIGHT;

/** What stands in for a section while its data is read: a heading and a body of the section's usual height, in the admin's placeholder style. */
export function SectionSkeleton({ kind, label }: { kind: OverviewSkeletonKind; label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-skeleton={kind} className="space-y-3">
      <span className="sr-only">{fillWords(analyticsWords().section.loading, { label })}</span>
      <div aria-hidden="true" className={`${pulse} h-6 w-56`} />
      <div aria-hidden="true" className={`${pulse} ${SKELETON_HEIGHT[kind]}`} />
    </div>
  );
}

/** What a section says when its data could not be read: calm, and the rest of the page is as it was. */
export function SectionUnavailable({ id, title }: { id: string; title: string }) {
  return (
    <AnalyticsSection id={id} title={title}>
      <Note title={analyticsWords().section.unavailableTitle}>{analyticsWords().section.unavailable}</Note>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** What a figure or panel that needs visit counting says: what it gives, that it sets no cookie, and (for an owner) where to switch it on. */
function VisitCountingOff({ base, isOwner, gives }: { base: string; isOwner: boolean; gives: string }) {
  const w = analyticsWords().overview.visitsOff;
  return (
    <div className="space-y-2 rounded-panel border border-dashed border-line px-4 py-5 text-sm">
      <p className="font-medium">{w.title}</p>
      <p className="text-muted">{fillWords(w.body, { gives })}</p>
      {isOwner ? (
        <Link href={`${base}/analytics/settings`} className={linkClass}>
          {w.switchOn}
        </Link>
      ) : (
        <p className="text-muted">{w.ownerCan}</p>
      )}
    </div>
  );
}

function Stat({ label, caption, value, reason }: { label: string; caption: string; value: string | null; reason: string }) {
  return (
    <div className={`min-w-0 p-3 ${CARD_CLASS}`}>
      <dt className="text-xs font-medium text-muted" title={caption}>
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-medium tabular-nums">{value ?? NO_FIGURE}</dd>
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
  const words = analyticsWords();
  const w = words.overview.answer;

  // ---- notes about what the figures are and are not ----
  const notes: ReactNode[] = [...data.notes];
  if (current.visitsFrom) notes.push(fillWords(w.visitsSince, { day: dayText(current.visitsFrom) }));
  if (sales && coverage !== null && coverage > 0 && coverage < COVERAGE_WARN) {
    notes.push(costsKnown(coverage) ? fillWords(w.estimated, { estimate: estimateText(coverage) ?? "" }) : fillWords(w.tooFew, { share: formatPercent(coverage, 0) }));
  }
  if (sales && !costsMissing && !data.settings.saved) {
    notes.push(
      isOwner ? (
        <>
          {w.feesNotEntered}{" "}
          <Link href={settingsHref} className={linkClass}>
            {w.enterThem}
          </Link>
          .
        </>
      ) : (
        `${w.feesNotEntered} ${w.ownerCanEnter}`
      ),
    );
  }

  // ---- the cards ----
  const cardWords = (card: KpiCardDef) => words.kpi.cards[card.id] ?? { label: card.label, help: card.help, missing: card.missingText ?? "" };
  const visitsText = (card: KpiCardDef, fallback: string): { text: string; action?: { label: string; href: string } } => {
    if (visitCounting) return { text: w.noVisits };
    return isOwner ? { text: cardWords(card).missing || fallback, action: { label: w.switchOnVisits, href: settingsHref } } : { text: w.visitsOffOwner };
  };
  const cards: (KpiCardProps & { id: string })[] = KPI_CARDS.map((card) => {
    const value = kpiValue(card, current.derived);
    const named = cardWords(card);
    const base0 = { id: card.id, label: named.label, good: card.good, help: named.help, emphasis: PRIMARY.has(card.id) };
    const missing = kpiMissing(card, current.derived);
    const noOrders = !sales && (card.id === "grossProfit" || card.id === "grossMargin");
    if (missing || noOrders) {
      if (noOrders || missing?.kind === "no-data") return { ...base0, value: null, state: "missing" as const, missing: { text: w.noOrders } };
      if (missing!.kind === "visits") return { ...base0, value: null, state: "missing" as const, missing: visitsText(card, missing!.text) };
      return {
        ...base0,
        value: null,
        state: "missing" as const,
        missing: { text: isOwner ? missing!.text : w.costsNotEntered, ...(isOwner ? { action: { label: w.addCosts, href: settingsHref } } : {}) },
      };
    }
    const delta = (from: PeriodFigures, needSales: boolean): DeltaView | null => {
      if (needSales && noSales(from)) return null;
      const c = kpiChange(card, value, kpiValue(card, from.derived));
      return c.abs === null ? null : { text: c.text, abs: c.abs, verdict: c.verdict };
    };
    const series = data.sparklines[card.id];
    const profitCard = card.id === "grossProfit" || card.id === "grossMargin";
    const hint = profitCard && coverage !== null && coverage > 0 ? data.costCoverageText : card.id === "conversion" && current.visitsFrom ? fillWords(w.countedSince, { day: dayText(current.visitsFrom) }) : undefined;
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
      <AnalyticsSection id="overview-making-money" title={w.title} description={fillWords(w.description, { period: params.period.label, currency })}>
        <div className="space-y-1 rounded-panel bg-sunken p-4 text-sm">
          {moneyLines(data, money, words).map((line, i) => (
            <p key={i} className={i === 0 ? "text-base font-medium" : "text-muted"}>
              {line}
            </p>
          ))}
          {costsMissing && isOwner ? (
            <p>
              <Link href={settingsHref} className={linkClass}>
                {w.addCosts}
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
  const words = analyticsWords();
  const w = words.overview.charts;
  const previousLabel = compare === "year" ? words.compare.modes.year : words.compare.modes.previous;
  const per = w.per[data.bucket] ?? data.bucket;

  return (
    <AnalyticsSection id="overview-sales" title={w.title} description={fillWords(w.description, { per, dashed: compare === "none" ? w.dashedOff : previousLabel.toLowerCase() })}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={w.net} description={w.netDescription}>
          {anySales ? (
            <LineChart
              label={fillWords(w.netPer, { per })}
              labels={labels}
              series={[{ key: "net", label: w.net, values: data.series.current.map((pt) => pt.netRevenueMinor), ...(comparison ? { previous: comparison.map((pt) => (pt ? pt.netRevenueMinor : null)) } : {}) }]}
              format={money}
              previousLabel={previousLabel}
              area
              exportId="overview.net_revenue"
              exportLeftOut={{ orders: data.unconverted, currencies: data.missingCurrencies }}
            />
          ) : (
            <p className="rounded-panel border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{fillWords(w.netNone, { per })}</p>
          )}
        </ChartCard>
        {costsMissing ? (
          <ChartCard title={w.profit} description={w.profitWhat}>
            <div className="space-y-2 rounded-panel border border-dashed border-line px-4 py-6 text-sm">
              <p className="font-medium">{w.profitAdd}</p>
              <p className="text-muted">{w.profitWhy}</p>
              {isOwner ? (
                <Link href={settingsHref} className={linkClass}>
                  {w.openSettings}
                </Link>
              ) : (
                <p className="text-muted">{w.ownerCanAdd}</p>
              )}
            </div>
          </ChartCard>
        ) : (
          <ChartCard
            title={w.profit}
            description={sales ? fillWords(w.profitDescription, { coverage: data.costCoverageText }) : w.profitPlain}
          >
            {sales ? (
              <LineChart
                label={fillWords(w.profitPer, { per })}
                labels={labels}
                series={[{ key: "profit", label: w.profit, values: data.series.current.map((pt) => pt.contributionMinor), ...(comparison ? { previous: comparison.map((pt) => (pt ? pt.contributionMinor : null)) } : {}) }]}
                format={money}
                previousLabel={previousLabel}
                area
                exportId="overview.contribution"
                exportLeftOut={{ orders: data.unconverted, currencies: data.missingCurrencies }}
              />
            ) : (
              <p className="rounded-panel border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{w.profitNone}</p>
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
  const w = analyticsWords().overview.why;
  return (
    <AnalyticsSection
      id="overview-why"
      title={w.title}
      description={fillWords(w.description, { period: frame.params.period.label, against: diagnosis.comparedWith, basis: diagnosis.basis })}
      action={
        diagnosis.explanation.lookAt ? (
          <Link href={drillTo(frame, diagnosis.explanation.lookAt.href)} className={linkClass}>
            {diagnosis.explanation.lookAt.text}
          </Link>
        ) : null
      }
    >
      {diagnosis.explanation.direction === "unknown" ? (
        <p className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{diagnosis.explanation.reason ?? diagnosis.explanation.sentences[0]}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={w.moved} description={w.movedDescription}>
            <HorizontalBars label={w.bars} rows={factorRows(diagnosis.explanation)} exportId="overview.factors" />
          </ChartCard>
          <div className={`min-w-0 space-y-2 p-4 text-sm ${CARD_CLASS}`}>
            {diagnosis.explanation.sentences.map((line, i) => (
              <p key={i} className={i === 0 ? "text-base font-medium" : "text-muted"}>
                {line}
              </p>
            ))}
            <p className="text-xs text-muted">
              {w.change}
              <span className="tabular-nums">{diagnosis.explanation.changeMinor < 0 ? MINUS : "+"}{money(Math.abs(diagnosis.explanation.changeMinor))}</span>
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
  const w = analyticsWords().overview.funnel;
  const funnelNotes: string[] = [];
  if (traffic.sessions !== null && traffic.coverage.partial && traffic.coverage.firstDay) funnelNotes.push(fillWords(w.since, { day: dayText(traffic.coverage.firstDay) }));
  if (traffic.sessions !== null && traffic.uncoveredOrders.orders > 0) {
    funnelNotes.push(countText(w.outside, traffic.uncoveredOrders.orders, {}, formatCount(traffic.uncoveredOrders.orders)));
  }
  funnelNotes.push(...f.notes);

  return (
    <AnalyticsSection
      id="overview-funnel"
      title={w.title}
      description={w.description}
      action={
        <Link href={drillTo(frame, "/analytics/traffic")} className={linkClass}>
          {w.details}
        </Link>
      }
    >
      {traffic.sessions === null ? (
        countingOn ? (
          <p className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{w.noVisits}</p>
        ) : (
          <VisitCountingOff base={frame.base} isOwner={frame.isOwner} gives={w.gives} />
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={w.way} description={w.wayDescription}>
            <Funnel label={w.label} stages={f.stages.map((s) => ({ label: s.label, value: s.count }))} format={formatCount} exportId="overview.funnel" />
          </ChartCard>
          <div className="space-y-3">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stat label={w.stats.productView.label} caption={w.stats.productView.caption} value={f.productViewRate === null ? null : formatPercent(f.productViewRate)} reason={w.noVisitsYet} />
              <Stat label={w.stats.addToCart.label} caption={w.stats.addToCart.caption} value={f.addToCartRate === null ? null : formatPercent(f.addToCartRate)} reason={w.noVisitsYet} />
              <Stat label={w.stats.cartAbandonment.label} caption={w.stats.cartAbandonment.caption} value={f.cartAbandonment === null ? null : formatPercent(f.cartAbandonment)} reason={w.stats.cartAbandonment.reason} />
              <Stat label={w.stats.checkoutAbandonment.label} caption={w.stats.checkoutAbandonment.caption} value={f.checkoutAbandonment === null ? null : formatPercent(f.checkoutAbandonment)} reason={w.stats.checkoutAbandonment.reason} />
              <Stat label={w.stats.purchase.label} caption={w.stats.purchase.caption} value={f.purchaseConversion === null ? null : formatPercent(f.purchaseConversion)} reason={w.noVisitsYet} />
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
  const w = analyticsWords().overview.products;
  const ownerCan = analyticsWords().overview.charts;
  const revenueRows: BarRow[] = top.byRevenue.map((p) => ({ key: p.productId, label: p.name, value: p.revenueMinor, valueText: money(p.revenueMinor), ...(p.units > 0 ? { detail: fillWords(w.sold, { n: formatCount(p.units) }) } : {}) }));
  const profitRows: BarRow[] = top.byProfit.map((p) => ({
    key: p.productId,
    label: p.name,
    value: p.profitMinor,
    valueText: p.profitMinor === null ? NO_FIGURE : money(p.profitMinor),
    ...(p.costCoverage !== null && p.costCoverage < 1 ? { detail: fillWords(w.costed, { share: formatPercent(p.costCoverage, 0) }) } : {}),
  }));
  return (
    <AnalyticsSection
      id="overview-products"
      title={w.title}
      description={w.description}
      action={
        <Link href={drillTo(frame, "/analytics/products")} className={linkClass}>
          {w.all}
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={w.byRevenue} description={w.byRevenueDescription}>
          <HorizontalBars label={w.byRevenueLabel} rows={revenueRows} emptyText={w.none} exportId="overview.top_revenue" />
        </ChartCard>
        <ChartCard title={w.byProfit} description={w.byProfitDescription}>
          {revenueRows.length > 0 && profitRows.length === 0 ? (
            <div className="space-y-2 rounded-panel border border-dashed border-line px-4 py-6 text-sm">
              <p className="font-medium">{w.addCosts}</p>
              {frame.isOwner ? (
                <Link href={settingsHref} className={linkClass}>
                  {ownerCan.openSettings}
                </Link>
              ) : (
                <p className="text-muted">{ownerCan.ownerCanAdd}</p>
              )}
            </div>
          ) : (
            <HorizontalBars label={w.byProfitLabel} rows={profitRows} emptyText={w.none} exportId="overview.top_profit" />
          )}
        </ChartCard>
      </div>
      {top.truncated ? <p className="text-xs text-muted">{w.truncated}</p> : null}
    </AnalyticsSection>
  );
}

export function ChannelsSection({ frame, marketing }: { frame: OverviewFrame; marketing: MarketingReport }) {
  const money = moneyWriter(frame.currency, frame.locale);
  const channelRows = (marketing.table?.rows ?? []).filter((r) => r.revenueMinor > 0 || r.orders > 0).slice(0, 5);
  const w = analyticsWords().overview.channels;
  const channelColumns: Column<ChannelRow>[] = [
    { key: "channel", label: w.channel, align: "left", cell: (r) => r.label },
    { key: "revenue", label: w.revenue, align: "right", cell: (r) => money(r.revenueMinor) },
    { key: "orders", label: w.orders, align: "right", cell: (r) => formatCount(r.orders) },
    {
      key: "conversion",
      label: w.conversion,
      align: "right",
      cell: (r) => (r.conversion === null ? <span title={w.visitsUnknown}>{NO_FIGURE}</span> : formatPercent(r.conversion)),
    },
    { key: "roas", label: w.roas, align: "right", cell: (r) => (r.roas === null ? <span title={w.noSpend}>{NO_FIGURE}</span> : formatTimes(r.roas)) },
  ];
  return (
    <AnalyticsSection
      id="overview-channels"
      title={w.title}
      description={w.description}
      action={
        <Link href={drillTo(frame, "/analytics/marketing")} className={linkClass}>
          {w.details}
        </Link>
      }
    >
      {marketing.table === null ? (
        marketing.counting ? (
          <p className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{w.noVisits}</p>
        ) : (
          <VisitCountingOff base={frame.base} isOwner={frame.isOwner} gives={w.gives} />
        )
      ) : (
        <div className="space-y-2">
          <DataTable caption={w.caption} columns={channelColumns} rows={channelRows} rowKey={(r) => r.channel} empty={w.empty} exportId="overview.channels" exportLeftOut={{ orders: marketing.unconverted, currencies: marketing.missingCurrencies }} />
          <p className="text-xs text-muted">
            <span title={w.roasLong}>{w.roas}</span>
            {fillWords(w.roasNote, { none: NO_FIGURE })}
            {marketing.spend.totalMinor === 0 ? w.noSpendPeriod : ""}
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
  const words = analyticsWords();
  const w = words.overview.target;
  const lines = targetLines(p, money, words);
  return (
    <AnalyticsSection id="overview-target" title={fillWords(w.title, { month: target.monthLabel })} description={w.description}>
      {p.status === "no_target" ? (
        <div className="space-y-2 rounded-panel border border-dashed border-line px-4 py-5 text-sm">
          <p className="font-medium">{fillWords(w.none, { month: target.monthLabel })}</p>
          <p className="text-muted">{fillWords(w.noneBody, { amount: money(p.actualMinor) })}</p>
          {frame.isOwner ? (
            <Link href={`${frame.base}/analytics/settings`} className={linkClass}>
              {w.set}
            </Link>
          ) : (
            <p className="text-muted">{w.ownerCanSet}</p>
          )}
        </div>
      ) : (
        <div className={`space-y-3 p-4 ${CARD_CLASS}`}>
          <Meter label={fillWords(w.meter, { month: target.monthLabel })} value={p.actualMinor} target={p.targetMinor} expected={p.tooEarly ? null : p.expectedByTodayMinor} format={money} />
          <ul className="space-y-1 text-sm text-muted">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {target.others && target.others.length > 0 ? (
        <div className="space-y-3 pt-2" data-running-targets>
          <h3 className="text-body-strong text-ink">{w.others}</h3>
          <p className="text-sm text-muted">{w.othersDescription}</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {target.others.map((card) => {
              const metric = w.metrics[card.metric];
              const write = metricWriter(card.metric, money);
              const level = !isSumMetric(card.metric);
              return (
                <li key={card.id} data-target={card.metric} className={`space-y-2 p-4 ${CARD_CLASS}`}>
                  <p className="text-body-strong text-ink">{fillWords(w.cardTitle, { metric, period: card.periodLabel })}</p>
                  <Meter
                    label={fillWords(w.cardMeter, { metric, period: card.periodLabel })}
                    value={card.progress.actual}
                    target={card.progress.targetValue}
                    expected={level || card.progress.tooEarly ? null : card.progress.expected}
                    format={write}
                  />
                  <ul className="space-y-1 text-sm text-muted">
                    {periodTargetLines(card, money, words).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                    {card.unconverted > 0 ? (
                      <li>{countText(words.overview.unconverted, card.unconverted, { currencies: card.missingCurrencies.join(", "), main: frame.currency })}</li>
                    ) : null}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </AnalyticsSection>
  );
}

/** The forecast under the target. Draws nothing when it could not be worked out. */
export function ForecastSection({ frame, forecast }: { frame: OverviewFrame; forecast: OverviewForecast | null }) {
  if (!forecast) return null;
  const money = moneyWriter(frame.currency, frame.locale);
  const words = analyticsWords();
  const w = words.overview.forecast;
  return (
    <AnalyticsSection
      id="overview-forecast"
      title={fillWords(w.title, { month: forecast.monthLabel })}
      description={w.description}
      action={<StatusPill tone="neutral">{w.estimate}</StatusPill>}
    >
      <div className={`space-y-2 p-4 text-sm ${CARD_CLASS}`}>
        {forecastLines(forecast, money, words).map((line, i) => (
          <p key={i} className={i === 0 ? "text-base font-medium" : "text-muted"}>
            {line}
          </p>
        ))}
        {forecast.orders ? <p className="text-muted" data-orders-forecast>{ordersForecastLine(forecast.orders, words)}</p> : null}
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
