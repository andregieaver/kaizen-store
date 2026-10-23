import type { PlatformDiscount } from "@/lib/discounts";
import { formatPriceInput } from "@/lib/product-input";
import { countWords, fillWords } from "@/lib/admin-fill";
import { platformEn, type PlatformMessages } from "@/lib/admin-messages/platform.en";

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";

/** What deleting a code asks first. */
export const deleteQuestion = (code: string, stores: number, w: PlatformMessages["discounts"] = platformEn.discounts) =>
  fillWords(w.deleteQuestion, { code }) + (stores > 0 ? countWords(stores, w.deleteKeep) : "");

/** `YYYY-MM-DD` of a time, in Norwegian time. */
const osloDate = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date(iso));

/** The fields of one of Kaizen's plan codes, empty for a new one or filled in to edit one (D31). */
export function PlatformDiscountFields({
  discount,
  currencies,
  w = platformEn.discountFields,
}: {
  discount: PlatformDiscount | null;
  currencies: string[];
  w?: PlatformMessages["discountFields"];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={label}>
        {w.code}
        <input
          name="code"
          required
          maxLength={40}
          autoCapitalize="characters"
          defaultValue={discount?.code}
          className={`${control} font-mono uppercase`}
        />
        <span className="text-xs font-normal text-muted">{w.codeHint}</span>
      </label>
      <label className={label}>
        {w.gives}
        <select name="kind" defaultValue={discount?.kind ?? "percent"} className={control}>
          <option value="percent">{w.percent}</option>
          <option value="fixed">{w.fixed}</option>
        </select>
      </label>
      <label className={label}>
        {w.percentOff}
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
        <legend className="mb-1 text-sm font-medium">{w.amountOff}</legend>
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
        {w.howLong}
        <select name="duration" defaultValue={discount?.duration ?? "repeating"} className={control}>
          <option value="once">{w.once}</option>
          <option value="repeating">{w.repeating}</option>
          <option value="forever">{w.forever}</option>
        </select>
      </label>
      <label className={label}>
        {w.months}
        <input name="durationMonths" type="number" min={1} max={36} defaultValue={discount?.durationMonths ?? 3} className={control} />
      </label>
      <label className={label}>
        {w.expires}
        <input name="expiresAt" type="date" defaultValue={discount?.expiresAt ? osloDate(discount.expiresAt) : ""} className={control} />
      </label>
      <label className={label}>
        {w.uses}
        <input
          name="maxRedemptions"
          type="number"
          min={1}
          placeholder={w.noLimit}
          defaultValue={discount?.maxRedemptions ?? ""}
          className={control}
        />
      </label>
      {discount && (
        <label className="flex items-center gap-3 text-sm font-medium sm:col-span-2">
          <input type="checkbox" name="active" defaultChecked={discount.active} className="size-4" />
          {w.on}
        </label>
      )}
    </div>
  );
}
