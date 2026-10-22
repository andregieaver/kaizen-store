import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { TermsManager } from "@/components/admin/terms";
import type { TermSeoSetup } from "@/components/admin/term-seo-fields";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { marketPath, storeHref, storeOrigin } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { requirePermission } from "@/server/permissions";
import { listTerms } from "@/server/taxonomy";
import { categoryGaps } from "@/server/unit-price-gaps";
import { PageHeader } from "@/components/admin/ui";

import { storeLanguages, termFieldsSetup } from "../../fields/data";

import { createProductTermAction, deleteProductTermAction, updateProductTermAction } from "../actions";

export const metadata: Metadata = { title: "Product categories and tags" };

/** The store's product categories and tags (D50): chosen on each product, used in menus and content grids. */
export default async function ProductTermsPage({ params }: PageProps<"/admin/[store]/products/categories">) {
  const gated = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "products").categoriesPage;
  const [terms, fields, gaps] = await Promise.all([
    listTerms({ storeId: store.id, contentType: "product" }),
    termFieldsSetup(store, ADMIN_LANG_FACTS[lang].locale),
    categoryGaps(store.id),
  ]);
  // The search texts (wave 2, D168): the store's languages, the description a page without a text of its own uses, and the address the preview is drawn at.
  const market = store.markets[0];
  const seo: TermSeoSetup = {
    locales: store.localization.locales,
    languageNames: Object.fromEntries(storeLanguages(store).map((l) => [l.locale, l.name])),
    storeName: store.name,
    descriptions: store.seo.description,
    base: `${storeOrigin(store.slug) ? "" : siteUrl()}${market ? storeHref(store.slug, marketPath(store.slug, market.slug)) : `/s/${store.slug}`}`.replace(/\/$/, ""),
  };
  return (
    <AdminTextScope texts={adminTexts(lang, ["products", "fields"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: `/admin/${store.slug}/products`, label: w.back }} title={w.title} description={w.description} />
        <TermsManager
          initial={terms}
          usedBy={w.usedBy}
          fields={fields}
          seo={seo}
          // A category can need a price per kg or litre of its products (unit price, D160); the counts are of active products still without content.
          unitPrice={{ gaps: Object.fromEntries(gaps), needsHref: `/admin/${store.slug}/products?needs=unit-price` }}
          actions={{
            create: createProductTermAction.bind(null, store.slug),
            update: updateProductTermAction.bind(null, store.slug),
            remove: deleteProductTermAction.bind(null, store.slug),
          }}
        />
      </div>
    </AdminTextScope>
  );
}
