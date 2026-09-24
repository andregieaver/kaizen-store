import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { platformDiscountSummary } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { planCurrencies } from "@/server/billing";
import { listPlatformDiscounts } from "@/server/platform-discounts";
import { platformModes } from "@/server/stripe";

import { createPlatformDiscountAction, setPlatformDiscountActiveAction } from "../actions";

export const metadata: Metadata = { title: "Discounts" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const money = (minor: number, currency: string) => formatMoney(minor, currency, "nb-NO");

/**
 * Kaizen's discount codes for stores' plans (D31). Each is a coupon and a
 * promotion code in Stripe; store owners type it on their Plan page.
 */
export default async function PlatformDiscountsPage() {
  const [discounts, currencies] = await Promise.all([listPlatformDiscounts(), planCurrencies()]);
  const modes = platformModes();

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Discounts</h1>
        <p className="max-w-2xl text-sm text-muted">
          Codes store owners use on their plan: a percentage or an amount off, once, for some months or for good.
          Kaizen puts each in Stripe{modes.length > 0 ? ` (${modes.join(" and ")} mode)` : ""}, which applies it to the
          plan&apos;s invoices. What a code gives cannot change once made; switch it off and make another.
        </p>
      </div>

      {discounts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Code</th>
                <th scope="col" className="px-4 py-2 font-medium">Gives</th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Limits</th>
                <th scope="col" className="px-4 py-2 font-medium">Stores</th>
                <th scope="col" className="px-4 py-2 font-medium">
                  <span className="sr-only">Switch</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <span className="font-mono font-medium">{d.code}</span>
                    <span className="block text-xs text-muted">
                      {d.active ? "On" : "Off"}
                      {d.syncedModes.length > 0 ? ` · in Stripe (${d.syncedModes.join(", ")})` : " · not in Stripe yet"}
                    </span>
                    {d.syncError && <span className="block text-xs text-red-700">{d.syncError}</span>}
                  </td>
                  <td className="px-4 py-2">{platformDiscountSummary(d, money)}</td>
                  <td className="hidden px-4 py-2 md:table-cell">
                    {[d.expiresAt && `until ${d.expiresAt.slice(0, 10)}`, d.maxRedemptions && `${d.maxRedemptions} uses`]
                      .filter(Boolean)
                      .join(" · ") || "None"}
                  </td>
                  <td className="px-4 py-2">{d.stores}</td>
                  <td className="px-4 py-2 text-right">
                    <ActionForm action={setPlatformDiscountActiveAction.bind(null, d.id, !d.active)}>
                      <SubmitButton variant="secondary">{d.active ? "Switch off" : "Switch on"}</SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="new-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="new-heading" className="mb-4 font-medium">
          New code
        </h2>
        <ActionForm action={createPlatformDiscountAction} className="flex flex-col gap-4" replaceOnSuccess>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              Code
              <input name="code" required maxLength={40} autoCapitalize="characters" className={`${control} font-mono uppercase`} />
              <span className="text-xs font-normal text-muted">3–40 letters A–Z, digits, - or _.</span>
            </label>
            <label className={label}>
              Gives
              <select name="kind" defaultValue="percent" className={control}>
                <option value="percent">A percentage off</option>
                <option value="fixed">An amount off</option>
              </select>
            </label>
            <label className={label}>
              Percent off (for a percentage)
              <input name="percent" type="number" min={1} max={100} defaultValue={20} className={control} />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Amount off (for an amount), excluding VAT</legend>
              <div className="flex flex-wrap gap-2">
                {currencies.map((currency) => (
                  <label key={currency} className="flex flex-col gap-1 text-xs">
                    {currency}
                    <input name={`amount_${currency}`} inputMode="decimal" className={`${control} w-28`} />
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={label}>
              How long
              <select name="duration" defaultValue="repeating" className={control}>
                <option value="once">The first payment</option>
                <option value="repeating">Some months</option>
                <option value="forever">Every payment</option>
              </select>
            </label>
            <label className={label}>
              Months (for some months)
              <input name="durationMonths" type="number" min={1} max={36} defaultValue={3} className={control} />
            </label>
            <label className={label}>
              Expires (optional)
              <input name="expiresAt" type="date" className={control} />
            </label>
            <label className={label}>
              Uses in all (optional)
              <input name="maxRedemptions" type="number" min={1} placeholder="No limit" className={control} />
            </label>
          </div>
          <SubmitButton>Make code</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
