import Link from "next/link";

import { Chip } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AnalyticsMessages } from "@/lib/admin-messages/analytics.en";
import { formatCount, NO_FIGURE } from "@/lib/analytics-core";
import { PhoneRow } from "@/components/admin/phone-row";
import { metricsToFix, MIN_SPEED_SAMPLES, SPEED_METRICS, speedValueText, type SpeedCell, type SpeedRating, type SpeedRow } from "@/lib/speed";
import type { SpeedReport } from "@/server/analytics-speed";

import { DataTable, type Column } from "./data-table";
import { AnalyticsSection, Note } from "./section";

const SIGNAL: Record<SpeedRating, "positive" | "warning" | "danger"> = { good: "positive", improve: "warning", poor: "danger" };

/** One figure: the value with Google's rating, or how many page loads there are of the 20 a figure needs. */
export function Figure({ cell, locale, w }: { cell: SpeedCell; locale: string; w: AnalyticsMessages["speed"] }) {
  if (cell.value === null) {
    return <span className="text-muted">{cell.samples === 0 ? NO_FIGURE : fillWords(w.tooFew, { n: formatCount(cell.samples), min: MIN_SPEED_SAMPLES })}</span>;
  }
  return (
    <Chip signal={SIGNAL[cell.rating]} dot>
      {`${speedValueText(cell.metric, cell.value, locale)} · ${w.ratings[cell.rating]}`}
    </Chip>
  );
}

/**
 * The speed report (wave 7 unit B, D336, `docs/analytics.md` "Speed"): how fast the store's pages loaded for its visitors over the last 28 days,
 * per kind of page and screen, at the 75th percentile, with Google's rating and what to fix first. Nothing is shown that was not measured: a
 * figure with fewer than 20 page loads says so, and the page says what it cannot measure.
 */
export function SpeedView({ base, locale, report: r, words }: { base: string; locale: string; report: SpeedReport; words: AnalyticsMessages }) {
  const w = words.speed;
  const columns: Column<SpeedRow>[] = [
    { key: "page", label: w.page, cell: (row) => w.kinds[row.kind] },
    { key: "screen", label: w.screen, cell: (row) => w.screens[row.screen] },
    ...SPEED_METRICS.map(
      (metric): Column<SpeedRow> => ({
        key: metric,
        label: w.metrics[metric].short,
        cell: (row) => <Figure cell={row.cells.find((c) => c.metric === metric)!} locale={locale} w={w} />,
      }),
    ),
  ];
  const toFix = metricsToFix(r.rows);
  return (
    <div className="flex flex-col gap-8">
      {/* Round 54 (D802): on a phone visit counting off is a strip with Turn on, and how the figures are made and what is not measured are rows. */}
      {!r.collecting && (
        <div className="flex items-center justify-between gap-3 rounded-panel bg-card p-4 sm:hidden">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body text-ink">{words.live.phone.off}</span>
            <span className="text-caption text-ink-2">{w.phone.offSub}</span>
          </span>
          <Link href={`${base}/analytics/settings#visits`} className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-line px-4 text-sm text-ink no-underline">
            {words.live.phone.turnOn}
          </Link>
        </div>
      )}
      {!r.collecting && (
        <div className="max-sm:hidden">
        <Note tone="warning">
          {w.off}{" "}
          <Link href={`${base}/analytics/settings`} className="underline">
            {w.offLink}
          </Link>
        </Note>
        </div>
      )}
      <AnalyticsSection
        id="speed"
        title={w.table}
        description={
          <>
            {fillWords(w.period, { from: r.from, to: r.to })} · {countWords(r.loads, w.loads, { n: formatCount(r.loads) })}
            {r.lastSample && <> · {fillWords(w.lastSample, { day: r.lastSample })}</>}
          </>
        }
      >
        {r.rows.length === 0 ? <p className="text-sm text-muted">{w.none}</p> : <DataTable caption={w.table} columns={columns} rows={r.rows} rowKey={(row) => `${row.screen}:${row.kind}`} exportId="speed.figures" />}
        <div className="max-sm:overflow-hidden max-sm:rounded-panel">
        <PhoneRow last title={w.phone.figures} sub={SPEED_METRICS.map((metric) => w.metrics[metric].short).join(", ")} change={w.phone.open} done={w.phone.done}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {SPEED_METRICS.map((metric) => (
            <div key={metric}>
              <dt className="text-ink">{`${w.metrics[metric].short} (${w.metrics[metric].name})`}</dt>
              <dd className="text-muted">{w.metrics[metric].explain}</dd>
            </div>
          ))}
        </dl>
        </PhoneRow>
        </div>
      </AnalyticsSection>
      {r.rows.length > 0 && (
        <AnalyticsSection id="speed-fix" title={w.fixTitle}>
          {toFix.length === 0 ? (
            <p className="text-sm">{w.allGood}</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {toFix.map(({ metric, rating }) => (
                <li key={metric} data-speed-fix={metric} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-ink">
                    {w.metrics[metric].short}
                    <Chip signal={SIGNAL[rating]} dot>
                      {w.ratings[rating]}
                    </Chip>
                  </span>
                  <span>{w.advice[metric]}</span>
                </li>
              ))}
            </ul>
          )}
        </AnalyticsSection>
      )}
      <div className="max-sm:overflow-hidden max-sm:rounded-panel">
      <PhoneRow last title={w.phone.limits} sub={w.phone.limitsSub} change={w.phone.open} done={w.phone.done}>
      <AnalyticsSection id="speed-limits" title={w.notMeasured}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {w.notMeasuredItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </AnalyticsSection>
      </PhoneRow>
      </div>
    </div>
  );
}
