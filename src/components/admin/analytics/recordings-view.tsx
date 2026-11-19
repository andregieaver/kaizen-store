import Link from "next/link";

import { fillWords } from "@/lib/admin-fill";
import type { RecordingsMessages } from "@/lib/admin-messages/recordings.en";
import { formatCount } from "@/lib/analytics-core";
import type { RecordingCounts, RecordingFilters, RecordingRow } from "@/server/recordings-read";


/**
 * The list of recordings of visits (D656, `docs/heatmaps-and-recordings.md` step 11), drawn on the server from plain props: chips with
 * counts (only where not zero), rows grouped by day (Today, Yesterday, then the date) with when (coarse, "around 14:00"), the device, the
 * length, the pages, rage and dead clicks, and *Watch*; watched rows dimmed. Most frustrated first, or newest; the page, period and version
 * filters are a fold away.
 */

export type RecordingsListProps = {
  base: string;
  rows: RecordingRow[];
  counts: RecordingCounts;
  filters: RecordingFilters;
  /** The store records now; when false a line says so above what is kept. */
  on: boolean;
  /** Recordings may be switched on for this store (the platform's hold is open, or it is Kaizena Flow's own). */
  available: boolean;
  more: boolean;
  page: number;
  timeZone: string;
  locale: string;
  now: Date;
  words: RecordingsMessages;
  /** The A/B versions the kept recordings were tagged with, as chips (D656 step 12); none without a test. */
  versions?: { tag: string; label: string }[];
};

const chip = (active: boolean) => `inline-flex h-9 items-center gap-1.5 rounded-panel border px-3 text-sm ${active ? "border-brand bg-sunken font-medium" : "border-line"}`;

/** The list's address with some filters changed (a chip, the sort, the next page). */
export function recordingsHref(base: string, filters: RecordingFilters, change: Partial<RecordingFilters> & { p?: number } = {}): string {
  const next = { ...filters, ...change } as Record<string, string | number | undefined>;
  const query = new URLSearchParams();
  for (const key of ["device", "has", "page", "tag", "from", "to", "sort", "p"]) {
    const value = next[key];
    if (value !== undefined && value !== "" && !(key === "sort" && value === "frustrated") && !(key === "p" && value === 0)) query.set(key, String(value));
  }
  const text = query.toString();
  return `${base}/analytics/recordings${text ? `?${text}` : ""}`;
}

/** A page key as the owner reads it: the path under the market, or the front page. */
export function entryName(page: string, words: RecordingsMessages): string {
  const rest = page.replace(/^\/[a-z0-9-]+/, "");
  return rest === "" ? words.frontPage : rest;
}

export const recordingHref = (base: string, id: string) => `${base}/analytics/recordings/${id}`;

/** A length in words: minutes from one minute, else seconds. */
export function lengthText(ms: number, words: RecordingsMessages): string {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? fillWords(words.minutes, { n: Math.round(seconds / 60) }) : fillWords(words.seconds, { n: seconds });
}

const dayKey = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));

export function RecordingsList(props: RecordingsListProps) {
  const { base, rows, counts, filters, on, available, words: w, timeZone, locale, now } = props;
  const today = dayKey(now.toISOString(), timeZone);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000).toISOString(), timeZone);
  const dayLabel = (key: string) =>
    key === today ? w.today : key === yesterday ? w.yesterday : new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
  const groups = new Map<string, RecordingRow[]>();
  for (const row of rows) {
    const key = dayKey(row.startedAt, timeZone);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const chips: { label: string; n: number; href: string; active: boolean }[] = [
    { label: w.chips.all, n: counts.all, href: recordingsHref(base, filters, { has: undefined, p: 0 }), active: !filters.has },
    { label: w.chips.rage, n: counts.rage, href: recordingsHref(base, filters, { has: "rage", p: 0 }), active: filters.has === "rage" },
    { label: w.chips.dead, n: counts.dead, href: recordingsHref(base, filters, { has: "dead", p: 0 }), active: filters.has === "dead" },
    ...(["mobile", "tablet", "desktop"] as const).map((d) => ({
      label: w.chips[d],
      n: counts[d],
      href: recordingsHref(base, filters, { device: filters.device === d ? undefined : d, p: 0 }),
      active: filters.device === d,
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      {!on ? (
        <p className="rounded-panel border border-line bg-sunken px-3 py-2 text-sm">
          {available ? w.off : w.notAvailable}{" "}
          {available ? (
            <Link href={`${base}/analytics/settings#signals`} className="underline">
              {w.turnOnHere}
            </Link>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Round 59 (D819): on a phone the filters are one line that scrolls, and each visit one line with Watch at its end. */}
        <nav aria-label={w.filters} className="flex flex-wrap gap-2 max-sm:-mr-4 max-sm:w-[calc(100%+1rem)] max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:pr-4 max-sm:*:shrink-0">
          {chips
            .filter((c) => c.n > 0 || c.active)
            .map((c) => (
              <Link key={c.label} href={c.href} aria-current={c.active ? "true" : undefined} className={chip(c.active)}>
                <span>{c.label}</span>
                <span className="tabular-nums text-muted">{formatCount(c.n)}</span>
              </Link>
            ))}
        </nav>
        <Link href={recordingsHref(base, filters, { sort: filters.sort === "newest" ? "frustrated" : "newest", p: 0 })} className="text-sm underline">
          {filters.sort === "newest" ? w.sort.frustrated : w.sort.newest}
        </Link>
      </div>

      {props.versions && props.versions.length > 0 ? (
        <nav aria-label={w.versionLabel} className="flex flex-wrap gap-2">
          {[{ tag: "", label: w.everyone }, ...props.versions].map((v) => (
            <Link
              key={v.tag || "all"}
              href={recordingsHref(base, filters, { tag: v.tag || undefined, p: 0 })}
              aria-current={(filters.tag ?? "") === v.tag ? "true" : undefined}
              className={chip((filters.tag ?? "") === v.tag)}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{w.empty}</p>
      ) : (
        [...groups.entries()].map(([key, list]) => (
          <section key={key} aria-labelledby={`rec-day-${key}`} className="flex flex-col gap-2">
            <h2 id={`rec-day-${key}`} className="text-sm text-muted">
              {dayLabel(key)}
            </h2>
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
              {list.map((r) => (
                <li key={r.id} data-watched={r.viewedAt ? "" : undefined} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 max-sm:flex-nowrap ${r.viewedAt ? "opacity-60" : ""}`}>
                  <div className="min-w-0">
                    <p className="font-medium">
                      {fillWords(w.around, { time: time(r.startedAt) })} · {w.devices[r.device]} · {lengthText(r.durationMs, w)} ·{" "}
                      {r.pages.length === 1 ? w.pages.one : fillWords(w.pages.many, { n: r.pages.length })}
                    </p>
                    <p className="break-all text-sm text-muted">
                      {entryName(r.entryPage, w)}
                      {r.tags.length > 0 ? ` · ${r.tags.map((t) => props.versions?.find((v) => v.tag === t)?.label ?? t.slice(-1).toUpperCase()).join(", ")}` : ""}
                      <span className="sm:hidden">
                        {r.rageClicks > 0 ? ` · ${fillWords(w.rage, { n: r.rageClicks })}` : ""}
                        {r.deadClicks > 0 ? ` · ${fillWords(w.dead, { n: r.deadClicks })}` : ""}
                      </span>
                    </p>
                    {r.rageClicks > 0 || r.deadClicks > 0 ? (
                      <p className="mt-1 flex flex-wrap gap-1.5 text-xs max-sm:hidden">
                        {r.rageClicks > 0 ? <span className="rounded-full border border-(--chart-warn) px-2 py-0.5">{fillWords(w.rage, { n: r.rageClicks })}</span> : null}
                        {r.deadClicks > 0 ? <span className="rounded-full border border-line px-2 py-0.5">{fillWords(w.dead, { n: r.deadClicks })}</span> : null}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href={recordingHref(base, r.id)}
                    className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm max-sm:min-h-11 max-sm:shrink-0 max-sm:border-0 max-sm:bg-transparent max-sm:px-0 max-sm:font-medium max-sm:underline max-sm:underline-offset-2"
                  >
                    {r.viewedAt ? w.watched : w.watch}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {props.more ? (
        <Link href={recordingsHref(base, filters, { p: props.page + 1 })} className="w-fit text-sm underline">
          {w.more}
        </Link>
      ) : null}

      <details className="rounded-lg border border-line bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">{w.filters}</summary>
        <form method="get" className="mt-3 grid gap-3 sm:grid-cols-2">
          {filters.device ? <input type="hidden" name="device" value={filters.device} /> : null}
          {filters.has ? <input type="hidden" name="has" value={filters.has} /> : null}
          {filters.sort === "newest" ? <input type="hidden" name="sort" value="newest" /> : null}
          <label className="flex flex-col gap-1">
            {w.filterPage}
            <input name="page" defaultValue={filters.page ?? ""} className="min-h-10 rounded-md border border-line px-3" />
          </label>
          <label className="flex flex-col gap-1">
            {w.filterVersion}
            <input name="tag" defaultValue={filters.tag ?? ""} className="min-h-10 rounded-md border border-line px-3" />
          </label>
          <label className="flex flex-col gap-1">
            {w.filterFrom}
            <input type="date" name="from" defaultValue={filters.from ?? ""} className="min-h-10 rounded-md border border-line px-3" />
          </label>
          <label className="flex flex-col gap-1">
            {w.filterTo}
            <input type="date" name="to" defaultValue={filters.to ?? ""} className="min-h-10 rounded-md border border-line px-3" />
          </label>
          <div>
            <button type="submit" className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm">
              {w.apply}
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
