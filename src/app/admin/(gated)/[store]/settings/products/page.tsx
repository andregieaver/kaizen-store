import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ProductSettingsForm } from "@/components/admin/product-settings-form";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { PRODUCTS_WORDS } from "@/lib/admin-words/products";
import { memberCan, requirePermission } from "@/server/permissions";
import { getProductSettings } from "@/server/product-settings";

import { saveProductSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Product settings" };

/**
 * The store's product settings (D557): what a product's tile in a content grid shows besides its picture, title and price. Everyone who
 * may read settings sees them; `settings:write` changes them.
 */
export default async function ProductSettingsPage({ params }: PageProps<"/admin/[store]/settings/products">) {
  const member = await requirePermission((await params).store, "settings:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PRODUCTS_WORDS[lang].settings;
  const settings = await getProductSettings(member.store.id);
  return (
    <AdminTextScope texts={areaTexts(lang, { products: PRODUCTS_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={w.intro} />
        <ProductSettingsForm settings={settings} canEdit={memberCan(member, "settings:write")} action={saveProductSettingsAction.bind(null, member.store.slug)} />
      </div>
    </AdminTextScope>
  );
}
