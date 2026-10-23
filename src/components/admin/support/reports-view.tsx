import type { ReactNode } from "react";

import { formatCount, formatPercent } from "@/lib/analytics-core";
import { fillWords } from "@/lib/admin-fill";
import {
  supportEn,
  type SupportMessages,
} from "@/lib/admin-messages/support.en";
import { topicWords } from "@/lib/support-inbox-text";
import {
  HANDOFF_WHYS,
  durationWords,
  missingWords,
  type Duration,
  type HandoffWhy,
  type Rate,
  type SupportReport,
} from "@/lib/support-reports";
import { MIN_SUPPORT_SAMPLE } from "@/lib/support-rules";
import { OUTCOMES } from "@/lib/support-summary";
import { TONE_BANDS } from "@/lib/support-tone";

/**
 * The support desk's report (D216, step 14): the figures of `docs/analytics.md` (Support) for a period, each with how many cases it
 * is from. A rate or a median below `MIN_SUPPORT_SAMPLE` shows how many there are and how many it needs, never a number; counts are
 * always shown. Per desk, never per person. Presentational: the page reads the report and passes it.
 */

type Words = SupportMessages;

const handoffWhyWords = (t: Words, why: HandoffWhy): string =>
  why === "taken_over"
    ? t.reports.takenOver
    : ((t.lib.handoff as Record<string, string>)[why] ?? why);

function Figure({
  label,
  value,
  sub,
  help,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  help?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-panel bg-sunken p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-metric text-ink tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
      {help && <dd className="text-xs text-muted">{help}</dd>}
    </div>
  );
}

/** A share, or what is missing for it. */
export function rateValue(r: Rate, t: Words = supportEn): ReactNode {
  return r.share === null ? (
    <span className="text-base font-normal text-muted">
      {missingWords(r.of, MIN_SUPPORT_SAMPLE, t.units)}
    </span>
  ) : (
    formatPercent(r.share)
  );
}
const rateSub = (r: Rate, what: string, t: Words) =>
  fillWords(t.reports.countOf, {
    count: formatCount(r.count),
    of: formatCount(r.of),
    what,
  });

function durationValue(d: Duration, t: Words): ReactNode {
  return d.median === null ? (
    <span className="text-base font-normal text-muted">
      {missingWords(d.n, MIN_SUPPORT_SAMPLE, t.units)}
    </span>
  ) : (
    durationWords(d.median, t.units)
  );
}

function CountTable({
  caption,
  rows,
  total,
  t,
}: {
  caption: string;
  rows: { label: string; count: number }[];
  total?: number;
  t: Words;
}) {
  return (
    <table className="w-full text-sm">
      <caption className="mb-2 text-left font-medium">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">{t.reports.what}</th>
          <th scope="col">{t.reports.conversations}</th>
          {total !== undefined && <th scope="col">{t.reports.share}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-line">
            <th scope="row" className="py-1.5 text-left font-normal">
              {row.label}
            </th>
            <td className="py-1.5 text-right tabular-nums">
              {formatCount(row.count)}
            </td>
            {total !== undefined && (
              <td className="w-20 py-1.5 text-right text-muted tabular-nums">
                {total >= MIN_SUPPORT_SAMPLE
                  ? formatPercent(row.count / total)
                  : ""}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReportsView({
  report,
  periodLabel,
  cut = false,
  picker,
  words: t = supportEn,
}: {
  report: SupportReport;
  periodLabel: string;
  cut?: boolean;
  picker?: ReactNode;
  words?: Words;
}) {
  const w = t.reports;
  const u = t.units;
  const toneTotal = TONE_BANDS.reduce(
    (sum, band) => sum + report.tone[band],
    0,
  );
  const handed = report.handover.count;
  return (
    <div className="flex flex-col gap-6">
      {picker}
      <p className="text-sm text-muted">
        {fillWords(w.intro, { period: periodLabel, min: MIN_SUPPORT_SAMPLE })}
      </p>
      {cut && (
        <p className="rounded-panel border border-line p-3 text-sm">{w.cut}</p>
      )}

      <section aria-labelledby="support-volume" className="flex flex-col gap-3">
        <h2 id="support-volume" className="text-title text-ink">
          {w.conversations}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label={w.started}
            value={formatCount(report.conversations)}
            sub={fillWords(w.stillOpen, { n: formatCount(report.open) })}
          />
          <Figure
            label={w.aiAlone}
            value={rateValue(report.aiAlone, t)}
            sub={rateSub(report.aiAlone, w.endedAiFirst, t)}
            help={w.aiAloneHelp}
          />
          <Figure
            label={w.aiResolved}
            value={rateValue(report.aiResolved, t)}
            sub={rateSub(report.aiResolved, w.aiHandledAlone, t)}
            help={w.aiResolvedHelp}
          />
          <Figure
            label={w.handedOver}
            value={rateValue(report.handover, t)}
            sub={rateSub(report.handover, w.endedAiFirst, t)}
          />
        </dl>
        <CountTable
          caption={w.byMode}
          t={t}
          rows={[
            { label: w.modeAiFirst, count: report.byMode.ai_first },
            { label: w.modePeople, count: report.byMode.people },
            { label: w.modeOff, count: report.byMode.off },
            ...(report.byMode.unknown
              ? [{ label: w.modeUnknown, count: report.byMode.unknown }]
              : []),
          ]}
        />
        {handed > 0 && (
          <CountTable
            caption={w.why}
            t={t}
            rows={HANDOFF_WHYS.filter((why) => report.handoverWhy[why] > 0).map(
              (why) => ({
                label: handoffWhyWords(t, why),
                count: report.handoverWhy[why],
              }),
            )}
            total={handed}
          />
        )}
      </section>

      <section aria-labelledby="support-speed" className="flex flex-col gap-3">
        <h2 id="support-speed" className="text-title text-ink">
          {w.speed}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label={w.firstAnswer}
            value={durationValue(report.firstAnswer, t)}
            sub={
              report.firstAnswer.median === null
                ? fillWords(w.answeredAfterWaiting, {
                    n: formatCount(report.firstAnswer.n),
                  })
                : fillWords(w.medianOf, {
                    n: formatCount(report.firstAnswer.n),
                  })
            }
          />
          <Figure
            label={w.slowest}
            value={
              report.firstAnswer.slowestTenth === null ? (
                <span className="text-base font-normal text-muted">
                  {missingWords(report.firstAnswer.n, MIN_SUPPORT_SAMPLE, u)}
                </span>
              ) : (
                fillWords(w.orMore, {
                  time: durationWords(report.firstAnswer.slowestTenth, u),
                })
              )
            }
            sub={w.slowestHelp}
          />
          <Figure
            label={w.missed}
            value={formatCount(report.missed.count)}
            sub={
              report.missed.share === null
                ? fillWords(w.ofWaited, { n: formatCount(report.missed.of) })
                : fillWords(w.shareOfWaited, {
                    share: formatPercent(report.missed.share),
                    n: formatCount(report.missed.of),
                  })
            }
            help={w.missedHelp}
          />
          <Figure
            label={w.timeToEnd}
            value={durationValue(report.timeToEnd, t)}
            sub={fillWords(w.medianOfEnded, {
              n: formatCount(report.timeToEnd.n),
            })}
          />
        </dl>
      </section>

      <section
        aria-labelledby="support-quality"
        className="flex flex-col gap-3"
      >
        <h2 id="support-quality" className="text-title text-ink">
          {w.quality}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label={w.helped}
            value={rateValue(report.rating, t)}
            sub={fillWords(w.ratings, { n: formatCount(report.rating.of) })}
          />
          <Figure
            label={w.drafts}
            value={
              report.drafts.share === null ? (
                <span className="text-base font-normal text-muted">
                  {missingWords(report.drafts.offered, MIN_SUPPORT_SAMPLE, u)}
                </span>
              ) : (
                formatPercent(report.drafts.share)
              )
            }
            sub={fillWords(w.draftsSub, {
              used: formatCount(report.drafts.used),
              offered: formatCount(report.drafts.offered),
            })}
          />
        </dl>
        <div className="grid gap-6 lg:grid-cols-3">
          <CountTable
            caption={w.toneAtEnd}
            t={t}
            rows={[...TONE_BANDS]
              .reverse()
              .map((band) => ({
                label: t.lib.tones[band],
                count: report.tone[band],
              }))
              .concat([
                { label: w.notMeasured, count: report.tone.not_measured },
              ])}
            total={toneTotal}
          />
          <CountTable
            caption={w.outcome}
            t={t}
            rows={OUTCOMES.map((outcome) => ({
              label: t.lib.outcomes[outcome] ?? outcome,
              count: report.outcomes[outcome],
            }))}
          />
          {report.topics.length > 0 ? (
            <CountTable
              caption={w.topics}
              t={t}
              rows={report.topics.map((row) => ({
                label: topicWords(row.topic, t.lib),
                count: row.count,
              }))}
            />
          ) : (
            <p className="text-sm text-muted">{w.noTopics}</p>
          )}
        </div>
      </section>

      <section
        aria-labelledby="support-requests"
        className="flex flex-col gap-3"
      >
        <h2 id="support-requests" className="text-title text-ink">
          {w.requests}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label={w.opened}
            value={formatCount(report.requests.opened)}
            sub={fillWords(w.stillOpen, {
              n: formatCount(report.requests.open),
            })}
          />
          <Figure label={w.done} value={formatCount(report.requests.done)} />
          <Figure
            label={w.declined}
            value={formatCount(report.requests.declined)}
          />
          <Figure
            label={w.timeToDecide}
            value={durationValue(report.requests.timeToDecide, t)}
            sub={fillWords(w.medianOfDecided, {
              n: formatCount(report.requests.timeToDecide.n),
            })}
          />
        </dl>
      </section>

      {report.anonymised > 0 && (
        <p className="text-sm text-muted">
          {fillWords(w.anonymised, { n: formatCount(report.anonymised) })}
        </p>
      )}
    </div>
  );
}
