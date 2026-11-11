import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireFeature } from "@/components/admin/feature-off";
import { GroupEditor } from "@/components/admin/group-editor";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { memberCan, requirePermission } from "@/server/permissions";
import { groupCandidates, groupOfProduct, isStoreProduct } from "@/server/product-groups";

import { addToGroupAction, leaveGroupAction, renameOptionAction, startGroupAction, updateMemberAction } from "./actions";

export const metadata: Metadata = { title: "Shown together" };

/**
 * A product's combined listing (D566): with none, what it is and one form to start one (what tells them apart and this product's value);
 * with one, its products in order, each value and colour editable, others added from the store's products, any taken out.
 */
export default async function ProductListingPage({ params }: PageProps<"/admin/[store]/products/[productId]/listing">) {
  const { store: slug, productId } = await params;
  const gated = await requirePermission(slug, "products:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  if (!(await isStoreProduct(store.id, productId))) notFound();
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "products").listing;
  const locale = store.localization.locales[0] ?? "en";
  const [group, candidates] = await Promise.all([groupOfProduct(store.id, productId, locale), groupCandidates(store.id, productId, locale)]);
  const mayWrite = memberCan(gated, "products:write");
  return (
    <AdminTextScope texts={adminTexts(lang, ["products"])}>
    <div className="flex flex-col gap-6">
      <Link href={`/admin/${store.slug}/products/${productId}`} className="text-sm text-muted underline underline-offset-2">
        {w.back}
      </Link>
      <PageHeader title={w.title} description={w.intro} />
      <GroupEditor
        group={group}
        candidates={candidates}
        productHref={`/admin/${store.slug}/products`}
        canWrite={mayWrite}
        actions={{
          start: startGroupAction.bind(null, store.slug, productId),
          add: addToGroupAction.bind(null, store.slug, productId),
          update: updateMemberAction.bind(null, store.slug),
          rename: renameOptionAction.bind(null, store.slug, productId),
          leave: leaveGroupAction.bind(null, store.slug),
        }}
      />
    </div>
    </AdminTextScope>
  );
}
