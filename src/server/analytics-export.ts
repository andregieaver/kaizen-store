import "server-only";

import { ANALYTICS_TABLES, lastDayOf, OWNER_ONLY_TABLES, tableFileName, tableFileRows, type AnalyticsTable, type ExportPeriod, type TableData } from "@/lib/analytics-export";
import { COHORT_OFFSETS } from "@/lib/analytics-customers";
import { financeStatement } from "@/lib/analytics-finance";
import { bandHours } from "@/lib/analytics-heatmap";
import { addDays, bucketFor, todayIn, type AnalyticsPeriod } from "@/lib/analytics-period";
import { UNKNOWN_CHANNEL, channelLabel } from "@/lib/analytics-traffic";
import { writeCsv, type DialectId, isDialect } from "@/lib/csv";
import { mainCurrency } from "@/lib/markets";
import { featureOn } from "@/lib/store-features";

import { codeKindText, trendMonths } from "@/components/admin/analytics/discounts-view";
import { WHERE_IT_WENT, lineOf, plainLabel } from "@/components/admin/analytics/finance-view";
import { STATUS_LABEL, parseInventoryParams, sortVariants } from "@/components/admin/analytics/inventory-view";
import { contributionProfit } from "@/components/admin/analytics/marketing-view";
import { factorRows } from "@/components/admin/analytics/overview-text";
import { TOP_CHART, parseProductsSort, sortProducts } from "@/components/admin/analytics/products-view";
import { marketName } from "@/components/admin/analytics/refunds-view";
import { upcomingTargets } from "@/components/admin/analytics/settings-forms";
import { bridgeBars, bridgeRows } from "@/components/admin/analytics/subscriptions-view";
import { FULL_WEEKDAYS, KIND_LABEL, countryRows, deviceShare, landingLabel } from "@/components/admin/analytics/traffic-view";

import { analyticsContextFor, type AnalyticsContext } from "./analytics-context";
import { customersReport } from "./analytics-customers-data";
import { discountsReport } from "./analytics-discounts-data";
import { geoReport } from "./analytics-geo-data";
import { diagnosisFor } from "./analytics-insights";
import { inventoryReport } from "./analytics-inventory-data";
import { overviewReads } from "./analytics-overview-reads";
import { productsReport } from "./analytics-products-data";
import { refundsReport } from "./analytics-refunds-data";
import { returnsReport } from "./analytics-returns-data";
import { searchReport } from "./analytics-search-data";
import { listSpend, listTargets } from "./analytics-settings";
import { subscriptionsReport } from "./analytics-subscriptions-data";
import { timeReport } from "./analytics-time-data";
import { overviewHead, periodTotals, seriesByBucket, topProducts, type SeriesPoint } from "./analytics-totals";
import { marketingReport, sessionTotals, trafficReport } from "./analytics-traffic-data";
import { audit, type Membership } from "./auth";
import { memberCan } from "./permissions";

/**
 * A CSV for every analytics table (D165, `docs/wave-2-data.md` 2.8, 5.5, 6.4). `exportAnalyticsTable()` is what the route
 * `/admin/{store}/analytics/export` calls for a table of `ANALYTICS_TABLES`: it reads what the PAGE reads, through the page's own loaders
 * (`overviewHead()`, `productsReport()`, `trafficReport()` and the rest, with the same arguments the page passes), and turns the rows the page
 * draws into the registry's columns, so a figure cannot differ from the page's: there is no second query. Every figure is what the page shows for
 * the period and the comparison in the address (the page's own sort for the products and inventory tables); a table is the whole of its rows (the
 * CSV goes beyond the screen's row limits, as Shopify's does) and has no totals row, so a column sums. A currency with no rate is left out as on
 * the page, and the count is written to the activity log with the export. A figure the page shows as a dash is empty here, never zero.
 *
 * Permissions: `analytics:write` for every table (an export is logged, as the VAT export is), and the owner role for the top customers (they are
 * people) and the owner's targets (`OWNER_ONLY_TABLES`). The audit entry is written BEFORE the file is handed back, and if it cannot be
 * written the file is not served. The entry holds the table's id, the period, the row count and the left-out count: never a cell.
 */

type V = string | number | boolean | null | undefined;
type Row = Record<string, V>;
type LeftOut = { orders: number; currencies: string[] };

/** What a table's builder gives: the page's rows in its order, and (where the page compares) the comparison's rows lined up with them. */
type Built = {
  rows: Row[];
  /** The comparison, when the page compares this table: its period and one row for each current row (an empty row where it has none). */
  previous?: { period: ExportPeriod; rows: Row[] } | null;
  /** The period the file says: the page's, or the day an as-of table was made. */
  period?: ExportPeriod;
  leftOut?: LeftOut;
};

type Query = Record<string, string | string[] | undefined>;

/** What the builders share: the page's context, the address, and each report read at most once for the export. */
type Run = {
  ctx: AnalyticsContext;
  query: Query;
  currency: string;
  period: AnalyticsPeriod;
  /** The period the address compares with, or null: "none" is a choice the page honours. */
  against: AnalyticsPeriod | null;
  /** Reads once per export. */
  once: <T>(key: string, read: () => Promise<T>) => Promise<T>;
};

const NONE: LeftOut = { orders: 0, currencies: [] };
const left = (r: { unconverted: number; missingCurrencies?: string[]; missingRates?: string[] }): LeftOut => ({ orders: r.unconverted, currencies: [...(r.missingCurrencies ?? r.missingRates ?? [])] });
const day = (ts: string | null | undefined, timeZone: string): string | null => {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
};
const span = (p: { from: string; to: string }): ExportPeriod => ({ from: p.from, to: p.to });

// ---------------------------------------------------------------------------
// The tables, by page
// ---------------------------------------------------------------------------

/** The overview's head, read as the page reads it. */
const head = (x: Run) =>
  x.once("overview", () =>
    overviewHead(x.ctx.store, x.query, x.ctx.now, { sessions: (period) => sessionTotals(x.ctx.store, period), settings: x.ctx.settings }),
  );
const reads = (x: Run) => {
  let kept: ReturnType<typeof overviewReads> | null = null;
  return (kept ??= overviewReads(x.ctx.store, x.ctx.now, x.ctx.settings));
};

/** A series of buckets (a chart's x axis) with the comparison lined up point for point. */
function seriesRows(points: readonly SeriesPoint[], comparison: readonly (SeriesPoint | null)[] | null, put: (p: SeriesPoint) => Row, against: AnalyticsPeriod | null): Built {
  return {
    rows: points.map((p) => ({ bucket: p.key, ...put(p) })),
    previous: comparison && against ? { period: span(against), rows: points.map((_, i) => (comparison[i] ? put(comparison[i] as SeriesPoint) : {})) } : null,
  };
}

const bars = (rows: readonly { label: string; value: V }[]): Row[] => rows.map((r) => ({ label: r.label, value: r.value }));

const BUILDERS: Record<string, (x: Run) => Promise<Built>> = {
  // ---- Overview ----
  "overview.net_revenue": async (x) => {
    const d = await head(x);
    return { ...seriesRows(d.series.current, d.series.comparison, (p) => ({ net: p.netRevenueMinor }), x.against), leftOut: left(d) };
  },
  "overview.contribution": async (x) => {
    const d = await head(x);
    return { ...seriesRows(d.series.current, d.series.comparison, (p) => ({ profit: p.contributionMinor }), x.against), leftOut: left(d) };
  },
  "overview.factors": async (x) => {
    const d = await x.once("diagnosis", () => diagnosisFor(x.ctx.store, x.ctx.params, x.ctx.now, reads(x)));
    return { rows: d ? bars(factorRows(d.explanation).map((r) => ({ label: r.label, value: r.value }))) : [] };
  },
  "overview.funnel": async (x) => {
    const t = await reads(x).traffic(x.period);
    return { rows: t.funnel.stages.map((s) => ({ stage: s.label, count: s.count })), leftOut: left(t) };
  },
  "overview.top_revenue": async (x) => {
    const top = await x.once("top", () => topProducts(x.ctx.store, x.period));
    return { rows: bars(top.byRevenue.map((p) => ({ label: p.name, value: p.revenueMinor }))) };
  },
  "overview.top_profit": async (x) => {
    const top = await x.once("top", () => topProducts(x.ctx.store, x.period));
    return { rows: bars(top.byProfit.map((p) => ({ label: p.name, value: p.profitMinor }))) };
  },
  "overview.channels": async (x) => {
    const m = await reads(x).marketing(x.period);
    const rows = (m.table?.rows ?? []).filter((r) => r.revenueMinor > 0 || r.orders > 0).slice(0, 5);
    return { rows: rows.map((r) => ({ channel: r.label, revenue: r.revenueMinor, orders: r.orders, conversion: r.conversion, roas: r.roas })), leftOut: left(m) };
  },

  // ---- Finance ----
  "finance.bridge": async (x) => {
    const [current, prior] = await Promise.all([x.once("fin:now", () => financeOf(x, x.period)), x.against ? x.once("fin:then", () => financeOf(x, x.against as AnalyticsPeriod)) : null]);
    const lines = current.statement.lines;
    const comparable = prior && prior.totals.orders > 0 ? prior : null;
    return {
      rows: lines.map((l) => ({ line: plainLabel(l.label), amount: l.amountMinor, share_of_net_revenue: l.shareOfNet, estimated: l.estimated ? "yes" : "no" })),
      // A line the comparison lacks was 0 (rounding), as the page reads it; with no sales then, nothing to compare with.
      previous: comparable && x.against ? { period: span(x.against), rows: lines.map((l) => ({ amount: lineOf(comparable.statement, l.key)?.amountMinor ?? (l.key === "rounding" ? 0 : null) })) } : null,
      leftOut: left(current),
    };
  },
  "finance.where_it_went": async (x) => {
    const current = await x.once("fin:now", () => financeOf(x, x.period));
    return { rows: bars(WHERE_IT_WENT.map(([key, label]) => ({ label, value: lineOf(current.statement, key)?.amountMinor ?? null }))), leftOut: left(current) };
  },
  "finance.revenue_profit": async (x) => {
    const bucket = bucketFor(x.period);
    const [series, comparison] = await Promise.all([
      seriesByBucket(x.ctx.store, x.period, bucket, x.ctx.settings),
      x.against ? seriesByBucket(x.ctx.store, x.against, bucket, x.ctx.settings) : null,
    ]);
    const current = await x.once("fin:now", () => financeOf(x, x.period));
    // The page lines the comparison up bucket by bucket from the start of each period; only net revenue is compared there.
    return { ...seriesRows(series, comparison, (p) => ({ net: p.netRevenueMinor, profit: p.contributionMinor }), x.against), leftOut: left(current) };
  },

  // ---- Customers ----
  "customers.top": async (x) => {
    const r = await customers(x);
    return {
      rows: r.topCustomers.map((c) => ({ customer: c.name ?? c.email, email: c.email, account: c.account ? "Has an account" : "Guest", orders: c.orders, revenue: c.revenueMinor, lifetime: c.lifetimeOrders, last: day(c.lastOrderAt, x.ctx.store.timeZone) })),
      leftOut: left(r),
    };
  },
  "customers.retention": async (x) => {
    const r = await customers(x);
    return { rows: r.cohorts.rows.map((c) => ({ cohort: c.cohort, size: c.size, ...offsets(r.cohorts.offsets, c.retention) })), leftOut: left(r) };
  },
  "customers.cohort_revenue": async (x) => {
    const r = await customers(x);
    return { rows: r.cohorts.rows.map((c) => ({ cohort: c.cohort, size: c.size, ...offsets(r.cohorts.offsets, c.revenuePerCustomerMinor) })), leftOut: left(r) };
  },

  // ---- Products ----
  "products.table": async (x) => {
    const report = await products(x);
    const { sort } = parseProductsSort(x.query);
    const rows = sortProducts(report.rows, sort);
    return {
      rows: rows.map((r) => ({
        product: r.name,
        handle: r.handle,
        revenue: r.revenueMinor,
        units: r.units,
        orders: r.orders,
        margin: r.margin,
        refunds: r.refundRate,
        share: r.revenueShare,
        profitShare: r.profitShare,
        views: r.views,
        conversion: r.conversion,
      })),
      previous: report.compare ? { period: span(report.compare), rows: rows.map((r) => ({ revenue: r.previousRevenueMinor, units: r.previousUnits })) } : null,
      leftOut: left(report),
    };
  },
  "products.top_revenue": async (x) => {
    const report = await products(x);
    const best = report.rows.filter((r) => !r.other && r.revenueMinor > 0).slice(0, TOP_CHART);
    return { rows: bars(best.map((r) => ({ label: r.name, value: r.revenueMinor }))), leftOut: left(report) };
  },

  // ---- Inventory: as of now, no period ----
  "inventory.variants": async (x) => {
    const report = await inventoryReport(x.ctx.store, x.ctx.now);
    const { status, sort } = parseInventoryParams(x.query);
    const rows = sortVariants(status ? report.rows.filter((r) => r.status === status) : report.rows, sort);
    return {
      rows: rows.map((r) => ({
        name: r.name,
        sku: r.sku,
        status: STATUS_LABEL[r.status],
        backorder: r.onBackorder ? "yes" : "no",
        onHand: r.tracked ? r.onHand : null,
        owed: r.tracked ? r.owed : null,
        v7: r.tracked ? r.velocity.v7 : null,
        v30: r.tracked ? r.velocity.v30 : null,
        days: r.daysOfStock,
        value: r.valueMinor,
        lastSold: day(r.lastSoldAt, x.ctx.store.timeZone),
      })),
      period: asOf(x),
    };
  },

  // ---- Marketing ----
  "marketing.channels": async (x) => {
    const m = await x.once("marketing", () => marketingReport(x.ctx.store, x.period, x.ctx.now));
    return {
      rows: (m.table?.rows ?? []).map((r) => ({
        channel: r.channel === UNKNOWN_CHANNEL ? "Unknown" : r.label,
        sessions: r.sessions,
        orders: r.orders,
        revenue: r.revenueMinor,
        conversion: r.conversion,
        aov: r.aov,
        newCustomers: r.newCustomers,
        spend: r.spendMinor > 0 ? r.spendMinor : null,
        cac: r.cac,
        roas: r.roas,
        profitRoas: r.profitRoas,
        contribution: contributionProfit(r),
      })),
      leftOut: left(m),
    };
  },
  "marketing.revenue_by_channel": async (x) => {
    const m = await x.once("marketing", () => marketingReport(x.ctx.store, x.period, x.ctx.now));
    return { rows: bars((m.table?.rows ?? []).filter((r) => r.revenueMinor > 0).map((r) => ({ label: r.label, value: r.revenueMinor }))), leftOut: left(m) };
  },
  "marketing.spend_by_channel": async (x) => {
    const m = await x.once("marketing", () => marketingReport(x.ctx.store, x.period, x.ctx.now));
    return { rows: bars(m.spend.byChannel.filter((s) => s.amountMinor > 0).map((s) => ({ label: s.label, value: s.amountMinor }))), leftOut: left(m) };
  },
  "marketing.discount_codes": async (x) => {
    const d = await x.once("discounts", () => discountsReport(x.ctx.store, x.period));
    return {
      rows: d.coupons.map((c) => {
        const noGoods = c.codeKind === "free_shipping";
        return {
          code: c.code,
          kind: codeKindText(c.codeKind),
          status: c.active === null ? "Deleted" : c.active ? "On" : "Off",
          orders: c.orders,
          revenue: c.revenueMinor,
          discount: noGoods ? null : c.discountMinor,
          pct: noGoods ? null : c.discountPct,
          perOrder: noGoods ? null : c.discountPerOrderMinor,
          aov: c.aovMinor,
          share: c.revenueShare,
        };
      }),
      leftOut: left(d),
    };
  },
  "marketing.discount_share": async (x) => {
    const d = await x.once("discounts", () => discountsReport(x.ctx.store, x.period));
    // The chart's own x axis: the last twelve months up to the one the period ends in, whatever the period is.
    return { rows: trendMonths(d).map((m) => ({ bucket: m.start, share: m.share })), leftOut: left(d) };
  },
  "marketing.discount_by_kind": async (x) => {
    const d = await x.once("discounts", () => discountsReport(x.ctx.store, x.period));
    return { rows: bars(d.breakdown.kinds.filter((k) => k.discountMinor > 0).map((k) => ({ label: k.label, value: k.discountMinor }))), leftOut: left(d) };
  },

  // ---- Subscriptions ----
  "subscriptions.bridge": async (x) => {
    const r = await x.once("subscriptions", () => subscriptionsReport(x.ctx.store, x.period, x.ctx.now));
    return { rows: bridgeRows(r).map((b) => ({ step: b.label, amount: b.amountMinor })) };
  },
  "subscriptions.mrr_bridge": async (x) => {
    const r = await x.once("subscriptions", () => subscriptionsReport(x.ctx.store, x.period, x.ctx.now));
    return { rows: bars(bridgeBars(r, () => "").map((b) => ({ label: b.label, value: b.value }))) };
  },

  // ---- Traffic, refunds and returns ----
  "traffic.devices": async (x) => {
    const t = await traffic(x);
    return {
      rows: t.byDevice.map((r) => ({
        device: r.key === "unknown" ? "Unknown" : r.label,
        sessions: r.sessions,
        share: r.key === "unknown" ? null : deviceShare(t.byDevice, r.key),
        conversion: r.conversion,
        aov: r.aov,
        orders: r.orders,
        revenue: r.revenueMinor,
      })),
      leftOut: left(t),
    };
  },
  "traffic.countries": async (x) => {
    const [g, t] = await Promise.all([geo(x), traffic(x)]);
    return {
      rows: countryRows(g, t).map((r) => ({ country: r.name, orders: r.orders, revenue: r.revenueMinor, share: r.shareOfRevenue, aov: r.aovMinor, new: r.newCustomers, sessions: r.sessions, conversion: r.conversion })),
      leftOut: left(g),
    };
  },
  "traffic.cities": async (x) => {
    const g = await geo(x);
    return { rows: g.cities.map((c) => ({ city: c.city, country: c.countryName, orders: c.orders, revenue: c.revenueMinor, share: c.shareOfRevenue, aov: c.aovMinor })), leftOut: left(g) };
  },
  "traffic.landing": async (x) => {
    const t = await traffic(x);
    return { rows: t.landingPages.map((r) => ({ page: landingLabel(r), kind: KIND_LABEL[r.kind], sessions: r.sessions, orders: r.orders, conversion: r.conversion, revenue: r.revenueMinor })), leftOut: left(t) };
  },
  "traffic.zero_terms": async (x) => {
    const s = await search(x);
    return { rows: s.zeroTerms.map((r) => ({ term: r.term === "" ? "(empty search)" : r.term, searches: r.searches, last: day(r.lastSearchedAt, x.ctx.store.timeZone) })) };
  },
  "traffic.top_terms": async (x) => {
    const s = await search(x);
    return { rows: s.topTerms.map((r) => ({ term: r.term === "" ? "(empty search)" : r.term, searches: r.searches, results: r.avgResults, zero: r.zeroResults, clicked: r.clicked, ctr: r.clickThrough })) };
  },
  "traffic.funnel": async (x) => {
    const t = await traffic(x);
    return { rows: t.funnel.stages.map((s) => ({ stage: s.label, count: s.count })), leftOut: left(t) };
  },
  "traffic.heatmap": async (x) => {
    const t = await time(x);
    const bands = bandHours(t.heatmap, 2);
    const names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
    return {
      rows: bands.bands.map((band, b) => ({ band: band.label, ...Object.fromEntries(names.map((n, d) => [n, bands.cells[d][b].orders])) })),
      leftOut: left(t),
    };
  },
  "traffic.weekdays": async (x) => {
    const t = await time(x);
    return { rows: bars(FULL_WEEKDAYS.map((label, i) => ({ label, value: t.heatmap.rowTotals[i].orders }))), leftOut: left(t) };
  },
  "traffic.refund_products": async (x) => {
    const r = await refunds(x);
    return { rows: r.products.map((p) => ({ product: p.name, value: p.valueMinor, share: p.share, refunds: p.refunds, restocked: p.productId === null ? null : p.restockedUnits })), leftOut: left(r) };
  },
  "traffic.refund_segments": async (x) => {
    const r = await refunds(x);
    const segments = r.segments.filter((s) => s.segment !== "unknown" || s.refunds > 0);
    return { rows: segments.map((s) => ({ segment: s.label, value: s.valueMinor, share: s.share, refunds: s.refunds, orders: s.orders })), leftOut: left(r) };
  },
  "traffic.refund_markets": async (x) => {
    const r = await refunds(x);
    // Every country the store had: past orders keep their country's name (D178).
    const names = Object.fromEntries(x.ctx.store.allMarkets.map((m) => [m.code, m.name]));
    return { rows: r.markets.map((m) => ({ market: marketName(names, m.market), value: m.valueMinor, refunds: m.refunds, orders: m.orders, revenue: m.revenueMinor, rate: m.rate })), leftOut: left(r) };
  },
  "traffic.refund_reasons": async (x) => {
    const r = await refunds(x);
    const rows = r.reasons.map((y) => ({ label: y.label, value: y.valueMinor }));
    // The page's last bar sums the reasons under the most common ones.
    if (r.other.reasons > 0) rows.push({ label: `${r.other.reasons} other ${r.other.reasons === 1 ? "reason" : "reasons"}`, value: r.other.valueMinor });
    return { rows: bars(rows), leftOut: left(r) };
  },
  "traffic.return_kinds": async (x) => {
    const r = await returns(x);
    return { rows: r.kinds.map((k) => ({ kind: k.label, returns: k.returns, units: k.units, declined: k.kind === "withdrawal" ? null : k.declined, cancelled: k.cancelled, refunded: k.refunded, value: k.refundedMinor })), leftOut: left(r) };
  },
  "traffic.return_timing": async (x) => {
    const r = await returns(x);
    const timing = [
      { what: "Request to refund", t: r.timing.requestToRefund },
      { what: "Goods received to refund", t: r.timing.receivedToRefund },
    ];
    return { rows: timing.map(({ what, t }) => ({ what, n: t.n, median: t.medianDays, slowest: t.slowestDays })) };
  },
  "traffic.return_products": async (x) => {
    const r = await returns(x);
    return { rows: r.products.map((p) => ({ product: p.name, returned: p.returnedUnits, sold: p.sold, rate: p.rate.value, value: p.returnedMinor })), leftOut: left(r) };
  },
  "traffic.return_reasons": async (x) => {
    const r = await returns(x);
    return { rows: bars(r.reasons.rows.map((y) => ({ label: y.label, value: y.returns }))), leftOut: left(r) };
  },

  // ---- What the owner entered ----
  "settings.spend": async (x) => {
    // The page lists the latest 25 entries; the file lists every entry of the period (up to a thousand), newest first, from the same reader.
    const entries = await listSpend(x.ctx.store.id, { from: x.period.from, to: x.period.to, limit: 1000 });
    return { rows: entries.map((e) => ({ day: e.day, channel: channelLabel(e.channel), campaign: e.campaign, amount: e.amountMinor, note: e.note })) };
  },
  "settings.targets": async (x) => {
    const today = todayIn(x.ctx.now, x.ctx.store.timeZone);
    const shown = upcomingTargets(await listTargets(x.ctx.store.id, 60), today);
    return { rows: shown.map((t) => ({ month: t.month.slice(0, 7), target: t.revenueTargetMinor })), period: asOf(x) };
  },
};

// ---------------------------------------------------------------------------
// The reports the builders share (read once per export, as the pages read them)
// ---------------------------------------------------------------------------

const financeOf = async (x: Run, period: AnalyticsPeriod) => {
  const { totals, unconverted, missingCurrencies } = await periodTotals(x.ctx.store, period, x.ctx.settings);
  return { totals, statement: financeStatement(totals, x.ctx.settings, period.days), unconverted, missingCurrencies };
};
const customers = (x: Run) => x.once("customers", () => customersReport(x.ctx.store, x.period, x.ctx.settings, x.ctx.now));
const products = (x: Run) => x.once("products", () => productsReport(x.ctx.store, x.period, x.against));
const traffic = (x: Run) => x.once("traffic", () => trafficReport(x.ctx.store, x.period, x.ctx.now));
const geo = (x: Run) => x.once("geo", () => geoReport(x.ctx.store, x.period));
const search = (x: Run) => x.once("search", () => searchReport(x.ctx.store, x.period, x.ctx.now));
const time = (x: Run) => x.once("time", () => timeReport(x.ctx.store, x.period));
const refunds = (x: Run) => x.once("refunds", () => refundsReport(x.ctx.store, x.period));
const returns = (x: Run) => x.once("returns", () => returnsReport(x.ctx.store, x.period, x.ctx.now));

/** A table with no period (the stock today, what the owner has entered) says the day it was made. */
const asOf = (x: Run): ExportPeriod => {
  const today = todayIn(x.ctx.now, x.ctx.store.timeZone);
  return { from: today, to: addDays(today, 1) };
};

/** A cohort row's figures by the table's offsets: `month_0`, `month_1` … (a month not over yet is blank, never zero). */
const offsets = (columns: readonly number[], values: readonly (number | null)[]): Row => Object.fromEntries(COHORT_OFFSETS.map((o) => [`month_${o}`, columns.includes(o) ? (values[columns.indexOf(o)] ?? null) : null]));

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

export type AnalyticsExportResult =
  | { ok: true; filename: string; csv: string; rows: number }
  | { ok: false; reason: "unknown" | "forbidden" | "failed"; message: string };

const FORBIDDEN: AnalyticsExportResult = { ok: false, reason: "forbidden", message: "Exports need the analytics role with write access." };
const UNKNOWN: AnalyticsExportResult = { ok: false, reason: "unknown", message: "That table cannot be downloaded." };

/** Whether this member may download this table (`analytics:write`, and the owner role for the tables of `OWNER_ONLY_TABLES`). */
export const mayExportTable = (member: Membership, tableId: string): boolean =>
  memberCan(member, "analytics:write") &&
  (!OWNER_ONLY_TABLES.has(tableId) || memberCan(member, "owner")) &&
  // The subscriptions page is hidden while that feature is off (D178), and so are its files.
  (ANALYTICS_TABLES[tableId]?.page !== "subscriptions" || featureOn(member.store, "subscriptions"));

/** The table's rows as the page draws them for an address, before they are written: what the tests compare with the loaders. */
export async function buildTable(ctx: AnalyticsContext, tableId: string, query: Query): Promise<{ table: AnalyticsTable; data: TableData; leftOut: LeftOut } | null> {
  const table = Object.hasOwn(ANALYTICS_TABLES, tableId) ? ANALYTICS_TABLES[tableId] : null;
  const build = table && Object.hasOwn(BUILDERS, tableId) ? BUILDERS[tableId] : null;
  if (!table || !build) return null;
  const kept = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, read: () => Promise<T>): Promise<T> => {
    if (!kept.has(key)) kept.set(key, read());
    return kept.get(key) as Promise<T>;
  };
  const { period, compare } = ctx.params;
  const run: Run = { ctx, query, currency: mainCurrency(ctx.store), period, against: compare.mode === "none" ? null : (compare.previous ?? compare.lastYear), once };
  const built = await build(run);
  const comparing = !!built.previous && table.columns.some((c) => c.previous);
  const data: TableData = {
    rows: built.rows,
    period: built.period ?? span(period),
    previous: comparing && built.previous ? { period: built.previous.period, rows: built.previous.rows } : null,
    currency: run.currency,
  };
  return { table, data, leftOut: built.leftOut ?? NONE };
}

/**
 * The file for a table and the page's address (`query`: the period, the comparison and the sort, as `queryText()` carried them). The member has
 * passed the route's guard; this checks the table's own (`mayExportTable()`), makes the file and writes the activity-log entry before returning it.
 */
export async function exportAnalyticsTable(member: Membership, tableId: unknown, rawQuery: Query, dialect: unknown = "excel_nordic"): Promise<AnalyticsExportResult> {
  if (typeof tableId !== "string" || !Object.hasOwn(ANALYTICS_TABLES, tableId)) return UNKNOWN;
  if (!mayExportTable(member, tableId)) return FORBIDDEN;
  const ctx = await analyticsContextFor(member, rawQuery);
  const built = await buildTable(ctx, tableId, rawQuery);
  if (!built) return UNKNOWN;
  const id: DialectId = isDialect(dialect) ? dialect : "excel_nordic";
  const csv = writeCsv(tableFileRows(built.table, built.data), id);
  const rows = built.data.rows.length;
  const period = built.data.period;
  try {
    await audit(member.account.id, member.store.id, "analytics.table_exported", {
      table: tableId,
      from: period.from,
      to: lastDayOf(period.to),
      compared: !!built.data.previous,
      rows,
      leftOutOrders: built.leftOut.orders,
      leftOutCurrencies: built.leftOut.currencies,
    });
  } catch (error) {
    console.error("analytics.export_not_logged", error instanceof Error ? error.message : error);
    return { ok: false, reason: "failed", message: "The export could not be logged, so no file was made. Try again." };
  }
  return { ok: true, filename: tableFileName(built.table, period), csv, rows };
}
