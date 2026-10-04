import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PLATFORM_BASE } from "@/lib/platform-nav";
import { ratePercent } from "@/lib/vat";
import type { VatRateRow } from "@/server/vat-admin";

import { card, dayText } from "./styles";

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

const STATE_WORDS: Record<VatRateRow["state"], string> = { current: "In force", scheduled: "Scheduled", ended: "Ended" };

/**
 * The rates nobody has verified yet (D157): current and scheduled rows, each with its source and the date it was checked, to work
 * through with an accountant. Marking a row verified records who and when. A rate is only relied on once a person has looked at it,
 * but an unverified rate is still the one that is charged: the list is the way to find them.
 */
export function UnverifiedCard({ rows, categoryName, verify }: { rows: VatRateRow[]; categoryName: (code: string) => string; verify: VerifyAction }) {
  return (
    <section aria-labelledby="unverified" className={card}>
      <div>
        <h2 id="unverified" className="font-medium">
          Not verified yet
        </h2>
        <p className="text-sm text-muted">
          Every rate starts unverified: it carries its source and the day it was read, and nobody has confirmed it. These rates are still the ones charged. Work through them with an accountant and
          mark each verified.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Every rate in force or scheduled has been verified.</p>
      ) : (
        <>
          <p className="text-sm" aria-live="polite">
            {rows.length} {rows.length === 1 ? "rate" : "rates"} to verify.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Rates not yet verified</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Country</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Category</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Rate</th>
                  <th scope="col" className="py-2 pr-3 font-medium">From</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Source and date checked</th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
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
                      {dayText(row.validFrom)}
                      {row.state === "scheduled" && <span className="block text-xs text-muted">Scheduled</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <Source source={row.source} />
                      <span className="block text-xs text-muted">Checked {dayText(row.checkedOn)}</span>
                      {row.note && <span className="block text-xs text-muted">{row.note}</span>}
                    </td>
                    <td className="py-2">
                      <ActionForm action={verify(row.country, row.category, row.validFrom)} successMessage="Verified." className="flex flex-col gap-1">
                        <SubmitButton variant="secondary">Mark verified</SubmitButton>
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
export function RateHistory({ rows, categoryName, verify }: { rows: VatRateRow[]; categoryName: (code: string) => string; verify: VerifyAction }) {
  return (
    <section aria-labelledby="history" className={card}>
      <div>
        <h2 id="history" className="font-medium">
          Rates and history
        </h2>
        <p className="text-sm text-muted">Every period of every rate for this country. A category with no row takes the standard rate.</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No rates are recorded for this country.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Rates and their history</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Category</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Rate</th>
                <th scope="col" className="py-2 pr-3 font-medium">Applies</th>
                <th scope="col" className="py-2 pr-3 font-medium">State</th>
                <th scope="col" className="py-2 pr-3 font-medium">Source and date checked</th>
                <th scope="col" className="py-2 font-medium">Verified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={`${row.category}:${row.validFrom}`} className={`align-top ${row.state === "ended" ? "text-muted" : ""}`}>
                  <td className="py-2 pr-3">{categoryName(row.category)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{ratePercent(row.rate)}</td>
                  <td className="py-2 pr-3">
                    {dayText(row.validFrom)}
                    {" to "}
                    {row.validTo ? dayText(row.validTo) : "now"}
                    <span className="block text-xs text-muted">The end day is the first day it no longer applies.</span>
                  </td>
                  <td className="py-2 pr-3">{STATE_WORDS[row.state]}</td>
                  <td className="py-2 pr-3">
                    <Source source={row.source} />
                    <span className="block text-xs text-muted">Checked {dayText(row.checkedOn)}</span>
                    {row.note && <span className="block text-xs text-muted">{row.note}</span>}
                  </td>
                  <td className="py-2">
                    {row.verified ? (
                      <span>
                        Verified
                        <span className="block text-xs text-muted">
                          {row.verified.by ? `${row.verified.by}, ` : ""}
                          {dayText(row.verified.at.slice(0, 10))}
                        </span>
                      </span>
                    ) : row.state === "ended" ? (
                      <span className="text-muted">Not verified</span>
                    ) : (
                      <ActionForm action={verify(row.country, row.category, row.validFrom)} successMessage="Verified." className="flex flex-col gap-1">
                        <SubmitButton variant="secondary">Mark verified</SubmitButton>
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
