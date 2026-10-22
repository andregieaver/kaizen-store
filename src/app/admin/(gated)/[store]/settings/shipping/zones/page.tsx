import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { chosenMarket, MarketTabs } from "@/components/admin/shipping/shipping-parts";
import { ZonesView } from "@/components/admin/shipping/zones-view";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf, ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { memberCan, requirePermission } from "@/server/permissions";
import { getShippingSetup } from "@/server/shipping-methods";

import { checkZoneCodeAction, deleteZoneAction, saveZoneAction } from "../actions";

export const metadata: Metadata = { title: "Shipping zones" };

/** One country's zones of postal codes (D237 2.1). */
export default async function ShippingZonesPage({ params, searchParams }: PageProps<"/admin/[store]/settings/shipping/zones">) {
  const gated = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const all = adminText(lang, "shipping");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const market = chosenMarket(store.markets, (await searchParams).market);
  const base = `/admin/${store.slug}/settings/shipping`;
  const setup = await getShippingSetup(store.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: all.pages.back }}
        title={all.pages.zonesTitle}
        description={all.pages.zonesDescription}
      />
      {market && (
        <>
          <MarketTabs href={(code) => `${base}/zones?market=${code}`} markets={store.markets} current={market.code} label={all.countries} />
          <ZonesView
            market={{ code: market.code, name: market.name }}
            zones={setup.zones.filter((z) => z.marketCode === market.code)}
            canWrite={memberCan(gated, "settings:write")}
            words={all.zones}
            locale={locale}
            save={(zoneId) => saveZoneAction.bind(null, store.slug, zoneId, market.code)}
            remove={(zoneId) => deleteZoneAction.bind(null, store.slug, zoneId)}
            check={memberCan(gated, "settings:write") ? checkZoneCodeAction.bind(null, store.slug, market.code) : null}
          />
        </>
      )}
    </div>
  );
}
