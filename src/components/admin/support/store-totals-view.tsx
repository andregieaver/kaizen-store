import Link from "next/link";

import { formatCount, formatPercent } from "@/lib/analytics-core";
import { durationWords, type Duration, type Rate, type SupportReport } from "@/lib/support-reports";
import { MIN_SUPPORT_SAMPLE, type SupportMode } from "@/lib/support-rules";

/**
 * The platform's per-store support totals (D216, 2.8 *Stores*, step 14): a row per store with its desk's mode, how many wait now and
 * the period's counts and rates. A rate or median below `MIN_SUPPORT_SAMPLE` is a dash with its count; the store's name links to the
 * store's page in the platform, never to a conversation.
 */

const MODE_WORDS: Record<SupportMode, string> = { off: "Assistant alone", ai_first: "AI first", people: "People only" };

const rateCell = (r: Rate) => (r.share === null ? <span className="text-muted">– ({formatCount(r.of)})</span> : formatPercent(r.share));
const durationCell = (d: Duration) => (d.median === null ? <span className="text-muted">– ({formatCount(d.n)})</span> : durationWords(d.median));

export type StoreTotalsRow = { store: { id: string; slug: string; name: string }; mode: SupportMode; waiting: number; report: SupportReport };

export function StoreTotalsView({ stores, cut = false, periodLabel }: { stores: StoreTotalsRow[]; cut?: boolean; periodLabel: string }) {
  if (stores.length === 0) return <p className="text-muted">No store has a support desk or a conversation in this period.</p>;
  const all = stores.reduce((sum, s) => sum + s.report.conversations, 0);
  const waiting = stores.reduce((sum, s) => sum + s.waiting, 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {formatCount(all)} conversations started in the period ({periodLabel}) across {formatCount(stores.length)} stores; {formatCount(waiting)} waiting for a person now. A
        dash means fewer than {MIN_SUPPORT_SAMPLE} cases (their count in brackets).
      </p>
      {cut && <p className="text-sm">The period has more conversations than one report reads: the figures are from the first 50 000.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">Support per store</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Store
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Mode
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Waiting now
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Conversations
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                AI alone
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Handed over
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                First answer (median)
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Missed
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Said we helped
              </th>
            </tr>
          </thead>
          <tbody>
            {stores.map(({ store, mode, waiting: now, report }) => (
              <tr key={store.id} className="border-t border-border">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <Link href={`/admin/platform/stores/${store.slug}`} className="underline">
                    {store.name}
                  </Link>
                </th>
                <td className="py-2 pr-3">{MODE_WORDS[mode]}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCount(now)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCount(report.conversations)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{rateCell(report.aiAlone)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{rateCell(report.handover)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{durationCell(report.firstAnswer)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCount(report.missed.count)}</td>
                <td className="py-2 text-right tabular-nums">{rateCell(report.rating)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
