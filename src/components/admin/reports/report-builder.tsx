"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/admin/ui";
import type { CustomReportsMessages } from "@/lib/admin-messages/custom-reports.en";
import {
  COMPARE_KEYS,
  DIMENSION_KEYS,
  dimensionAllowed,
  isDimension,
  isMetric,
  MAX_DIMENSIONS,
  MAX_FILTERS,
  MAX_METRICS,
  MAX_ROWS,
  METRIC_KEYS,
  PERIOD_PRESETS,
  specProblems,
  type DimensionKey,
  type MetricKey,
  type ReportSpec,
} from "@/lib/report-catalogue";
import { problemText } from "@/lib/report-words";

/**
 * The report builder (wave 8 unit A, D345, Lisa's step): the figures, at most two cuts, filters, the period and comparison, the sort, the
 * number of rows and how to show it. It offers only cuts every chosen figure allows (`dimensionAllowed()`), says why a spec cannot run
 * before it is sent (`specProblems()`), and puts the spec in the address (`q`), so a report is a link and the server draws it.
 */
export function ReportBuilder({
  path,
  id,
  initial,
  words,
  periodWords,
}: {
  /** The view's address, without a query. */
  path: string;
  /** The saved report this was opened from, kept in the address so it can be saved over. */
  id: string | null;
  initial: ReportSpec;
  words: Pick<CustomReportsMessages, "builder" | "catalogue" | "problems">;
  /** The period presets' and comparisons' names, as the analytics header writes them. */
  periodWords: { presets: Record<string, string>; compare: Record<string, string> };
}) {
  const router = useRouter();
  const [spec, setSpec] = useState<ReportSpec>(initial);
  const [filterText, setFilterText] = useState<string[]>(initial.filters.map((f) => f.values.join(", ")));
  const w = words.builder;
  const update = (patch: Partial<ReportSpec>) => setSpec((s) => ({ ...s, ...patch }));

  const withFilters: ReportSpec = {
    ...spec,
    filters: spec.filters.map((f, i) => ({ ...f, values: (filterText[i] ?? "").split(",").map((v) => v.trim()).filter(Boolean) })),
  };
  const problems = specProblems(withFilters);

  const toggleMetric = (m: MetricKey, on: boolean) => {
    const metrics = on ? [...spec.metrics, m].slice(0, MAX_METRICS) : spec.metrics.filter((x) => x !== m);
    const dimensions = spec.dimensions.filter((d) => dimensionAllowed(metrics, d));
    update({ metrics, dimensions, sort: spec.sort && (metrics.includes(spec.sort as MetricKey) || dimensions.includes(spec.sort as DimensionKey)) ? spec.sort : undefined });
  };
  const setDimension = (index: number, value: string) => {
    const next = [...spec.dimensions];
    if (isDimension(value)) next[index] = value;
    else next.splice(index, 1);
    const dimensions = next.filter((d, i) => next.indexOf(d) === i).slice(0, MAX_DIMENSIONS);
    update({ dimensions, sort: spec.sort && !isMetric(spec.sort) && !dimensions.includes(spec.sort) ? undefined : spec.sort });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problems.length > 0) return;
    const query = new URLSearchParams();
    if (id) query.set("id", id);
    query.set("q", JSON.stringify(withFilters));
    router.push(`${path}?${query.toString()}`);
  };

  const dimensionSelect = (index: number) => (
    <select
      aria-label={index === 0 ? w.dimensions : `${w.dimensions} (2)`}
      value={spec.dimensions[index] ?? ""}
      onChange={(e) => setDimension(index, e.target.value)}
      disabled={index === 1 && spec.dimensions.length === 0}
    >
      <option value="">{w.noDimension}</option>
      {DIMENSION_KEYS.map((d) => (
        <option key={d} value={d} disabled={!dimensionAllowed(spec.metrics, d)}>
          {words.catalogue.dimensions[d]}
          {dimensionAllowed(spec.metrics, d) ? "" : ` (${w.notAllowed})`}
        </option>
      ))}
    </select>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" aria-label={w.title} data-report-builder>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-eyebrow text-muted">{w.metrics}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {METRIC_KEYS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={spec.metrics.includes(m)} onChange={(e) => toggleMetric(m, e.target.checked)} />
              {words.catalogue.metrics[m]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {w.dimensions}
          {dimensionSelect(0)}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {`${w.dimensions} (2)`}
          {dimensionSelect(1)}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {w.period}
          <select value={spec.period.preset} onChange={(e) => update({ period: { ...spec.period, preset: e.target.value as ReportSpec["period"]["preset"] } })}>
            {PERIOD_PRESETS.map((p) => (
              <option key={p} value={p}>
                {periodWords.presets[p] ?? p}
              </option>
            ))}
          </select>
        </label>
        {spec.period.preset === "custom" && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              {w.from}
              <input type="date" value={spec.period.from ?? ""} onChange={(e) => update({ period: { ...spec.period, from: e.target.value || undefined } })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {w.to}
              <input type="date" value={spec.period.to ?? ""} onChange={(e) => update({ period: { ...spec.period, to: e.target.value || undefined } })} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm">
          {w.compare}
          <select value={spec.period.compare} onChange={(e) => update({ period: { ...spec.period, compare: e.target.value as ReportSpec["period"]["compare"] } })}>
            {COMPARE_KEYS.map((c) => (
              <option key={c} value={c}>
                {periodWords.compare[c] ?? c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-eyebrow text-muted">{w.filters}</legend>
        {spec.filters.map((filter, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {w.filterOn}
              <select
                value={filter.dimension}
                onChange={(e) => update({ filters: spec.filters.map((f, j) => (j === i && isDimension(e.target.value) ? { ...f, dimension: e.target.value } : f)) })}
              >
                {DIMENSION_KEYS.map((d) => (
                  <option key={d} value={d} disabled={!dimensionAllowed(spec.metrics, d)}>
                    {words.catalogue.dimensions[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
              {w.values}
              <input value={filterText[i] ?? ""} onChange={(e) => setFilterText((t) => t.map((v, j) => (j === i ? e.target.value : v)))} />
            </label>
            <Button
              onClick={() => {
                update({ filters: spec.filters.filter((_, j) => j !== i) });
                setFilterText((t) => t.filter((_, j) => j !== i));
              }}
            >
              {w.removeFilter}
            </Button>
          </div>
        ))}
        {spec.filters.length < MAX_FILTERS && (
          <div>
            <Button
              onClick={() => {
                update({ filters: [...spec.filters, { dimension: "market", values: [] }] });
                setFilterText((t) => [...t, ""]);
              }}
            >
              {w.addFilter}
            </Button>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {w.sort}
          <select value={spec.sort ?? ""} onChange={(e) => update({ sort: (e.target.value || undefined) as ReportSpec["sort"] })}>
            <option value="">{w.sortDefault}</option>
            {[...spec.metrics, ...spec.dimensions].map((k) => (
              <option key={k} value={k}>
                {isMetric(k) ? words.catalogue.metrics[k] : words.catalogue.dimensions[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {w.limit}
          <input type="number" min={1} max={MAX_ROWS} value={spec.limit} onChange={(e) => update({ limit: Math.max(1, Math.min(MAX_ROWS, Number(e.target.value) || 1)) })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {w.chart}
          <select value={spec.chart} onChange={(e) => update({ chart: e.target.value as ReportSpec["chart"] })}>
            {(["table", "bar", "line"] as const).map((c) => (
              <option key={c} value={c}>
                {w.charts[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-panel border border-warning-line bg-warning-soft p-3 text-sm text-warning-text">
          {problems.map((p, i) => (
            <li key={i}>{problemText(p, words)}</li>
          ))}
        </ul>
      )}
      <div>
        <Button type="submit" kind="main" disabled={problems.length > 0}>
          {w.run}
        </Button>
      </div>
    </form>
  );
}
