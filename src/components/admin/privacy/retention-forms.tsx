"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { COUNTS_FROM, PERIOD_UNITS, RETENTION_BASES } from "@/lib/retention";

import { hint, input, label } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const BASIS_OPTIONS: Record<string, string> = {
  read: "Read at the source",
  snippet: "Seen in a search result only",
  secondary: "From a secondary source",
  fallback: "Safe fallback, not read",
  policy: "Kaizen's own choice",
};

/** The form that starts a new period for a kind of data (`commerce.set_retention_rule()`: the old row is closed, never edited). */
export function ChangeRuleForm({ action, today, kinds }: { action: Action; today: string; kinds: { value: string; label: string }[] }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4" successMessage="The new period is saved.">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Kind of data
          <select name="kind" required defaultValue="" className={input}>
            <option value="" disabled>
              Choose
            </option>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Country <span className={hint}>(two letters, empty for every other country)</span>
          <input name="country" maxLength={2} autoComplete="off" className={`${input} uppercase sm:w-32`} />
        </label>
        <label className={label}>
          Kept for
          <input name="periodValue" type="number" min={1} step={1} required inputMode="numeric" className={`${input} sm:w-32`} />
        </label>
        <label className={label}>
          Unit
          <select name="periodUnit" required defaultValue="months" className={input}>
            {PERIOD_UNITS.map((u) => (
              <option key={u} value={u}>
                {u === "days" ? "Days" : "Months"}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Counted from
          <select name="countsFrom" required defaultValue="event" className={input}>
            {COUNTS_FROM.map((c) => (
              <option key={c} value={c}>
                {c === "event" ? "The event (a sale, a message)" : "The end of the calendar year (bookkeeping)"}
              </option>
            ))}
          </select>
          <span className={hint}>From the end of the year needs whole years in months (60, 84, 120).</span>
        </label>
        <label className={label}>
          From
          <input name="validFrom" type="date" required defaultValue={today} className={input} />
          <span className={hint}>The first day the new period applies. It must be after the latest one.</span>
        </label>
        <label className={`${label} sm:col-span-2`}>
          Source <span className={hint}>(the act and section, or why Kaizen chose it)</span>
          <input name="source" required maxLength={600} autoComplete="off" className={input} />
        </label>
        <label className={label}>
          Source address <span className={hint}>(optional)</span>
          <input name="sourceUrl" type="url" maxLength={400} autoComplete="off" className={input} />
        </label>
        <label className={label}>
          How much was read
          <select name="basis" required defaultValue="policy" className={input}>
            {RETENTION_BASES.map((b) => (
              <option key={b} value={b}>
                {BASIS_OPTIONS[b]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Checked on
          <input name="checkedOn" type="date" required defaultValue={today} className={input} />
        </label>
        <label className={label}>
          Note <span className={hint}>(optional)</span>
          <input name="note" maxLength={400} autoComplete="off" className={input} />
        </label>
      </div>
      <div>
        <SubmitButton>Start the new period</SubmitButton>
      </div>
    </ActionForm>
  );
}
