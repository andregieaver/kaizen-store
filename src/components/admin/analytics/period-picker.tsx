import Link from "next/link";

import { COMPARE_MODES, periodHref, PRESETS, type AnalyticsPreset, type CompareMode } from "@/lib/analytics-period";

/**
 * The period and comparison of an analytics page (D152), kept in the address (`?period=&from=&to=&compare=`) so a view can be linked to and
 * works with no script: the presets are links, a custom range and the comparison are two small GET forms. The page gives what the
 * address already says; reading the address is `parseAnalyticsParams()`'s job. `to` is the last day, inclusive, as in the address.
 */

export type PeriodPickerProps = {
  /** The page's own path, without a query: the forms and links go there. */
  basePath: string;
  preset: AnalyticsPreset;
  /** First day shown in the custom range, `YYYY-MM-DD`. */
  from: string;
  /** Last day shown (inclusive). */
  to: string;
  compare: CompareMode;
  /** Other parameters the page keeps through a change (a sort, a tab), so picking a period does not lose them. */
  preserve?: Readonly<Record<string, string>>;
  /** The latest day that can be chosen (today in the store's time zone). */
  max?: string;
  /** False for a page with nothing to compare (the VAT reports, D161): the comparison control is left out. Default true. */
  showCompare?: boolean;
  /** True for a page whose own default is not the default preset: every preset link then names its period, so "Last 30 days" is not read as the page's default. */
  explicitPeriod?: boolean;
};

const inputClass = "h-9 rounded-lg border border-border bg-background px-2 text-sm";
const buttonClass = "h-9 rounded-lg border border-border px-3 text-sm font-medium";

function Hidden({ values }: { values: Readonly<Record<string, string>> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

export function PeriodPicker({ basePath, preset, from, to, compare, preserve = {}, max, showCompare = true, explicitPeriod = false }: PeriodPickerProps) {
  const links = PRESETS.filter((p) => p.id !== "custom");
  // The current view as the compare form sends it back: the period as it is, a custom one with its dates.
  const keep: Record<string, string> = { ...preserve, period: preset };
  if (preset === "custom") {
    keep.from = from;
    keep.to = to;
  }
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <nav aria-label="Period" className="flex flex-wrap gap-1">
        {links.map((p) => {
          const active = p.id === preset;
          return (
            <Link
              key={p.id}
              href={periodHref(basePath, { period: { preset: p.id, from, to }, compare: { mode: compare } }, explicitPeriod ? { ...preserve, period: p.id } : preserve)}
              aria-current={active ? "true" : undefined}
              className={`inline-flex h-9 items-center rounded-lg border px-3 text-sm ${active ? "border-foreground bg-surface font-semibold" : "border-border"}`}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2" aria-label="Custom range">
        <Hidden values={{ ...preserve, period: "custom", compare }} />
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          From
          <input type="date" name="from" defaultValue={from} {...(max ? { max } : {})} required className={inputClass} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          To
          <input type="date" name="to" defaultValue={to} {...(max ? { max } : {})} required className={inputClass} />
        </label>
        <button type="submit" className={`${buttonClass} ${preset === "custom" ? "border-foreground" : ""}`}>
          Apply range
        </button>
      </form>

      {showCompare ? (
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2" aria-label="Comparison">
        <Hidden values={keep} />
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          Compare with
          <select name="compare" defaultValue={compare} className={inputClass}>
            {COMPARE_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass}>
          Update
        </button>
      </form>
      ) : null}
    </div>
  );
}
