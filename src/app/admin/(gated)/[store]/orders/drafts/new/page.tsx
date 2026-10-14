import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { NewDraftForm } from "@/components/admin/drafts/new-draft-form";
import { draftMarketOptions } from "@/lib/draft-markets";
import { memberCan, requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { createDraftAction } from "../actions";

export const metadata: Metadata = { title: "New draft order" };

/** Starts a draft order: choose the market (country, language, currency) it is priced in, then fill it in (wave 3, D173). `orders:read` opens the page; making the draft needs `orders:write`, which the action checks too. */
export default async function NewDraftPage({ params }: PageProps<"/admin/[store]/orders/drafts/new">) {
  const member = await requirePermission((await params).store, "orders:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const options = draftMarketOptions(store.markets, store.localization);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/orders/drafts`, label: "Draft orders" }}
        title="New draft order"
        description={<>Choose where the order is for first: it decides the currency, the prices, the VAT and the shipping rate.</>}
      />
      {memberCan(member, "orders:write") ? (
        <NewDraftForm options={options} action={createDraftAction.bind(null, store.slug)} defaultCountry={store.markets[0]?.code ?? ""} />
      ) : (
        <p className="rounded-panel bg-sunken p-4 text-sm">You can look at draft orders but not make one: that needs the right to change orders.</p>
      )}
    </div>
  );
}
