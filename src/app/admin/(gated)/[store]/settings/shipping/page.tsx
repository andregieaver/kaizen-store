import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ShippingHubView } from "@/components/admin/shipping/shipping-hub";
import { formatPriceInput } from "@/lib/product-input";
import { WEIGHT_GRAMS_MAX } from "@/lib/shipping-limits";
import { memberCan, requirePermission } from "@/server/permissions";
import { listLocalAreas } from "@/server/local-delivery";
import { listPickupPlaces } from "@/server/pickup";
import { getShippingSettings } from "@/server/settings";
import { getShippingSetup, shippingWarningsFor } from "@/server/shipping-methods";
import { PageHeader } from "@/components/admin/ui";

import { saveShippingAction } from "../../../actions";
import { saveDefaultWeightAction } from "./actions";

export const metadata: Metadata = { title: "Shipping" };

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * The Shipping hub (D237, `docs/wave-3-shipping-methods.md` 2.1): the flat rate per country as before (now the default and the fallback), and cards
 * leading to methods, zones, profiles, pickup, local delivery and the carriers, with the warnings that need a look.
 */
export default async function ShippingPage({ params }: PageProps<"/admin/[store]/settings/shipping">) {
  const gated = await requirePermission((await params).store, "settings:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const canWrite = memberCan(gated, "settings:write");
  const [settings, setup, warnings, places, areas] = await Promise.all([
    getShippingSettings(store),
    getShippingSetup(store.id),
    shippingWarningsFor(store.id, store.markets.map((m) => m.code)),
    listPickupPlaces(store.id),
    listLocalAreas(store.id),
  ]);
  const base = `/admin/${store.slug}/settings/shipping`;

  const flatRateForm = (
    <ActionForm action={saveShippingAction.bind(null, store.slug)} className="flex flex-col gap-4">
      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-4 font-medium">Country</th>
            <th scope="col" className="py-2 pr-4 font-medium">Shipping price</th>
            <th scope="col" className="py-2 font-medium">Free from basket value</th>
          </tr>
        </thead>
        <tbody>
          {settings.map((rate) => {
            const market = store.markets.find((m) => m.code === rate.marketCode)!;
            return (
              <tr key={rate.marketCode} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-4 font-normal">
                  {market.name} <span className="text-muted">({rate.currency})</span>
                </th>
                <td className="py-2 pr-4">
                  <input
                    name={`amount:${rate.marketCode}`}
                    inputMode="decimal"
                    defaultValue={rate.amountMinor === null ? "" : formatPriceInput(rate.amountMinor, rate.currency)}
                    placeholder="Not set"
                    aria-label={`Shipping price to ${market.name}, ${rate.currency}`}
                    className={input}
                    disabled={!canWrite}
                  />
                </td>
                <td className="py-2">
                  <input
                    name={`free:${rate.marketCode}`}
                    inputMode="decimal"
                    defaultValue={rate.freeOverMinor === null ? "" : formatPriceInput(rate.freeOverMinor, rate.currency)}
                    placeholder="Never free"
                    aria-label={`Free shipping to ${market.name} from, ${rate.currency}`}
                    className={input}
                    disabled={!canWrite}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canWrite && (
        <div>
          <SubmitButton>Save flat rates</SubmitButton>
        </div>
      )}
    </ActionForm>
  );

  const defaultWeightForm = (
    <ActionForm action={saveDefaultWeightAction.bind(null, store.slug)} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Grams per unit
        <input name="grams" inputMode="numeric" required defaultValue={setup.defaultWeightGrams} min={1} max={WEIGHT_GRAMS_MAX} type="number" className={`${input} max-w-40`} disabled={!canWrite} />
      </label>
      {canWrite && <SubmitButton variant="secondary">Save weight</SubmitButton>}
    </ActionForm>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shipping"
        description="What delivery costs, country by country: a flat rate, your own methods with zones and profiles, pickup at your places and local delivery by your own drivers. Every price includes VAT."
      />
      <ShippingHubView
        base={base}
        markets={store.markets.map((m) => {
          const methods = setup.methods.filter((x) => x.marketCode === m.code);
          return {
            code: m.code,
            name: m.name,
            currency: m.nativeCurrency,
            methods: methods.length,
            activeMethods: methods.filter((x) => x.active).length,
            zones: setup.zones.filter((z) => z.marketCode === m.code).length,
            hasFlat: setup.flatMarkets.includes(m.code),
          };
        })}
        profiles={setup.profiles.length}
        profiledProducts={setup.profiles.reduce((n, p) => n + p.products, 0)}
        defaultWeightGrams={setup.defaultWeightGrams}
        pickup={{ places: places.length, active: places.filter((p) => p.option?.active).length }}
        local={{ areas: areas.length, active: areas.filter((a) => a.active).length }}
        warnings={warnings}
        flatRateForm={flatRateForm}
        defaultWeightForm={defaultWeightForm}
      />
    </div>
  );
}
