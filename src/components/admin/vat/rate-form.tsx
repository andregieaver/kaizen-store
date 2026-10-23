import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { VatCategoryRow } from "@/lib/vat";

import { card, hint, input, label, VAT_EN, type VatWords } from "./styles";

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
  words: w = VAT_EN,
}: {
  /** Exempt has no rate and is left out by the caller; inactive ones can still be given a rate. */
  categories: VatCategoryRow[];
  countries: { code: string; name: string }[];
  country?: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  words?: VatWords;
}) {
  const r = w.rateForm;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section aria-labelledby="set-rate" className={card}>
      <div>
        <h2 id="set-rate" className="text-title text-ink">
          {r.title}
        </h2>
        <p className="text-sm text-muted">{r.text}</p>
      </div>
      <ActionForm action={action} successMessage={r.set} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {country ? (
            <input type="hidden" name="country" value={country} />
          ) : (
            <label className={label}>
              {w.country}
              <select name="country" required defaultValue="" className={input}>
                <option value="" disabled>
                  {w.choose}
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
            {w.category}
            <select name="category" required defaultValue="" className={input}>
              <option value="" disabled>
                {w.choose}
              </option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nameEn}
                  {c.active ? "" : w.off}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            {w.rate} <span className={hint}>{r.rateHint}</span>
            <input name="ratePercent" required inputMode="decimal" autoComplete="off" className={`${input} sm:w-32`} />
          </label>
          <label className={label}>
            {w.from} <span className={hint}>{r.fromHint}</span>
            <input name="validFrom" type="date" required defaultValue={today} className={input} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            {w.source} <span className={hint}>{r.sourceHint}</span>
            <input name="source" required minLength={8} maxLength={400} autoComplete="off" className={input} />
          </label>
          <label className={label}>
            {w.checkedOn}
            <input name="checkedOn" type="date" required defaultValue={today} className={input} />
          </label>
          <label className={label}>
            {w.note}
            <input name="note" maxLength={400} autoComplete="off" className={input} />
          </label>
        </div>
        <div>
          <SubmitButton>{r.button}</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
