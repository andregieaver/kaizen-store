import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PLATFORM_BASE } from "@/lib/platform-nav";
import { ratePercent } from "@/lib/vat";
import type { VatRateRow } from "@/server/vat-admin";

import { countWords, fillWords } from "@/lib/admin-fill";

import { card, dayText, VAT_EN, type VatWords } from "./styles";

type VerifyAction = (country: string, category: string, validFrom: string) => (state: FormState, form: FormData) => Promise<FormState>;

/** A source that is a web address is a link; an act's name is text. */
function Source({ source }: { source: string }) {
  if (/^https?:\/\//i.test(source)) {
    return (
      <a href={source} target="_blank" rel="noreferrer" className="break-all underline">
        {source}
      </a>
    );
  }
  return <span>{source}</span>;
}


/**
 * The rates nobody has verified yet (D157): current and scheduled rows, each with its source and the date it was checked, to work
 * through with an accountant. Marking a row verified records who and when. A rate is only relied on once a person has looked at it,
 * but an unverified rate is still the one that is charged: the list is the way to find them.
 */
export function UnverifiedCard({ rows, categoryName, verify, words: w = VAT_EN, locale }: { rows: VatRateRow[]; categoryName: (code: string) => string; verify: VerifyAction; words?: VatWords; locale?: string }) {
  const u = w.unverified;
  return (
    <section aria-labelledby="unverified" className={card}>
      <div>
        <h2 id="unverified" className="text-title text-ink">
          {u.title}
        </h2>
        <p className="text-sm text-muted">{u.text}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{u.none}</p>
      ) : (
        <>
          <p className="text-sm" aria-live="polite">
            {countWords(rows.length, u.count)}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">{u.caption}</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">{w.country}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{w.category}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{w.rate}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{w.from}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{u.sourceAndDate}</th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">{u.action}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={`${row.country}:${row.category}:${row.validFrom}`} className="align-top">
                    <td className="py-2 pr-3">
                      <Link href={`${PLATFORM_BASE}/vat/${row.country}`} className="underline">
                        {row.country}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{categoryName(row.category)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{ratePercent(row.rate)}</td>
                    <td className="py-2 pr-3">
                      {dayText(row.validFrom, locale)}
                      {row.state === "scheduled" && <span className="block text-xs text-muted">{w.states.scheduled}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <Source source={row.source} />
                      <span className="block text-xs text-muted">{fillWords(w.checked, { date: dayText(row.checkedOn, locale) })}</span>
                      {row.note && <span className="block text-xs text-muted">{row.note}</span>}
                    </td>
                    <td className="py-2">
                      <ActionForm action={verify(row.country, row.category, row.validFrom)} successMessage={w.verifiedDone} className="flex flex-col gap-1">
                        <SubmitButton variant="secondary">{w.markVerified}</SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * One country's rates with their history, newest first for each category: the rate, when it applied, whether it is in force now, its source
 * and who verified it and when. A rate is never edited: a change ends one period and begins another, so this is the full record.
 */
export function RateHistory({ rows, categoryName, verify, words: w = VAT_EN, locale }: { rows: VatRateRow[]; categoryName: (code: string) => string; verify: VerifyAction; words?: VatWords; locale?: string }) {
  const hw = w.history;
  return (
    <section aria-labelledby="history" className={card}>
      <div>
        <h2 id="history" className="text-title text-ink">
          {hw.title}
        </h2>
        <p className="text-sm text-muted">{hw.text}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{hw.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">{hw.caption}</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">{w.category}</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">{w.rate}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{hw.applies}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{hw.state}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{w.unverified.sourceAndDate}</th>
                <th scope="col" className="py-2 font-medium">{w.verified}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={`${row.category}:${row.validFrom}`} className={`align-top ${row.state === "ended" ? "text-muted" : ""}`}>
                  <td className="py-2 pr-3">{categoryName(row.category)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{ratePercent(row.rate)}</td>
                  <td className="py-2 pr-3">
                    {dayText(row.validFrom, locale)}
                    {hw.to}
                    {row.validTo ? dayText(row.validTo, locale) : hw.now}
                    <span className="block text-xs text-muted">{hw.endDay}</span>
                  </td>
                  <td className="py-2 pr-3">{w.states[row.state]}</td>
                  <td className="py-2 pr-3">
                    <Source source={row.source} />
                    <span className="block text-xs text-muted">{fillWords(w.checked, { date: dayText(row.checkedOn, locale) })}</span>
                    {row.note && <span className="block text-xs text-muted">{row.note}</span>}
                  </td>
                  <td className="py-2">
                    {row.verified ? (
                      <span>
                        {w.verified}
                        <span className="block text-xs text-muted">
                          {row.verified.by ? `${row.verified.by}, ` : ""}
                          {dayText(row.verified.at.slice(0, 10), locale)}
                        </span>
                      </span>
                    ) : row.state === "ended" ? (
                      <span className="text-muted">{hw.notVerified}</span>
                    ) : (
                      <ActionForm action={verify(row.country, row.category, row.validFrom)} successMessage={w.verifiedDone} className="flex flex-col gap-1">
                        <SubmitButton variant="secondary">{w.markVerified}</SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
