import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { isSaleKey } from "@/lib/campaign-offers";
import { mainCurrency } from "@/lib/markets";
import { requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { CampaignForm } from "../campaign-form";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({ params, searchParams }: PageProps<"/admin/[store]/campaigns/new">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store, account } = gated;
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "discounts").campaigns;
  const key = (await searchParams).sale;
  const amount = new Intl.NumberFormat(ADMIN_LANG_FACTS[lang].locale, {
    style: "currency",
    currency: mainCurrency(store),
    maximumFractionDigits: 0,
    currencyDisplay: "narrowSymbol",
  }).format(key === "gift" ? 1000 : 800);
  // Shoppers read the name in the cart and on their order, so it is written in the shop's own language where the admin has it.
  const shopLang: AdminLang = /^(nb|nn|no)\b/.test(store.markets[0]?.locale ?? "") ? "nb" : "en";
  const sale = isSaleKey(key) ? { key, name: fillWords(adminText(shopLang, "discounts").campaigns.sales[key].name, { amount }) } : null;
  return (
    <AdminTextScope texts={adminTexts(lang, ["discounts"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: `/admin/${store.slug}/campaigns`, label: w.title }} title={w.newCampaign} />
        <CampaignForm store={store} campaign={null} sale={sale} />
      </div>
    </AdminTextScope>
  );
}
