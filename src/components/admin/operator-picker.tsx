"use client";

import { useAdminText } from "@/components/admin/admin-text";
import type { CountryOption } from "@/lib/iso-countries";
import type { OperatorChoice } from "@/lib/product-input";
import type { Operator } from "@/server/products";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";

/**
 * A product-safety company (GPSR Art. 19): one of the store's, none, or a new one with its address. The product editor's, and *Who makes
 * your products?* on Moving in (D445 step 6), which can open it with a new company already begun (`initial`) and without the *none* choice.
 */
export function OperatorPicker({
  legend,
  note,
  choice,
  operators,
  countries,
  onChange,
  required = false,
}: {
  legend: string;
  note?: string;
  /** Without the *none* choice. */
  required?: boolean;
  choice: OperatorChoice;
  operators: Operator[];
  countries: CountryOption[];
  onChange: (choice: OperatorChoice) => void;
}) {
  const w = useAdminText("product").safety;
  const value = choice === null ? "" : "id" in choice ? choice.id : "new";
  const blank = { name: "", postalAddress: "", electronicAddress: "", country: "" };
  const fresh = choice && "new" in choice ? choice.new : null;
  const setNew = (change: Partial<typeof blank>) => onChange({ new: { ...(fresh ?? blank), ...change } });

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {note && <p className="text-xs text-muted">{note}</p>}
      <select
        value={value}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "new" ? { new: blank } : { id: e.target.value })
        }
        aria-label={legend}
        className={input}
      >
        {!required && <option value="">{w.none}</option>}
        {operators.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.country})
          </option>
        ))}
        <option value="new">{w.addCompany}</option>
      </select>
      {fresh && (
        <div className="flex flex-col gap-3 rounded-md border border-line p-3">
          <label className={label}>
            {w.companyName}
            <input value={fresh.name} onChange={(e) => setNew({ name: e.target.value })} className={input} />
          </label>
          <label className={label}>
            {w.postalAddress}
            <textarea
              value={fresh.postalAddress}
              onChange={(e) => setNew({ postalAddress: e.target.value })}
              rows={2}
              className={`${input} py-2`}
            />
          </label>
          <label className={label}>
            {w.electronic}
            <input
              value={fresh.electronicAddress}
              onChange={(e) => setNew({ electronicAddress: e.target.value })}
              className={input}
            />
          </label>
          <label className={label}>
            {w.country}
            <select value={fresh.country} onChange={(e) => setNew({ country: e.target.value })} className={input}>
              <option value="">{w.choose}</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </fieldset>
  );
}
