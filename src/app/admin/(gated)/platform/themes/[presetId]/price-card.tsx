import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { formatPriceInput } from "@/lib/product-input";
import { PURCHASE_STATUS_WORDS, type ThemePrice, type ThemePurchaseStatus } from "@/lib/theme-prices";

import { saveThemePricesAction } from "../actions";

const control = "min-h-10 w-40 rounded-md border border-line bg-card px-3 font-normal";

/**
 * A theme's price on its page (D286): Free, or Premium with a price in every currency stores are billed in, without VAT, paid once per store
 * when the theme goes live on an open store. Saved at once, not as a draft. Under it, how many stores have it and how, and any store whose
 * invoice could not be made yet.
 */
export function ThemePriceCard({
  presetId,
  title,
  prices,
  currencies,
  counts,
  stuck,
}: {
  presetId: string;
  title: string;
  prices: ThemePrice[];
  currencies: string[];
  counts: Record<ThemePurchaseStatus, number>;
  stuck: { store: string; problem: string; tries: number }[];
}) {
  const premium = prices.length > 0;
  const amount = (currency: string) => {
    const price = prices.find((p) => p.currency === currency);
    return price ? formatPriceInput(price.amountMinor, currency) : "";
  };
  const standing = (["paid", "invoiced", "due", "owed", "granted", "void"] as const).filter((status) => counts[status] > 0);
  return (
    <Card
      title="Price"
      description="Free, or Premium: a store pays once, without VAT, when the theme goes live on it and the store is open (one chosen before it opens is paid when it opens). Trying it and adding it to a store's theme library are free. Once paid, the store keeps it with every preset and update. Saved at once."
    >
      <ActionForm action={saveThemePricesAction.bind(null, presetId)} className="group flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="sr-only">Price of {title}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="pricing" value="free" defaultChecked={!premium} className="size-4" />
            Free
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="pricing" value="premium" defaultChecked={premium} className="size-4" />
            Premium
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-3 text-sm group-has-[input[value=free]:checked]:hidden">
          <legend className="mb-1 font-medium">
            The price, once per store <span className="font-normal text-muted">(without VAT; Norwegian stores pay 25 % MVA on top, as on their plan)</span>
          </legend>
          <div className="flex flex-wrap gap-4">
            {currencies.map((currency) => (
              <label key={currency} className="flex flex-col gap-1 font-medium">
                {currency}
                <input name={`price:${currency}`} inputMode="decimal" defaultValue={amount(currency)} className={control} />
              </label>
            ))}
          </div>
          <p className="text-muted">A store is billed in its plan&apos;s currency, else its own country&apos;s. Stores that have the theme when it gets its first price keep it free.</p>
        </fieldset>
        <div>
          <SubmitButton variant="secondary">Save the price</SubmitButton>
        </div>
      </ActionForm>
      {standing.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {standing.map((status) => `${PURCHASE_STATUS_WORDS[status].words}: ${counts[status]}`).join(" · ")}
        </p>
      )}
      {stuck.length > 0 && (
        <div className="mt-4 rounded-panel border border-warning-line bg-warning-soft p-3 text-sm text-warning-text">
          <p className="text-body-strong">Not invoiced yet</p>
          <ul className="mt-1 list-disc pl-5">
            {stuck.map((row, index) => (
              <li key={index}>
                {row.store}: {row.problem} ({row.tries} {row.tries === 1 ? "try" : "tries"}; tried again by itself)
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
