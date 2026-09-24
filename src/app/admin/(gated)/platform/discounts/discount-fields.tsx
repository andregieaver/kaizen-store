import type { PlatformDiscount } from "@/lib/discounts";
import { formatPriceInput } from "@/lib/product-input";

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";

/** What deleting a code asks first. */
export const deleteQuestion = (code: string, stores: number) =>
  `Delete the code ${code}, here and in Stripe? Owners can no longer use it.` +
  (stores > 0 ? ` The ${stores} ${stores === 1 ? "store" : "stores"} with it on their plan keep the discount until it runs out.` : "");

/** `YYYY-MM-DD` of a time, in Norwegian time. */
const osloDate = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date(iso));

/** The fields of one of Kaizen's plan codes, empty for a new one or filled in to edit one (D31). */
export function PlatformDiscountFields({ discount, currencies }: { discount: PlatformDiscount | null; currencies: string[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={label}>
        Code
        <input
          name="code"
          required
          maxLength={40}
          autoCapitalize="characters"
          defaultValue={discount?.code}
          className={`${control} font-mono uppercase`}
        />
        <span className="text-xs font-normal text-muted">3–40 letters A–Z, digits, - or _.</span>
      </label>
      <label className={label}>
        Gives
        <select name="kind" defaultValue={discount?.kind ?? "percent"} className={control}>
          <option value="percent">A percentage off</option>
          <option value="fixed">An amount off</option>
        </select>
      </label>
      <label className={label}>
        Percent off (for a percentage)
        <input
          name="percent"
          type="number"
          min={1}
          max={100}
          defaultValue={discount?.kind === "percent" ? discount.percent : 20}
          className={control}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Amount off (for an amount), excluding VAT</legend>
        <div className="flex flex-wrap gap-2">
          {currencies.map((currency) => {
            const minor = discount?.amounts[currency.toLowerCase()];
            return (
              <label key={currency} className="flex flex-col gap-1 text-xs">
                {currency}
                <input
                  name={`amount_${currency}`}
                  inputMode="decimal"
                  defaultValue={minor ? formatPriceInput(minor, currency) : ""}
                  className={`${control} w-28`}
                />
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className={label}>
        How long
        <select name="duration" defaultValue={discount?.duration ?? "repeating"} className={control}>
          <option value="once">The first payment</option>
          <option value="repeating">Some months</option>
          <option value="forever">Every payment</option>
        </select>
      </label>
      <label className={label}>
        Months (for some months)
        <input name="durationMonths" type="number" min={1} max={36} defaultValue={discount?.durationMonths ?? 3} className={control} />
      </label>
      <label className={label}>
        Expires (optional)
        <input name="expiresAt" type="date" defaultValue={discount?.expiresAt ? osloDate(discount.expiresAt) : ""} className={control} />
      </label>
      <label className={label}>
        Uses in all (optional)
        <input
          name="maxRedemptions"
          type="number"
          min={1}
          placeholder="No limit"
          defaultValue={discount?.maxRedemptions ?? ""}
          className={control}
        />
      </label>
      {discount && (
        <label className="flex items-center gap-3 text-sm font-medium sm:col-span-2">
          <input type="checkbox" name="active" defaultChecked={discount.active} className="size-4" />
          Switched on
        </label>
      )}
    </div>
  );
}
