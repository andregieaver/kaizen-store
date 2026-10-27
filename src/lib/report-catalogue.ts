/**
 * The report layer's catalogue (wave 8 unit A, D345, `docs/wave-8-analytics-ai.md` section 3, `docs/analytics.md` Reports): what an owner,
 * and later the AI manager, may ask a report for. A report is a `ReportSpec` (metrics, dimensions, filters, a period and a comparison, a
 * sort and a limit), never SQL: `src/server/report-query.ts` is the one module that turns it into a query, from this catalogue.
 *
 * Pure and free of zod (the builder draws it in the browser); the schema is `report-catalogue-schema.ts`, and the words are the
 * `customReports` admin catalogue. Every metric is defined in `docs/analytics.md`, and the grain it is counted at decides which cuts it
 * allows:
 *
 * - `order`: counted from paid orders (`PAID`), dated by `placed_at`. Cut by a line dimension (product, variant, category, tag, kind), an
 *   order metric is counted from the order's lines: net sales and VAT from the lines' own amounts, with the rest of each order (shipping, an
 *   order's own discount, lines with no product) as a row of its own, so the table still adds up to the period; orders and customers count
 *   those that bought it, which do not add up across rows.
 * - `line`: counted from the lines of paid orders, gift cards left out (they are not sales, D300).
 * - `refund`: succeeded refunds dated by their own day, without VAT by their order's share, as Finance counts them; cut only by what a refund
 *   has (the day, the order's country and type of customer, the payment's currency and method).
 */

export const METRIC_KEYS = ["net_sales", "gross_sales", "discounts", "refunds", "orders", "units", "aov", "customers", "gross_profit", "vat"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const DIMENSION_KEYS = [
  "day",
  "week",
  "month",
  "quarter",
  "product",
  "variant",
  "category",
  "tag",
  "kind",
  "market",
  "currency",
  "channel",
  "device",
  "discount_code",
  "payment_method",
  "customer_type",
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export type MetricKind = "money" | "count" | "average";
export type Grain = "order" | "line" | "refund";
export type DimensionLevel = "time" | "order" | "line";

export type MetricDef = {
  key: MetricKey;
  kind: MetricKind;
  grain: Grain;
  /** Whether a column of it adds up to its total when cut by a line dimension (orders and customers who bought something do not). */
  addsUpByLine: boolean;
  /** Whether it adds up across rows of an order dimension (customers do not: one can buy in two countries). */
  addsUpByOrder: boolean;
  /** The line dimensions it may be cut by. */
  byLine: boolean;
};

export const METRICS: Record<MetricKey, MetricDef> = {
  net_sales: { key: "net_sales", kind: "money", grain: "order", addsUpByLine: true, addsUpByOrder: true, byLine: true },
  gross_sales: { key: "gross_sales", kind: "money", grain: "line", addsUpByLine: true, addsUpByOrder: true, byLine: true },
  discounts: { key: "discounts", kind: "money", grain: "line", addsUpByLine: true, addsUpByOrder: true, byLine: true },
  refunds: { key: "refunds", kind: "money", grain: "refund", addsUpByLine: true, addsUpByOrder: true, byLine: false },
  orders: { key: "orders", kind: "count", grain: "order", addsUpByLine: false, addsUpByOrder: true, byLine: true },
  units: { key: "units", kind: "count", grain: "line", addsUpByLine: true, addsUpByOrder: true, byLine: true },
  aov: { key: "aov", kind: "average", grain: "order", addsUpByLine: false, addsUpByOrder: false, byLine: false },
  customers: { key: "customers", kind: "count", grain: "order", addsUpByLine: false, addsUpByOrder: false, byLine: true },
  gross_profit: { key: "gross_profit", kind: "money", grain: "line", addsUpByLine: true, addsUpByOrder: true, byLine: true },
  vat: { key: "vat", kind: "money", grain: "order", addsUpByLine: true, addsUpByOrder: true, byLine: true },
};

export type DimensionDef = {
  key: DimensionKey;
  level: DimensionLevel;
  /** A refund can be cut by it. */
  refunds: boolean;
};

const dim = (key: DimensionKey, level: DimensionLevel, refunds: boolean): DimensionDef => ({ key, level, refunds });

export const DIMENSIONS: Record<DimensionKey, DimensionDef> = {
  day: dim("day", "time", true),
  week: dim("week", "time", true),
  month: dim("month", "time", true),
  quarter: dim("quarter", "time", true),
  product: dim("product", "line", false),
  variant: dim("variant", "line", false),
  category: dim("category", "line", false),
  tag: dim("tag", "line", false),
  kind: dim("kind", "line", false),
  market: dim("market", "order", true),
  currency: dim("currency", "order", true),
  channel: dim("channel", "order", false),
  device: dim("device", "order", false),
  discount_code: dim("discount_code", "order", false),
  payment_method: dim("payment_method", "order", true),
  customer_type: dim("customer_type", "order", true),
};

/** Dimensions where a line or an order can be counted in several rows (a product in two categories, an order with two codes). */
export const OVERLAPPING: ReadonlySet<DimensionKey> = new Set(["category", "tag", "discount_code"]);

export const MAX_METRICS = 6;
export const MAX_DIMENSIONS = 2;
export const MAX_FILTERS = 10;
export const MAX_FILTER_VALUES = 50;
export const MAX_ROWS = 500;
export const DEFAULT_ROWS = 100;

export const PERIOD_PRESETS = ["today", "yesterday", "7d", "30d", "month", "last_month", "year", "custom"] as const;
export type ReportPreset = (typeof PERIOD_PRESETS)[number];
export const COMPARE_KEYS = ["previous", "year", "none"] as const;
export type ReportCompare = (typeof COMPARE_KEYS)[number];

export type ReportFilter = { dimension: DimensionKey; values: string[] };

export type ReportSpec = {
  metrics: MetricKey[];
  dimensions: DimensionKey[];
  filters: ReportFilter[];
  period: { preset: ReportPreset; from?: string; to?: string; compare: ReportCompare };
  /** A metric key or a dimension key, descending for a metric and ascending for a dimension; none: the first time dimension, else the first metric. */
  sort?: MetricKey | DimensionKey;
  limit: number;
  chart: "table" | "bar" | "line";
};

export type SpecProblem =
  | { kind: "no_metric" }
  | { kind: "too_many_metrics" }
  | { kind: "too_many_dimensions" }
  | { kind: "two_time_dimensions" }
  | { kind: "repeated"; key: MetricKey | DimensionKey }
  | { kind: "not_by_line"; metric: MetricKey; dimension: DimensionKey }
  | { kind: "refunds_by"; dimension: DimensionKey }
  | { kind: "too_many_filters" }
  | { kind: "empty_filter"; dimension: DimensionKey }
  | { kind: "custom_period" }
  | { kind: "sort"; key: string }
  | { kind: "limit" };

export const isMetric = (value: unknown): value is MetricKey => (METRIC_KEYS as readonly unknown[]).includes(value);
export const isDimension = (value: unknown): value is DimensionKey => (DIMENSION_KEYS as readonly unknown[]).includes(value);
export const isTime = (key: DimensionKey): boolean => DIMENSIONS[key].level === "time";
export const isLineDim = (key: DimensionKey): boolean => DIMENSIONS[key].level === "line";

/** The dimensions a metric may be cut by. */
export function allowedDimensions(metric: MetricKey): DimensionKey[] {
  const def = METRICS[metric];
  return DIMENSION_KEYS.filter((d) => (def.grain === "refund" ? DIMENSIONS[d].refunds : def.byLine || !isLineDim(d)));
}

/** Whether every chosen metric may be cut by the dimension: what the builder offers. */
export function dimensionAllowed(metrics: readonly MetricKey[], dimension: DimensionKey): boolean {
  return metrics.every((m) => allowedDimensions(m).includes(dimension));
}

/** Every reason a spec cannot be run, in order; empty when it can. Filters count as cuts: refunds cannot be filtered by a product. */
export function specProblems(spec: ReportSpec): SpecProblem[] {
  const problems: SpecProblem[] = [];
  if (spec.metrics.length === 0) problems.push({ kind: "no_metric" });
  if (spec.metrics.length > MAX_METRICS) problems.push({ kind: "too_many_metrics" });
  if (spec.dimensions.length > MAX_DIMENSIONS) problems.push({ kind: "too_many_dimensions" });
  if (spec.dimensions.filter(isTime).length > 1) problems.push({ kind: "two_time_dimensions" });
  for (const list of [spec.metrics, spec.dimensions] as const) {
    const seen = new Set<string>();
    for (const key of list) {
      if (seen.has(key)) problems.push({ kind: "repeated", key });
      seen.add(key);
    }
  }
  const cuts = [...spec.dimensions, ...spec.filters.map((f) => f.dimension).filter((d) => !spec.dimensions.includes(d))];
  for (const metric of spec.metrics) {
    for (const dimension of cuts) {
      if (allowedDimensions(metric).includes(dimension)) continue;
      problems.push(METRICS[metric].grain === "refund" ? { kind: "refunds_by", dimension } : { kind: "not_by_line", metric, dimension });
    }
  }
  if (spec.filters.length > MAX_FILTERS) problems.push({ kind: "too_many_filters" });
  for (const filter of spec.filters) {
    if (filter.values.length === 0 || filter.values.length > MAX_FILTER_VALUES) problems.push({ kind: "empty_filter", dimension: filter.dimension });
  }
  if (spec.period.preset === "custom" && (!spec.period.from || !spec.period.to)) problems.push({ kind: "custom_period" });
  if (spec.sort !== undefined && !spec.metrics.includes(spec.sort as MetricKey) && !spec.dimensions.includes(spec.sort as DimensionKey)) {
    problems.push({ kind: "sort", key: spec.sort });
  }
  if (!Number.isInteger(spec.limit) || spec.limit < 1 || spec.limit > MAX_ROWS) problems.push({ kind: "limit" });
  return problems;
}

/** The grain a metric is counted at in this report: an order metric cut or filtered by a line dimension is counted from lines. */
export function grainIn(spec: Pick<ReportSpec, "dimensions" | "filters">, metric: MetricKey): Grain {
  const grain = METRICS[metric].grain;
  if (grain !== "order") return grain;
  const byLine = spec.dimensions.some(isLineDim) || spec.filters.some((f) => isLineDim(f.dimension));
  return byLine && metric !== "aov" ? "line" : "order";
}

/**
 * Whether a column adds up to its total: false for orders and customers cut by a line dimension (an order holds several products), for
 * customers and averages always, and for any metric cut by a dimension where one thing sits in several rows (categories, tags, codes).
 */
export function columnAddsUp(spec: Pick<ReportSpec, "dimensions">, metric: MetricKey): boolean {
  const def = METRICS[metric];
  if (def.kind === "average") return false;
  if (spec.dimensions.some((d) => OVERLAPPING.has(d))) return false;
  if (spec.dimensions.some(isLineDim) && !def.addsUpByLine) return false;
  if (spec.dimensions.some((d) => DIMENSIONS[d].level === "order") && !def.addsUpByOrder) return false;
  return true;
}

/** Whether the table gets a row for what is not in any line (shipping, an order's own discount): an order money metric cut by a line dimension. */
export function needsRestRow(spec: Pick<ReportSpec, "metrics" | "dimensions">): boolean {
  return spec.dimensions.some(isLineDim) && spec.metrics.some((m) => METRICS[m].grain === "order" && METRICS[m].kind === "money");
}

/** The sort a spec gets: what it says, else the time dimension ascending, else the first metric descending. */
export function sortOf(spec: Pick<ReportSpec, "metrics" | "dimensions" | "sort">): { key: MetricKey | DimensionKey; descending: boolean } {
  if (spec.sort) return { key: spec.sort, descending: isMetric(spec.sort) };
  const time = spec.dimensions.find(isTime);
  if (time) return { key: time, descending: false };
  return { key: spec.metrics[0], descending: true };
}

// ---------------------------------------------------------------------------
// Ready reports: Homer's start, one press each
// ---------------------------------------------------------------------------

export const READY_KEYS = [
  "sales_by_product",
  "sales_by_variant",
  "sales_by_category",
  "sales_by_country",
  "sales_by_currency",
  "sales_by_payment_method",
  "sales_by_channel",
  "sales_by_day",
  "new_and_returning",
  "discount_codes",
] as const;
export type ReadyKey = (typeof READY_KEYS)[number];

const ready = (metrics: MetricKey[], dimensions: DimensionKey[], period: ReportPreset = "30d"): ReportSpec => ({
  metrics,
  dimensions,
  filters: [],
  period: { preset: period, compare: "previous" },
  limit: DEFAULT_ROWS,
  chart: dimensions.some(isTime) ? "line" : "table",
});

export const READY_REPORTS: Record<ReadyKey, ReportSpec> = {
  sales_by_product: ready(["net_sales", "units", "orders", "gross_profit"], ["product"]),
  sales_by_variant: ready(["net_sales", "units", "orders"], ["variant"]),
  sales_by_category: ready(["net_sales", "units", "orders"], ["category"]),
  sales_by_country: ready(["net_sales", "orders", "aov", "customers"], ["market"]),
  sales_by_currency: ready(["net_sales", "orders", "aov"], ["currency"]),
  sales_by_payment_method: ready(["net_sales", "orders", "refunds"], ["payment_method"]),
  sales_by_channel: ready(["net_sales", "orders", "aov"], ["channel"]),
  sales_by_day: ready(["net_sales", "orders", "units", "refunds"], ["day"]),
  new_and_returning: ready(["net_sales", "orders", "customers", "aov"], ["customer_type"]),
  discount_codes: ready(["net_sales", "discounts", "orders"], ["discount_code"]),
};

export const blankSpec = (): ReportSpec => ready(["net_sales", "orders"], ["day"]);

// ---------------------------------------------------------------------------
// Words: what a report is, said from its spec
// ---------------------------------------------------------------------------

export type CatalogueWords = {
  metrics: Record<MetricKey, string>;
  dimensions: Record<DimensionKey, string>;
  describe: {
    /** "{metrics} by {dimensions}" */
    by: string;
    /** "{metrics}" when there is no dimension */
    total: string;
    and: string;
    /** "only where {dimension} is {values}" */
    filter: string;
    or: string;
    /** "{period}, compared with {comparison}" */
    compared: string;
    /** Paid orders, without VAT, in the main currency. */
    basis: string;
  };
};

const list = (items: string[], and: string): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;

/** A name inside a sentence: "Units sold" becomes "units sold", an abbreviation ("VAT") stays as it is. */
const inSentence = (name: string): string => (/^[A-ZÆØÅ][a-zæøå]/.test(name) ? `${name.charAt(0).toLowerCase()}${name.slice(1)}` : name);

const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);

/**
 * The definition of a report in one sentence, from its spec only: "Net sales and units by product, only where country is NO, Last 30
 * days, compared with the previous period. Paid orders, without VAT, in NOK." The period's own words and the currency come from the caller.
 */
export function describeSpec(spec: ReportSpec, words: CatalogueWords, extra: { period: string; comparison: string | null; currency: string; filterValue?: (d: DimensionKey, v: string) => string }): string {
  const metrics = list(spec.metrics.map((m, i) => (i === 0 ? words.metrics[m] : inSentence(words.metrics[m]))), words.describe.and);
  const head = spec.dimensions.length
    ? fill(words.describe.by, { metrics, dimensions: list(spec.dimensions.map((d) => inSentence(words.dimensions[d])), words.describe.and) })
    : fill(words.describe.total, { metrics });
  const filters = spec.filters.map((f) =>
    fill(words.describe.filter, {
      dimension: inSentence(words.dimensions[f.dimension]),
      values: list(f.values.map((v) => extra.filterValue?.(f.dimension, v) ?? v), words.describe.or),
    }),
  );
  const when = extra.comparison ? fill(words.describe.compared, { period: extra.period, comparison: extra.comparison }) : extra.period;
  const first = [head, ...filters, when].join(", ");
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}. ${fill(words.describe.basis, { currency: extra.currency })}`;
}
