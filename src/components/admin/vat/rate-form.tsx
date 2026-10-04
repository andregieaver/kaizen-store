import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { VatCategoryRow } from "@/lib/vat";

import { card, hint, input, label } from "./styles";

/**
 * Sets a country's rate for a category from a date (`commerce.set_vat_rate()`): the old period ends the day the new one begins and
 * nothing is edited in place. The rate starts unverified. It applies to new carts and orders from its date, never to a placed order.
 * With `country` fixed the form is the country's own page's.
 */
export function RateForm({
  categories,
  countries,
  country,
  action,
}: {
  /** Exempt has no rate and is left out by the caller; inactive ones can still be given a rate. */
  categories: VatCategoryRow[];
  countries: { code: string; name: string }[];
  country?: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section aria-labelledby="set-rate" className={card}>
      <div>
        <h2 id="set-rate" className="font-medium">
          Set a rate
        </h2>
        <p className="text-sm text-muted">
          The old rate ends the day the new one begins. A date in the future is a scheduled change. The new rate counts as unverified until a person marks it verified, and it applies to new
          carts and orders only: a placed order keeps the rate it was charged.
        </p>
      </div>
      <ActionForm action={action} successMessage="The rate is set. It starts unverified." className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {country ? (
            <input type="hidden" name="country" value={country} />
          ) : (
            <label className={label}>
              Country
              <select name="country" required defaultValue="" className={input}>
                <option value="" disabled>
                  Choose …
                </option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={label}>
            Category
            <select name="category" required defaultValue="" className={input}>
              <option value="" disabled>
                Choose …
              </option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nameEn}
                  {c.active ? "" : " (off)"}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Rate <span className={hint}>(percent, such as 15 or 25.5)</span>
            <input name="ratePercent" required inputMode="decimal" autoComplete="off" className={`${input} sm:w-32`} />
          </label>
          <label className={label}>
            From <span className={hint}>(the first day the rate applies, in the country&apos;s own time)</span>
            <input name="validFrom" type="date" required defaultValue={today} className={input} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Source <span className={hint}>(the web address of the page, or the act, the rate was read from)</span>
            <input name="source" required minLength={8} maxLength={400} autoComplete="off" className={input} />
          </label>
          <label className={label}>
            Checked on
            <input name="checkedOn" type="date" required defaultValue={today} className={input} />
          </label>
          <label className={label}>
            Note
            <input name="note" maxLength={400} autoComplete="off" className={input} />
          </label>
        </div>
        <div>
          <SubmitButton>Set the rate</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
