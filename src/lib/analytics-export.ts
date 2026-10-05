/**
 * A CSV for every analytics table (D165, `docs/wave-2-data.md` 2.8, 5.5), pure: the registry of tables (`ANALYTICS_TABLES`), the ones that are
 * deliberately not exportable (`NOT_EXPORTED`, each with a reason), and how a table's rows become cells.
 *
 * The file is the table AS THE PAGE SHOWS IT for the period and comparison in the address: the same rows in the same order, the same figures (the
 * server calls the page's own loaders, never a second query), the period's first and last day in `period_from` / `period_to`, the main currency
 * in a `currency` column where the table has amounts, and where the page compares, a `{column}_previous` column for each compared figure with
 * `previous_from` / `previous_to`. Header names are English snake_case, fixed per table, one per column. Amounts are decimals WITHOUT VAT in the
 * store's main currency (the analytics definition, `docs/analytics.md`). A currency with no rate is left out of the table and counted on the page;
 * the button's label repeats that (`downloadLabel()`) and the audit entry records it, so the file never states more than the page.
 *
 * A table, chart or hand-made table in `src/components/admin/analytics/*-view.tsx` gets a Download CSV button through `exportId` (an id in
 * `ANALYTICS_TABLES`) or says `exportable={false}` with an entry in `NOT_EXPORTED`; `analytics-export-views.test.ts` fails for any other.
 * The VAT, OSS and IOSS tables keep the four files of D161 (their own button and log).
 */
import { amountCell, type Cell } from "./csv";

export type ColumnKind =
  /** Text, written escaped. */
  | "text"
  /** A whole number. */
  | "int"
  /** Minor units of the main currency, written as a decimal. */
  | "amount"
  /** A fraction (0.425) written as a percentage with two decimals ("42.50"); a share, a rate. */
  | "percent"
  /** A figure with decimals that is not money, such as a ratio ("3.4") or days ("12.5"). */
  | "decimal"
  /** A day (`2026-10-05`) or a moment in ISO. */
  | "date"
  | "bool";

export type TableColumn = {
  /** The key of the value in the row the loader gives. */
  key: string;
  /** The header in the file: English snake_case, unique in the table. */
  header: string;
  kind: ColumnKind;
  /** The page compares this figure: the file gets `{header}_previous` when a comparison is on. */
  previous?: boolean;
};

export const ANALYTICS_PAGES = ["overview", "finance", "customers", "products", "inventory", "marketing", "subscriptions", "traffic", "settings", "tax"] as const;
export type AnalyticsPage = (typeof ANALYTICS_PAGES)[number];

/** What drew it: a table, a bar chart, a line chart's series, a heat map, a funnel or a cohort table (all have a data table behind them). */
export type TableShape = "table" | "bars" | "series" | "heatmap" | "funnel" | "cohort";

export type AnalyticsTable = {
  id: string;
  page: AnalyticsPage;
  /** The view file under `src/components/admin/analytics/` that draws it. */
  view: string;
  shape: TableShape;
  /** What it is, as the file's name and the button say. */
  caption: string;
  columns: TableColumn[];
  /** Amounts are in it: the file has a `currency` column. */
  money: boolean;
};

const text = (key: string, header = key): TableColumn => ({ key, header, kind: "text" });
const int = (key: string, header = key, previous = false): TableColumn => ({ key, header, kind: "int", ...(previous ? { previous } : {}) });
const amount = (key: string, header = key, previous = false): TableColumn => ({ key, header, kind: "amount", ...(previous ? { previous } : {}) });
const pct = (key: string, header = key, previous = false): TableColumn => ({ key, header, kind: "percent", ...(previous ? { previous } : {}) });
const dec = (key: string, header = key): TableColumn => ({ key, header, kind: "decimal" });
const date = (key: string, header = key): TableColumn => ({ key, header, kind: "date" });

const table = (id: string, page: AnalyticsPage, view: string, caption: string, columns: TableColumn[], money = false): AnalyticsTable => ({ id, page, view, shape: "table", caption, columns, money });
const bars = (id: string, page: AnalyticsPage, view: string, caption: string, kind: "amount" | "int" | "decimal" = "amount"): AnalyticsTable => ({
  id, page, view, shape: "bars", caption, columns: [text("label"), kind === "amount" ? amount("value") : kind === "int" ? int("value") : dec("value")], money: kind === "amount",
});
const series = (id: string, page: AnalyticsPage, view: string, caption: string, values: TableColumn[], money: boolean): AnalyticsTable => ({
  id, page, view, shape: "series", caption, columns: [date("bucket"), ...values], money,
});

/** The months after the first order a cohort table has a column for (`COHORT_OFFSETS` in `analytics-customers.ts`). */
const MONTHS = [0, 1, 2, 3, 6, 12].map((i) => `month_${i}`);

const REGISTRY: AnalyticsTable[] = [
  // Overview
  series("overview.net_revenue", "overview", "overview-sections.tsx", "Net revenue per period", [{ ...amount("net", "net_revenue", true) }], true),
  series("overview.contribution", "overview", "overview-sections.tsx", "Contribution profit per period", [{ ...amount("profit", "contribution_profit", true) }], true),
  bars("overview.factors", "overview", "overview-sections.tsx", "Change in each factor, in percent", "decimal"),
  { id: "overview.funnel", page: "overview", view: "overview-sections.tsx", shape: "funnel", caption: "Sales funnel", columns: [text("stage"), int("count")], money: false },
  bars("overview.top_revenue", "overview", "overview-sections.tsx", "Top products by revenue"),
  bars("overview.top_profit", "overview", "overview-sections.tsx", "Top products by profit"),
  table("overview.channels", "overview", "overview-sections.tsx", "Top channels by revenue", [text("channel"), amount("revenue"), int("orders"), pct("conversion"), dec("roas")], true),

  // Finance
  table("finance.bridge", "finance", "finance-view.tsx", "From gross sales to operating profit", [text("line"), amount("amount", "amount", true), pct("share_of_net_revenue"), text("estimated")], true),
  bars("finance.where_it_went", "finance", "finance-view.tsx", "Where net revenue went"),
  series("finance.revenue_profit", "finance", "finance-view.tsx", "Net revenue and contribution profit", [amount("net", "net_revenue", true), amount("profit", "contribution_profit")], true),

  // Customers
  table("customers.top", "customers", "customers-view.tsx", "Top customers by revenue", [text("customer"), text("email"), text("account"), int("orders", "orders_in_period"), amount("revenue", "revenue_in_period"), int("lifetime", "orders_to_date"), date("last", "last_order_on")], true),
  { id: "customers.retention", page: "customers", view: "customers-view.tsx", shape: "cohort", caption: "Share of each month's new customers who had bought again", columns: [date("cohort"), int("size", "customers"), ...MONTHS.map((m) => pct(m))], money: false },
  { id: "customers.cohort_revenue", page: "customers", view: "customers-view.tsx", shape: "cohort", caption: "Revenue per customer of each month's new customers", columns: [date("cohort"), int("size", "customers"), ...MONTHS.map((m) => amount(m))], money: true },

  // Products
  table("products.table", "products", "products-view.tsx", "Products with revenue, units, orders, margin, refund rate and shares", [
    text("product"), text("handle"), amount("revenue", "revenue", true), int("units", "units", true), int("orders", "orders"), pct("margin", "margin"), pct("refunds", "refund_rate"), pct("share", "share_of_revenue"), pct("profitShare", "share_of_profit"), int("views", "views"), pct("conversion", "conversion_rate"),
  ], true),
  bars("products.top_revenue", "products", "products-view.tsx", "Top 10 products by revenue"),

  // Inventory
  table("inventory.variants", "inventory", "inventory-view.tsx", "Stocked variants with stock, sales per day, days left and what is tied up", [
    text("name", "product"), text("sku"), text("status"), int("onHand", "on_hand"), dec("v7", "per_day_7_days"), dec("v30", "per_day_30_days"), dec("days", "days_left"), amount("value", "tied_up_at_cost"), date("lastSold", "last_sold_on"),
  ], true),

  // Marketing
  table("marketing.channels", "marketing", "marketing-view.tsx", "Channels with sessions, orders, revenue, conversion, spend, CAC, ROAS and profit", [
    text("channel"), int("sessions"), int("orders"), amount("revenue"), pct("conversion"), amount("aov", "average_order"), int("newCustomers", "new_customers"), amount("spend", "ad_spend"), amount("cac"), dec("roas"), dec("profitRoas", "profit_roas"), amount("contribution", "contribution_profit"),
  ], true),
  bars("marketing.revenue_by_channel", "marketing", "marketing-view.tsx", "Revenue by channel"),
  bars("marketing.spend_by_channel", "marketing", "marketing-view.tsx", "Ad spend by channel"),
  table("marketing.discount_codes", "marketing", "discounts-view.tsx", "Discount codes used in the period", [
    text("code"), text("kind", "type"), text("status"), int("orders"), amount("revenue"), amount("discount", "taken_off"), pct("pct", "discount_percent"), amount("perOrder", "per_order"), amount("aov", "average_order"), pct("share", "share_of_code_revenue"),
  ], true),
  series("marketing.discount_share", "marketing", "discounts-view.tsx", "Share of paid orders with a discount, by month", [pct("share", "orders_with_a_discount")], false),
  bars("marketing.discount_by_kind", "marketing", "discounts-view.tsx", "Discount given by kind"),

  // Subscriptions
  table("subscriptions.bridge", "subscriptions", "subscriptions-view.tsx", "How monthly recurring revenue moved", [text("step"), amount("amount")], true),
  bars("subscriptions.mrr_bridge", "subscriptions", "subscriptions-view.tsx", "MRR at the start, what was added and lost, and MRR at the end"),

  // Traffic, and what follows from it
  table("traffic.devices", "traffic", "traffic-view.tsx", "Devices with visits, share of visits, conversion rate, average order, orders and revenue", [text("device"), int("sessions", "visits"), pct("share", "share_of_visits"), pct("conversion", "conversion_rate"), amount("aov", "average_order"), int("orders"), amount("revenue")], true),
  table("traffic.countries", "traffic", "traffic-view.tsx", "Countries with orders, revenue, share of revenue, average order, new customers, visits and conversion rate", [text("country"), int("orders"), amount("revenue"), pct("share", "share_of_revenue"), amount("aov", "average_order"), int("new", "new_customers"), int("sessions", "visits"), pct("conversion", "conversion_rate")], true),
  table("traffic.cities", "traffic", "traffic-view.tsx", "The cities with most revenue", [text("city"), text("country"), int("orders"), amount("revenue"), pct("share", "share_of_revenue"), amount("aov", "average_order")], true),
  table("traffic.landing", "traffic", "traffic-view.tsx", "The pages most visits began on", [text("page"), text("kind"), int("sessions", "visits"), int("orders"), pct("conversion", "conversion_rate"), amount("revenue")], true),
  table("traffic.zero_terms", "traffic", "traffic-view.tsx", "Searches that found nothing", [text("term", "search"), int("searches", "times_it_found_nothing"), date("last", "last_searched_on")]),
  table("traffic.top_terms", "traffic", "traffic-view.tsx", "The most searched terms", [text("term", "search"), int("searches"), int("results", "results_shown"), int("zero", "found_nothing"), int("clicked", "opened_a_result"), pct("ctr", "click_through")]),
  { id: "traffic.funnel", page: "traffic", view: "traffic-view.tsx", shape: "funnel", caption: "Visits, product views, carts, checkouts and purchases", columns: [text("stage"), int("count")], money: false },
  { id: "traffic.heatmap", page: "traffic", view: "traffic-view.tsx", shape: "heatmap", caption: "Paid orders by weekday and two-hour band", columns: [text("band"), int("monday"), int("tuesday"), int("wednesday"), int("thursday"), int("friday"), int("saturday"), int("sunday")], money: false },
  bars("traffic.weekdays", "traffic", "traffic-view.tsx", "Paid orders for each weekday", "int"),
  table("traffic.refund_products", "traffic", "refunds-view.tsx", "The most refunded products", [text("product"), amount("value", "refunded"), pct("share", "share_of_refunds"), int("refunds"), int("restocked", "back_in_stock")], true),
  table("traffic.refund_segments", "traffic", "refunds-view.tsx", "Refunds by new and returning customers", [text("segment", "customer"), amount("value", "refunded"), pct("share", "share_of_refunds"), int("refunds"), int("orders")], true),
  table("traffic.refund_markets", "traffic", "refunds-view.tsx", "Refunds and refund rate by market", [text("market"), amount("value", "refunded"), int("refunds"), int("orders", "orders_refunded"), amount("revenue"), pct("rate", "refund_rate")], true),
  bars("traffic.refund_reasons", "traffic", "refunds-view.tsx", "Refunded amount by reason"),
  table("traffic.return_kinds", "traffic", "returns-view.tsx", "Returns made in the period by kind", [text("kind"), int("returns", "made"), int("units"), int("declined"), int("cancelled"), int("refunded"), amount("value", "refunded_amount")], true),
  table("traffic.return_timing", "traffic", "returns-view.tsx", "Time from the request and from the goods arriving to the refund", [text("what", "time"), int("n", "returns"), dec("median", "typical_days"), dec("slowest", "slowest_days")]),
  table("traffic.return_products", "traffic", "returns-view.tsx", "The most returned products", [text("product"), int("returned", "units_returned"), int("sold", "units_sold"), pct("rate", "return_rate"), amount("value", "returned_value")], true),
  bars("traffic.return_reasons", "traffic", "returns-view.tsx", "Returns made by reason", "int"),

  // Settings pages: what the owner entered
  table("settings.spend", "settings", "spend-form.tsx", "Latest ad spend entries", [date("day"), text("channel"), text("campaign"), amount("amount"), text("note")], true),
  table("settings.targets", "settings", "settings-forms.tsx", "Revenue targets for the next 12 months", [text("month"), amount("target", "net_revenue_target")], true),
];

/** Every exportable table, by id. */
export const ANALYTICS_TABLES: Readonly<Record<string, AnalyticsTable>> = Object.freeze(Object.fromEntries(REGISTRY.map((t) => [t.id, t])));
export const ANALYTICS_TABLE_IDS: readonly string[] = REGISTRY.map((t) => t.id);

/**
 * Tables, charts and forms that are deliberately not exported here, by the id the view gives (`exportable={false}`), each with the reason.
 * The VAT, OSS and IOSS tables keep the four files of D161 (`/admin/{store}/analytics/tax/export`, with their own log and drift check).
 */
export const NOT_EXPORTED: Readonly<Record<string, string>> = Object.freeze({
  "tax.vat": "VAT report: it has its own CSV, its log and its drift check (D161).",
  "tax.vat_chart": "The data behind the VAT chart is in the VAT file (D161).",
  "tax.reconciliation": "The reconciliation has its own CSV with a direction column (D161).",
  "tax.currency_bridge": "Part of the reconciliation file (D161).",
  "oss.part2": "OSS return, Part 2: the OSS file (D161).",
  "oss.part3": "OSS return, Part 3: the OSS file (D161).",
  "oss.part4": "OSS return, Part 4: the OSS file (D161).",
  "oss.left_out": "Sales left out of the return: the OSS file's reconciliation (D161).",
  "oss.rates": "Euro rates used: the OSS file (D161).",
  "oss.conversions": "The conversions behind the return: the OSS detail file (D161).",
});

/**
 * Tables only the owner downloads, besides `analytics:write`: the top customers lists people (the customer file of D165 is the owner's too,
 * `docs/wave-2-data.md` 4.7), and the targets are what the owner entered on the owner-only settings page.
 */
export const OWNER_ONLY_TABLES: ReadonlySet<string> = new Set(["customers.top", "settings.targets"]);

export const isExportable = (id: string): boolean => Object.hasOwn(ANALYTICS_TABLES, id);

// ---------------------------------------------------------------------------
// Rows to cells
// ---------------------------------------------------------------------------

export type ExportPeriod = { from: string; to: string };

export type TableData = {
  /** The page's rows, in the page's order: a value by column key. */
  rows: readonly Record<string, string | number | boolean | null | undefined>[];
  /** The period in the address: `from` is the first day and `to` the day AFTER the last (the page's own `[from, to)`). */
  period: ExportPeriod;
  /** The comparison's period and its rows, when the page compares. */
  previous?: { period: ExportPeriod; rows: readonly Record<string, string | number | boolean | null | undefined>[] } | null;
  /** The store's main currency. */
  currency: string;
};

/** The last day of a period whose end is exclusive. */
export function lastDayOf(toExclusive: string): string {
  const d = new Date(`${toExclusive}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The header of a table's file for what the page shows: its columns, `{column}_previous` where compared, the currency, and the periods. */
export function tableHeader(t: AnalyticsTable, comparing: boolean): string[] {
  return [
    ...t.columns.map((c) => c.header),
    ...(comparing ? t.columns.filter((c) => c.previous).map((c) => `${c.header}_previous`) : []),
    ...(t.money ? ["currency"] : []),
    "period_from",
    "period_to",
    ...(comparing ? ["previous_from", "previous_to"] : []),
  ];
}

/** A percentage with two decimals from a fraction: 0.4255 is "42.55". Not money, so it is a decimal, not minor units. */
export function percentText(fraction: number): string {
  return (Math.round(fraction * 10_000) / 100).toFixed(2);
}

function cellOf(kind: ColumnKind, value: string | number | boolean | null | undefined, currency: string): Cell {
  if (value === null || value === undefined || value === "") return null;
  switch (kind) {
    case "text":
    case "date":
      return String(value);
    case "int":
      return typeof value === "number" && Number.isSafeInteger(value) ? value : typeof value === "number" ? { num: String(Math.round(value)) } : null;
    case "amount":
      return typeof value === "number" && Number.isFinite(value) ? amountCell(Math.round(value), currency) : null;
    case "percent":
      return typeof value === "number" && Number.isFinite(value) ? { num: percentText(value) } : null;
    case "decimal":
      return typeof value === "number" && Number.isFinite(value) ? { num: String(Math.round(value * 100) / 100) } : null;
    case "bool":
      return value === true || value === "true" ? "true" : "false";
  }
}

/**
 * The rows (no header) of a table: cells by the column's kind, the previous period's figure beside each compared one (matched by row position,
 * as the page lines them up: the server passes the comparison's rows aligned with the current ones, `null` for a row with no counterpart), the
 * currency, and the period columns. A figure the page shows as a dash is empty here, never zero.
 */
export function tableRows(t: AnalyticsTable, data: TableData): Cell[][] {
  const comparing = !!data.previous;
  const prevCols = t.columns.filter((c) => c.previous);
  return data.rows.map((row, i) => {
    const out: Cell[] = t.columns.map((c) => cellOf(c.kind, row[c.key], data.currency));
    if (comparing) {
      const before = data.previous?.rows[i];
      for (const c of prevCols) out.push(before ? cellOf(c.kind, before[c.key], data.currency) : null);
    }
    if (t.money) out.push(data.currency);
    out.push(data.period.from, lastDayOf(data.period.to));
    if (comparing && data.previous) out.push(data.previous.period.from, lastDayOf(data.previous.period.to));
    return out;
  });
}

/** A whole file: the header and the rows. */
export const tableFileRows = (t: AnalyticsTable, data: TableData): Cell[][] => [tableHeader(t, !!data.previous), ...tableRows(t, data)];

/** The file's name: the table's id and the period, `products.table_2026-09-01_2026-09-30.csv`. */
export const tableFileName = (t: AnalyticsTable, period: ExportPeriod): string => `${t.id}_${period.from}_${lastDayOf(period.to)}.csv`;

// ---------------------------------------------------------------------------
// What the page's address carries into the export
// ---------------------------------------------------------------------------

/**
 * The parts of a page's address an export repeats: the period and the comparison (`period`, `compare`, `from`, `to`), the sort and "show all"
 * of the products and inventory tables, and the inventory's status filter. Anything else in an address is dropped, never trusted.
 */
export const EXPORT_QUERY_KEYS = ["period", "compare", "from", "to", "sort", "dir", "limit", "status"] as const;

type Query = Record<string, string | string[] | undefined>;

/** The page's address parameters as the one query string the button's form carries (only the keys above, the first value of each). */
export function queryText(query: Query): string {
  const out = new URLSearchParams();
  for (const key of EXPORT_QUERY_KEYS) {
    const value = Array.isArray(query[key]) ? query[key][0] : query[key];
    if (typeof value === "string" && value !== "" && value.length <= 40) out.set(key, value);
  }
  return out.toString();
}

/** The same parameters back as the object the pages' loaders take; text that is not a query string gives none. */
export function queryRecord(text: unknown): Record<string, string> {
  if (typeof text !== "string" || text.length > 400) return {};
  const parsed = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const key of EXPORT_QUERY_KEYS) {
    const value = parsed.get(key);
    if (value !== null && value !== "" && value.length <= 40) out[key] = value;
  }
  return out;
}

/** What the button says: the left-out currencies are repeated, so the file never states more than the page does. */
export function downloadLabel(leftOut: { orders: number; currencies: readonly string[] }): string {
  if (leftOut.orders <= 0) return "Download CSV";
  const where = leftOut.currencies.length > 0 ? ` in ${leftOut.currencies.join(", ")}` : "";
  return `Download CSV: ${leftOut.orders} ${leftOut.orders === 1 ? "order" : "orders"}${where} left out, as on this page`;
}

// ---------------------------------------------------------------------------
// Finding what a view draws (for the scan test)
// ---------------------------------------------------------------------------

/** The components whose data table gets a button. */
export const EXPORT_COMPONENTS = ["DataTable", "LineChart", "BarChart", "HorizontalBars", "Heatmap", "Funnel", "CohortTable"] as const;

export type TableUse = { component: string; line: number; exportId: string | null; exportable: boolean | null };

/** The opening tag starting at `start` (the `<`), to its closing `>`: braces and quotes are balanced, so `=>` and `{a > b}` do not end it. */
export function openingTagAt(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  // A component with a type argument (`<DataTable<Row> …`): its `<…>` is not the tag's end.
  let from = start + 1;
  while (/[A-Za-z0-9_.]/.test(source[from] ?? "")) from += 1;
  if (source[from] === "<") {
    let angle = 0;
    for (; from < source.length; from += 1) {
      if (source[from] === "<") angle += 1;
      else if (source[from] === ">" && source[from - 1] !== "=" && (angle -= 1) === 0) {
        from += 1;
        break;
      }
    }
  }
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (depth > 0 && (ch === '"' || ch === "'" || ch === "`")) quote = ch;
    else if (ch === ">" && depth === 0 && source[i - 1] !== "=") return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** Every use of a table or chart component in a view's source, with the export props it carries. */
export function tableUses(source: string): TableUse[] {
  const uses: TableUse[] = [];
  const re = new RegExp(`<(${EXPORT_COMPONENTS.join("|")})(?![A-Za-z])`, "g");
  for (const m of source.matchAll(re)) {
    const start = m.index ?? 0;
    const tag = openingTagAt(source, start);
    const id = /\bexportId=(?:"([^"]+)"|\{\s*"([^"]+)"\s*\})/.exec(tag);
    const off = /\bexportable=\{\s*false\s*\}/.test(tag);
    const offId = /\bexportReason=(?:"([^"]+)"|\{\s*"([^"]+)"\s*\})/.exec(tag);
    uses.push({
      component: m[1],
      line: source.slice(0, start).split("\n").length,
      exportId: id ? (id[1] ?? id[2]) : off && offId ? (offId[1] ?? offId[2]) : null,
      exportable: off ? false : id ? true : null,
    });
  }
  return uses;
}

/** Hand-made tables (`<table`) in a view: each must say `data-export-id="..."` or `data-export-skip="id"`. */
export function rawTableUses(source: string): { line: number; id: string | null }[] {
  const out: { line: number; id: string | null }[] = [];
  for (const m of source.matchAll(/<table\b/g)) {
    const start = m.index ?? 0;
    const tag = openingTagAt(source, start);
    const id = /\bdata-export(?:-id|-skip)?=(?:"([^"]+)"|\{\s*"([^"]+)"\s*\})/.exec(tag);
    out.push({ line: source.slice(0, start).split("\n").length, id: id ? (id[1] ?? id[2]) : null });
  }
  return out;
}
