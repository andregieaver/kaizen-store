import type { ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { CHANNELS } from "@/lib/analytics-channels";
import { formatCount } from "@/lib/analytics-core";
import { channelLabel } from "@/lib/analytics-traffic";
import type { StoredSpend } from "@/server/analytics-settings";

import { DataTable, type Column } from "./data-table";
import { dayText, moneyWriter } from "./overview-view";
import { AnalyticsSection } from "./section";

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

const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

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
  const columns: Column<StoredSpend>[] = [
    { key: "day", label: "Day", cell: (e) => dayText(e.day) },
    { key: "channel", label: "Channel", cell: (e) => channelLabel(e.channel) },
    { key: "campaign", label: "Campaign", cell: (e) => (e.campaign === "" ? <span className="text-muted">Whole channel</span> : e.campaign) },
    { key: "amount", label: `Amount (${currency})`, align: "right", cell: (e) => money(e.amountMinor) },
    { key: "note", label: "Note", cell: (e) => (e.note ? e.note : <span className="text-muted">–</span>) },
    {
      key: "remove",
      label: "Remove",
      align: "right",
      cell: (e) => (
        <ActionForm action={actions.remove} replaceOnSuccess successMessage="Removed." className="flex justify-end">
          <input type="hidden" name="id" value={e.id} />
          <SubmitButton variant="secondary">
            Remove<span className="sr-only"> the {money(e.amountMinor)} entered for {channelLabel(e.channel)} on {dayText(e.day)}</span>
          </SubmitButton>
        </ActionForm>
      ),
    },
  ];

  return (
    <AnalyticsSection
      id="spend"
      title="Ad spend"
      description="What you paid for marketing. Sales are known exactly, but ad bills are not, so CAC and ROAS come from what you enter here."
    >
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
        <ActionForm action={actions.add} className="flex flex-col gap-4" successMessage="Saved. CAC and ROAS follow it.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Day" hint="The day the money was spent. Enter a month's spend one day at a time, or the whole amount on one day.">
              <input type="date" name="day" required defaultValue={today} max={today} className={`${field} max-w-48`} />
            </Field>
            <Field label="Channel" hint="Where the ads ran. Sales are matched to the same channels.">
              <select name="channel" required defaultValue="" className={field}>
                <option value="" disabled>
                  Choose a channel
                </option>
                {CHANNELS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Campaign (optional)" hint="A name of your own, to tell campaigns in one channel apart.">
              <input name="campaign" maxLength={100} autoComplete="off" className={field} />
            </Field>
            <Field label="Amount" hint={`In ${currency}, without VAT, like the sales figures.`}>
              <span className="flex items-center gap-2">
                <input name="amount" required inputMode="decimal" autoComplete="off" placeholder="1 500" className={`${field} max-w-48 tabular-nums`} />
                <span className="text-sm font-normal text-muted">{currency}</span>
              </span>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Note (optional)" hint="Anything you want to remember about it.">
                <input name="note" maxLength={500} autoComplete="off" className={field} />
              </Field>
            </div>
          </div>
          <p className="text-xs text-muted">One amount is kept for each day, channel and campaign: entering it again replaces the earlier amount.</p>
          <div>
            <SubmitButton>Add spend</SubmitButton>
          </div>
        </ActionForm>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Latest entries</h3>
          <DataTable
            caption="Latest ad spend entries"
            columns={columns}
            rows={entries}
            rowKey={(e) => e.id}
            empty="No ad spend entered yet. Add the first one above."
            exportId="settings.spend"
          />
          {entries.length >= limit ? <p className="text-xs text-muted">{`Showing the ${formatCount(limit)} latest entries.`}</p> : null}
        </div>
      </div>
    </AnalyticsSection>
  );
}
