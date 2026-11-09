import Link from "next/link";

import { CARD_CLASS } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { ReportsMessages } from "@/lib/admin-messages/reports.en";
import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import { formatMoney } from "@/lib/money";
import type { SalesReport } from "@/server/sales-reports";

import { KpiCard } from "./kpi-card";
import { AnalyticsSection, Note } from "./section";

const th = "px-3 py-2 text-left text-xs font-medium text-muted";
const num = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
const cell = "px-3 py-2";

/**
 * Analytics → Sales (S6, D519): the open deals' value and its weighted part, the share of closed deals won and the time to win at the top;
 * then when the open deals may close, how deals made in the period moved from stage to stage, and what each person won and lost. Homer reads
 * the four cards; Lisa switches the pipeline and the currency, one step away.
 */
export function SalesView({
  report: r,
  base,
  query,
  locale,
  words: w,
}: {
  report: SalesReport;
  base: string;
  query: Record<string, string>;
  locale: string;
  words: ReportsMessages["sales"];
}) {
  const money = (minor: number) => formatMoney(minor, r.currency, locale, { decimals: "hide_whole" });
  const days = (n: number | null) => (n === null ? NO_FIGURE : countWords(n, w.days));
  const closed = r.people.reduce((s, p) => s + p.won + p.lost, 0);
  const won = r.people.reduce((s, p) => s + p.won, 0);
  const href = (change: Record<string, string>) => `${base}/analytics/sales?${new URLSearchParams({ ...query, ...change })}`;
  const monthName = (key: string) =>
    key === "overdue" ? w.overdue : key === "later" ? w.later : key === "none" ? w.noDate : new Date(`${key}-15T12:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });

  if (r.pipelines.length === 0) {
    return (
      <div className={`${CARD_CLASS} p-5 text-sm`}>
        <p className="text-muted">{w.none}</p>
        <Link href={`${base}/deals`} className="mt-2 inline-block underline">
          {w.openDeals}
        </Link>
      </div>
    );
  }

  const switches = (
    <div className="flex flex-wrap items-center gap-3">
      {r.pipelines.length > 1 && (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{w.pipeline}:</span>
          {r.pipelines.map((p) =>
            p.id === r.pipelineId ? (
              <span key={p.id} className="text-body-strong">
                {p.name}
              </span>
            ) : (
              <Link key={p.id} href={href({ pipeline: p.id })} className="underline">
                {p.name}
              </Link>
            ),
          )}
        </span>
      )}
      {r.currencies.length > 1 && (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{w.currency}:</span>
          {r.currencies.map((c) =>
            c === r.currency ? (
              <span key={c} className="text-body-strong">
                {c}
              </span>
            ) : (
              <Link key={c} href={href({ currency: c })} className="underline">
                {c}
              </Link>
            ),
          )}
        </span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {(r.pipelines.length > 1 || r.currencies.length > 1) && <div className="text-sm">{switches}</div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={w.openValue} value={money(r.open.valueMinor)} hint={countWords(r.open.deals, { one: `{n} ${w.open.toLowerCase()}`, many: `{n} ${w.open.toLowerCase()}` })} emphasis />
        <KpiCard label={w.weighted} value={money(r.open.weightedMinor)} hint={w.weightedHint} />
        <KpiCard label={w.winRate} value={closed === 0 ? NO_FIGURE : formatPercent(won / closed, 0)} hint={`${formatCount(won)} / ${formatCount(closed)}`} />
        <KpiCard
          label={w.timeToWin}
          value={days(r.timeToWin.median)}
          hint={r.timeToWin.deals > 0 ? fillWords(w.medianHint, { n: r.timeToWin.deals, mean: days(r.timeToWin.mean) }) : undefined}
        />
      </div>

      <AnalyticsSection id="sales-forecast" title={w.forecastTitle} description={w.forecastNote}>
        <div className={`${CARD_CLASS} relative overflow-x-auto`}>
          <table className="w-full text-sm" data-export-skip="sales.forecast">
            <thead>
              <tr>
                <th className={th}>{w.month}</th>
                <th className={`${th} text-right`}>{w.deals}</th>
                <th className={`${th} text-right`}>{w.value}</th>
                <th className={`${th} text-right`}>{w.weightedShort}</th>
              </tr>
            </thead>
            <tbody>
              {r.forecast
                .filter((b) => b.deals > 0 || /^\d{4}-\d{2}$/.test(b.key))
                .map((b) => (
                  <tr key={b.key} className="border-t border-line">
                    <th scope="row" className={`${cell} text-left font-normal ${b.key === "overdue" && b.deals > 0 ? "text-warning-text" : ""}`}>
                      {monthName(b.key)}
                    </th>
                    <td className={num}>{formatCount(b.deals)}</td>
                    <td className={num}>{b.deals > 0 ? money(b.valueMinor) : ""}</td>
                    <td className={num}>
                      {b.deals > 0 ? money(b.weightedMinor) : ""}
                      {b.unweighted > 0 && <span className="block text-xs text-muted">{countWords(b.unweighted, w.leftOut)}</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </AnalyticsSection>

      <AnalyticsSection id="sales-stages" title={w.stagesTitle} description={w.stagesNote}>
        {r.stages.steps.every((s) => s.reached === 0) ? (
          <p className="text-sm text-muted">{w.nothingInPeriod}</p>
        ) : (
          <>
            <div className={`${CARD_CLASS} relative overflow-x-auto`}>
              <table className="w-full text-sm" data-export-skip="sales.stages">
                <thead>
                  <tr>
                    <th className={th}>{w.stage}</th>
                    <th className={`${th} text-right`}>{w.reached}</th>
                    <th className={`${th} text-right`}>{w.onward}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.stages.steps.map((s) => (
                    <tr key={s.stageId} className="border-t border-line">
                      <th scope="row" className={`${cell} text-left font-normal`}>
                        {r.stages.names[s.stageId] ?? s.stageId}
                      </th>
                      <td className={num}>{formatCount(s.reached)}</td>
                      <td className={num}>{formatPercent(s.onward, 0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line">
                    <th scope="row" className={`${cell} text-left font-medium`}>
                      {w.toWon}
                    </th>
                    <td className={num}>{formatCount(r.stages.won)}</td>
                    <td className={num} />
                  </tr>
                </tbody>
              </table>
            </div>
            <Note>{fillWords(w.endings, { won: r.stages.won, lost: r.stages.lost, open: r.stages.open })}</Note>
          </>
        )}
      </AnalyticsSection>

      <AnalyticsSection id="sales-people" title={w.peopleTitle} description={fillWords(w.peopleNote, { currency: r.currency })}>
        {r.people.length === 0 ? (
          <p className="text-sm text-muted">{w.nothingInPeriod}</p>
        ) : (
          <div className={`${CARD_CLASS} relative overflow-x-auto`}>
            <table className="w-full text-sm" data-export-skip="sales.people">
              <thead>
                <tr>
                  <th className={th}>{w.person}</th>
                  <th className={`${th} text-right`}>{w.won}</th>
                  <th className={`${th} text-right`}>{w.lost}</th>
                  <th className={`${th} text-right`}>{w.winRate}</th>
                  <th className={`${th} text-right`}>{w.wonValue}</th>
                </tr>
              </thead>
              <tbody>
                {r.people.map((p) => (
                  <tr key={p.ownerId ?? "nobody"} className="border-t border-line">
                    <th scope="row" className={`${cell} text-left font-normal`}>
                      {p.ownerId === null ? w.nobody : (p.name ?? w.nobody)}
                    </th>
                    <td className={num}>{formatCount(p.won)}</td>
                    <td className={num}>{formatCount(p.lost)}</td>
                    <td className={num}>{formatPercent(p.winRate, 0)}</td>
                    <td className={num}>{money(p.wonMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AnalyticsSection>
    </div>
  );
}
