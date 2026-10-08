import type { ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";

type CountryOption = { code: string; name: string; currency: string };

/**
 * The countries a store sells to (D178), as the setup wizard and the Countries settings ask them: any number while Several countries is on,
 * else the one country the store sells in. Saved by `setMarkets()`, which keeps a country's prices and settings when it leaves the list.
 */
export function CountriesForm({
  action,
  countries,
  chosen,
  several,
  submitLabel,
  disabled = false,
  note,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  countries: readonly CountryOption[];
  /** The store's countries now (its active markets), its own first. */
  chosen: readonly string[];
  /** Several countries is on: any number; else one. */
  several: boolean;
  submitLabel: string;
  /** Read-only, for a member who may not change it. */
  disabled?: boolean;
  note?: ReactNode;
}) {
  const on = new Set(several ? chosen : chosen.slice(0, 1));
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      <fieldset disabled={disabled}>
        <legend className="mb-3 text-sm font-medium">{several ? "Countries you sell to" : "The country you sell in"}</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {countries.map((country) => (
            <li key={country.code}>
              <label className="flex min-h-10 items-center gap-3 rounded-md border border-border px-3 text-sm has-[:checked]:border-foreground">
                <input type={several ? "checkbox" : "radio"} name="country" value={country.code} defaultChecked={on.has(country.code)} className="size-4" />
                <span className="flex-1">{country.name}</span>
                <span className="text-muted">{country.currency}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {note}
      {!disabled && (
        <div>
          <SubmitButton>{submitLabel}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
