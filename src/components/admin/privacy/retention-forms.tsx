"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import { COUNTS_FROM, PERIOD_UNITS, RETENTION_BASES } from "@/lib/retention";

import { hint, input, label } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/** The form that starts a new period for a kind of data (`commerce.set_retention_rule()`: the old row is closed, never edited). */
export function ChangeRuleForm({ action, today, kinds }: { action: Action; today: string; kinds: { value: string; label: string }[] }) {
  const { retention, common: c } = useAdminText("privacy");
  const f = retention.form;
  return (
    <ActionForm action={action} className="flex flex-col gap-4" successMessage={f.saved}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          {f.kind}
          <select name="kind" required defaultValue="" className={input}>
            <option value="" disabled>
              {f.choose}
            </option>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {f.country} <span className={hint}>{f.countryHint}</span>
          <input name="country" maxLength={2} autoComplete="off" className={`${input} uppercase sm:w-32`} />
        </label>
        <label className={label}>
          {f.keptFor}
          <input name="periodValue" type="number" min={1} step={1} required inputMode="numeric" className={`${input} sm:w-32`} />
        </label>
        <label className={label}>
          {f.unit}
          <select name="periodUnit" required defaultValue="months" className={input}>
            {PERIOD_UNITS.map((u) => (
              <option key={u} value={u}>
                {f.units[u]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {f.countedFrom}
          <select name="countsFrom" required defaultValue="event" className={input}>
            {COUNTS_FROM.map((from) => (
              <option key={from} value={from}>
                {f.counts[from]}
              </option>
            ))}
          </select>
          <span className={hint}>{f.countedHint}</span>
        </label>
        <label className={label}>
          {f.from}
          <input name="validFrom" type="date" required defaultValue={today} className={input} />
          <span className={hint}>{f.fromHint}</span>
        </label>
        <label className={`${label} sm:col-span-2`}>
          {f.source} <span className={hint}>{f.sourceHint}</span>
          <input name="source" required maxLength={600} autoComplete="off" className={input} />
        </label>
        <label className={label}>
          {f.sourceUrl} <span className={hint}>{c.optional}</span>
          <input name="sourceUrl" type="url" maxLength={400} autoComplete="off" className={input} />
        </label>
        <label className={label}>
          {f.basis}
          <select name="basis" required defaultValue="policy" className={input}>
            {RETENTION_BASES.map((b) => (
              <option key={b} value={b}>
                {retention.bases[b]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {f.checkedOn}
          <input name="checkedOn" type="date" required defaultValue={today} className={input} />
        </label>
        <label className={label}>
          {c.note} <span className={hint}>{c.optional}</span>
          <input name="note" maxLength={400} autoComplete="off" className={input} />
        </label>
      </div>
      <div>
        <SubmitButton>{f.start}</SubmitButton>
      </div>
    </ActionForm>
  );
}
