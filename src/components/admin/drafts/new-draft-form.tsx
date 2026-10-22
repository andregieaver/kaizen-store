"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { field, hint } from "@/components/admin/data/ui";
import { draftMarketSlug, type DraftMarketOptions } from "@/lib/draft-markets";
import { useAdminText } from "@/components/admin/admin-text";

/**
 * Where a draft starts (wave 3, D173, `docs/wave-3-orders.md` 2.4): the market, because it decides the prices, the currency and the VAT country. A country the store sells to, shown in a language
 * and a currency the store offers; the address shown (`no-en-eur`) is what the server resolves again. The form works without a script for the country's own language and currency.
 */
export function NewDraftForm({ options, action, defaultCountry }: { options: DraftMarketOptions; action: (state: FormState, form: FormData) => Promise<FormState>; defaultCountry: string }) {
  const w = useAdminText("drafts").newForm;
  const first = options.countries.find((c) => c.code === defaultCountry) ?? options.countries[0];
  const [country, setCountry] = useState(first?.code ?? "");
  const current = options.countries.find((c) => c.code === country) ?? first;
  const [lang, setLang] = useState(current?.ownLang ?? "");
  const [currency, setCurrency] = useState(current?.ownCurrency ?? "");
  const choices = current?.currencies ?? [];
  const slug = current ? draftMarketSlug(options, { country, lang, currency }) : null;

  if (!current) {
    return <p className="rounded-panel bg-sunken p-4 text-sm">{w.noMarket}</p>;
  }
  return (
    <ActionForm action={action} className="flex max-w-xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.country}
          <select
            name="country"
            value={country}
            onChange={(event) => {
              const next = options.countries.find((c) => c.code === event.target.value)!;
              setCountry(next.code);
              setLang(next.ownLang);
              setCurrency(next.ownCurrency);
            }}
            className={field}
          >
            {options.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.language}
          <select name="lang" value={lang} onChange={(event) => setLang(event.target.value)} className={field}>
            {current.languages.map((l) => (
              <option key={l.lang} value={l.lang}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.currency}
          <select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className={field}>
            {choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={hint}>
        {w.hint} {slug ? <>{w.address} <span className="font-mono">/{slug}</span>.</> : null}
      </p>
      <div>
        <SubmitButton>{w.start}</SubmitButton>
      </div>
    </ActionForm>
  );
}
