import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatPriceInput } from "@/lib/product-input";
import { requireMember } from "@/server/auth";
import { getShippingSettings } from "@/server/settings";

import { saveShippingAction } from "../../../actions";

export const metadata: Metadata = { title: "Shipping" };

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

export default async function ShippingPage({ params }: PageProps<"/admin/[store]/settings/shipping">) {
  const { store } = await requireMember((await params).store);
  const settings = await getShippingSettings(store);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Shipping</h1>
        <p className="text-sm text-muted">
          One flat price per country, including VAT, shown in the cart and at checkout. Leave
          &quot;free from&quot; empty to always charge shipping. Shoppers cannot check out to a
          country without a shipping price.
        </p>
      </div>
      <ActionForm action={saveShippingAction.bind(null, store.slug)} className="flex flex-col gap-4">
        <table className="w-full max-w-2xl rounded-lg border border-border bg-background text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 font-medium">Country</th>
              <th scope="col" className="px-4 py-2 font-medium">Shipping price</th>
              <th scope="col" className="px-4 py-2 font-medium">Free from basket value</th>
            </tr>
          </thead>
          <tbody>
            {settings.map((rate) => {
              const market = store.markets.find((m) => m.code === rate.marketCode)!;
              return (
                <tr key={rate.marketCode} className="border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-2 font-normal">
                    {market.name} <span className="text-muted">({rate.currency})</span>
                  </th>
                  <td className="px-4 py-2">
                    <input
                      name={`amount:${rate.marketCode}`}
                      inputMode="decimal"
                      defaultValue={rate.amountMinor === null ? "" : formatPriceInput(rate.amountMinor, rate.currency)}
                      placeholder="Not set"
                      aria-label={`Shipping price to ${market.name}, ${rate.currency}`}
                      className={input}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      name={`free:${rate.marketCode}`}
                      inputMode="decimal"
                      defaultValue={rate.freeOverMinor === null ? "" : formatPriceInput(rate.freeOverMinor, rate.currency)}
                      placeholder="Never free"
                      aria-label={`Free shipping to ${market.name} from, ${rate.currency}`}
                      className={input}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div>
          <SubmitButton>Save shipping</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
