import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { field } from "@/components/admin/data/ui";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { ConsoleMessages } from "@/lib/admin-messages/console.en";
import { CHANNELS } from "@/lib/analytics-channels";
import { formatCount } from "@/lib/analytics-core";
import { formatMoney } from "@/lib/money";
import type { ChannelRow, CohortRow } from "@/lib/platform-channels";
import type { SpendRow } from "@/server/platform-channels";

const th = "px-3 py-2 text-left font-normal";
const num = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

type Words = ConsoleMessages["planAnalytics"];

/**
 * Owners by the month they joined, and where new owners came from (C2, D521) on Plans → Analytics: two tables Homer reads as they are; Lisa
 * enters what was spent on each channel below the second, one step away (a platform owner or its finance role).
 */
export function OwnerCohortsCard({ currency, rows, locale, words: w }: { currency: string; rows: CohortRow[]; locale: string; words: Words }) {
  const o = w.owners;
  const money = (minor: number | null) => (minor === null ? "" : formatMoney(minor, currency, locale, { decimals: "hide_whole" }));
  const month = (key: string) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Card title={o.title} description={fillWords(o.description, { currency })}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{o.none}</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className={th}>{o.month}</th>
                <th scope="col" className={`${th} text-right`}>{o.stores}</th>
                <th scope="col" className={`${th} text-right`}>{o.opened}</th>
                <th scope="col" className={`${th} text-right`}>{o.payingNow}</th>
                <th scope="col" className={`${th} text-right`}>{o.everPaid}</th>
                <th scope="col" className={`${th} text-right`}>{o.paid}</th>
                <th scope="col" className={`${th} text-right`}>{o.perStore}</th>
                <th scope="col" className={`${th} text-right`}>{o.perPayer}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-b border-line last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal">{month(r.month)}</th>
                  <td className={num}>{formatCount(r.stores)}</td>
                  <td className={num}>{formatCount(r.opened)}</td>
                  <td className={num}>{formatCount(r.payingNow)}</td>
                  <td className={num}>{formatCount(r.everPaid)}</td>
                  <td className={num}>{money(r.paidMinor)}</td>
                  <td className={num}>{money(r.perStoreMinor)}</td>
                  <td className={num}>{money(r.perPayerMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function OwnerChannelsCard({
  days,
  currency,
  rows,
  spend,
  canWrite,
  today,
  locale,
  words: w,
  channelNames,
  save,
  remove,
}: {
  days: number;
  currency: string;
  rows: ChannelRow[];
  spend: SpendRow[];
  canWrite: boolean;
  today: string;
  locale: string;
  words: Words;
  /** A channel's name by its key, from the reports' words. */
  channelNames: Record<string, string>;
  save: (state: FormState, form: FormData) => Promise<FormState>;
  remove: (id: string) => Promise<FormState>;
}) {
  const c = w.channels;
  const money = (minor: number | null, cur = currency) => (minor === null ? "" : formatMoney(minor, cur, locale, { decimals: "hide_whole" }));
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "UTC" });
  return (
    <Card title={fillWords(c.title, { n: days })} description={fillWords(c.description, { currency })}>
      <div className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{c.none}</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className={th}>{c.channel}</th>
                  <th scope="col" className={`${th} text-right`}>{c.requests}</th>
                  <th scope="col" className={`${th} text-right`}>{c.owners}</th>
                  <th scope="col" className={`${th} text-right`}>{c.opened}</th>
                  <th scope="col" className={`${th} text-right`}>{c.payingNow}</th>
                  <th scope="col" className={`${th} text-right`}>{c.spend}</th>
                  <th scope="col" className={`${th} text-right`}>{c.perOwner}</th>
                  <th scope="col" className={`${th} text-right`}>{c.perPaying}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.channel} className="border-b border-line last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">{channelNames[r.channel] ?? r.channel}</th>
                    <td className={num}>{formatCount(r.requests)}</td>
                    <td className={num}>{formatCount(r.owners)}</td>
                    <td className={num}>{formatCount(r.opened)}</td>
                    <td className={num}>{formatCount(r.payingNow)}</td>
                    <td className={num}>{r.spendMinor > 0 ? money(r.spendMinor) : ""}</td>
                    <td className={num}>{money(r.perOwnerMinor)}</td>
                    <td className={num}>{money(r.perPayingMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details>
          <summary className="w-fit cursor-pointer text-sm text-muted underline underline-offset-2">{c.spendTitle}</summary>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            {spend.length === 0 ? (
              <p className="text-muted">{c.spendNone}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {spend.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {day(s.day)} · {channelNames[s.channel] ?? s.channel}
                      {s.campaign ? ` · ${s.campaign}` : ""} · {money(s.amountMinor, s.currency)}
                    </span>
                    {canWrite && (
                      <ActionForm action={remove.bind(null, s.id)}>
                        <SubmitButton variant="secondary">{c.remove}</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <ActionForm action={save} className="flex flex-col gap-3">
                <p className="text-muted">{c.spendHint}</p>
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1 font-medium">
                    {c.day}
                    <input name="day" type="date" required defaultValue={today} className={field} />
                  </label>
                  <label className="flex flex-col gap-1 font-medium">
                    {c.channel}
                    <select name="channel" defaultValue="paid_search" className={field}>
                      {CHANNELS.map((ch) => (
                        <option key={ch.key} value={ch.key}>
                          {channelNames[ch.key] ?? ch.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-48 flex-1 flex-col gap-1 font-medium">
                    {c.campaign}
                    <input name="campaign" maxLength={100} className={field} />
                  </label>
                  <label className="flex w-36 flex-col gap-1 font-medium">
                    {c.amount}
                    <input name="amount" inputMode="decimal" required className={field} />
                  </label>
                  <label className="flex w-24 flex-col gap-1 font-medium">
                    {c.currency}
                    <input name="currency" required maxLength={3} defaultValue={currency} className={`${field} uppercase`} />
                  </label>
                </div>
                <label className="flex flex-col gap-1 font-medium">
                  {c.note}
                  <input name="note" maxLength={500} className={field} />
                </label>
                <div>
                  <SubmitButton variant="secondary">{c.add}</SubmitButton>
                </div>
              </ActionForm>
            )}
          </div>
        </details>
      </div>
    </Card>
  );
}
