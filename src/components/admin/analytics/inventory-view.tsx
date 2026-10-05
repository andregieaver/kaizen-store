import Link from "next/link";
import type { ReactNode } from "react";

import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import { formatAmount, formatDecimal, formatUpTo } from "@/lib/analytics-format";
import {
  DEAD_STOCK_DAYS,
  LOW_STOCK_DAYS,
  MIN_SOLD_30D,
  STOCKOUT_ALERT_DAYS,
  type StockStatus,
} from "@/lib/analytics-inventory";
import type {
  InventoryReport,
  InventoryReportRow,
} from "@/server/analytics-inventory-data";

import {
  DataTable,
  StatusPill,
  type Column,
  type PillTone,
  type SortState,
} from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { AnalyticsSection, Note } from "./section";

/**
 * The Inventory page's body (D152): everything under the page's header, drawn from the one report object it is handed and nothing else
 * (no data access, so it can be rendered on fixture data). It answers three things first (is anything about to run out, how much money
 * is tied up in stock, how fast does stock move), then the table of every stocked variant with a filter on its status. A figure that
 * cannot be known (a cost never entered, days left for something that does not sell) is a dash with the reason, never a zero.
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type StatusFilter = Exclude<StockStatus, "untracked">;

export type InventoryViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's first market's locale, for writing amounts. */
  locale: string;
  report: InventoryReport;
  /** Show only variants in this state (`?status=`); null shows all. */
  status: StatusFilter | null;
  /** How the table is sorted (`?sort=&dir=`); null is the report's own order, most urgent first. */
  sort: SortState | null;
  /** Every variant, not the first `ROW_LIMIT` (`?limit=all`). */
  showAll: boolean;
};

/** Rows of the table before "show all". */
export const ROW_LIMIT = 25;
/** Alerts listed in full before the rest fold away. */
export const ALERTS_SHOWN = 8;

const linkClass =
  "font-medium text-(--brand-text) underline-offset-2 hover:underline";

// ---------------------------------------------------------------------------
// The address (pure, exported for the tests)
// ---------------------------------------------------------------------------

export const STATUS_FILTERS = [
  "out",
  "low",
  "dead",
  "ok",
] as const satisfies readonly StatusFilter[];
export const INVENTORY_SORT_KEYS = [
  "name",
  "status",
  "onHand",
  "v7",
  "v30",
  "days",
  "value",
  "lastSold",
] as const;
export type InventorySortKey = (typeof INVENTORY_SORT_KEYS)[number];

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** What the address asks for, each part checked: an unknown status, column or direction is ignored. */
export function parseInventoryParams(
  query: Record<string, string | string[] | undefined>,
): { status: StatusFilter | null; sort: SortState | null; showAll: boolean } {
  const status = one(query.status);
  const key = one(query.sort);
  const dir = one(query.dir);
  const sortKey = (INVENTORY_SORT_KEYS as readonly string[]).includes(key ?? "")
    ? (key as InventorySortKey)
    : null;
  return {
    status: (STATUS_FILTERS as readonly string[]).includes(status ?? "")
      ? (status as StatusFilter)
      : null,
    sort: sortKey
      ? {
          key: sortKey,
          dir:
            dir === "asc" || dir === "desc"
              ? dir
              : sortKey === "name" || sortKey === "days"
                ? "asc"
                : "desc",
        }
      : null,
    showAll: one(query.limit) === "all",
  };
}

/** The table's address with a status, a sort and "show all" set; the anchor lands on the table. */
export function inventoryHref(
  path: string,
  state: {
    status: StatusFilter | null;
    sort: SortState | null;
    showAll: boolean;
  },
): string {
  const q = new URLSearchParams();
  if (state.status) q.set("status", state.status);
  if (state.sort) {
    q.set("sort", state.sort.key);
    q.set("dir", state.sort.dir);
  }
  if (state.showAll) q.set("limit", "all");
  const text = q.toString();
  return `${path}${text ? `?${text}` : ""}#variants`;
}

const STATUS_RANK: Record<StockStatus, number> = {
  out: 0,
  low: 1,
  dead: 2,
  ok: 3,
  untracked: 4,
};

function sortValue(
  r: InventoryReportRow,
  key: InventorySortKey,
): number | string | null {
  switch (key) {
    case "name":
      return r.name;
    case "status":
      return STATUS_RANK[r.status];
    case "onHand":
      return r.onHand;
    case "v7":
      return r.velocity.v7;
    case "v30":
      return r.velocity.v30;
    case "days":
      return r.daysOfStock;
    case "value":
      return r.valueMinor;
    case "lastSold":
      // Days since the last sale; a variant with no sale in a year ranks as the longest ago.
      return r.lastSoldDaysAgo ?? Number.MAX_SAFE_INTEGER;
  }
}

/** The variants in the order asked for; a figure that is not known sorts last whichever way the table goes. Ties keep the report's order. */
export function sortVariants(
  rows: readonly InventoryReportRow[],
  sort: SortState | null,
): InventoryReportRow[] {
  if (!sort || !(INVENTORY_SORT_KEYS as readonly string[]).includes(sort.key))
    return [...rows];
  const key = sort.key as InventorySortKey;
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = sortValue(a.row, key);
      const y = sortValue(b.row, key);
      if (x === null && y === null) return a.index - b.index;
      if (x === null) return 1;
      if (y === null) return -1;
      const order =
        typeof x === "string" || typeof y === "string"
          ? String(x).localeCompare(String(y), "en")
          : x - y;
      return order !== 0 ? sign * order : a.index - b.index;
    })
    .map((e) => e.row);
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

/** "1 variant", "3 variants". */
function countOf(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** Units per day, up to two decimals ("0.43"); the dash when it cannot be known. */
export function perDayOf(): (n: number | null | undefined) => string {
  return (n) => formatUpTo(n, 2);
}

/** How long stock lasts, in words: "6 days", "under a day"; the dash when it cannot be known. */
export function daysText(days: number | null | undefined): string {
  if (typeof days !== "number" || !Number.isFinite(days)) return NO_FIGURE;
  if (days < 1) return "under a day";
  const whole = Math.round(days);
  return `${whole} ${whole === 1 ? "day" : "days"}`;
}

/** One alert in a sentence: "Ethiopian Coffee 1kg: estimated stockout in 6 days". */
export function alertText(alert: InventoryReport["alerts"][number]): string {
  if (alert.kind === "out") return `${alert.row.name}: out of stock`;
  return `${alert.row.name}: estimated stockout in ${alert.days < 1 ? "less than a day" : daysText(alert.days)}`;
}

const PILL: Record<
  StockStatus,
  { tone: PillTone; label: string; help: string }
> = {
  out: { tone: "bad", label: "Out of stock", help: "Nothing is left on hand." },
  low: {
    tone: "warning",
    label: "Running low",
    help: `At the current pace the stock lasts ${LOW_STOCK_DAYS} days or less.`,
  },
  dead: {
    tone: "neutral",
    label: "Not selling",
    help: `Dead stock: on hand and not sold for ${DEAD_STOCK_DAYS} days.`,
  },
  ok: {
    tone: "good",
    label: "In stock",
    help: "Enough on hand for the current pace of sales.",
  },
  untracked: {
    tone: "neutral",
    label: "Not counted",
    help: "Stock is not counted for this variant.",
  },
};

/** A variant's status in the words the table's pill uses (the CSV repeats them). */
export const STATUS_LABEL: Record<StockStatus, string> = {
  out: PILL.out.label,
  low: PILL.low.label,
  dead: PILL.dead.label,
  ok: PILL.ok.label,
  untracked: PILL.untracked.label,
};

/** Words for the filter's choices and for an empty table under each. */
const FILTER_COPY: Record<StatusFilter, { label: string; empty: string }> = {
  out: { label: "Out of stock", empty: "No variant is out of stock." },
  low: { label: "Running low", empty: "No variant is running low." },
  dead: { label: "Not selling", empty: "No variant counts as dead stock." },
  ok: {
    label: "In stock",
    empty: "No variant is in stock and selling normally.",
  },
};

function lastSoldText(r: InventoryReportRow): string {
  if (r.lastSoldDaysAgo === null)
    return r.ageDays < 365 ? "Never" : "Over a year ago";
  if (r.lastSoldDaysAgo === 0) return "Today";
  return `${formatCount(r.lastSoldDaysAgo)} ${r.lastSoldDaysAgo === 1 ? "day" : "days"} ago`;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function InventoryView({
  base,
  locale,
  report,
  status,
  sort,
  showAll,
}: InventoryViewProps) {
  const money = moneyOf(report.currency, locale);
  const perDay = perDayOf();
  const path = `${base}/analytics/inventory`;
  const productHref = (id: string) => `${base}/products/${id}`;
  const costsAction = {
    label: "Enter what your products cost",
    href: `${base}/products`,
  };
  const { totals } = report;

  // ---- notes about what the figures are and are not ----
  const notes: ReactNode[] = [];
  if (report.readTruncated) {
    notes.push(
      <Note key="read" tone="warning" title="Only part of the stock is counted">
        This store has more stocked variants than one page can read. The figures
        below cover the best sellers among them, so the totals may be a little
        low.
      </Note>,
    );
  }

  // ---- no stocked products: one calm message ----
  if (report.variants === 0) {
    return (
      <div className="flex flex-col gap-8">
        {notes.length > 0 ? <div className="space-y-3">{notes}</div> : null}
        <AnalyticsSection
          id="inv-empty"
          title="No stock to follow yet"
          description="This page follows physical products whose stock the store counts."
        >
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
            <p className="font-medium text-foreground">No stocked products.</p>
            <p className="mx-auto mt-1 max-w-prose">
              Once the store has a physical product with its stock set, this
              page shows what is on hand and what it is worth, how fast each
              variant sells, how many days it will last, and what is about to
              run out or is not selling.{" "}
              <Link href={`${base}/products`} className={linkClass}>
                Go to Products
              </Link>
            </p>
          </div>
        </AnalyticsSection>
      </div>
    );
  }

  const value = totals.value;
  const noSales30 = totals.sold30 === 0;
  if (noSales30) {
    notes.push(
      <Note key="nosales" title="Nothing has sold in the last 30 days">
        Without sales there is no pace to work days of stock left from, and
        turnover needs a year of them, so those show a dash, not zero.
        {totals.sellThrough30 !== null
          ? " Sell-through is 0 % because nothing sold."
          : ""}{" "}
        Stock levels and what is tied up in stock are shown as normal.
      </Note>,
    );
  }
  if (value.units > 0 && value.unitsWithoutCost > 0) {
    notes.push(
      <Note
        key="costs"
        tone={
          value.coverage !== null && value.coverage <= 0 ? "warning" : "info"
        }
        title={
          value.coverage !== null && value.coverage > 0
            ? `Stock value covers ${formatPercent(value.coverage, 0)} of the units on hand`
            : "Product costs are not entered"
        }
      >
        {countOf(value.unitsWithoutCost, "unit")} on hand{" "}
        {value.unitsWithoutCost === 1 ? "has" : "have"} no cost, so{" "}
        {value.unitsWithoutCost === 1 ? "it is" : "they are"} left out of the
        stock value and of what is tied up in dead stock.{" "}
        {value.unitsWithoutCost === 1 ? "It is" : "They are"} not valued at
        zero.{" "}
        <Link href={costsAction.href} className={linkClass}>
          {costsAction.label}
        </Link>
      </Note>,
    );
  }
  const noteBlock =
    notes.length > 0 ? <div className="space-y-3">{notes}</div> : null;

  // ---- what needs attention now ----
  const shownAlerts = report.alerts.slice(0, ALERTS_SHOWN);
  const foldedAlerts = report.alerts.slice(ALERTS_SHOWN);
  const alertItem = (a: InventoryReport["alerts"][number]) => (
    <li key={a.row.variantId} className="flex items-start gap-2">
      <StatusPill tone={a.kind === "out" ? "bad" : "warning"}>
        {a.kind === "out" ? "Out" : "Soon"}
      </StatusPill>
      <span className="min-w-0">
        <Link
          href={productHref(a.row.productId)}
          className={`${linkClass} break-words`}
        >
          {alertText(a)}
        </Link>
        <span className="block text-xs text-muted">{`Sold ${formatCount(a.row.sold30)} in the last 30 days, ${formatCount(a.row.sold7)} in the last 7. ${a.kind === "out" ? "Nothing on hand." : `${formatCount(a.row.onHand)} on hand.`}`}</span>
      </span>
    </li>
  );

  // ---- the three things first ----
  const valueHelp =
    "What the stock on hand cost you: units on hand times what one unit costs. Stock with no cost entered is not included.";
  const valueCard: KpiCardProps =
    value.units === 0
      ? {
          label: "Stock value at cost",
          value: null,
          state: "missing",
          help: valueHelp,
          missing: {
            text: "Nothing is on hand, so there is no stock to value.",
          },
        }
      : value.coverage !== null && value.coverage <= 0
        ? {
            label: "Stock value at cost",
            value: null,
            state: "missing",
            help: valueHelp,
            missing: {
              text: "Product costs are not entered, so the stock cannot be valued.",
              action: costsAction,
            },
          }
        : {
            label: "Stock value at cost",
            value: money(value.valueMinor),
            help: valueHelp,
            hint:
              value.coverage !== null && value.coverage < 1
                ? `Based on ${formatPercent(value.coverage, 0)} of ${countOf(value.units, "unit")} on hand`
                : `${countOf(value.units, "unit")} on hand in ${countOf(totals.variants, "variant")}`,
            emphasis: true,
          };

  const outCard: KpiCardProps = {
    label: "Out of stock",
    value: formatCount(totals.out),
    help: "Variants with nothing left on hand.",
    hint:
      totals.out === 0
        ? "Everything is in stock."
        : totals.out === 1
          ? "1 variant has nothing on hand."
          : `${formatCount(totals.out)} variants have nothing on hand.`,
    href: `${path}?status=out#variants`,
  };
  const lowCard: KpiCardProps = {
    label: "Running low",
    value: formatCount(totals.low),
    help: `Variants that, at the current pace of sales, last ${LOW_STOCK_DAYS} days or less.`,
    hint: `Lasts ${LOW_STOCK_DAYS} days or less at today's pace.`,
    href: `${path}?status=low#variants`,
  };

  // Dead stock: units with no known cost make its value partial, which the hint says (rows are the whole picture only when not cut).
  const deadUnknown = report.rowsTruncated
    ? null
    : report.rows
        .filter((r) => r.status === "dead" && r.costMinor === null)
        .reduce((s, r) => s + r.onHand, 0);
  const deadHint =
    totals.dead === 0
      ? "Nothing is sitting unsold."
      : deadUnknown !== null && deadUnknown >= totals.deadUnits
        ? `${countOf(totals.deadUnits, "unit")}. Costs are not entered, so what is tied up is not known.`
        : `${countOf(totals.deadUnits, "unit")}, ${money(totals.deadValueMinor)} at cost${deadUnknown === null || deadUnknown > 0 ? " where the cost is known" : ""}.`;
  const deadCard: KpiCardProps = {
    label: "Dead stock",
    value: formatCount(totals.dead),
    help: `Variants with stock on hand that have not sold for ${DEAD_STOCK_DAYS} days (or never sold, and have been on offer that long). Money tied up for nothing.`,
    hint: deadHint,
    href: `${path}?status=dead#variants`,
  };

  const turnoverHelp =
    "How many times the stock sells through in a year: what the goods sold in the last 365 days cost, divided by what the stock on hand costs now.";
  const turnoverCard: KpiCardProps = ((): KpiCardProps => {
    const base0 = { label: "Stock turnover", help: turnoverHelp };
    if (value.units === 0)
      return {
        ...base0,
        value: null,
        state: "missing",
        missing: {
          text: "Nothing is on hand, so there is nothing to measure against.",
        },
      };
    if (value.coverage !== null && value.coverage <= 0)
      return {
        ...base0,
        value: null,
        state: "missing",
        missing: {
          text: "Product costs are not entered, so the stock has no value to measure against.",
          action: costsAction,
        },
      };
    if (totals.cogs365Coverage === null)
      return {
        ...base0,
        value: null,
        state: "missing",
        missing: { text: "Nothing has sold in the last 365 days." },
      };
    if (totals.cogs365Coverage <= 0 || totals.turnover === null)
      return {
        ...base0,
        value: null,
        state: "missing",
        missing: {
          text: "The goods sold had no cost entered, so what they cost is not known.",
          action: costsAction,
        },
      };
    return {
      ...base0,
      value: `${formatDecimal(totals.turnover, 1)} times a year`,
      hint:
        totals.cogs365Coverage < 1
          ? `Based on the cost of ${formatPercent(totals.cogs365Coverage, 0)} of the units sold`
          : "Cost of goods sold over the last 365 days against stock at cost.",
    };
  })();

  const sellHelp =
    "Units sold in the last 30 days as a share of units sold plus units still on hand. Higher means stock is moving.";
  const sellCard: KpiCardProps =
    totals.sellThrough30 === null
      ? {
          label: "Sell-through, 30 days",
          value: null,
          state: "missing",
          help: sellHelp,
          missing: {
            text: "Nothing sold in the last 30 days and nothing is on hand.",
          },
        }
      : {
          label: "Sell-through, 30 days",
          value: formatPercent(totals.sellThrough30, 1),
          help: sellHelp,
          hint: `${countOf(totals.sold30, "unit")} sold in the last 30 days.`,
        };

  // ---- the table ----
  const filtered = status
    ? report.rows.filter((r) => r.status === status)
    : report.rows;
  const sorted = sortVariants(filtered, sort);
  const limited = !showAll && sorted.length > ROW_LIMIT;
  const shown = limited ? sorted.slice(0, ROW_LIMIT) : sorted;
  const sortHref = (key: string, dir: "asc" | "desc") =>
    inventoryHref(path, { status, sort: { key, dir }, showAll });
  const countFor = (s: StatusFilter) => totals[s];

  const columns: Column<InventoryReportRow>[] = [
    {
      key: "name",
      label: "Product",
      sortable: true,
      firstDir: "asc",
      cell: (r) => (
        <span>
          <Link
            href={productHref(r.productId)}
            title={r.name}
            className="block truncate hover:underline"
          >
            {r.name}
          </Link>
          {r.sku ? (
            <span className="block text-xs text-muted">{`SKU ${r.sku}`}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      firstDir: "asc",
      cell: (r) => (
        <span title={PILL[r.status].help}>
          <StatusPill tone={PILL[r.status].tone}>
            {PILL[r.status].label}
          </StatusPill>
        </span>
      ),
    },
    {
      key: "onHand",
      label: "On hand",
      align: "right",
      sortable: true,
      cell: (r) => formatCount(r.onHand),
    },
    {
      key: "v7",
      label: "Per day, 7 days",
      align: "right",
      sortable: true,
      cell: (r) => (
        <span title={`${formatCount(r.sold7)} sold in the last 7 days`}>
          {perDay(r.velocity.v7)}
        </span>
      ),
    },
    {
      key: "v30",
      label: "Per day, 30 days",
      align: "right",
      sortable: true,
      cell: (r) => (
        <span title={`${formatCount(r.sold30)} sold in the last 30 days`}>
          {perDay(r.velocity.v30)}
        </span>
      ),
    },
    {
      key: "days",
      label: "Days left",
      align: "right",
      sortable: true,
      firstDir: "asc",
      cell: (r) =>
        r.daysOfStock === null ? (
          <span
            title={
              r.sold30 === 0
                ? "Nothing sold in the last 30 days, so it cannot be worked out"
                : `Fewer than ${MIN_SOLD_30D} sold in 30 days: too few to say`
            }
          >
            {NO_FIGURE}
          </span>
        ) : (
          <span className="whitespace-nowrap">{daysText(r.daysOfStock)}</span>
        ),
    },
    {
      key: "value",
      label: "Tied up at cost",
      align: "right",
      sortable: true,
      cell: (r) =>
        r.valueMinor !== null ? (
          money(r.valueMinor)
        ) : r.onHand > 0 && r.costMinor === null ? (
          <span
            className="text-muted"
            title="No cost entered for this variant, so its stock is not valued"
          >
            No cost
          </span>
        ) : (
          <span title="Nothing on hand">{NO_FIGURE}</span>
        ),
    },
    {
      key: "lastSold",
      label: "Last sold",
      align: "right",
      sortable: true,
      firstDir: "asc",
      cell: (r) => <span className="whitespace-nowrap">{lastSoldText(r)}</span>,
    },
  ];

  const toggle =
    limited || (showAll && sorted.length > ROW_LIMIT) ? (
      <Link
        href={inventoryHref(path, { status, sort, showAll: limited })}
        className={linkClass}
      >
        {limited
          ? `Show all ${formatCount(sorted.length)} variants`
          : `Show only the first ${ROW_LIMIT}`}
      </Link>
    ) : null;

  const filterLink = (
    target: StatusFilter | null,
    label: string,
    count: number,
  ) => {
    const active = status === target;
    return (
      <Link
        key={target ?? "all"}
        href={inventoryHref(path, { status: target, sort, showAll: false })}
        aria-current={active ? "true" : undefined}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm ${active ? "border-foreground bg-surface font-semibold" : "border-border"}`}
      >
        <span>{label}</span>
        <span className="tabular-nums text-muted">{formatCount(count)}</span>
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      {noteBlock}

      <AnalyticsSection
        id="inv-alerts"
        title="Running out"
        description={`Variants that sell and are gone, or are estimated to run out within ${STOCKOUT_ALERT_DAYS} days at the pace of the last 7 and 30 days. Needs at least ${MIN_SOLD_30D} sold in 30 days, so a single sale raises nothing.`}
      >
        {report.alerts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted">
            {noSales30
              ? "Nothing has sold in the last 30 days, so there is nothing to say about what will run out."
              : `Nothing that sells is out, or estimated to run out within ${STOCKOUT_ALERT_DAYS} days.`}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background p-4">
            <ul className="space-y-3 text-sm">{shownAlerts.map(alertItem)}</ul>
            {foldedAlerts.length > 0 ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted hover:text-foreground">{`Show ${formatCount(foldedAlerts.length)} more`}</summary>
                <ul className="mt-3 space-y-3">
                  {foldedAlerts.map(alertItem)}
                </ul>
              </details>
            ) : null}
            {report.alertsTotal > report.alerts.length ? (
              <p className="mt-3 text-xs text-muted">{`Showing the ${formatCount(report.alerts.length)} most urgent of ${formatCount(report.alertsTotal)}.`}</p>
            ) : null}
          </div>
        )}
      </AnalyticsSection>

      <section
        aria-label="The main figures"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        <KpiCard {...valueCard} />
        <KpiCard {...deadCard} />
        <KpiCard {...outCard} />
        <KpiCard {...lowCard} />
        <KpiCard {...turnoverCard} />
        <KpiCard {...sellCard} />
      </section>

      <AnalyticsSection
        id="variants"
        title="Every variant"
        description={`Amounts are in ${report.currency}, at what the stock cost, without VAT. Click a heading to sort; the default order is the most urgent first.`}
        action={toggle}
      >
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
          {filterLink(null, "All", totals.variants)}
          {STATUS_FILTERS.map((s) =>
            filterLink(s, FILTER_COPY[s].label, countFor(s)),
          )}
        </nav>
        <DataTable<InventoryReportRow>
          caption={`Stocked variants${status ? `: ${FILTER_COPY[status].label.toLowerCase()}` : ""}, with stock, sales per day, days left and what is tied up`}
          columns={columns}
          rows={shown}
          rowKey={(r) => r.variantId}
          sort={sort}
          sortHref={sortHref}
          empty={status ? FILTER_COPY[status].empty : "No variants to show."}
          exportId="inventory.variants"
        />
        {report.rowsTruncated ? (
          <p className="text-xs text-muted">{`The table lists the ${formatCount(report.rows.length)} that need attention most, of ${formatCount(report.variants)} variants. The figures above count them all.`}</p>
        ) : null}
        <dl className="grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-2">
          <div>
            <dt className="inline font-medium">Per day: </dt>
            <dd className="inline">
              units sold per day over the last 7 and over the last 30 days.
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Days left: </dt>
            <dd className="inline">
              units on hand divided by the pace of sales (60 % the last 7 days,
              40 % the last 30). A dash means too little has sold to say.
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline font-medium">Tied up at cost: </dt>
            <dd className="inline">
              units on hand times what one unit costs. Stock counts what is on
              hand; items held for an unpaid order are not taken off.
            </dd>
          </div>
        </dl>
      </AnalyticsSection>
    </div>
  );
}
