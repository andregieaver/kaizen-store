import Link from "next/link";

import { PhoneRow } from "@/components/admin/phone-row";

import { formatCount, formatPercent } from "@/lib/analytics-core";
import {
  durationWords,
  type Duration,
  type Rate,
  type SupportReport,
} from "@/lib/support-reports";
import { MIN_SUPPORT_SAMPLE, type SupportMode } from "@/lib/support-rules";
import { countWords, fillWords } from "@/lib/admin-fill";
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
      <p className="text-sm text-muted sm:hidden">{fillWords(w.phone.intro, { all: formatCount(all), stores: formatCount(stores.length), waiting: formatCount(waiting) })}</p>
      <p className="text-sm text-muted max-sm:hidden">
        {fillWords(w.intro, {
          all: formatCount(all),
          period: periodLabel,
          stores: formatCount(stores.length),
          waiting: formatCount(waiting),
          min: MIN_SUPPORT_SAMPLE,
        })}
      </p>
      {cut && <p className="text-sm">{t.reports.cut}</p>}
      {/* Round 71 (D853): on a phone each store is a row, those with someone waiting first: its mode and conversations, the waiting
          at the end, opening its rates. From sm up the table. */}
      <div className="overflow-hidden rounded-panel bg-card px-4 sm:hidden">
        {[...stores]
          .sort((a, b) => b.waiting - a.waiting)
          .map(({ store, mode, waiting: now, report }, i, all) => (
            <PhoneRow
              key={store.id}
              inset
              last={i === all.length - 1}
              title={store.name}
              sub={`${w.modes[mode]} · ${countWords(report.conversations, w.phone.conversations, { n: formatCount(report.conversations) })}`}
              change={now > 0 ? fillWords(w.phone.waiting, { n: formatCount(now) }) : w.phone.open}
              done={w.phone.close}
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {(
                  [
                    [w.aiAlone, rateCell(report.aiAlone)],
                    [w.handedOver, rateCell(report.handover)],
                    [w.firstAnswer, durationCell(report.firstAnswer, t)],
                    [w.missed, formatCount(report.missed.count)],
                    [w.helped, rateCell(report.rating)],
                  ] as const
                ).map(([name, value]) => (
                  <div key={name} className="flex flex-col">
                    <dt className="text-caption text-muted">{name}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <Link href={`/admin/platform/stores/${store.slug}`} className="mt-3 inline-flex min-h-10 items-center text-sm underline">
                {w.phone.store}
              </Link>
            </PhoneRow>
          ))}
      </div>
      <div className="overflow-x-auto max-sm:hidden">
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
