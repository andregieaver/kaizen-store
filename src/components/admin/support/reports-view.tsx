import type { ReactNode } from "react";

import { formatCount, formatPercent } from "@/lib/analytics-core";
import { HANDOFF_WORDS, OUTCOME_WORDS, topicWords } from "@/lib/support-inbox-text";
import { HANDOFF_WHYS, durationWords, missingWords, type Duration, type HandoffWhy, type Rate, type SupportReport } from "@/lib/support-reports";
import { MIN_SUPPORT_SAMPLE } from "@/lib/support-rules";
import { OUTCOMES } from "@/lib/support-summary";
import { TONE_BANDS, TONE_BAND_WORDS } from "@/lib/support-tone";

/**
 * The support desk's report (D216, step 14): the figures of `docs/analytics.md` (Support) for a period, each with how many cases it
 * is from. A rate or a median below `MIN_SUPPORT_SAMPLE` shows how many there are and how many it needs, never a number; counts are
 * always shown. Per desk, never per person. Presentational: the page reads the report and passes it.
 */

const HANDOFF_WHY_WORDS: Record<HandoffWhy, string> = { ...(HANDOFF_WORDS as Record<Exclude<HandoffWhy, "taken_over">, string>), taken_over: "A person took it over" };

function Figure({ label, value, sub, help }: { label: string; value: ReactNode; sub?: ReactNode; help?: string }) {
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
export function rateValue(r: Rate): ReactNode {
  return r.share === null ? <span className="text-base font-normal text-muted">{missingWords(r.of)}</span> : formatPercent(r.share);
}
const rateSub = (r: Rate, what: string) => `${formatCount(r.count)} of ${formatCount(r.of)} ${what}`;

function durationValue(d: Duration): ReactNode {
  return d.median === null ? <span className="text-base font-normal text-muted">{missingWords(d.n)}</span> : durationWords(d.median);
}

function CountTable({ caption, rows, total }: { caption: string; rows: { label: string; count: number }[]; total?: number }) {
  return (
    <table className="w-full text-sm">
      <caption className="mb-2 text-left font-medium">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">What</th>
          <th scope="col">Conversations</th>
          {total !== undefined && <th scope="col">Share</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-line">
            <th scope="row" className="py-1.5 text-left font-normal">
              {row.label}
            </th>
            <td className="py-1.5 text-right tabular-nums">{formatCount(row.count)}</td>
            {total !== undefined && (
              <td className="w-20 py-1.5 text-right text-muted tabular-nums">{total >= MIN_SUPPORT_SAMPLE ? formatPercent(row.count / total) : ""}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReportsView({ report, periodLabel, cut = false, picker }: { report: SupportReport; periodLabel: string; cut?: boolean; picker?: ReactNode }) {
  const toneTotal = TONE_BANDS.reduce((sum, band) => sum + report.tone[band], 0);
  const handed = report.handover.count;
  return (
    <div className="flex flex-col gap-6">
      {picker}
      <p className="text-sm text-muted">
        Conversations that started in the period ({periodLabel}). Rates and medians are shown from {MIN_SUPPORT_SAMPLE} conversations. For the desk, never per person.
      </p>
      {cut && <p className="rounded-panel border border-line p-3 text-sm">This period has more conversations than one report reads: the figures are from the first 50 000.</p>}

      <section aria-labelledby="support-volume" className="flex flex-col gap-3">
        <h2 id="support-volume" className="text-title text-ink">
          Conversations
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Started" value={formatCount(report.conversations)} sub={`${formatCount(report.open)} still open`} />
          <Figure
            label="Handled by the AI alone"
            value={rateValue(report.aiAlone)}
            sub={rateSub(report.aiAlone, "ended with the AI first")}
            help="Never queued, taken over or answered by a person."
          />
          <Figure
            label="Resolved by the AI"
            value={rateValue(report.aiResolved)}
            sub={rateSub(report.aiResolved, "the AI handled alone")}
            help="The AI's own judgement in its summaries."
          />
          <Figure label="Handed to a person" value={rateValue(report.handover)} sub={rateSub(report.handover, "ended with the AI first")} />
        </dl>
        <CountTable
          caption="By who answered first"
          rows={[
            { label: "The AI first", count: report.byMode.ai_first },
            { label: "People only", count: report.byMode.people },
            { label: "The chat assistant alone (support off)", count: report.byMode.off },
            ...(report.byMode.unknown ? [{ label: "Not recorded (before reports began)", count: report.byMode.unknown }] : []),
          ]}
        />
        {handed > 0 && (
          <CountTable
            caption="Why it went to a person"
            rows={HANDOFF_WHYS.filter((why) => report.handoverWhy[why] > 0).map((why) => ({ label: HANDOFF_WHY_WORDS[why], count: report.handoverWhy[why] }))}
            total={handed}
          />
        )}
      </section>

      <section aria-labelledby="support-speed" className="flex flex-col gap-3">
        <h2 id="support-speed" className="text-title text-ink">
          Waiting and answering
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Time to a person's first answer"
            value={durationValue(report.firstAnswer)}
            sub={report.firstAnswer.median === null ? `${formatCount(report.firstAnswer.n)} answered after waiting` : `Median of ${formatCount(report.firstAnswer.n)}`}
          />
          <Figure
            label="Slowest tenth waited"
            value={report.firstAnswer.slowestTenth === null ? <span className="text-base font-normal text-muted">{missingWords(report.firstAnswer.n)}</span> : `${durationWords(report.firstAnswer.slowestTenth)} or more`}
            sub="One in ten waited at least this long."
          />
          <Figure label="Missed" value={formatCount(report.missed.count)} sub={report.missed.share === null ? `Of ${formatCount(report.missed.of)} that waited` : `${formatPercent(report.missed.share)} of ${formatCount(report.missed.of)} that waited`} help="Ended while waiting, with no answer from a person." />
          <Figure label="Time to the end" value={durationValue(report.timeToEnd)} sub={`Median of ${formatCount(report.timeToEnd.n)} ended`} />
        </dl>
      </section>

      <section aria-labelledby="support-quality" className="flex flex-col gap-3">
        <h2 id="support-quality" className="text-title text-ink">
          How it went
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Customers who said we helped" value={rateValue(report.rating)} sub={`${formatCount(report.rating.of)} ratings`} />
          <Figure label="Partner drafts used" value={report.drafts.share === null ? <span className="text-base font-normal text-muted">{missingWords(report.drafts.offered)}</span> : formatPercent(report.drafts.share)} sub={`${formatCount(report.drafts.used)} replies from ${formatCount(report.drafts.offered)} drafts`} />
        </dl>
        <div className="grid gap-6 lg:grid-cols-3">
          <CountTable
            caption="Tone at the end"
            rows={[...TONE_BANDS].reverse().map((band) => ({ label: TONE_BAND_WORDS[band], count: report.tone[band] })).concat([{ label: "Not measured", count: report.tone.not_measured }])}
            total={toneTotal}
          />
          <CountTable caption="Outcome (the AI's summaries)" rows={OUTCOMES.map((outcome) => ({ label: OUTCOME_WORDS[outcome] ?? outcome, count: report.outcomes[outcome] }))} />
          {report.topics.length > 0 ? (
            <CountTable caption="Topics" rows={report.topics.map((t) => ({ label: topicWords(t.topic), count: t.count }))} />
          ) : (
            <p className="text-sm text-muted">No summaries with topics in this period.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="support-requests" className="flex flex-col gap-3">
        <h2 id="support-requests" className="text-title text-ink">
          Requests to your team
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Opened" value={formatCount(report.requests.opened)} sub={`${formatCount(report.requests.open)} still open`} />
          <Figure label="Done" value={formatCount(report.requests.done)} />
          <Figure label="Declined" value={formatCount(report.requests.declined)} />
          <Figure label="Time to decide" value={durationValue(report.requests.timeToDecide)} sub={`Median of ${formatCount(report.requests.timeToDecide.n)} decided`} />
        </dl>
      </section>

      {report.anonymised > 0 && (
        <p className="text-sm text-muted">
          {formatCount(report.anonymised)} of these conversations are past their transcript&apos;s period: they count in every figure above except requests and the
          partner&apos;s drafts, which went with their transcripts.
        </p>
      )}
    </div>
  );
}
