import Link from "next/link";
import { useId, type ReactNode } from "react";

import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";

import {
  areaPath,
  barPath,
  funnelSteps,
  linePath,
  linearScale,
  maxOf,
  niceTicks,
  paceOf,
  rampStep,
  RAMP_STEPS,
  sharePct,
  sparseIndices,
  truncateLabel,
  type Pace,
  type Point,
} from "./chart-math";
import { ExportButton, type LeftOut } from "./export-scope";

/** What every chart takes to get its Download CSV button (D165): an id in `ANALYTICS_TABLES`, or `exportable={false}` with a reason in `NOT_EXPORTED`. */
export type ChartExport = { exportId?: string; exportable?: boolean; exportReason?: string; exportLeftOut?: LeftOut | null };

/** The button under a chart's data: nothing without an id (or without a scope, which the button itself checks). */
function ExportRow({ exportId, leftOut }: { exportId?: string; leftOut?: LeftOut | null }) {
  if (!exportId) return null;
  return (
    <div className="mt-1 flex justify-end empty:hidden">
      <ExportButton exportId={exportId} leftOut={leftOut} />
    </div>
  );
}

/**
 * The charts of the analytics pages (D152), drawn by hand as inline SVG or plain HTML on the server: no library, no script. Colours are
 * the admin's chart tokens (`--chart-1…6`, the ramp `--chart-seq-0…6`, `--chart-good/bad/warn`, `--chart-grid/axis/compare`), which
 * change with light and dark, so nothing here names a colour. Every chart is a figure with a name and a short description for a screen
 * reader, its figures in the tooltips (`<title>`, no script) and in a table behind a "Data table" disclosure, so nothing is only colour.
 * Amounts, counts and shares are formatted by the functions the page passes in (`format`), the same ones everywhere.
 */

export type Format = (value: number) => string;

const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
const OTHER = "var(--chart-compare)";

/** The colour of the nth series: the categorical set in its fixed order, and the muted "other" colour past the sixth (never a cycle). */
export const seriesColor = (index: number): string => SERIES[index] ?? OTHER;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const show = (format: Format, value: number | null | undefined) => (finite(value) ? format(value) : NO_FIGURE);

// ---------- shared pieces ----------

/** What a chart says when there is nothing to draw: a quiet box, with the chart's name for a screen reader. */
function EmptyChart({ label, text, height = 96 }: { label: string; text: string; height?: number }) {
  return (
    <div role="img" aria-label={`${label}: ${text}`} style={{ minHeight: height }} className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted">
      {text}
    </div>
  );
}

/** The table behind a chart, closed until asked for: the same figures as the tooltips, for anyone who cannot or will not read the picture. */
function DataBehind({ caption, head, rows, exportId, leftOut }: { caption: string; head: readonly string[]; rows: readonly (readonly string[])[]; exportId?: string; leftOut?: LeftOut | null }) {
  return (
    <>
    <details className="mt-2 text-xs">
      <summary className="inline-block cursor-pointer text-muted hover:text-foreground">Data table</summary>
      <div className="relative mt-1 max-h-72 overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col" className={`sticky top-0 whitespace-nowrap px-2 py-1 ${i === 0 ? "text-left" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                {r.map((c, j) => (
                  <td key={j} className={`px-2 py-1 ${j === 0 ? "text-left" : "text-right tabular-nums"}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
    <ExportRow exportId={exportId} leftOut={leftOut} />
    </>
  );
}

type LegendItem = { label: string; color: string; dashed?: boolean };

/** Who is who, in words beside a colour key; present whenever a chart has more than one thing to tell apart. */
function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul aria-label="Legend" className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-4"
            style={item.dashed ? { borderTop: `2px dashed ${item.color}` } : { height: 3, borderRadius: 2, background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** The SVG itself: a named image with a description a screen reader can reach, scaling to its card (down to a phone's width, so the latest point is never scrolled out of sight). */
function Svg({ label, description, width, height, children }: { label: string; description: string; width: number; height: number; children: ReactNode }) {
  const descId = useId();
  return (
    <div className="relative overflow-x-auto">
      <svg role="img" aria-label={label} aria-describedby={descId} viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full min-w-[280px] text-[11px]" fontFamily="inherit">
        <desc id={descId}>{description}</desc>
        {children}
      </svg>
    </div>
  );
}

const W = 480;

/** The room the y-axis labels need on the left, from the widest of them. */
const leftMargin = (labels: readonly string[]) => Math.min(96, Math.max(32, 10 + Math.max(0, ...labels.map((l) => l.length)) * 6.2));

function YAxis({ ticks, y, left, right, format, bottomY }: { ticks: readonly number[]; y: (v: number) => number; left: number; right: number; format: Format; bottomY: number }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} />
          <text x={left - 6} y={y(t)} dy=".32em" textAnchor="end" fill="var(--muted)">
            {format(t)}
          </text>
        </g>
      ))}
      <line x1={left} x2={right} y1={bottomY} y2={bottomY} stroke="var(--chart-axis)" strokeWidth={1} />
    </g>
  );
}

/** What the axis writes under a point: a week's "Week of 2 Feb" is "2 Feb" (the cut would leave "Week of 2…", the same on every label); the tooltip and the table keep the whole. */
const axisLabel = (label: string): string => label.replace(/^Week of /, "");

function XLabels({ labels, indices, x, y }: { labels: readonly string[]; indices: readonly number[]; x: (i: number) => number; y: number }) {
  return (
    <g fill="var(--muted)" textAnchor="middle">
      {indices.map((i) => (
        // The last label would run past the chart's right edge and be cut off: it ends at the edge instead of being centred on it.
        <text key={i} x={x(i)} y={y} textAnchor={x(i) > W - 24 ? "end" : "middle"}>
          {truncateLabel(axisLabel(labels[i] ?? ""), 10)}
        </text>
      ))}
    </g>
  );
}

// ---------- line chart ----------

export type LineSeries = {
  key: string;
  label: string;
  values: readonly (number | null)[];
  /** The same measure over the comparison period, point for point; drawn dashed and muted. */
  previous?: readonly (number | null)[];
};

/** One to three lines over the same x labels. A null is a gap, not a zero. */
export function LineChart({
  label,
  labels,
  series,
  format,
  axisFormat,
  previousLabel = "Previous period",
  height = 220,
  area = false,
  integer = false,
  includeZero = true,
  emptyText = "No data for this period.",
  exportId,
  exportLeftOut,
}: ChartExport & {
  label: string;
  labels: readonly string[];
  series: readonly LineSeries[];
  format: Format;
  /** A shorter form for the axis (12.3K); the tooltips and the table use `format`. */
  axisFormat?: Format;
  previousLabel?: string;
  height?: number;
  /** A faint wash under the line; only for a single line. */
  area?: boolean;
  /** A count's axis never has a fractional tick. */
  integer?: boolean;
  includeZero?: boolean;
  emptyText?: string;
}) {
  const lines = series.slice(0, 3);
  const n = labels.length;
  const reads = (s: LineSeries, i: number) => (finite(s.values[i]) ? s.values[i] : null);
  const reads2 = (s: LineSeries, i: number) => (s.previous && finite(s.previous[i]) ? s.previous[i] : null);
  const everything: number[] = [];
  for (const s of lines) {
    for (let i = 0; i < n; i += 1) {
      const v = reads(s, i);
      const p = reads2(s, i);
      if (v !== null) everything.push(v);
      if (p !== null) everything.push(p);
    }
  }
  if (n === 0 || lines.length === 0 || !lines.some((s) => Array.from({ length: n }, (_, i) => reads(s, i)).some((v) => v !== null))) {
    return <EmptyChart label={label} text={emptyText} height={height / 2} />;
  }

  const ax = axisFormat ?? format;
  const ticks = niceTicks(Math.min(...everything), Math.max(...everything), { integer, includeZero });
  const left = leftMargin(ticks.ticks.map(ax));
  const right = W - 12;
  const top = 10;
  const bottom = height - 24;
  const slot = n > 1 ? (right - left) / (n - 1) : right - left;
  const x = (i: number) => (n === 1 ? (left + right) / 2 : left + i * slot);
  const y = linearScale([ticks.min, ticks.max], [bottom, top]);
  const hasPrevious = lines.some((s) => s.previous);
  const items: LegendItem[] = lines.map((s, i) => ({ label: s.label, color: seriesColor(i) }));
  if (hasPrevious) items.push({ label: previousLabel, color: "var(--chart-compare)", dashed: true });

  const description = lines
    .map((s) => {
      const vals = Array.from({ length: n }, (_, i) => reads(s, i)).filter((v): v is number => v !== null);
      if (vals.length === 0) return `${s.label}: no data`;
      if (vals.every((v) => v === 0)) return `${s.label}: ${vals.length} points, all zero`;
      return `${s.label}: ${vals.length} points, latest ${format(vals[vals.length - 1])}, highest ${format(Math.max(...vals))}, lowest ${format(Math.min(...vals))}`;
    })
    .join(". ");

  const head = ["", ...lines.map((s) => s.label), ...lines.filter((s) => s.previous).map((s) => (lines.length > 1 ? `${s.label} (${previousLabel})` : previousLabel))];
  const rows = labels.slice(0, 400).map((l, i) => [l, ...lines.map((s) => show(format, reads(s, i))), ...lines.filter((s) => s.previous).map((s) => show(format, reads2(s, i)))]);

  return (
    <figure className="min-w-0">
      {items.length > 1 ? <Legend items={items} /> : null}
      <Svg label={label} description={description} width={W} height={height}>
        <YAxis ticks={ticks.ticks} y={y} left={left} right={right} format={ax} bottomY={y(ticks.min)} />
        <XLabels labels={labels} indices={sparseIndices(n, Math.max(2, Math.floor((right - left) / 64)))} x={x} y={height - 6} />
        {lines.map((s, si) => {
          const color = seriesColor(si);
          const pts: (Point | null)[] = Array.from({ length: n }, (_, i) => {
            const v = reads(s, i);
            return v === null ? null : { x: x(i), y: y(v) };
          });
          const prev: (Point | null)[] = Array.from({ length: n }, (_, i) => {
            const v = reads2(s, i);
            return v === null ? null : { x: x(i), y: y(v) };
          });
          const lastIndex = pts.reduce<number>((acc, p, i) => (p ? i : acc), -1);
          const last = lastIndex >= 0 ? pts[lastIndex] : null;
          return (
            <g key={s.key}>
              {s.previous ? <path d={linePath(prev)} fill="none" stroke="var(--chart-compare)" strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" /> : null}
              {area && lines.length === 1 ? <path d={areaPath(pts, y(Math.max(0, ticks.min)))} fill={color} opacity={0.1} /> : null}
              <path d={linePath(pts)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="an-mark" />
              {last ? <circle cx={last.x} cy={last.y} r={4} fill={color} stroke="var(--background)" strokeWidth={2} /> : null}
            </g>
          );
        })}
        {n <= 200
          ? labels.map((l, i) => {
              const half = slot / 2;
              const x0 = Math.max(0, x(i) - half);
              return (
                <rect key={i} className="an-hit" x={x0} y={top} width={Math.min(W - x0, n === 1 ? right - left : slot)} height={bottom - top} fill="transparent">
                  <title>
                    {[
                      l,
                      ...lines.map((s) => `${s.label}: ${show(format, reads(s, i))}`),
                      ...lines.filter((s) => s.previous).map((s) => `${lines.length > 1 ? `${s.label}, ` : ""}${previousLabel}: ${show(format, reads2(s, i))}`),
                    ].join("\n")}
                  </title>
                </rect>
              );
            })
          : null}
      </Svg>
      <DataBehind caption={label} head={head} rows={rows} exportId={exportId} leftOut={exportLeftOut} />
    </figure>
  );
}

// ---------- bar chart ----------

export type BarSeries = { key: string; label: string; values: readonly (number | null)[] };

/** Columns by label, side by side or stacked; a column grows from the zero line, up for a positive and down for a negative. */
export function BarChart({
  label,
  labels,
  series,
  stacked = false,
  format,
  axisFormat,
  height = 220,
  integer = false,
  emptyText = "No data for this period.",
  exportId,
  exportLeftOut,
}: ChartExport & {
  label: string;
  labels: readonly string[];
  series: readonly BarSeries[];
  stacked?: boolean;
  format: Format;
  axisFormat?: Format;
  height?: number;
  integer?: boolean;
  emptyText?: string;
}) {
  const bars = series.slice(0, 6);
  const n = labels.length;
  const at = (s: BarSeries, i: number) => (finite(s.values[i]) ? s.values[i] : 0);
  const known = (s: BarSeries, i: number) => finite(s.values[i]);
  if (n === 0 || bars.length === 0 || !bars.some((s) => labels.some((_, i) => known(s, i)))) return <EmptyChart label={label} text={emptyText} height={height / 2} />;

  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i += 1) {
    if (stacked) {
      lo = Math.min(lo, bars.reduce((a, s) => a + Math.min(0, at(s, i)), 0));
      hi = Math.max(hi, bars.reduce((a, s) => a + Math.max(0, at(s, i)), 0));
    } else {
      for (const s of bars) {
        lo = Math.min(lo, at(s, i));
        hi = Math.max(hi, at(s, i));
      }
    }
  }
  const ax = axisFormat ?? format;
  const ticks = niceTicks(lo, hi, { integer });
  const left = leftMargin(ticks.ticks.map(ax));
  const right = W - 12;
  const top = 10;
  const bottom = height - 24;
  const y = linearScale([ticks.min, ticks.max], [bottom, top]);
  const slot = (right - left) / n;
  const k = stacked ? 1 : bars.length;
  const gap = 2;
  const barW = Math.max(1, Math.min(24, (slot * 0.8 - gap * (k - 1)) / k));
  const groupW = barW * k + gap * (k - 1);
  const slotX = (i: number) => left + i * slot;
  const zeroY = y(0);

  const description = bars
    .map((s) => {
      const vals = labels.map((_, i) => s.values[i]).filter(finite);
      const total = vals.reduce((a, b) => a + b, 0);
      return vals.length === 0 ? `${s.label}: no data` : vals.every((v) => v === 0) ? `${s.label}: all zero` : `${s.label}: ${vals.length} columns, total ${format(total)}, highest ${format(Math.max(...vals))}`;
    })
    .join(". ");
  const head = ["", ...bars.map((s) => s.label), ...(stacked && bars.length > 1 ? ["Total"] : [])];
  const rows = labels.slice(0, 400).map((l, i) => [l, ...bars.map((s) => show(format, finite(s.values[i]) ? s.values[i] : null)), ...(stacked && bars.length > 1 ? [format(bars.reduce((a, s) => a + at(s, i), 0))] : [])]);

  return (
    <figure className="min-w-0">
      {bars.length > 1 ? <Legend items={bars.map((s, i) => ({ label: s.label, color: seriesColor(i) }))} /> : null}
      <Svg label={label} description={description} width={W} height={height}>
        <YAxis ticks={ticks.ticks} y={y} left={left} right={right} format={ax} bottomY={y(ticks.min)} />
        <XLabels labels={labels} indices={sparseIndices(n, Math.max(2, Math.floor((right - left) / 48)))} x={(i) => slotX(i) + slot / 2} y={height - 6} />
        {labels.map((_, i) => {
          const x0 = slotX(i) + (slot - groupW) / 2;
          if (stacked) {
            const segments: { s: number; from: number; to: number }[] = [];
            let pos = 0;
            let neg = 0;
            bars.forEach((s, si) => {
              const v = at(s, i);
              if (v > 0) {
                segments.push({ s: si, from: pos, to: pos + v });
                pos += v;
              } else if (v < 0) {
                segments.push({ s: si, from: neg, to: neg + v });
                neg += v;
              }
            });
            const lastUp = Math.max(-1, ...segments.filter((g) => g.to > g.from).map((g) => g.s));
            const lastDown = Math.max(-1, ...segments.filter((g) => g.to < g.from).map((g) => g.s));
            return (
              <g key={i}>
                {segments.map((g) => {
                  const outer = g.s === (g.to > g.from ? lastUp : lastDown);
                  const dir = g.to > g.from ? -1 : 1; // an SVG's y grows downward
                  // The two sides of a join each give up a pixel (the 2 px gap), toward the segment's own middle; the baseline and the free end stay put.
                  const y0 = y(g.from) + (g.from === 0 ? 0 : dir);
                  const y1 = y(g.to) - (outer ? 0 : dir);
                  const d = barPath(x0, y0, y1, barW, outer ? 4 : 0);
                  return d ? <path key={g.s} d={d} fill={seriesColor(g.s)} className="an-mark" /> : null;
                })}
              </g>
            );
          }
          return (
            <g key={i}>
              {bars.map((s, si) => {
                // A zero or a gap has no column; nothing is drawn for it.
                const d = known(s, i) ? barPath(x0 + si * (barW + gap), zeroY, y(at(s, i)), barW, 4) : "";
                return d ? <path key={s.key} d={d} fill={seriesColor(si)} className="an-mark" /> : null;
              })}
            </g>
          );
        })}
        {n <= 200
          ? labels.map((l, i) => (
              <rect key={i} className="an-hit" x={slotX(i)} y={top} width={slot} height={bottom - top} fill="transparent">
                <title>{[l, ...bars.map((s) => `${s.label}: ${show(format, finite(s.values[i]) ? s.values[i] : null)}`)].join("\n")}</title>
              </rect>
            ))
          : null}
      </Svg>
      <DataBehind caption={label} head={head} rows={rows} exportId={exportId} leftOut={exportLeftOut} />
    </figure>
  );
}

// ---------- ranked bars ----------

export type BarRow = {
  key?: string;
  label: string;
  value: number | null;
  /** The figure as written for the row ("12 400 kr"); the bar only shows it. */
  valueText: string;
  /** A second, quieter figure ("32 orders"). */
  detail?: string;
  href?: string;
  /** Which categorical colour; the same entity keeps its colour wherever it is drawn. */
  colorIndex?: number;
};

/**
 * A ranked list with a bar and a value at the end of each row, for products, channels and countries. Rows come in the order given
 * (the caller ranks). A negative value is a bar in the bad colour with its minus sign in the text. A long label is cut and keeps its
 * full text in `title`. It is a list of words with the figures in it, so it needs no table behind it.
 */
export function HorizontalBars({
  label,
  rows,
  limit,
  emptyText = "Nothing to show for this period.",
  exportId,
  exportLeftOut,
}: ChartExport & {
  label: string;
  rows: readonly BarRow[];
  limit?: number;
  emptyText?: string;
}) {
  if (rows.length === 0) return <EmptyChart label={label} text={emptyText} />;
  const shown = limit && limit > 0 ? rows.slice(0, limit) : rows;
  const max = Math.max(0, ...shown.map((r) => (finite(r.value) ? Math.abs(r.value) : 0)));
  return (
    <div className="@container">
      <ol aria-label={label} className="space-y-2 text-sm @md:space-y-1.5">
        {shown.map((r, i) => {
          const width = finite(r.value) ? sharePct(Math.abs(r.value), max) : 0;
          const negative = finite(r.value) && r.value < 0;
          const name = r.href ? (
            <Link href={r.href} title={r.label} className="block truncate hover:underline">
              {r.label}
            </Link>
          ) : (
            <span title={r.label} className="block truncate">
              {r.label}
            </span>
          );
          return (
            // In a narrow list (a phone, a half-width card) the name and the figure share the first line and the bar runs under them, so it
            // keeps its length; with room, they are one row: name, bar, figure.
            <li
              key={r.key ?? `${r.label}-${i}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 @md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]"
            >
              {name}
              <span aria-hidden="true" className="order-last col-span-2 h-2 overflow-hidden rounded-full bg-(--chart-seq-0) @md:order-none @md:col-span-1">
                <span className="block h-full rounded-full" style={{ width: `${width}%`, background: negative ? "var(--chart-bad)" : seriesColor(r.colorIndex ?? 0) }} />
              </span>
              <span className="text-right tabular-nums">
                {r.valueText}
                {r.detail ? <span className="ml-1.5 text-xs text-muted">{r.detail}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {shown.length < rows.length ? <p className="mt-2 text-xs text-muted">{`Showing ${shown.length} of ${rows.length}.`}</p> : null}
      <ExportRow exportId={exportId} leftOut={exportLeftOut} />
    </div>
  );
}

// ---------- sparkline ----------

/**
 * A line with no axes, for a card: the shape of the last days. With a `label` it is an image with that name; without, it is
 * decoration and hidden from a screen reader (the card carries the figure). Fewer than two figures draws nothing but the end dot or no
 * line at all. A flat line is drawn in the middle.
 */
export function Sparkline({ values, label, width = 96, height = 28, tone = "neutral" }: { values: readonly (number | null)[]; label?: string; width?: number; height?: number; tone?: "neutral" | "good" | "bad" }) {
  const nums = values.filter(finite);
  if (nums.length === 0) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const pad = 4;
  const n = values.length;
  const x = (i: number) => (n === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));
  const y = linearScale([lo, hi], [height - pad, pad]);
  const pts: (Point | null)[] = values.map((v, i) => (finite(v) ? { x: x(i), y: y(v) } : null));
  const lastIndex = pts.reduce<number>((acc, p, i) => (p ? i : acc), -1);
  const last = pts[lastIndex];
  const color = tone === "good" ? "var(--chart-good)" : tone === "bad" ? "var(--chart-bad)" : "var(--chart-1)";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="shrink-0" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <path d={linePath(pts)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {last ? <circle cx={last.x} cy={last.y} r={3} fill={color} stroke="var(--background)" strokeWidth={1.5} /> : null}
    </svg>
  );
}

// ---------- funnel ----------

export type FunnelStage = { label: string; value: number | null; note?: string };

/**
 * Stages of a funnel as bars as wide as their count, with the share that went on from the stage before between them. A stage whose
 * count is not known (no visit counting, say) says "Not tracked" and has no bar: it is never drawn as zero, and nothing is worked
 * out across it.
 */
export function Funnel({ label, stages, format, missingText = "Not tracked", emptyText = "No data for this period.", exportId, exportLeftOut }: ChartExport & { label: string; stages: readonly FunnelStage[]; format: Format; missingText?: string; emptyText?: string }) {
  if (stages.length === 0 || !stages.some((s) => finite(s.value))) return <EmptyChart label={label} text={emptyText} />;
  const steps = funnelSteps(stages.map((s) => (finite(s.value) ? s.value : null)));
  return (
    <>
    <ol aria-label={label} className="space-y-3 text-sm">
      {stages.map((s, i) => {
        const step = steps[i];
        return (
          <li key={`${s.label}-${i}`}>
            {i > 0 ? (
              <p className="mb-1 text-xs text-muted">
                <span aria-hidden="true">↓ </span>
                {step.conversion !== null ? `${formatPercent(step.conversion)} went on from the step before` : `Share that went on: ${NO_FIGURE}`}
              </p>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium" title={s.label}>
                {s.label}
              </span>
              <span className="shrink-0 tabular-nums">
                {finite(s.value) ? format(s.value) : missingText}
                {finite(s.value) && step.overall !== null && i > 0 ? <span className="ml-1.5 text-xs text-muted">{`${formatPercent(step.overall)} of the first`}</span> : null}
              </span>
            </div>
            {step.widthPct !== null ? (
              <div aria-hidden="true" className="mt-1 h-3 overflow-hidden rounded bg-(--chart-seq-0)">
                <div className="h-full rounded" style={{ width: `${step.widthPct}%`, minWidth: finite(s.value) && s.value > 0 ? 2 : 0, background: "var(--chart-1)" }} />
              </div>
            ) : null}
            {s.note ? <p className="mt-0.5 text-xs text-muted">{s.note}</p> : null}
          </li>
        );
      })}
    </ol>
    <ExportRow exportId={exportId} leftOut={exportLeftOut} />
    </>
  );
}

// ---------- heatmap ----------

export type HeatRow = { label: string; values: readonly (number | null)[] };

/** The ramp's legend: from none to the most, in the steps the cells use. */
function RampKey({ low, high }: { low: string; high: string }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
      <span>{low}</span>
      <span aria-hidden="true" className="inline-flex overflow-hidden rounded">
        {Array.from({ length: RAMP_STEPS }, (_, i) => (
          <span key={i} className="inline-block h-2.5 w-5" style={{ background: `var(--chart-seq-${i})` }} />
        ))}
      </span>
      <span>{high}</span>
    </div>
  );
}

/**
 * Weekday columns by rows of hour bands, each cell one step of the sequential ramp (0 is nothing, any real value is told from none);
 * the figure is in the cell's tooltip and in the table behind. A cell with no figure is blank, not zero. With nothing in any
 * cell it says so rather than drawing a flat grid.
 */
export function Heatmap({ label, columns, rows, format, emptyText = "No data for this period.", exportId, exportLeftOut }: ChartExport & { label: string; columns: readonly string[]; rows: readonly HeatRow[]; format: Format; emptyText?: string }) {
  const max = maxOf(rows.flatMap((r) => r.values));
  if (columns.length === 0 || rows.length === 0 || max <= 0) return <EmptyChart label={label} text={emptyText} />;
  const labelW = Math.min(110, Math.max(36, 10 + Math.max(...rows.map((r) => r.label.length)) * 6.2));
  const headerH = 18;
  const cellH = 22;
  const cw = (W - labelW) / columns.length;
  const height = headerH + rows.length * cellH + 2;
  const peak = rows.reduce<{ row: string; col: string; v: number } | null>((best, r) => {
    r.values.forEach((v, j) => {
      if (finite(v) && (!best || v > best.v)) best = { row: r.label, col: columns[j] ?? "", v };
    });
    return best;
  }, null);
  const description = `${rows.length} rows by ${columns.length} columns; the most is ${peak ? `${format(peak.v)} on ${peak.col}, ${peak.row}` : "none"}.`;
  return (
    <figure className="min-w-0">
      <Svg label={label} description={description} width={W} height={height}>
        <g fill="var(--muted)" textAnchor="middle">
          {columns.map((c, j) => (
            <text key={j} x={labelW + j * cw + cw / 2} y={12}>
              {truncateLabel(c, 6)}
            </text>
          ))}
        </g>
        {rows.map((r, i) => (
          <g key={i}>
            <text x={labelW - 6} y={headerH + i * cellH + cellH / 2} dy=".32em" textAnchor="end" fill="var(--muted)">
              {truncateLabel(r.label, 14)}
            </text>
            {columns.map((c, j) => {
              const v = r.values[j];
              const known = finite(v);
              return (
                <rect key={j} x={labelW + j * cw + 1} y={headerH + i * cellH + 1} width={Math.max(1, cw - 2)} height={cellH - 2} rx={3} fill={known ? `var(--chart-seq-${rampStep(v, max)})` : "var(--chart-grid)"} opacity={known ? 1 : 0.5}>
                  <title>{`${r.label}, ${c}: ${known ? format(v) : "no data"}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </Svg>
      <RampKey low={format(0)} high={format(max)} />
      <DataBehind caption={label} head={["", ...columns]} rows={rows.map((r) => [r.label, ...columns.map((_, j) => show(format, r.values[j]))])} exportId={exportId} leftOut={exportLeftOut} />
    </figure>
  );
}

// ---------- cohorts ----------

export type CohortRow = { label: string; size: number | null; values: readonly (number | null)[] };

/**
 * A cohort table: a row for each month's new customers, a column for each month since, a cell for the share who bought then. Cells use
 * the same ramp as the heatmap, with the share written in them (so it is its own table view); a month that has not happened yet
 * (null) is blank, never 0 %.
 */
export function CohortTable({
  label,
  columns,
  rows,
  sizeLabel = "Customers",
  format = (v: number) => formatPercent(v, 0),
  max = 1,
  emptyText = "No cohorts yet.",
  exportId,
  exportLeftOut,
}: ChartExport & {
  label: string;
  columns: readonly string[];
  rows: readonly CohortRow[];
  sizeLabel?: string;
  format?: Format;
  /** The value that gets the darkest cell (a share of 1 = 100 %). */
  max?: number;
  emptyText?: string;
}) {
  if (rows.length === 0 || columns.length === 0) return <EmptyChart label={label} text={emptyText} />;
  return (
    <>
    <div className="relative overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1.5 text-left">
              Cohort
            </th>
            <th scope="col" className="px-2 py-1.5 text-right">
              {sizeLabel}
            </th>
            {columns.map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap px-2 py-1.5 text-right">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.label}-${i}`} className="border-t border-border">
              <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-medium">
                {r.label}
              </th>
              <td className="px-2 py-1 text-right tabular-nums">{show((v) => formatCount(v), r.size)}</td>
              {columns.map((c, j) => {
                const v = r.values[j];
                if (!finite(v)) return <td key={c} className="px-2 py-1" />;
                const step = rampStep(v, max);
                return (
                  <td key={c} title={`${r.label}, ${c}: ${format(v)}`} className="px-2 py-1 text-right tabular-nums" style={{ background: `var(--chart-seq-${step})`, color: `var(--chart-seq-${step}-ink)` }}>
                    {format(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <ExportRow exportId={exportId} leftOut={exportLeftOut} />
    </>
  );
}

// ---------- meter ----------

const PACE_WORDS: Record<Pace, string> = { ahead: "Ahead of pace", on: "On pace", behind: "Behind pace", unknown: "" };
const PACE_COLOR: Record<Pace, string> = { ahead: "var(--chart-good)", on: "var(--chart-good)", behind: "var(--chart-warn)", unknown: "var(--chart-1)" };

/**
 * Progress toward a target, with a tick where it should be by today. The state is written (Ahead of, On, Behind pace) as well as
 * coloured. Without a target it says there is none; it never shows an empty bar for "no target".
 */
export function Meter({
  label,
  value,
  target,
  expected,
  format,
  expectedLabel = "Expected by today",
  missingText = "No target set.",
}: {
  label: string;
  value: number | null;
  target: number | null;
  expected?: number | null;
  format: Format;
  expectedLabel?: string;
  missingText?: string;
}) {
  if (!finite(target) || target <= 0) return <EmptyChart label={label} text={missingText} height={56} />;
  const got = finite(value) ? value : 0;
  const pace = finite(expected) ? paceOf(got, expected, target) : "unknown";
  const fill = sharePct(got, target);
  const tick = finite(expected) ? sharePct(expected, target) : null;
  const share = formatPercent(got / target, 0);
  const text = [`${format(got)} of ${format(target)} (${share})`, tick !== null && finite(expected) ? `${expectedLabel}: ${format(expected)}` : "", PACE_WORDS[pace]].filter(Boolean).join(", ");
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        <span className="font-medium tabular-nums">
          {format(got)} <span className="font-normal text-muted">{`of ${format(target)} · ${share}`}</span>
        </span>
        {PACE_WORDS[pace] ? <span className="text-xs font-medium">{PACE_WORDS[pace]}</span> : null}
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(Math.max(got, 0), target)} aria-valuetext={text} className="relative h-2.5 rounded-full bg-(--chart-seq-0)">
        <div className="h-full rounded-full" style={{ width: `${fill}%`, background: PACE_COLOR[pace] }} />
        {tick !== null ? <div aria-hidden="true" className="absolute -top-1 h-[18px] w-0.5 rounded bg-foreground" style={{ left: `calc(${tick}% - 1px)` }} /> : null}
      </div>
      {tick !== null && finite(expected) ? <p className="mt-1.5 text-xs text-muted">{`${expectedLabel}: ${format(expected)}`}</p> : null}
    </div>
  );
}
