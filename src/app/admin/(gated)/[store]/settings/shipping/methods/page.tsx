import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { MethodsListView } from "@/components/admin/shipping/methods-list";
import { chosenMarket, MarketTabs } from "@/components/admin/shipping/shipping-parts";
import { PageHeader } from "@/components/admin/ui";
import { memberCan, requirePermission } from "@/server/permissions";
import { getShippingSetup } from "@/server/shipping-methods";

import { moveShippingAction } from "../actions";

export const metadata: Metadata = { title: "Shipping methods" };

/** One country's shipping methods (D237 2.1): add, open, reorder; a method's rates are on its own page. */
export default async function ShippingMethodsPage({ params, searchParams }: PageProps<"/admin/[store]/settings/shipping/methods">) {
  const gated = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const market = chosenMarket(store.markets, (await searchParams).market);
  const base = `/admin/${store.slug}/settings/shipping`;
  const setup = await getShippingSetup(store.id);
  const methods = market ? setup.methods.filter((m) => m.marketCode === market.code) : [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: "Shipping" }}
        title="Shipping methods"
        description="Each country's own ways of shipping, priced per zone and profile. When two methods cost the same, the one higher here is shown first."
      />
      {market && (
        <>
          <MarketTabs href={(code) => `${base}/methods?market=${code}`} markets={store.markets} current={market.code} />
          <MethodsListView
            base={base}
            market={{ code: market.code, name: market.name, currency: market.nativeCurrency }}
            methods={methods}
            canWrite={memberCan(gated, "settings:write")}
            move={(id, direction) => moveShippingAction.bind(null, store.slug, "methods", market.code, id, direction)}
          />
        </>
      )}
    </div>
  );
}
