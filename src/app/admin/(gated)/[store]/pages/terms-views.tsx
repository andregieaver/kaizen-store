import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { AdminTextScope } from "@/components/admin/admin-text";
import { TermsManager } from "@/components/admin/terms";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { termContentOf, type PageType } from "@/lib/page-content";
import { requirePageTypeAccess } from "@/server/permissions";
import { listTerms } from "@/server/taxonomy";

import { termFieldsSetup } from "../fields/data";
import { createStorePageTermAction, deleteStorePageTermAction, updateStorePageTermAction } from "./actions";
import { storePagesBase } from "./context";

type StoreParams = Promise<{ store: string }>;

/** A store's page or article categories and tags (D50, D53, D57): chosen in the editor, shown by content grids. */
export async function StorePageTermsView({ type, params }: { type: PageType; params: StoreParams }) {
  const gated = await requirePageTypeAccess((await params).store, type, "read");
  // Product layouts are part of the online shop (D178 step 5): hidden while it is off.
  const shopOff = type === "product_layout" ? requireFeature(gated, "shop") : null;
  if (shopOff) return shopOff;
  const { store, account } = gated;
  const tw = adminText(adminLangOf(account.adminLocale), "website").storePages.types[type];
  const [terms, fields] = await Promise.all([listTerms({ storeId: store.id, contentType: termContentOf(type) }), termFieldsSetup(store)]);
  return (
    // The categories manager's words are the products' (it is the same manager as theirs).
    <AdminTextScope texts={adminTexts(adminLangOf(account.adminLocale), ["products"])}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={storePagesBase(store, type)} className="w-fit text-sm underline">
          {tw.list}
        </Link>
        <PageHeader title={tw.termsTitle} description={tw.terms} />
        </div>
      <TermsManager
        initial={terms}
        usedBy={tw.many}
        fields={fields}
        actions={{
          create: createStorePageTermAction.bind(null, store.slug, type),
          update: updateStorePageTermAction.bind(null, store.slug, type),
          remove: deleteStorePageTermAction.bind(null, store.slug, type),
        }}
      />
    </div>
    </AdminTextScope>
  );
}
