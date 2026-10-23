import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { formatPriceInput } from "@/lib/product-input";
import { type ThemePrice, type ThemePurchaseStatus } from "@/lib/theme-prices";

import { countWords, fillWords } from "@/lib/admin-fill";
import { platformSiteEn, type PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";

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
  w = platformSiteEn,
}: {
  presetId: string;
  title: string;
  prices: ThemePrice[];
  currencies: string[];
  counts: Record<ThemePurchaseStatus, number>;
  stuck: { store: string; problem: string; tries: number }[];
  w?: PlatformSiteMessages;
}) {
  const p = w.price;
  const premium = prices.length > 0;
  const amount = (currency: string) => {
    const price = prices.find((p) => p.currency === currency);
    return price ? formatPriceInput(price.amountMinor, currency) : "";
  };
  const standing = (["paid", "invoiced", "due", "owed", "granted", "void"] as const).filter((status) => counts[status] > 0);
  return (
    <Card
      title={p.title}
      description={p.description}
    >
      <ActionForm action={saveThemePricesAction.bind(null, presetId)} className="group flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="sr-only">{fillWords(p.legend, { title })}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="pricing" value="free" defaultChecked={!premium} className="size-4" />
            {p.free}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="pricing" value="premium" defaultChecked={premium} className="size-4" />
            {p.premium}
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-3 text-sm group-has-[input[value=free]:checked]:hidden">
          <legend className="mb-1 font-medium">
            {p.amount} <span className="font-normal text-muted">{p.amountHint}</span>
          </legend>
          <div className="flex flex-wrap gap-4">
            {currencies.map((currency) => (
              <label key={currency} className="flex flex-col gap-1 font-medium">
                {currency}
                <input name={`price:${currency}`} inputMode="decimal" defaultValue={amount(currency)} className={control} />
              </label>
            ))}
          </div>
          <p className="text-muted">{p.billed}</p>
        </fieldset>
        <div>
          <SubmitButton variant="secondary">{p.save}</SubmitButton>
        </div>
      </ActionForm>
      {standing.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {standing.map((status) => `${w.tables.purchases[status]}: ${counts[status]}`).join(" · ")}
        </p>
      )}
      {stuck.length > 0 && (
        <div className="mt-4 rounded-panel border border-warning-line bg-warning-soft p-3 text-sm text-warning-text">
          <p className="text-body-strong">{p.stuck}</p>
          <ul className="mt-1 list-disc pl-5">
            {stuck.map((row, index) => (
              <li key={index}>
                {row.store}: {row.problem} ({countWords(row.tries, p.tries)}; {p.triedAgain})
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
