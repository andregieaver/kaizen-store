import { change, changePoints, formatChange, formatCount, formatPercent, formatPoints, NO_FIGURE, safeRatio, verdictOf, type GoodDirection, type Verdict } from "./analytics-core";
import { formatAmount } from "./analytics-format";

/**
 * The figures of a period and what is worked out from them (D152,
 * docs/analytics.md). `Totals` is what the server's SQL adds up; `derive()` is
 * the only place profit, margin, conversion and the rest are calculated, and
 * `KPI_CARDS` is the overview's first screen.
 */

/**
 * The store's own cost settings (`analytics_settings`). All amounts are minor
 * units of the main currency.
 */
export type AnalyticsSettings = {
  /** Payment fee as basis points of an order's total with VAT (140 = 1.4 %). */
  paymentFeeBps: number;
  /** Payment fee per paid order. */
  paymentFeeFixedMinor: number;
  /** What sending one order with a physical line costs the store. */
  shippingCostMinor: number;
  /** Rent, salaries and the like per month. */
  fixedCostsMonthlyMinor: number;
  /** Years a customer is expected to stay, for predicted lifetime value. */
  ltvLifespanYears: number;
};

export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = {
  paymentFeeBps: 0,
  paymentFeeFixedMinor: 0,
  shippingCostMinor: 0,
  fixedCostsMonthlyMinor: 0,
  ltvLifespanYears: 3,
};

/**
 * What one period adds up to, in minor units of the store's main currency and
 * without VAT unless said. Paid orders only (docs/analytics.md, "Paid order").
 */
export type Totals = {
  /** Paid orders. */
  orders: number;
  /**
   * Of them, the orders from a shopper's own checkout (`orders.source = 'checkout'`): conversion rate counts these only, as a staff-made order (D173) was
   * not a visit. Absent means every order is one (totals made by hand, older fixtures).
   */
  checkoutOrders?: number;
  /** Goods before discounts. */
  grossSalesMinor: number;
  /** Every discount (campaign, group, referral, bonus credit, code; a free-shipping code's discount on shipping too), without VAT, positive. */
  discountsMinor: number;
  /** Shipping income before its discount, without its VAT: gross sales − discounts + shipping income = revenue. */
  shippingMinor: number;
  /** VAT collected on everything. */
  vatMinor: number;
  /** Σ (total − tax): gross sales − discounts + shipping income, give or take rounding. */
  revenueMinor: number;
  /** Succeeded refunds in the period (by their own date), without VAT, positive. */
  refundsMinor: number;
  /** Σ unit cost × quantity of lines whose cost was known. */
  cogsMinor: number;
  /** The part of the lines' revenue (after discounts, without VAT) whose cost was known (no-variant lines count as known; a custom item staff typed into a draft, D173, does not: its cost is not known). Shipping income is not a line. */
  knownCostRevenueMinor: number;
  /** Σ (total − tax) over the order lines: what `knownCostRevenueMinor` is a share of (revenue less shipping income, give or take rounding). */
  lineRevenueMinor: number;
  /** Estimated payment fees (see `paymentFees()`). */
  paymentFeesMinor: number;
  /** What Kaizen took on the period's captured payments. */
  platformFeesMinor: number;
  /** Estimated shipping costs (orders with a physical line × `shippingCostMinor`). */
  shippingCostsMinor: number;
  /** Marketing spend entered by the owner. */
  marketingMinor: number;
  /** Visitor-days counted; null when visit counting is off or has no days in the period. */
  sessions: number | null;
  /** Customers whose first paid order is in the period. */
  newCustomers: number;
  /** Customers with a paid order in the period and an earlier first one. */
  returningCustomers: number;
  /** Units of goods sold. */
  units: number;
};

export const EMPTY_TOTALS: Totals = {
  orders: 0,
  grossSalesMinor: 0,
  discountsMinor: 0,
  shippingMinor: 0,
  vatMinor: 0,
  revenueMinor: 0,
  refundsMinor: 0,
  cogsMinor: 0,
  knownCostRevenueMinor: 0,
  lineRevenueMinor: 0,
  paymentFeesMinor: 0,
  platformFeesMinor: 0,
  shippingCostsMinor: 0,
  marketingMinor: 0,
  sessions: null,
  newCustomers: 0,
  returningCustomers: 0,
  units: 0,
};

/** Below this share of sales with known costs, a profit figure carries a warning. */
export const COVERAGE_WARN = 0.8;

/**
 * The least cost coverage (docs/analytics.md, "Gross profit") at which profit is estimated. From here up to (not including) 1 gross,
 * contribution and operating profit are ESTIMATES: the cost of goods known for the covered sales is scaled up to all the sales
 * (`estimatedCogs()`). Below it too little is known to scale, so profit has no figure (and a prompt to add costs), as with no cost
 * at all. At 1 the figures are exact.
 */
export const ESTIMATE_MIN_COVERAGE = 0.3;

/**
 * Cost coverage (docs/analytics.md): the share of the lines' revenue whose cost is known, so shipping income (not a product, no cost
 * to know) never counts as known; with no product cost entered it is 0. Null without revenue. Totals made without line revenue
 * (`lineRevenueMinor` 0 beside revenue) are read against revenue.
 */
export function costCoverageOf(t: Pick<Totals, "revenueMinor" | "lineRevenueMinor" | "knownCostRevenueMinor">): number | null {
  if (t.revenueMinor <= 0) return null;
  const base = t.lineRevenueMinor > 0 ? t.lineRevenueMinor : t.revenueMinor;
  return Math.min(1, Math.max(0, t.knownCostRevenueMinor / base));
}

/** Days in a year, for spreading monthly fixed costs by day. */
const DAYS_PER_YEAR = 365;

/** Fixed costs for a number of days: twelve months over 365 days, so a day costs the same in every month. */
export function fixedCostsFor(settings: Pick<AnalyticsSettings, "fixedCostsMonthlyMinor">, days: number): number {
  if (days <= 0 || settings.fixedCostsMonthlyMinor <= 0) return 0;
  return Math.round((settings.fixedCostsMonthlyMinor * 12 * days) / DAYS_PER_YEAR);
}

/** Words for how much of sales a profit figure rests on: "based on 83 % of sales". */
export function coverageText(coverage: number | null): string {
  return coverage === null ? "no sales yet" : `based on ${formatPercent(coverage, 0)} of sales`;
}

/** What `derive()` works out. Shares are ratios (0.834 is 83.4 %); amounts are minor units, rounded whole. */
export type Derived = {
  // Straight from the totals, so a card needs only this.
  orders: number;
  revenue: number;
  units: number;
  sessions: number | null;
  newCustomers: number;
  returningCustomers: number;
  /** Revenue − refunds. */
  netRevenue: number;
  /** Revenue / orders; null without orders. */
  aov: number | null;
  /**
   * Revenue share of lines whose cost is known, 0..1; null when there was no
   * revenue (nothing to cost).
   */
  costCoverage: number | null;
  /**
   * Net revenue − COGS: exact at coverage 1, ESTIMATED from coverage 0.3 up (COGS scaled to all the sales, `estimatedCogs()`), null
   * below 0.3 (too little is known; it would be revenue, not profit).
   */
  grossProfit: number | null;
  /** Whether `grossProfit` and what follows it are estimates (0.3 <= coverage < 1). */
  profitEstimated: boolean;
  /** Gross margin on the covered sales only (`coveredMargin()`), whenever any cost is known; null without coverage. */
  grossMarginPct: number | null;
  /** Net revenue − COGS − payment fees − platform fees − shipping costs − marketing; estimated and missing with gross profit. */
  contributionProfit: number | null;
  /** The period's pro rata share of the fixed costs. */
  fixedCosts: number;
  /** Contribution profit − fixed costs; null with contribution profit. */
  operatingProfit: number | null;
  /** Orders / sessions; null without sessions. */
  conversionRate: number | null;
  /** Net revenue / sessions. */
  revenuePerVisitor: number | null;
  /** Contribution profit / sessions. */
  contributionPerVisitor: number | null;
  /** Refunds / revenue. */
  refundRate: number | null;
};

/**
 * How well the cost of goods is known (docs/analytics.md, "Gross profit"): `exact` when it is known for every sale (or nothing was
 * sold), `estimated` from `ESTIMATE_MIN_COVERAGE` up to, not including, 1, `missing` below that (profit has no figure).
 */
export type CostMode = "exact" | "estimated" | "missing";

export function costModeOf(coverage: number | null): CostMode {
  if (coverage === null || coverage >= 1) return "exact";
  return coverage >= ESTIMATE_MIN_COVERAGE ? "estimated" : "missing";
}

/** Whether profit can be shown, exactly or as an estimate: the cost of goods is known for enough of what was sold, or nothing was sold. */
export function costsKnown(coverage: number | null): boolean {
  return costModeOf(coverage) !== "missing";
}

/**
 * The cost of goods a profit figure is made with: the recorded cost when it is known for every sale; when it is known for only some,
 * scaled to all the goods sold (`cogs / coverage`, which is `cogs / covered revenue × revenue`, the coverage being the covered share
 * of the goods' revenue), rounded; null when too little is known to scale.
 */
export function estimatedCogs(t: Pick<Totals, "cogsMinor">, coverage: number | null): number | null {
  const mode = costModeOf(coverage);
  if (mode === "missing") return null;
  if (mode === "exact" || coverage === null) return t.cogsMinor;
  return Math.round(t.cogsMinor / coverage);
}

/**
 * Gross margin on the COVERED sales only: (covered net revenue − cost of goods) / covered net revenue, where covered net revenue is
 * net revenue × coverage (refunds and shipping income spread in proportion to the covered share). It is shown whenever any cost is
 * known (coverage above 0), with the coverage; at coverage 1 it is gross profit over net revenue exactly. Null without coverage or
 * without net revenue above 0.
 */
export function coveredMargin(t: Pick<Totals, "revenueMinor" | "refundsMinor" | "cogsMinor">, coverage: number | null): number | null {
  if (coverage === null || coverage <= 0) return null;
  const covered = (t.revenueMinor - t.refundsMinor) * coverage;
  return covered > 0 ? (covered - t.cogsMinor) / covered : null;
}

/** "estimated from the 45 % of sales whose cost is known" while profit is an estimate, else null. */
export function estimateText(coverage: number | null): string | null {
  return costModeOf(coverage) === "estimated" && coverage !== null ? `estimated from the ${formatPercent(coverage, 0)} of sales whose cost is known` : null;
}

/** Net revenue less everything it costs the store per order; null while too little of the cost of goods is known (estimated while part of it is). */
function contributionOf(t: Totals, coverage: number | null): number | null {
  const cogs = estimatedCogs(t, coverage);
  if (cogs === null) return null;
  return t.revenueMinor - t.refundsMinor - cogs - t.paymentFeesMinor - t.platformFeesMinor - t.shippingCostsMinor - t.marketingMinor;
}

const whole = (n: number | null) => (n === null ? null : Math.round(n));

/**
 * Everything worked out from a period's totals. Money is rounded to whole minor
 * units. Whatever cannot be known is null, never 0: gross profit and what
 * follows it with too few costs known (below 30 % of sales; from there to 99 % they
 * are estimates, `ESTIMATE_MIN_COVERAGE`), conversion and the per-visitor figures without
 * visit counting.
 *
 * `visitTotals` is for when visit counting began inside the period: pass the
 * totals of only the days both orders and visits are known for, so conversion
 * and per-visitor figures are not understated by days with no visits counted.
 * It defaults to `totals`.
 */
export function derive(totals: Totals, settings: Pick<AnalyticsSettings, "fixedCostsMonthlyMinor">, days: number, visitTotals: Totals = totals): Derived {
  const netRevenue = totals.revenueMinor - totals.refundsMinor;
  const coverage = costCoverageOf(totals);
  const cogs = estimatedCogs(totals, coverage);
  const grossProfit = cogs === null ? null : netRevenue - cogs;
  const contribution = contributionOf(totals, coverage);
  const fixedCosts = fixedCostsFor(settings, days);

  const visitCoverage = costCoverageOf(visitTotals);
  const visitNet = visitTotals.revenueMinor - visitTotals.refundsMinor;
  const sessions = visitTotals.sessions;

  return {
    orders: totals.orders,
    revenue: totals.revenueMinor,
    units: totals.units,
    sessions: totals.sessions,
    newCustomers: totals.newCustomers,
    returningCustomers: totals.returningCustomers,
    netRevenue,
    aov: whole(safeRatio(totals.revenueMinor, totals.orders)),
    costCoverage: coverage,
    grossProfit,
    profitEstimated: costModeOf(coverage) === "estimated",
    grossMarginPct: coveredMargin(totals, coverage),
    contributionProfit: contribution,
    fixedCosts,
    operatingProfit: contribution === null ? null : contribution - fixedCosts,
    conversionRate: sessions && sessions > 0 ? safeRatio(visitTotals.checkoutOrders ?? visitTotals.orders, sessions) : null,
    revenuePerVisitor: sessions && sessions > 0 ? whole(safeRatio(visitNet, sessions)) : null,
    contributionPerVisitor: sessions && sessions > 0 ? whole(safeRatio(contributionOf(visitTotals, visitCoverage), sessions)) : null,
    refundRate: safeRatio(totals.refundsMinor, totals.revenueMinor > 0 ? totals.revenueMinor : null),
  };
}

// ---------- the overview's cards ----------

export type KpiKind = "money" | "count" | "percent";

/** The drill-down pages under `/admin/{store}/analytics`. */
export type AnalyticsPage = "overview" | "finance" | "customers" | "products" | "inventory" | "marketing" | "subscriptions" | "traffic" | "settings";

/** What a figure needs that the store may not have set up. */
export type KpiNeed = "costs" | "visits";

export type KpiId =
  | "revenue"
  | "netRevenue"
  | "orders"
  | "conversion"
  | "aov"
  | "grossProfit"
  | "grossMargin"
  | "newCustomers"
  | "returningCustomers"
  | "refundRate"
  | "sessions"
  | "revenuePerVisitor";

export type KpiCard = {
  id: KpiId;
  label: string;
  kind: KpiKind;
  /** Which way is good news: refunds going down is good. */
  good: GoodDirection;
  /** The page that explains it. */
  page: Exclude<AnalyticsPage, "overview">;
  /** What has to be set up for the figure to exist; null when it always does. */
  needs: KpiNeed | null;
  /** What to tell the owner when the figure is missing for that reason. */
  missingText: string | null;
  /** Where to fix it. */
  fixPage: AnalyticsPage | null;
  /** One line on how it is worked out, for the card's help text. */
  help: string;
};

export const KPI_CARDS: readonly KpiCard[] = [
  {
    id: "revenue",
    label: "Revenue",
    kind: "money",
    good: "up",
    page: "finance",
    needs: null,
    missingText: null,
    fixPage: null,
    help: "Paid orders without VAT, after discounts, with shipping income. Refunds are not taken off here.",
  },
  {
    id: "netRevenue",
    label: "Net revenue",
    kind: "money",
    good: "up",
    page: "finance",
    needs: null,
    missingText: null,
    fixPage: null,
    help: "Revenue less refunds made in the period.",
  },
  {
    id: "orders",
    label: "Orders",
    kind: "count",
    good: "up",
    page: "traffic",
    needs: null,
    missingText: null,
    fixPage: null,
    help: "Paid orders. Unpaid, cancelled-before-payment and copied orders, and hosts' orders, are left out.",
  },
  {
    id: "conversion",
    label: "Conversion rate",
    kind: "percent",
    good: "up",
    page: "traffic",
    needs: "visits",
    missingText: "Needs visit counting, which is off. Switch it on in Analytics settings to see how many visits end in an order.",
    fixPage: "settings",
    help: "Paid orders divided by visits, over the days both are counted.",
  },
  {
    id: "aov",
    label: "Average order value",
    kind: "money",
    good: "up",
    page: "products",
    needs: null,
    missingText: null,
    fixPage: null,
    help: "Revenue divided by paid orders.",
  },
  {
    id: "grossProfit",
    label: "Gross profit",
    kind: "money",
    good: "up",
    page: "finance",
    needs: "costs",
    missingText: "Needs product costs. Enter what a unit costs in the product editor to see profit.",
    fixPage: "settings",
    help: "Net revenue less the cost of the goods sold. When the cost is known for only some sales (30 % or more), it is estimated from those; with less, there is no figure.",
  },
  {
    id: "grossMargin",
    label: "Gross margin",
    kind: "percent",
    good: "up",
    page: "finance",
    needs: "costs",
    missingText: "Needs product costs. Enter what a unit costs in the product editor to see margin.",
    fixPage: "settings",
    help: "Gross profit as a share of net revenue, worked out on the sales whose cost is known.",
  },
  {
    id: "newCustomers",
    label: "New customers",
    kind: "count",
    good: "up",
    page: "customers",
    needs: null,
    missingText: null,
    fixPage: null,
    help: "Customers whose first paid order is in the period.",
  },
  {
    id: "returningCustomers",
    label: "Returning customers",
    kind: "count",
    good: "up",
    page: "customers",
    needs: null,
    missingText: null,
    fixPage: null,
    help: "Customers with a paid order in the period and an earlier first one.",
  },
  {
    id: "refundRate",
    label: "Refund rate",
    kind: "percent",
    good: "down",
    page: "finance",
    needs: null,
    missingText: null,
    fixPage: null,
    help: "Refunds made in the period as a share of revenue. Refunds made only in Stripe's dashboard are not seen.",
  },
  {
    id: "sessions",
    label: "Visits",
    kind: "count",
    good: "neutral",
    page: "traffic",
    needs: "visits",
    missingText: "Needs visit counting, which is off. It sets no cookies and needs no consent banner; switch it on in Analytics settings.",
    fixPage: "settings",
    help: "Visitor-days: one visitor on one day, without bots and without people who ask not to be counted.",
  },
  {
    id: "revenuePerVisitor",
    label: "Revenue per visitor",
    kind: "money",
    good: "up",
    page: "traffic",
    needs: "visits",
    missingText: "Needs visit counting, which is off. Switch it on in Analytics settings.",
    fixPage: "settings",
    help: "Net revenue divided by visits.",
  },
];

export const KPI_BY_ID: ReadonlyMap<KpiId, KpiCard> = new Map(KPI_CARDS.map((c) => [c.id, c]));

/**
 * How each card reads its figure. The cards themselves are plain data, so
 * they can be handed to a client component.
 */
const VALUES: Record<KpiId, (d: Derived) => number | null> = {
  revenue: (d) => d.revenue,
  netRevenue: (d) => d.netRevenue,
  orders: (d) => d.orders,
  conversion: (d) => d.conversionRate,
  aov: (d) => d.aov,
  grossProfit: (d) => d.grossProfit,
  grossMargin: (d) => d.grossMarginPct,
  newCustomers: (d) => d.newCustomers,
  returningCustomers: (d) => d.returningCustomers,
  refundRate: (d) => d.refundRate,
  sessions: (d) => d.sessions,
  revenuePerVisitor: (d) => d.revenuePerVisitor,
};

/** A card's figure for a period; null when it cannot be known. */
export function kpiValue(card: Pick<KpiCard, "id">, derived: Derived): number | null {
  return VALUES[card.id](derived);
}

export type KpiMissing = {
  /** `costs` and `visits` can be fixed in settings; `no-data` is a figure with nothing to work from yet. */
  kind: KpiNeed | "no-data";
  text: string;
  fixPage: AnalyticsPage | null;
};

/** Why a card has no figure, or null when it has one. */
export function kpiMissing(card: KpiCard, derived: Derived): KpiMissing | null {
  if (kpiValue(card, derived) !== null) return null;
  if (card.needs === "visits" && derived.sessions === null) return { kind: "visits", text: card.missingText ?? "Needs visit counting.", fixPage: card.fixPage };
  // A margin or profit with no figure while something was sold means the costs are not there (none, or too few to estimate from).
  if (card.needs === "costs" && derived.costCoverage !== null && !costsKnown(derived.costCoverage)) {
    const partial = derived.costCoverage > 0;
    const text = partial
      ? `Product costs are known for only ${formatPercent(derived.costCoverage, 0)} of sales, too few to estimate ${card.id === "grossMargin" ? "margin" : "profit"}. Enter the rest in the product editor.`
      : (card.missingText ?? "Needs product costs.");
    return { kind: "costs", text, fixPage: card.fixPage };
  }
  return { kind: "no-data", text: "Nothing to work this out from in the period.", fixPage: null };
}

/** A card's figure as the admin writes it; money in the main currency. */
export function formatKpi(card: Pick<KpiCard, "kind">, value: number | null, currency: string, locale = "en"): string {
  if (value === null || !Number.isFinite(value)) return NO_FIGURE;
  if (card.kind === "money") return formatAmount(Math.round(value), currency, locale);
  if (card.kind === "percent") return formatPercent(value, 1);
  return formatCount(value);
}

/** The change in a card's figure: the percentage change for amounts and counts, points for shares. */
export function kpiChange(
  card: Pick<KpiCard, "kind" | "good">,
  current: number | null,
  previous: number | null,
): { text: string; verdict: Verdict; abs: number | null } {
  if (card.kind === "percent") {
    const points = changePoints(current, previous);
    // Under a tenth of a point is noise in a share.
    return { text: formatPoints(points), verdict: verdictOf(points, card.good, 0.05), abs: points };
  }
  const delta = change(current, previous);
  return { text: formatChange(delta), verdict: verdictOf(delta?.abs, card.good), abs: delta?.abs ?? null };
}
