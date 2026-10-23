import Link from "next/link";

import { fillWords } from "@/lib/admin-fill";
import { reportsEn, type ReportsMessages } from "@/lib/admin-messages/reports.en";
import type { ReactNode } from "react";

import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import { formatAmount, formatDecimal, formatUpTo } from "@/lib/analytics-format";
import {
  DEAD_STOCK_DAYS,
  LOW_STOCK_DAYS,
  onBackorder,
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
import { CARD_CLASS } from "@/components/admin/ui";

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

export type InventoryWords = ReportsMessages["inventory"];
const cnt = (n: number, pair: { one: string; many: string }) => `${formatCount(n)} ${n === 1 ? pair.one : pair.many}`;

/** Units per day, up to two decimals ("0.43"); the dash when it cannot be known. */
export function perDayOf(): (n: number | null | undefined) => string {
  return (n) => formatUpTo(n, 2);
}

/** How long stock lasts, in words: "6 days", "under a day"; the dash when it cannot be known. */
export function daysText(days: number | null | undefined, w: InventoryWords = reportsEn.inventory): string {
  if (typeof days !== "number" || !Number.isFinite(days)) return NO_FIGURE;
  if (days < 1) return w.underADay;
  const whole = Math.round(days);
  return `${whole} ${whole === 1 ? w.n.day.one : w.n.day.many}`;
}

/** One alert in a sentence: "Ethiopian Coffee 1kg: estimated stockout in 6 days". */
export function alertText(alert: InventoryReport["alerts"][number], w: InventoryWords = reportsEn.inventory): string {
  const name = alert.row.name;
  if (alert.kind === "out") return onBackorder(alert.row) ? `${fillWords(w.alertBackorder, { name })}${alert.row.owed > 0 ? fillWords(w.alertOwed, { n: String(alert.row.owed) }) : ""}` : fillWords(w.alertOut, { name });
  return fillWords(w.alertSoon, { name, days: alert.days < 1 ? w.lessThanADay : daysText(alert.days, w) });
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

function lastSoldText(r: InventoryReportRow, w: InventoryWords): string {
  if (r.lastSoldDaysAgo === null)
    return r.ageDays < 365 ? w.never : w.overAYear;
  if (r.lastSoldDaysAgo === 0) return w.today;
  return fillWords(w.daysAgo, { days: cnt(r.lastSoldDaysAgo, w.n.day) });
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
  words: w = reportsEn.inventory,
}: InventoryViewProps & { words?: InventoryWords }) {
  const pill = (s: StockStatus) => ({ tone: PILL[s].tone, label: w.pill[s].label, help: fillWords(w.pill[s].help, { days: String(s === "low" ? LOW_STOCK_DAYS : DEAD_STOCK_DAYS) }) });
  const money = moneyOf(report.currency, locale);
  const perDay = perDayOf();
  const path = `${base}/analytics/inventory`;
  const productHref = (id: string) => `${base}/products/${id}`;
  const costsAction = {
    label: w.enterCosts,
    href: `${base}/products`,
  };
  const { totals } = report;

  // ---- notes about what the figures are and are not ----
  const notes: ReactNode[] = [];
  if (report.readTruncated) {
    notes.push(
      <Note key="read" tone="warning" title={w.readTitle}>
        {w.read}
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
          title={w.emptyTitle}
          description={w.emptyDescription}
        >
          <div className="rounded-panel border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            <p className="font-medium text-ink">{w.emptyLead}</p>
            <p className="mx-auto mt-1 max-w-prose">
              {w.emptyBody}{" "}
              <Link href={`${base}/products`} className={linkClass}>
                {w.goToProducts}
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
      <Note key="nosales" title={w.noSalesTitle}>
        {w.noSales}
        {totals.sellThrough30 !== null
          ? w.sellThroughZero
          : ""}{" "}
        {w.levelsNormal}
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
            ? fillWords(w.valueCovers, { share: formatPercent(value.coverage, 0) })
            : w.costsNotEntered
        }
      >
        {fillWords(value.unitsWithoutCost === 1 ? w.noCostOne : w.noCostMany, { units: cnt(value.unitsWithoutCost, w.n.unit) })}{" "}
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
        {a.kind === "out" ? w.alertOutPill : w.alertSoonPill}
      </StatusPill>
      <span className="min-w-0">
        <Link
          href={productHref(a.row.productId)}
          className={`${linkClass} break-words`}
        >
          {alertText(a, w)}
        </Link>
        <span className="block text-xs text-muted">{`${fillWords(w.alertSold, { n30: formatCount(a.row.sold30), n7: formatCount(a.row.sold7) })}${a.kind === "out" ? (onBackorder(a.row) ? w.alertBackorderNote : w.alertNothing) : fillWords(w.alertOnHand, { n: formatCount(a.row.onHand) })}`}</span>
      </span>
    </li>
  );

  // ---- the three things first ----
  const valueHelp = w.valueHelp;
  const valueCard: KpiCardProps =
    value.units === 0
      ? {
          label: w.valueLabel,
          value: null,
          state: "missing",
          help: valueHelp,
          missing: {
            text: w.valueNothing,
          },
        }
      : value.coverage !== null && value.coverage <= 0
        ? {
            label: w.valueLabel,
            value: null,
            state: "missing",
            help: valueHelp,
            missing: {
              text: w.valueNoCosts,
              action: costsAction,
            },
          }
        : {
            label: w.valueLabel,
            value: money(value.valueMinor),
            help: valueHelp,
            hint:
              value.coverage !== null && value.coverage < 1
                ? fillWords(w.valueBasedOn, { share: formatPercent(value.coverage, 0), units: cnt(value.units, w.n.unit) })
                : fillWords(w.valueUnits, { units: cnt(value.units, w.n.unit), variants: cnt(totals.variants, w.n.variant) }),
            emphasis: true,
          };

  const outCard: KpiCardProps = {
    label: w.outLabel,
    value: formatCount(totals.out),
    help: w.outHelp,
    hint:
      totals.out === 0
        ? w.outNone
        : totals.out === 1
          ? w.outOne
          : fillWords(w.outMany, { n: formatCount(totals.out) }),
    href: `${path}?status=out#variants`,
  };
  const lowCard: KpiCardProps = {
    label: w.lowLabel,
    value: formatCount(totals.low),
    help: fillWords(w.lowHelp, { days: String(LOW_STOCK_DAYS) }),
    hint:
      totals.belowLevel > 0
        ? fillWords(w.lowHintLevel, { variants: cnt(totals.belowLevel, w.n.variant), days: String(LOW_STOCK_DAYS) })
        : fillWords(w.lowHint, { days: String(LOW_STOCK_DAYS) }),
    href: `${path}?status=low#variants`,
  };

  // Backorders (D172): only when the store sells past its stock or still owes units. Never a 0 that hides a debt, and never shown at all
  // for a store that does not use backorders.
  const backorderCard: KpiCardProps | null =
    totals.owedUnits > 0 || totals.onBackorder > 0
      ? {
          label: w.owedLabel,
          value: formatCount(totals.owedUnits),
          help: w.owedHelp,
          hint:
            totals.onBackorder > 0
              ? fillWords(w.owedSelling, { variants: cnt(totals.onBackorder, w.n.variant) })
              : w.owedNone,
          href: `${base}/inventory?status=backorder`,
        }
      : null;

  // Dead stock: units with no known cost make its value partial, which the hint says (rows are the whole picture only when not cut).
  const deadUnknown = report.rowsTruncated
    ? null
    : report.rows
        .filter((r) => r.status === "dead" && r.costMinor === null)
        .reduce((s, r) => s + r.onHand, 0);
  const deadHint =
    totals.dead === 0
      ? w.deadNone
      : deadUnknown !== null && deadUnknown >= totals.deadUnits
        ? fillWords(w.deadNoCosts, { units: cnt(totals.deadUnits, w.n.unit) })
        : fillWords(w.deadValue, { units: cnt(totals.deadUnits, w.n.unit), money: money(totals.deadValueMinor), where: deadUnknown === null || deadUnknown > 0 ? w.whereKnown : "" });
  const deadCard: KpiCardProps = {
    label: w.deadLabel,
    value: formatCount(totals.dead),
    help: fillWords(w.deadHelp, { days: String(DEAD_STOCK_DAYS) }),
    hint: deadHint,
    href: `${path}?status=dead#variants`,
  };

  const turnoverHelp = w.turnoverHelp;
  const turnoverCard: KpiCardProps = ((): KpiCardProps => {
    const base0 = { label: w.turnoverLabel, help: turnoverHelp };
    if (value.units === 0)
      return {
        ...base0,
        value: null,
        state: "missing",
        missing: {
          text: w.turnoverNothing,
        },
      };
    if (value.coverage !== null && value.coverage <= 0)
      return {
        ...base0,
        value: null,
        state: "missing",
        missing: {
          text: w.turnoverNoCosts,
          action: costsAction,
        },
      };
    if (totals.cogs365Coverage === null)
      return {
        ...base0,
        value: null,
        state: "missing",
        missing: { text: w.turnoverNoSales },
      };
    if (totals.cogs365Coverage <= 0 || totals.turnover === null)
      return {
        ...base0,
        value: null,
        state: "missing",
        missing: {
          text: w.turnoverNoCogs,
          action: costsAction,
        },
      };
    return {
      ...base0,
      value: fillWords(w.timesAYear, { n: formatDecimal(totals.turnover, 1) }),
      hint:
        totals.cogs365Coverage < 1
          ? fillWords(w.turnoverBasedOn, { share: formatPercent(totals.cogs365Coverage, 0) })
          : w.turnoverHint,
    };
  })();

  const sellHelp = w.sellHelp;
  const sellCard: KpiCardProps =
    totals.sellThrough30 === null
      ? {
          label: w.sellLabel,
          value: null,
          state: "missing",
          help: sellHelp,
          missing: {
            text: w.sellNone,
          },
        }
      : {
          label: w.sellLabel,
          value: formatPercent(totals.sellThrough30, 1),
          help: sellHelp,
          hint: fillWords(w.sellHint, { units: cnt(totals.sold30, w.n.unit) }),
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
      label: w.cols.name,
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
            <span className="block text-xs text-muted">{fillWords(w.sku, { sku: r.sku })}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      label: w.cols.status,
      sortable: true,
      firstDir: "asc",
      cell: (r) => (
        <span title={r.onBackorder ? w.backorderHelp : pill(r.status).help}>
          <StatusPill tone={r.onBackorder ? "warning" : PILL[r.status].tone}>
            {r.onBackorder ? w.backorderLabel : pill(r.status).label}
          </StatusPill>
        </span>
      ),
    },
    {
      key: "onHand",
      label: w.cols.onHand,
      align: "right",
      sortable: true,
      cell: (r) =>
        r.owed > 0 || r.onHand < 0 ? (
          <span title={w.belowZero}>
            {formatCount(r.onHand)}
            {r.owed > 0 ? (
              <span className="block text-xs text-muted">{fillWords(w.owed, { n: formatCount(r.owed) })}</span>
            ) : null}
          </span>
        ) : (
          formatCount(r.onHand)
        ),
    },
    {
      key: "v7",
      label: w.cols.v7,
      align: "right",
      sortable: true,
      cell: (r) => (
        <span title={fillWords(w.sold7, { n: formatCount(r.sold7) })}>
          {perDay(r.velocity.v7)}
        </span>
      ),
    },
    {
      key: "v30",
      label: w.cols.v30,
      align: "right",
      sortable: true,
      cell: (r) => (
        <span title={fillWords(w.sold30, { n: formatCount(r.sold30) })}>
          {perDay(r.velocity.v30)}
        </span>
      ),
    },
    {
      key: "days",
      label: w.cols.days,
      align: "right",
      sortable: true,
      firstDir: "asc",
      cell: (r) =>
        r.daysOfStock === null ? (
          <span
            title={
              r.sold30 === 0
                ? w.daysNoSales
                : fillWords(w.daysFew, { n: String(MIN_SOLD_30D) })
            }
          >
            {NO_FIGURE}
          </span>
        ) : (
          <span className="whitespace-nowrap">{daysText(r.daysOfStock, w)}</span>
        ),
    },
    {
      key: "value",
      label: w.cols.value,
      align: "right",
      sortable: true,
      cell: (r) =>
        r.valueMinor !== null ? (
          money(r.valueMinor)
        ) : r.onHand > 0 && r.costMinor === null ? (
          <span
            className="text-muted"
            title={w.noCostTitle}
          >
            {w.noCost}
          </span>
        ) : (
          <span title={w.nothingOnHand}>{NO_FIGURE}</span>
        ),
    },
    {
      key: "lastSold",
      label: w.cols.lastSold,
      align: "right",
      sortable: true,
      firstDir: "asc",
      cell: (r) => <span className="whitespace-nowrap">{lastSoldText(r, w)}</span>,
    },
  ];

  const toggle =
    limited || (showAll && sorted.length > ROW_LIMIT) ? (
      <Link
        href={inventoryHref(path, { status, sort, showAll: limited })}
        className={linkClass}
      >
        {limited
          ? fillWords(w.showAll, { n: formatCount(sorted.length) })
          : fillWords(w.showFirst, { n: String(ROW_LIMIT) })}
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
        className={`inline-flex h-9 items-center gap-1.5 rounded-panel border px-3 text-sm ${active ? "border-brand bg-sunken font-medium" : "border-line"}`}
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
        title={w.alertsTitle}
        description={fillWords(w.alertsDescription, { days: String(STOCKOUT_ALERT_DAYS), min: String(MIN_SOLD_30D) })}
      >
        {report.alerts.length === 0 ? (
          <div className="rounded-panel border border-dashed border-line px-4 py-5 text-sm text-muted">
            {noSales30
              ? w.alertsNoSales
              : fillWords(w.alertsNone, { days: String(STOCKOUT_ALERT_DAYS) })}
          </div>
        ) : (
          <div className={`p-4 ${CARD_CLASS}`}>
            <ul className="space-y-3 text-sm">{shownAlerts.map(alertItem)}</ul>
            {foldedAlerts.length > 0 ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted hover:text-ink">{fillWords(w.showMore, { n: formatCount(foldedAlerts.length) })}</summary>
                <ul className="mt-3 space-y-3">
                  {foldedAlerts.map(alertItem)}
                </ul>
              </details>
            ) : null}
            {report.alertsTotal > report.alerts.length ? (
              <p className="mt-3 text-xs text-muted">{fillWords(w.showingUrgent, { shown: formatCount(report.alerts.length), all: formatCount(report.alertsTotal) })}</p>
            ) : null}
          </div>
        )}
      </AnalyticsSection>

      <section
        aria-label={w.mainFigures}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        <KpiCard {...valueCard} />
        <KpiCard {...deadCard} />
        <KpiCard {...outCard} />
        <KpiCard {...lowCard} />
        {backorderCard ? <KpiCard {...backorderCard} /> : null}
        <KpiCard {...turnoverCard} />
        <KpiCard {...sellCard} />
      </section>

      <AnalyticsSection
        id="variants"
        title={w.tableTitle}
        description={fillWords(w.tableDescription, { currency: report.currency })}
        action={toggle}
      >
        <nav aria-label={w.filterLabel} className="flex flex-wrap gap-1">
          {filterLink(null, w.all, totals.variants)}
          {STATUS_FILTERS.map((s) =>
            filterLink(s, w.filter[s].label, countFor(s)),
          )}
        </nav>
        <DataTable<InventoryReportRow>
          caption={status ? fillWords(w.captionFiltered, { status: w.filter[status].label.toLowerCase() }) : w.caption}
          columns={columns}
          rows={shown}
          rowKey={(r) => r.variantId}
          sort={sort}
          sortHref={sortHref}
          empty={status ? w.filter[status].empty : w.tableEmpty}
          exportId="inventory.variants"
        />
        {report.rowsTruncated ? (
          <p className="text-xs text-muted">{fillWords(w.rowsTruncated, { shown: formatCount(report.rows.length), all: formatCount(report.variants) })}</p>
        ) : null}
        <dl className="grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-2">
          <div>
            <dt className="inline font-medium">{w.perDayTerm}</dt>
            <dd className="inline">
              {w.perDayDef}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">{w.daysTerm}</dt>
            <dd className="inline">
              {w.daysDef}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline font-medium">{w.tiedTerm}</dt>
            <dd className="inline">
              {w.tiedDef}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline font-medium">{w.owedTerm}</dt>
            <dd className="inline">
              {w.owedDef}
            </dd>
          </div>
        </dl>
      </AnalyticsSection>
    </div>
  );
}
