import Link from "next/link";
import type { ReactNode } from "react";

import { NO_FIGURE, verdictOf, type GoodDirection, type Verdict } from "@/lib/analytics-core";

import { nextSort, sharePct } from "./chart-math";
import { ExportButton, type LeftOut } from "./export-scope";

/**
 * A compact table for the analytics pages (D152), sorted by links (`?sort=col&dir=`) so it works with no script, with numbers
 * right-aligned in tabular figures, an optional sticky header, an empty state and a bar for a share. Also the small text parts
 * shared by the cards: a change (`Delta`) and a status (`StatusPill`), both of which carry a sign, an arrow or an icon besides colour.
 */

// ---------- a change ----------

/** A change as the engine words it: its text (with sign), its size (for the arrow and the verdict) and, when known, whether it is good news. */
export type DeltaView = { text: string; abs: number | null; verdict?: Verdict };

const TONE_CLASS: Record<Verdict, string> = {
  good: "text-(--chart-good)",
  bad: "text-(--chart-bad)",
  neutral: "text-muted",
};

/** Which way the arrow points: by the sign of the change, never by whether it is good. */
export function arrowOf(abs: number | null | undefined): "up" | "down" | "flat" {
  if (typeof abs !== "number" || !Number.isFinite(abs) || abs === 0) return "flat";
  return abs > 0 ? "up" : "down";
}

const ARROW = { up: "▲", down: "▼", flat: "▬" } as const;
const SPOKEN = { up: "Up", down: "Down", flat: "No change" } as const;
const NEWS: Record<Verdict, string> = { good: ", better", bad: ", worse", neutral: "" };

/**
 * The change in a figure: an arrow, the signed text and the words for what it is against ("vs previous period"). Colour only adds
 * to the news (green good, red bad); the arrow and the sign are what say the direction, and a hidden word says it to a screen reader.
 * With no change to show (nothing to compare with) it says so with a dash.
 */
export function Delta({ delta, versus, good = "neutral" }: { delta: DeltaView | null | undefined; versus: string; good?: GoodDirection }) {
  if (!delta) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-1 text-xs text-muted">
        <span>{NO_FIGURE}</span>
        <span>{versus}</span>
      </span>
    );
  }
  const direction = arrowOf(delta.abs);
  const verdict = delta.verdict ?? verdictOf(delta.abs, good);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1 text-xs">
      <span className={`inline-flex items-baseline gap-1 whitespace-nowrap font-medium tabular-nums ${TONE_CLASS[verdict]}`}>
        <span aria-hidden="true" className="text-[0.7em]">
          {ARROW[direction]}
        </span>
        <span className="sr-only">{`${SPOKEN[direction]}${NEWS[verdict]}: `}</span>
        <span>{delta.text}</span>
      </span>
      <span className="text-muted">{versus}</span>
    </span>
  );
}

// ---------- a status ----------

export type PillTone = "good" | "warning" | "bad" | "neutral" | "info";

const PILL_ICON: Record<PillTone, string> = { good: "✓", warning: "!", bad: "✕", neutral: "•", info: "i" };
const PILL_CLASS: Record<PillTone, string> = {
  good: "border-(--chart-good) text-(--chart-good)",
  warning: "border-(--chart-warn) text-(--chart-warn)",
  bad: "border-(--chart-bad) text-(--chart-bad)",
  neutral: "border-border text-muted",
  info: "border-border text-foreground",
};

/** A short state in words ("Out of stock", "Behind pace") with an icon, so colour is never all it says. */
export function StatusPill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${PILL_CLASS[tone]}`}>
      <span aria-hidden="true" className="text-[0.85em] leading-none">
        {PILL_ICON[tone]}
      </span>
      <span>{children}</span>
    </span>
  );
}

// ---------- a share ----------

/** A bar for a share (0 to 1) under its text, for a cell of a table: "Share of revenue 42.1 %". The text carries the figure; the bar only shows it. */
export function ShareBar({ share, text, label }: { share: number | null | undefined; text: string; label?: string }) {
  const known = typeof share === "number" && Number.isFinite(share);
  const width = known ? sharePct(share, 1) : 0;
  // The figure over its bar, not beside it: a share column is as wide as its figure, so a table with two of them still fits.
  return (
    <span className="flex flex-col items-end gap-1" {...(label ? { title: label } : {})}>
      <span className="tabular-nums">{text}</span>
      <span aria-hidden="true" className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-(--chart-seq-0)">
        <span className="block h-full rounded-full bg-(--chart-1)" style={{ width: `${width}%` }} />
      </span>
    </span>
  );
}

// ---------- the table ----------

export type Column<R> = {
  /** The key the address carries when the table is sorted by this column. */
  key: string;
  label: string;
  /** Numbers and shares go right. */
  align?: "left" | "right";
  /** A header that is a link. Needs `sortHref` on the table. */
  sortable?: boolean;
  /** The first direction a click sorts in; text starts ascending, figures descending (the default). */
  firstDir?: "asc" | "desc";
  cell: (row: R) => ReactNode;
};

export type SortState = { key: string; dir: "asc" | "desc" };

/** The address a header links to: the page's own, with the sort set (the caller keeps the period and other parameters). */
export type SortHref = (key: string, dir: "asc" | "desc") => string;

export function DataTable<R>({
  caption,
  showCaption = false,
  columns,
  rows,
  rowKey,
  sort,
  sortHref,
  sticky = false,
  empty = "Nothing to show for this period.",
  footer,
  exportId,
  exportLeftOut,
}: {
  caption: string;
  /** The caption is read by screen readers always; shown only when asked. */
  showCaption?: boolean;
  columns: readonly Column<R>[];
  rows: readonly R[];
  rowKey: (row: R, index: number) => string;
  sort?: SortState | null;
  sortHref?: SortHref;
  sticky?: boolean;
  empty?: string;
  /** A closing row (totals), drawn as given inside the table's foot. */
  footer?: ReactNode;
  /**
   * The table's id in `ANALYTICS_TABLES` (`src/lib/analytics-export.ts`): the table gets a Download CSV button beside it (D165). A table that is not
   * exportable says `exportable={false}` with an `exportReason` that is in `NOT_EXPORTED`; `analytics-export-views.test.ts` fails for any other.
   */
  exportId?: string;
  exportable?: boolean;
  exportReason?: string;
  /** The orders the page leaves out (a currency with no rate), repeated on the button. */
  exportLeftOut?: LeftOut | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
        <span className="sr-only">{`${caption}: `}</span>
        {empty}
      </div>
    );
  }
  const stickyHead = sticky ? "sticky top-0 z-10" : "";
  // The more columns, the less room between them: a table of twelve has to fit a laptop's width without hiding its last columns.
  const pad = columns.length >= 10 ? "px-1" : columns.length >= 8 ? "px-1.5" : "px-3";
  const table = (
    <div className={`relative overflow-x-auto rounded-lg border border-border bg-background ${sticky ? "max-h-[32rem] overflow-y-auto" : ""}`}>
      <table className="w-full border-collapse text-[13px]">
        <caption className={showCaption ? "px-3 py-2 text-left text-xs font-medium text-muted" : "sr-only"}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = !!sortHref && c.sortable === true && sort?.key === c.key;
              const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : c.sortable && sortHref ? "none" : undefined;
              const align = c.align === "right" ? "text-right" : "text-left";
              return (
                <th key={c.key} scope="col" aria-sort={ariaSort} className={`border-b border-border ${pad} py-2 align-bottom text-xs ${align} ${stickyHead}`}>
                  {c.sortable && sortHref ? (
                    <Link
                      href={sortHref(c.key, nextSort(sort, c.key, c.firstDir ?? "desc"))}
                      className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
                    >
                      <span>{c.label}</span>
                      <span aria-hidden="true" className="text-[0.7em]">
                        {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b border-border last:border-b-0">
              {columns.map((c, j) => (
                <td key={c.key} className={`${pad} py-1.5 ${c.align === "right" ? "text-right tabular-nums" : "text-left"} ${j === 0 ? "max-w-[14rem] truncate" : ""}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot className="border-t border-border font-medium">{footer}</tfoot> : null}
      </table>
    </div>
  );
  if (!exportId) return table;
  return (
    <>
      {table}
      <div className="flex justify-end empty:hidden">
        <ExportButton exportId={exportId} leftOut={exportLeftOut} />
      </div>
    </>
  );
}
