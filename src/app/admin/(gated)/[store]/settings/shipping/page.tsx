import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { deliverySentence, ShippingHubView, type HubPrice } from "@/components/admin/shipping/shipping-hub";
import { fillWords } from "@/lib/admin-fill";
import { formatPriceInput } from "@/lib/product-input";
import { WEIGHT_GRAMS_MAX } from "@/lib/shipping-limits";
import { memberCan, requirePermission } from "@/server/permissions";
import { listLocalAreas } from "@/server/local-delivery";
import { listPickupPlaces } from "@/server/pickup";
import { getShippingSettings } from "@/server/settings";
import { getShippingSetup, shippingWarningsFor } from "@/server/shipping-methods";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { formatMoney } from "@/lib/money";
import { listCarriers } from "@/server/shipping-carriers";
import { adminText } from "@/lib/admin-text";

import { saveShippingAction } from "../../../actions";
import { saveDefaultWeightAction } from "./actions";

export const metadata: Metadata = { title: "Shipping" };

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * The Shipping hub (D237, `docs/wave-3-shipping-methods.md` 2.1; D615): a sentence saying what shoppers pay, the flat rate per country (the
 * default and the fallback) beside what a shopper sees, the other ways to deliver, and a fold for zones, profiles and the default weight.
 */
export default async function ShippingPage({ params }: PageProps<"/admin/[store]/settings/shipping">) {
  const gated = await requirePermission((await params).store, "settings:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const all = adminText(lang, "shipping");
  const canWrite = memberCan(gated, "settings:write");
  const [settings, setup, warnings, places, areas, carriers] = await Promise.all([
    getShippingSettings(store),
    getShippingSetup(store.id),
    shippingWarningsFor(store.id, store.markets.map((m) => m.code)),
    listPickupPlaces(store.id),
    listLocalAreas(store.id),
    listCarriers(store.id),
  ]);
  const base = `/admin/${store.slug}/settings/shipping`;

  const locale = ADMIN_LANG_FACTS[lang].locale;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale, { decimals: "hide_whole" });
  const symbol = (currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  const prices: HubPrice[] = settings.map((rate) => ({
    code: rate.marketCode,
    name: store.markets.find((m) => m.code === rate.marketCode)?.name ?? rate.marketCode,
    price: rate.amountMinor === null ? null : money(rate.amountMinor, rate.currency),
    free: rate.amountMinor === 0,
    freeFrom: rate.freeOverMinor === null ? null : money(rate.freeOverMinor, rate.currency),
  }));
  const sentence = deliverySentence(prices, all.hub);

  const flatRateForm = (
    <ActionForm action={saveShippingAction.bind(null, store.slug)} className="flex flex-col gap-4">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="pb-1.5 pr-3 font-normal text-muted">{all.hub.country}</th>
            <th scope="col" className="pb-1.5 pr-3 font-normal text-muted">{all.hub.price}</th>
            <th scope="col" className="pb-1.5 font-normal text-muted">{all.hub.freeFrom}</th>
          </tr>
        </thead>
        <tbody>
          {settings.map((rate) => {
            const market = store.markets.find((m) => m.code === rate.marketCode)!;
            const unit = symbol(rate.currency);
            return (
              <tr key={rate.marketCode}>
                <th scope="row" className="py-1.5 pr-3 text-body font-normal text-ink">
                  {market.name}
                </th>
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-1.5">
                    <input
                      name={`amount:${rate.marketCode}`}
                      inputMode="decimal"
                      defaultValue={rate.amountMinor === null ? "" : formatPriceInput(rate.amountMinor, rate.currency)}
                      placeholder={all.hub.notSet}
                      aria-label={fillWords(all.hub.priceTo, { market: market.name, currency: rate.currency })}
                      className={input}
                      disabled={!canWrite}
                    />
                    <span aria-hidden className="text-muted">{unit}</span>
                  </span>
                </td>
                <td className="py-1.5">
                  <span className="flex items-center gap-1.5">
                    <input
                      name={`free:${rate.marketCode}`}
                      inputMode="decimal"
                      defaultValue={rate.freeOverMinor === null ? "" : formatPriceInput(rate.freeOverMinor, rate.currency)}
                      placeholder={all.hub.neverFree}
                      aria-label={fillWords(all.hub.freeTo, { market: market.name, currency: rate.currency })}
                      className={input}
                      disabled={!canWrite}
                    />
                    <span aria-hidden className="text-muted">{unit}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canWrite && (
        <div>
          <SubmitButton>{all.hub.saveFlat}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );

  const defaultWeightForm = (
    <ActionForm action={saveDefaultWeightAction.bind(null, store.slug)} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {all.hub.grams}
        <input name="grams" inputMode="numeric" required defaultValue={setup.defaultWeightGrams} min={1} max={WEIGHT_GRAMS_MAX} type="number" className={`${input} max-w-40`} disabled={!canWrite} />
      </label>
      {canWrite && <SubmitButton variant="secondary">{all.hub.saveWeight}</SubmitButton>}
    </ActionForm>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={all.hub.title}
        meta={[
          <span key="sentence">
            <span className="text-ink">{sentence.lead}</span>
            {sentence.rest}
          </span>,
        ]}
      />
      <ShippingHubView
        base={base}
        prices={prices}
        carriers={carriers.filter((c) => c.complete).length}
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
        words={all.hub}
      />
    </div>
  );
}
