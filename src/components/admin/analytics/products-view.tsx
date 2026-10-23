import Link from "next/link";
import type { ReactNode } from "react";

import {
  change,
  formatChange,
  formatCount,
  formatDate,
  formatPercent,
  NO_FIGURE,
  safeRatio,
  verdictOf,
} from "@/lib/analytics-core";
import { fillWords } from "@/lib/admin-fill";
import { reportsEn, type ReportsMessages } from "@/lib/admin-messages/reports.en";
import { formatAmount } from "@/lib/analytics-format";
import { addDays, type CompareMode } from "@/lib/analytics-period";
import type {
  ProductReportRow,
  ProductsReport,
} from "@/server/analytics-products-data";

import { HorizontalBars, type BarRow } from "./charts";
import {
  DataTable,
  Delta,
  ShareBar,
  type Column,
  type DeltaView,
  type SortState,
} from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { AnalyticsSection, ChartCard, Note } from "./section";

/**
 * The Products page's body (D152): everything under the page's header, drawn from the one report object it is handed and nothing else
 * (no data access, so it can be rendered on fixture data). It answers three things first (what the products brought in, what is left
 * of it, how concentrated the sales are), then the best ten and the table of every product. A figure that cannot be known (a cost
 * that was never entered, views that were never counted) is a dash with the reason, never a zero.
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ProductsViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's first market's locale, for writing amounts. */
  locale: string;
  report: ProductsReport;
  /** Which comparison the address asked for: decides how the change is worded. */
  compareMode: CompareMode;
  /** How the table is sorted, as `parseProductsSort()` read it from the address. */
  sort: SortState;
  /** Every product, not the first `PRODUCT_LIMIT` (`?limit=all`). */
  showAll: boolean;
  /** The parameters that keep the period and comparison (`?period=&compare=…`), added to every link the table makes. */
  keep?: Readonly<Record<string, string>>;
};

export type ProductsWords = ReportsMessages["products"];

/** Rows of the table before "show all". */
export const PRODUCT_LIMIT = 50;
/** Best sellers in the chart. */
export const TOP_CHART = 10;
/** Products named in the "no cost" note. */
const NAMED_WITHOUT_COST = 5;
const linkClass =
  "font-medium text-(--brand-text) underline-offset-2 hover:underline";

// ---------------------------------------------------------------------------
// Sorting (pure, exported for the tests)
// ---------------------------------------------------------------------------

export const PRODUCT_SORT_KEYS = [
  "product",
  "revenue",
  "change",
  "units",
  "orders",
  "margin",
  "refunds",
  "share",
  "profitShare",
  "views",
  "conversion",
] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];

const DEFAULT_SORT: SortState = { key: "revenue", dir: "desc" };

const isKey = (key: unknown): key is ProductSortKey =>
  typeof key === "string" &&
  (PRODUCT_SORT_KEYS as readonly string[]).includes(key);
const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * `?sort=&dir=` as the table understands it: a column the table has and a direction, else the default (revenue, highest first).
 * `explicit` says the address asked for it, so links keep it. Anything else in the address is ignored, never trusted.
 */
export function parseProductsSort(
  query: Record<string, string | string[] | undefined>,
): { sort: SortState; explicit: boolean } {
  const key = one(query.sort);
  if (!isKey(key)) return { sort: DEFAULT_SORT, explicit: false };
  const dir = one(query.dir);
  return {
    sort: {
      key,
      dir:
        dir === "asc" || dir === "desc"
          ? dir
          : key === "product"
            ? "asc"
            : "desc",
    },
    explicit: true,
  };
}

/** What a row is sorted by; null when the figure is not known, which sorts last whichever way the table goes. */
function sortValue(
  r: ProductReportRow,
  key: ProductSortKey,
): number | string | null {
  switch (key) {
    case "product":
      return r.name;
    case "revenue":
      return r.revenueMinor;
    case "change":
      // A product that did not sell before has no percentage ("new"): it ranks above every percentage.
      return r.revenueChange === null
        ? null
        : (r.revenueChange.pct ??
            (r.revenueChange.abs > 0 ? Number.MAX_SAFE_INTEGER : 0));
    case "units":
      return r.units;
    case "orders":
      return r.orders;
    case "margin":
      return r.margin;
    case "refunds":
      return r.refundRate;
    case "share":
      return r.revenueShare;
    case "profitShare":
      return r.profitShare;
    case "views":
      return r.views;
    case "conversion":
      return r.conversion;
  }
}

/** The products in the order asked for, ties by revenue rank; "Other lines" are not products and always come last. */
export function sortProducts(
  rows: readonly ProductReportRow[],
  sort: SortState,
): ProductReportRow[] {
  const key = isKey(sort.key) ? sort.key : DEFAULT_SORT.key;
  const sign = sort.dir === "asc" ? 1 : -1;
  const products = rows.filter((r) => !r.other);
  const others = rows.filter((r) => r.other);
  products.sort((a, b) => {
    const x = sortValue(a, key as ProductSortKey);
    const y = sortValue(b, key as ProductSortKey);
    if (x === null && y === null) return a.rank - b.rank;
    if (x === null) return 1;
    if (y === null) return -1;
    const order =
      typeof x === "string" || typeof y === "string"
        ? String(x).localeCompare(String(y), "en")
        : x - y;
    return order !== 0 ? sign * order : a.rank - b.rank;
  });
  return [...products, ...others];
}

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

/** An amount of the main currency; a figure that is missing is the dash, never a zero. */
export function moneyOf(
  currency: string,
  locale: string,
): (minor: number | null | undefined) => string {
  return (minor) => {
    if (typeof minor !== "number" || !Number.isFinite(minor)) return NO_FIGURE;
    const whole = Math.round(minor);
    return Number.isSafeInteger(whole)
      ? formatAmount(whole, currency, locale)
      : NO_FIGURE;
  };
}

/** `2026-10-03` as "3 Oct 2026" (the one day label every analytics page uses); anything that is not a day as it came. */
export function dayText(day: string): string {
  return formatDate(day);
}

/** A change as the table's cell and the cards draw it; null without a comparison. */
export function deltaView(
  delta: ReturnType<typeof change> | null | undefined,
): DeltaView | null {
  if (!delta) return null;
  return {
    text: formatChange(delta),
    abs: delta.abs,
    verdict: verdictOf(delta.abs, "up"),
  };
}

/** The address of the table in a given sort: the period's own parameters, the sort, and "show all" when it is on. */
export function productsHref(
  path: string,
  keep: Readonly<Record<string, string>>,
  sort: SortState | null,
  showAll: boolean,
  anchor = "products-table",
): string {
  const q = new URLSearchParams(keep);
  if (sort) {
    q.set("sort", sort.key);
    q.set("dir", sort.dir);
  }
  if (showAll) q.set("limit", "all");
  const text = q.toString();
  return `${path}${text ? `?${text}` : ""}#${anchor}`;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function ProductsView({
  base,
  locale,
  report,
  compareMode,
  sort,
  showAll,
  keep = {},
  words: w = reportsEn.products,
}: ProductsViewProps & { words?: ProductsWords }) {
  const money = moneyOf(report.currency, locale);
  const path = `${base}/analytics/products`;
  const productHref = (id: string) => `${base}/products/${id}`;
  const costsHref = `${base}/products`;
  const settingsHref = `${base}/analytics/settings`;
  const products = report.rows.filter((r) => !r.other);
  const cnt = (n: number, pair: { one: string; many: string }) => `${formatCount(n)} ${n === 1 ? pair.one : pair.many}`;

  // ---- notes about what the figures are and are not ----
  const notes: ReactNode[] = [];
  if (report.truncated) {
    notes.push(
      <Note key="truncated" tone="warning" title={w.truncatedTitle}>
        {w.truncated}
      </Note>,
    );
  }
  if (report.unconverted > 0) {
    const currencies =
      report.missingCurrencies.length > 0
        ? report.missingCurrencies.join(", ")
        : w.anotherCurrency;
    notes.push(
      <Note
        key="unconverted"
        tone="warning"
        title={w.unconvertedTitle}
      >
        {fillWords(report.unconverted === 1 ? w.unconvertedOne : w.unconvertedMany, { count: cnt(report.unconverted, w.n.orderOrRefund), currencies })}{" "}
        <Link href={`${base}/settings/localization`} className={linkClass}>
          {w.addRate}
        </Link>
      </Note>,
    );
  }

  // ---- an empty period: one calm message, no zeros ----
  if (report.rows.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        {notes.length > 0 ? <div className="space-y-3">{notes}</div> : null}
        <AnalyticsSection
          id="prod-empty"
          title={w.emptyTitle}
          description={w.emptyDescription}
        >
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

  // ---- cost coverage ----
  // Of the products' own sales (the lines that are not products count as known at 0 and would hide a store with no costs at all).
  const productRevenue = products.reduce(
    (sum, r) => sum + Math.max(0, r.revenueMinor),
    0,
  );
  const knownRevenue = products.reduce(
    (sum, r) => sum + Math.max(0, r.revenueMinor) * (r.costCoverage ?? 0),
    0,
  );
  const coverage =
    productRevenue > 0 ? Math.min(1, knownRevenue / productRevenue) : null;
  const noCostAtAll = coverage !== null && coverage <= 0;
  const partlyKnown = coverage !== null && coverage > 0 && coverage < 1;
  const withoutCost = products.filter(
    (r) => r.revenueMinor > 0 && r.costCoverage !== null && r.costCoverage < 1,
  );
  const costsAction = {
    label: w.enterCosts,
    href: costsHref,
  };
  if (noCostAtAll) {
    notes.push(
      <Note key="nocosts" tone="warning" title={w.noCostsTitle}>
        {w.noCosts}{" "}
        <Link href={costsAction.href} className={linkClass}>
          {costsAction.label}
        </Link>
      </Note>,
    );
  } else if (partlyKnown) {
    const named = withoutCost.slice(0, NAMED_WITHOUT_COST);
    notes.push(
      <Note
        key="partcosts"
        tone="info"
        title={fillWords(w.partCostsTitle, { share: formatPercent(coverage, 0) })}
      >
        {w.partCosts}{" "}
        {named.map((r, i) => (
          <span key={r.productId}>
            {i > 0 ? ", " : ""}
            <Link href={productHref(r.productId)} className={linkClass}>
              {r.name}
            </Link>
          </span>
        ))}
        {withoutCost.length > named.length
          ? fillWords(w.andMore, { n: formatCount(withoutCost.length - named.length) })
          : ""}
        .
      </Note>,
    );
  }

  // ---- views ----
  const viewsKnown = report.viewsFrom !== null;
  if (!viewsKnown) {
    notes.push(
      <Note key="noviews" title={w.noViewsTitle}>
        {w.noViews}{" "}
        <Link href={settingsHref} className={linkClass}>
          {w.switchOnVisits}
        </Link>
      </Note>,
    );
  } else if (report.viewsFrom! > report.period.from) {
    notes.push(
      <Note
        key="partviews"
        title={fillWords(w.partViewsTitle, { day: dayText(report.viewsFrom!) })}
      >
        {w.partViews}
      </Note>,
    );
  }
  const noteBlock =
    notes.length > 0 ? <div className="space-y-3">{notes}</div> : null;

  // ---- the three things first ----
  const revenueDelta = report.compare
    ? deltaView(report.revenueChange)
    : undefined;
  const compared: Partial<KpiCardProps> =
    report.compare === null
      ? {}
      : compareMode === "year"
        ? { deltaLastYear: revenueDelta ?? null }
        : { deltaPrevious: revenueDelta ?? null };
  const revenueCard: KpiCardProps = {
    label: w.revenueLabel,
    value: money(report.totals.revenueMinor),
    help: w.revenueHelp,
    hint:
      report.shareOfRevenue !== null
        ? fillWords(w.revenueHint, { share: formatPercent(report.shareOfRevenue, 0) })
        : undefined,
    emphasis: true,
    good: "up",
    ...compared,
  };

  const profit = report.totals.profitMinor;
  const profitHelp = w.profitHelp;
  const profitCard: KpiCardProps =
    profit === null || noCostAtAll
      ? {
          label: w.profitLabel,
          value: null,
          state: "missing",
          help: profitHelp,
          missing: {
            text: w.profitNone,
            action: costsAction,
          },
        }
      : {
          label: w.profitLabel,
          value: money(profit),
          help: profitHelp,
          hint:
            coverage !== null && coverage < 1
              ? fillWords(w.basedOn, { share: formatPercent(coverage, 0) })
              : fillWords(w.afterRefunds, { money: money(report.totals.refundsMinor) }),
          emphasis: true,
        };

  const pareto = report.pareto;
  const paretoHelp = w.paretoHelp;
  const paretoCard: KpiCardProps =
    pareto && pareto.text
      ? {
          label: w.paretoLabel,
          value: pareto.text,
          help: paretoHelp,
          hint: fillWords(w.paretoHint, { top: formatCount(pareto.topCount), all: formatCount(pareto.products), share: formatPercent(pareto.threshold, 0) }),
          emphasis: true,
        }
      : {
          label: w.paretoLabel,
          value: null,
          state: "missing",
          help: paretoHelp,
          missing: {
            text: pareto
              ? fillWords(w.paretoFew, { products: cnt(pareto.products, w.n.product) })
              : w.noRevenue,
          },
        };

  // ---- the best ten ----
  const best: BarRow[] = products
    .filter((r) => r.revenueMinor > 0)
    .slice(0, TOP_CHART)
    .map((r) => ({
      key: r.productId,
      label: r.name,
      value: r.revenueMinor,
      valueText: money(r.revenueMinor),
      detail: `${formatPercent(r.revenueShare, 1)} · ${cnt(r.units, w.n.unit)}`,
      href: productHref(r.productId),
    }));

  // ---- the table ----
  const sorted = sortProducts(report.rows, sort);
  const limited = !showAll && sorted.length > PRODUCT_LIMIT;
  const shown = limited ? sorted.slice(0, PRODUCT_LIMIT) : sorted;
  const sortHref = (key: string, dir: "asc" | "desc") =>
    productsHref(path, keep, { key, dir }, showAll);
  const changeHelp = fillWords(w.changeHelp, { against: compareMode === "year" ? w.againstYear : w.againstPrevious });

  const columns: Column<ProductReportRow>[] = [
    {
      key: "product",
      label: w.cols.product,
      sortable: true,
      firstDir: "asc",
      cell: (r) => {
        if (r.other) {
          return (
            <span>
              <span className="block truncate">{r.name}</span>
              <span className="block text-xs text-muted">
                {r.productId === "custom" ? w.customLines : w.otherLines}
              </span>
            </span>
          );
        }
        const flag =
          r.revenueMinor > 0 && r.costCoverage !== null && r.costCoverage <= 0
            ? w.noCostEntered
            : r.revenueMinor > 0 &&
                r.costCoverage !== null &&
                r.costCoverage < 1
              ? fillWords(w.costKnownFor, { share: formatPercent(r.costCoverage, 0) })
              : null;
        return (
          <span>
            <Link
              href={productHref(r.productId)}
              title={r.name}
              className="block truncate hover:underline"
            >
              {r.name}
            </Link>
            {flag ? (
              <span className="block text-xs text-muted">{flag}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "revenue",
      label: w.cols.revenue,
      align: "right",
      sortable: true,
      cell: (r) => money(r.revenueMinor),
    },
    ...(report.compare
      ? [
          {
            key: "change",
            label: w.cols.change,
            align: "right",
            sortable: true,
            cell: (r: ProductReportRow) => (
              <Delta delta={deltaView(r.revenueChange)} versus="" good="up" />
            ),
          } satisfies Column<ProductReportRow>,
        ]
      : []),
    {
      key: "units",
      label: w.cols.units,
      align: "right",
      sortable: true,
      cell: (r) => (r.other ? NO_FIGURE : formatCount(r.units)),
    },
    {
      key: "orders",
      label: w.cols.orders,
      align: "right",
      sortable: true,
      cell: (r) => formatCount(r.orders),
    },
    {
      key: "margin",
      label: w.cols.margin,
      align: "right",
      sortable: true,
      cell: (r) =>
        r.margin === null ? (
          <span
            title={
              r.other || r.revenueMinor <= 0
                ? w.notAvailable : w.costNotEntered
            }
          >
            {NO_FIGURE}
          </span>
        ) : (
          <span
            title={
              r.costCoverage !== null && r.costCoverage < 1
                ? fillWords(w.marginBasedOn, { share: formatPercent(r.costCoverage, 0) })
                : undefined
            }
          >
            {formatPercent(r.margin, 1)}
          </span>
        ),
    },
    {
      key: "refunds",
      label: w.cols.refunds,
      align: "right",
      sortable: true,
      cell: (r) => formatPercent(r.refundRate, 1),
    },
    {
      key: "share",
      label: w.cols.share,
      align: "right",
      sortable: true,
      cell: (r) => (
        <ShareBar
          share={r.revenueShare}
          text={formatPercent(r.revenueShare, 1)}
          label={w.shareOfProductsRevenue}
        />
      ),
    },
    {
      key: "profitShare",
      label: w.cols.profitShare,
      align: "right",
      sortable: true,
      cell: (r) =>
        r.profitShare === null ? (
          <span title={w.noProfit}>{NO_FIGURE}</span>
        ) : (
          <ShareBar
            share={r.profitShare}
            text={formatPercent(r.profitShare, 1)}
            label={w.shareOfProductsProfit}
          />
        ),
    },
    ...(viewsKnown
      ? [
          {
            key: "views",
            label: w.cols.views,
            align: "right",
            sortable: true,
            cell: (r: ProductReportRow) =>
              r.views === null ? NO_FIGURE : formatCount(r.views),
          } satisfies Column<ProductReportRow>,
          {
            key: "conversion",
            label: w.cols.conversion,
            align: "right",
            sortable: true,
            cell: (r: ProductReportRow) =>
              r.conversion === null ? (
                <span title={w.noViewsToMeasure}>{NO_FIGURE}</span>
              ) : (
                formatPercent(r.conversion, 1)
              ),
          } satisfies Column<ProductReportRow>,
        ]
      : []),
  ];

  const footer = (
    <tr>
      {columns.map((c, i) => {
        let content: ReactNode = null;
        if (c.key === "product")
          content = fillWords(w.allRows, { rows: cnt(report.rows.length, w.n.row) });
        else if (c.key === "revenue")
          content = money(report.totals.revenueMinor);
        else if (c.key === "change")
          content = (
            <Delta
              delta={deltaView(report.revenueChange)}
              versus=""
              good="up"
            />
          );
        else if (c.key === "units") content = formatCount(report.totals.units);
        else if (c.key === "refunds")
          content = formatPercent(
            safeRatio(
              report.totals.refundsMinor,
              report.totals.revenueMinor > 0
                ? report.totals.revenueMinor
                : null,
            ),
            1,
          );
        return (
          <td
            key={c.key}
            className={`px-3 py-1.5 ${c.align === "right" ? "text-right tabular-nums" : "text-left"} ${i === 0 ? "whitespace-nowrap" : ""}`}
          >
            {content}
          </td>
        );
      })}
    </tr>
  );

  const toggle = limited ? (
    <Link
      href={productsHref(
        path,
        keep,
        sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir
          ? null
          : sort,
        true,
      )}
      className={linkClass}
    >
      {fillWords(w.showAll, { n: formatCount(sorted.length) })}
    </Link>
  ) : showAll && sorted.length > PRODUCT_LIMIT ? (
    <Link
      href={productsHref(
        path,
        keep,
        sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir
          ? null
          : sort,
        false,
      )}
      className={linkClass}
    >
      {fillWords(w.showFirst, { n: String(PRODUCT_LIMIT) })}
    </Link>
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      {noteBlock}

      <section
        aria-label={w.mainFigures}
        className="grid grid-cols-1 gap-3 md:grid-cols-3"
      >
        <KpiCard {...revenueCard} />
        <KpiCard {...profitCard} />
        <KpiCard {...paretoCard} />
      </section>

      <AnalyticsSection
        id="prod-best"
        title={w.bestTitle}
        description={w.bestDescription}
      >
        <ChartCard title={w.top10}>
          <HorizontalBars
            label={w.top10}
            rows={best}
            emptyText={w.noRevenue}
            exportId="products.top_revenue"
            exportLeftOut={{ orders: report.unconverted, currencies: report.missingCurrencies }}
          />
        </ChartCard>
      </AnalyticsSection>

      <AnalyticsSection
        id="products-table"
        title={w.tableTitle}
        description={`${fillWords(w.tableDescription, { currency: report.currency })}${report.compare ? ` ${changeHelp}` : ""}`}
        action={toggle}
      >
        <DataTable<ProductReportRow>
          caption={w.tableCaption}
          columns={columns}
          rows={shown}
          rowKey={(r) => r.productId}
          sort={sort}
          sortHref={sortHref}
          footer={footer}
          empty={w.tableEmpty}
          exportId="products.table"
          exportLeftOut={{ orders: report.unconverted, currencies: report.missingCurrencies }}
        />
        <dl className="grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-2">
          <div>
            <dt className="inline font-medium">{w.marginTerm}</dt>
            <dd className="inline">
              {w.marginDef}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">{w.refundTerm}</dt>
            <dd className="inline">
              {w.refundDef}
            </dd>
          </div>
          {viewsKnown ? (
            <div className="sm:col-span-2">
              <dt className="inline font-medium">{w.conversionTerm}</dt>
              <dd className="inline">
                {w.conversionDef}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="text-xs text-muted">
          {report.shareOfRevenue !== null
            ? fillWords(w.linesShare, { share: formatPercent(report.shareOfRevenue, 0) })
            : ""}
          {w.stripeRefunds}
          {report.compare
            ? fillWords(w.changeAgainst, { from: dayText(report.compare.from), to: dayText(addDays(report.compare.to, -1)) })
            : ""}
        </p>
      </AnalyticsSection>
    </div>
  );
}
