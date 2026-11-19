import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { PageSignalsStrip } from "@/components/admin/page-signals-strip";
import { ProductEditor } from "@/components/admin/product-editor";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { signalPlan } from "@/lib/page-signals";
import { editorOptions } from "@/lib/variant-grid";
import { memberCan, requirePermission } from "@/server/permissions";
import { fieldsForEditor } from "@/server/custom-fields";
import { getEditorContext, getProductForEdit } from "@/server/products";

import { archiveProductAction } from "../actions";
import { editorProps } from "../editor-props";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/admin/[store]/products/[productId]">) {
  const { store: slug, productId } = await params;
  const gated = await requirePermission(slug, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  if (!z.uuid().safeParse(productId).success) notFound();
  const context = await getEditorContext(store);
  const product = await getProductForEdit(store, context, productId);
  if (!product) notFound();
  const { archived, ...stored } = product;
  const initial = { ...stored, options: editorOptions(stored.options, stored.variants) };
  const fields = await fieldsForEditor(store.id, "product", productId);
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "product").page;
  // How it performs (ecosystem plan E2.3, D713), for those who may read the analytics: streamed after the editor, never in its way.
  const insight = memberCan(gated, "analytics:read") ? (
    <Suspense fallback={null}>
      <PageSignalsStrip
        store={store}
        target={{ ...signalPlan({ type: "product", handle: stored.handle }, store.allMarkets.map((m) => m.code)), productId }}
        what="product"
        name={stored.translations.find((t) => t.locale === context.primaryLocale)?.title || stored.handle}
        lang={lang}
        owner={memberCan(gated, "owner")}
        tests={memberCan(gated, "marketing:read")}
      />
    </Suspense>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      {archived && (
        <p role="status" className="rounded-md border border-line bg-card p-3 text-sm">
          {w.archived}
        </p>
      )}
      <AdminTextScope texts={adminTexts(lang, ["product", "products", "fields", "builderText", "websitePick"])}>
        <ProductEditor {...(await editorProps(store, context, lang))} productId={productId} initial={initial} fields={fields} insight={insight} />
      </AdminTextScope>
      <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href={`/admin/${store.slug}/products/${productId}/listing`} className="underline underline-offset-2">
          {adminText(lang, "products").listing.link}
        </Link>
        <Link href={`/admin/${store.slug}/products/${productId}/passport`} className="underline underline-offset-2">
          {adminText(lang, "products").passport.link}
        </Link>
      </p>
      <form
        action={archiveProductAction.bind(null, store.slug, productId, !archived)}
        className="border-t border-line pt-4"
      >
        <button type="submit" className="text-sm underline">
          {archived ? w.restore : w.archive}
        </button>
        {!archived && (
          <span className="ml-2 text-sm text-muted">{w.archiveHint}</span>
        )}
      </form>
    </div>
  );
}
