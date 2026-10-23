import type { ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { CHANNELS } from "@/lib/analytics-channels";
import { formatCount } from "@/lib/analytics-core";
import { channelLabel } from "@/lib/analytics-traffic";
import { analyticsWords } from "@/lib/analytics-words";
import type { StoredSpend } from "@/server/analytics-settings";

import { DataTable, type Column } from "./data-table";
import { dayText, moneyWriter } from "./overview-view";
import { AnalyticsSection } from "./section";
import { CARD_CLASS } from "@/components/admin/ui";

/**
 * Where the owner enters what was spent on marketing (D152, docs/analytics.md): a form for one day, channel and campaign at a time, and the
 * latest entries with a button to take each one away. CAC and ROAS are worked out from these entries, so the form says what to enter
 * and in what currency. The view takes plain props (the entries, and the server actions already bound to the store), reads nothing
 * itself and works with no script: the form posts, and a delete is its own small form. Any member may enter spend.
 */

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

/** The server actions the page binds to the store. */
export type SpendActions = { add: FormAction; remove: FormAction };

export type SpendSectionProps = {
  /** The store's main currency: spend is typed in it, without VAT. */
  currency: string;
  /** The first market's locale, for writing amounts. */
  locale: string;
  /** What day it is in the store's time zone (`YYYY-MM-DD`): the form starts on it and takes no later day. */
  today: string;
  /** The latest entries, newest day first. */
  entries: readonly StoredSpend[];
  /** How many entries are listed at most, so the page can say when there may be more. */
  limit: number;
  actions: SpendActions;
};

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export function SpendSection({ currency, locale, today, entries, limit, actions }: SpendSectionProps) {
  const money = moneyWriter(currency, locale);
  const w = analyticsWords().spend;
  const columns: Column<StoredSpend>[] = [
    { key: "day", label: w.day, cell: (e) => dayText(e.day) },
    { key: "channel", label: w.channel, cell: (e) => channelLabel(e.channel) },
    { key: "campaign", label: w.campaign, cell: (e) => (e.campaign === "" ? <span className="text-muted">{w.wholeChannel}</span> : e.campaign) },
    { key: "amount", label: fillWords(w.amountColumn, { currency }), align: "right", cell: (e) => money(e.amountMinor) },
    { key: "note", label: w.note, cell: (e) => (e.note ? e.note : <span className="text-muted">–</span>) },
    {
      key: "remove",
      label: w.remove,
      align: "right",
      cell: (e) => (
        <ActionForm action={actions.remove} replaceOnSuccess successMessage={w.removed} className="flex justify-end">
          <input type="hidden" name="id" value={e.id} />
          <SubmitButton variant="secondary">
            {w.remove}
            <span className="sr-only">{fillWords(w.removeWhat, { amount: money(e.amountMinor), channel: channelLabel(e.channel), day: dayText(e.day) })}</span>
          </SubmitButton>
        </ActionForm>
      ),
    },
  ];

  return (
    <AnalyticsSection id="spend" title={w.title} description={w.description}>
      <div className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
        <ActionForm action={actions.add} className="flex flex-col gap-4" successMessage={w.saved}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field label={w.day} hint={w.dayHint}>
              <input type="date" name="day" required defaultValue={today} max={today} className={`${field} max-w-48`} />
            </Field>
            <Field label={w.channel} hint={w.channelHint}>
              <select name="channel" required defaultValue="" className={field}>
                <option value="" disabled>
                  {w.chooseChannel}
                </option>
                {CHANNELS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={w.campaignField} hint={w.campaignHint}>
              <input name="campaign" maxLength={100} autoComplete="off" className={field} />
            </Field>
            <Field label={w.amount} hint={fillWords(w.amountHint, { currency })}>
              <span className="flex items-center gap-2">
                <input name="amount" required inputMode="decimal" autoComplete="off" placeholder="1 500" className={`${field} max-w-48 tabular-nums`} />
                <span className="text-sm font-normal text-muted">{currency}</span>
              </span>
            </Field>
            <div className="sm:col-span-2">
              <Field label={w.noteField} hint={w.noteHint}>
                <input name="note" maxLength={500} autoComplete="off" className={field} />
              </Field>
            </div>
          </div>
          <p className="text-xs text-muted">{w.once}</p>
          <div>
            <SubmitButton>{w.add}</SubmitButton>
          </div>
        </ActionForm>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="text-body-strong text-ink">{w.latest}</h3>
          <DataTable
            caption={w.caption}
            columns={columns}
            rows={entries}
            rowKey={(e) => e.id}
            empty={w.empty}
            exportId="settings.spend"
          />
          {entries.length >= limit ? <p className="text-xs text-muted">{fillWords(w.showing, { n: formatCount(limit) })}</p> : null}
        </div>
      </div>
    </AnalyticsSection>
  );
}
