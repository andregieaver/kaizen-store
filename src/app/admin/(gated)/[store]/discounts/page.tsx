import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DiscountTabs } from "@/components/admin/discount-tabs";
import { adminLangOf } from "@/lib/admin-lang";
import { discountTab } from "@/lib/discount-tabs";
import { areaTexts } from "@/lib/admin-area";
import { DISCOUNTS_WORDS } from "@/lib/admin-words/discounts";
import { requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { automaticTab } from "../campaigns/automatic-tab";
import { codesTab } from "./codes-tab";

export const metadata: Metadata = { title: "Discounts" };

/**
 * The store's discounts as one page (ecosystem plan E3.7, D718; code review step 2.4): Codes, the codes shoppers type at checkout (D31,
 * the old Coupons page at this address), and Automatic (`?tab=automatic`), the offers without a code (D114, the old Campaigns page, whose
 * address leads here). Each tab keeps its own list, ready offers and actions; the header says the tab's sentence and its Write your own.
 */
export default async function DiscountsPage({ params, searchParams }: PageProps<"/admin/[store]/discounts">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store, account } = gated;
  const lang = adminLangOf(account.adminLocale);
  const w = DISCOUNTS_WORDS[lang].page;
  const tab = discountTab((await searchParams).tab);
  const shown = tab === "automatic" ? await automaticTab(store, lang) : await codesTab(store, lang);

  return (
    <AdminTextScope texts={areaTexts(lang, { discounts: DISCOUNTS_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} meta={[shown.lead]} actions={shown.action} />
        <DiscountTabs storeSlug={store.slug} current={tab} words={w.tabs} />
        {shown.body}
      </div>
    </AdminTextScope>
  );
}
