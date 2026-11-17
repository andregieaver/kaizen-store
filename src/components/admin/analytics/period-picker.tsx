import Link from "next/link";

import { COMPARE_MODES, periodHref, PRESETS, type AnalyticsPreset, type CompareMode } from "@/lib/analytics-period";
import { analyticsWords } from "@/lib/analytics-words";

import { PeriodMore } from "./period-more";

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

const inputClass = "h-9 rounded-lg border border-line bg-card px-2 text-sm";
const buttonClass = "h-9 rounded-lg border border-line px-3 text-sm font-medium";

/** The presets a phone shows under Other dates rather than on the line (round 26, D699). */
const PHONE_LATER: ReadonlySet<AnalyticsPreset> = new Set(["yesterday", "last_month", "year"]);
/** The presets with a shorter name on a phone ("30 days"), so the line holds Other dates too. */
const SHORT: ReadonlySet<AnalyticsPreset> = new Set(["7d", "30d"]);

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
  const words = analyticsWords();
  const w = words.picker;
  // The current view as the compare form sends it back: the period as it is, a custom one with its dates.
  const keep: Record<string, string> = { ...preserve, period: preset };
  if (preset === "custom") {
    keep.from = from;
    keep.to = to;
  }
  // On a phone the less used presets wait under Other dates (round 26, D699), unless one of them is the period shown.
  const later = links.filter((p) => PHONE_LATER.has(p.id) && p.id !== preset);
  const moreLinks = later.length > 0 ? (
    <ul className="flex flex-wrap gap-1 sm:hidden">
      {later.map((p) => (
        <li key={p.id}>
          <Link
            href={periodHref(basePath, { period: { preset: p.id, from, to }, compare: { mode: compare } }, explicitPeriod ? { ...preserve, period: p.id } : preserve)}
            className="inline-flex h-9 items-center rounded-panel border border-line px-3 text-sm"
          >
            {words.period.presets[p.id]}
          </Link>
        </li>
      ))}
    </ul>
  ) : null;
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <PeriodMore label={w.otherDates} more={moreLinks} chips={
      <nav aria-label={w.period} className="flex gap-1 max-sm:shrink-0 sm:flex-wrap">
        {links.map((p) => {
          const active = p.id === preset;
          return (
            <Link
              key={p.id}
              href={periodHref(basePath, { period: { preset: p.id, from, to }, compare: { mode: compare } }, explicitPeriod ? { ...preserve, period: p.id } : preserve)}
              aria-current={active ? "true" : undefined}
              className={`inline-flex h-9 shrink-0 items-center rounded-panel border px-3 text-sm whitespace-nowrap max-sm:px-2.5 ${active ? "border-brand bg-sunken font-medium" : "border-line"} ${PHONE_LATER.has(p.id) && !active ? "max-sm:hidden" : ""}`}
            >
              {SHORT.has(p.id) ? (
                <>
                  <span className="sm:hidden">{w.short[p.id as "7d" | "30d"]}</span>
                  <span className="max-sm:hidden">{words.period.presets[p.id]}</span>
                </>
              ) : (
                words.period.presets[p.id]
              )}
            </Link>
          );
        })}
      </nav>
      }>

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2" aria-label={w.customRange}>
        <Hidden values={{ ...preserve, period: "custom", compare }} />
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          {w.from}
          <input type="date" name="from" defaultValue={from} {...(max ? { max } : {})} required className={inputClass} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          {w.to}
          <input type="date" name="to" defaultValue={to} {...(max ? { max } : {})} required className={inputClass} />
        </label>
        <button type="submit" className={`${buttonClass} ${preset === "custom" ? "border-brand" : ""}`}>
          {w.apply}
        </button>
      </form>

      {showCompare ? (
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-2" aria-label={w.comparison}>
        <Hidden values={keep} />
        <label className="flex flex-col gap-0.5 text-xs text-muted">
          {w.compareWith}
          <select name="compare" defaultValue={compare} className={inputClass}>
            {COMPARE_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {words.compare.modes[m.id]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass}>
          {w.update}
        </button>
      </form>
      ) : null}
      </PeriodMore>
    </div>
  );
}
