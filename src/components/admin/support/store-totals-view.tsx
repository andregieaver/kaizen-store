import Link from "next/link";

import { formatCount, formatPercent } from "@/lib/analytics-core";
import {
  durationWords,
  type Duration,
  type Rate,
  type SupportReport,
} from "@/lib/support-reports";
import { MIN_SUPPORT_SAMPLE, type SupportMode } from "@/lib/support-rules";
import { fillWords } from "@/lib/admin-fill";
import {
  supportEn,
  type SupportMessages,
} from "@/lib/admin-messages/support.en";

/**
 * The platform's per-store support totals (D216, 2.8 *Stores*, step 14): a row per store with its desk's mode, how many wait now and
 * the period's counts and rates. A rate or median below `MIN_SUPPORT_SAMPLE` is a dash with its count; the store's name links to the
 * store's page in the platform, never to a conversation.
 */

const rateCell = (r: Rate) =>
  r.share === null ? (
    <span className="text-muted">– ({formatCount(r.of)})</span>
  ) : (
    formatPercent(r.share)
  );
const durationCell = (d: Duration, t: SupportMessages) =>
  d.median === null ? (
    <span className="text-muted">– ({formatCount(d.n)})</span>
  ) : (
    durationWords(d.median, t.units)
  );

export type StoreTotalsRow = {
  store: { id: string; slug: string; name: string };
  mode: SupportMode;
  waiting: number;
  report: SupportReport;
};

export function StoreTotalsView({
  stores,
  cut = false,
  periodLabel,
  words: t = supportEn,
}: {
  stores: StoreTotalsRow[];
  cut?: boolean;
  periodLabel: string;
  words?: SupportMessages;
}) {
  const w = t.totals;
  if (stores.length === 0) return <p className="text-muted">{w.none}</p>;
  const all = stores.reduce((sum, s) => sum + s.report.conversations, 0);
  const waiting = stores.reduce((sum, s) => sum + s.waiting, 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {fillWords(w.intro, {
          all: formatCount(all),
          period: periodLabel,
          stores: formatCount(stores.length),
          waiting: formatCount(waiting),
          min: MIN_SUPPORT_SAMPLE,
        })}
      </p>
      {cut && <p className="text-sm">{t.reports.cut}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">{w.caption}</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                {w.store}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {w.mode}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {w.waiting}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {w.conversations}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {w.aiAlone}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {w.handedOver}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {w.firstAnswer}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                {w.missed}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {w.helped}
              </th>
            </tr>
          </thead>
          <tbody>
            {stores.map(({ store, mode, waiting: now, report }) => (
              <tr key={store.id} className="border-t border-line">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <Link
                    href={`/admin/platform/stores/${store.slug}`}
                    className="underline"
                  >
                    {store.name}
                  </Link>
                </th>
                <td className="py-2 pr-3">{w.modes[mode]}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatCount(now)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatCount(report.conversations)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {rateCell(report.aiAlone)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {rateCell(report.handover)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {durationCell(report.firstAnswer, t)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatCount(report.missed.count)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {rateCell(report.rating)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
