import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ProductsTable, type BulkTools } from "@/components/admin/products-bulk";
import { NeedsContentList, NeedsContentNotice } from "@/components/admin/unit-price-gaps-view";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { ACTIVE_IMPORT_STATUSES } from "@/lib/data-job";
import { listJobs } from "@/server/data-jobs";
import { memberCan, requirePermission } from "@/server/permissions";
import { getEditorContext, listAdminProducts } from "@/server/products";
import { productsNeedingMeasure } from "@/server/unit-price-gaps";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { continueBulkAction, matchingAction, previewBulkAction, startBulkAction, undoBatchAction } from "./bulk/actions";

export const metadata: Metadata = { title: "Products" };

type Props = PageProps<"/admin/[store]/products">;

export default async function ProductsPage({ params, searchParams }: Props) {
  const member = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const canWrite = memberCan(member, "products:write");
  const w = adminText(adminLangOf(member.account.adminLocale), "products").list;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={w.title} />
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/${store.slug}/products/export`}
            className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium"
          >
            {w.exportLink}
          </Link>
          {canWrite && (
            <Link
              href={`/admin/${store.slug}/products/import`}
              className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium"
            >
              {w.importLink}
            </Link>
          )}
          <Link
            href={`/admin/${store.slug}/products/categories`}
            className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium"
          >
            {w.categories}
          </Link>
          <Link
            href={`/admin/${store.slug}/products/new`}
            className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
          >
            {w.add}
          </Link>
        </div>
      </div>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-card" />}>
        <ProductList storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ProductList({
  storeSlug,
  searchParams,
}: {
  storeSlug: string;
  searchParams: Props["searchParams"];
}) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const canWrite = memberCan(member, "products:write");
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "products").list;
  const query = await searchParams;
  const archived = query.show === "archived";
  const needsFilter = !archived && query.needs === "unit-price";
  const locale = store.markets[0]?.locale ?? "en";
  // Unit price (D160): active products that need a content and have none, for the notice and its filter.
  const [products, needing, editor, imports] = await Promise.all([
    needsFilter ? Promise.resolve([]) : listAdminProducts(store, { archived }),
    archived ? Promise.resolve([]) : productsNeedingMeasure(store.id, store.localization.locales[0] ?? locale),
    // Bulk editing (D165): the store's categories, tags and markets for the action panels, read only for a member who can change products.
    canWrite && !needsFilter ? getEditorContext(store) : Promise.resolve(null),
    canWrite && !archived && !needsFilter ? listJobs(member, "product_import", 5) : Promise.resolve([]),
  ]);
  const openImport = imports.find((j) => (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(j.status)) ?? null;
  const bulk: BulkTools | null = editor
    ? {
        preview: previewBulkAction.bind(null, store.slug),
        start: startBulkAction.bind(null, store.slug),
        next: continueBulkAction.bind(null, store.slug),
        matching: matchingAction.bind(null, store.slug),
        undo: undoBatchAction.bind(null, store.slug),
        terms: editor.terms.map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
        markets: editor.markets.map((m) => ({ code: m.code, name: m.name, currency: m.currency })),
      }
    : null;
  const base = `/admin/${store.slug}/products`;
  const needsHref = `${base}?needs=unit-price`;

  const market = store.markets[0];
  return (
    <AdminTextScope texts={adminTexts(lang, ["products"])}>
      {!needsFilter && <NeedsContentNotice count={needing.length} href={needsHref} />}
      {openImport && (
        <p className="rounded-panel bg-sunken p-3 text-sm">
          {fillWords(w.openImport, { name: openImport.inputName ?? w.aFile })}{" "}
          <Link href={`${base}/import/${openImport.id}`} className="underline underline-offset-2">
            {w.continueIt}
          </Link>
          .
        </p>
      )}
      <nav aria-label={w.filters} className="flex gap-2 text-sm">
        <Link
          href={base}
          aria-current={archived || needsFilter ? undefined : "page"}
          className="rounded px-2 py-1 aria-[current=page]:bg-card aria-[current=page]:font-medium"
        >
          {w.current}
        </Link>
        <Link
          href={`${base}?show=archived`}
          aria-current={archived ? "page" : undefined}
          className="rounded px-2 py-1 aria-[current=page]:bg-card aria-[current=page]:font-medium"
        >
          {w.archived}
        </Link>
        {(needing.length > 0 || needsFilter) && (
          <Link
            href={needsHref}
            aria-current={needsFilter ? "page" : undefined}
            className="rounded px-2 py-1 aria-[current=page]:bg-card aria-[current=page]:font-medium"
          >
            {w.needsContent}
          </Link>
        )}
      </nav>
      {needsFilter ? (
        <NeedsContentList products={needing} base={base} />
      ) : products.length === 0 ? (
        <div className={`p-8 text-center ${CARD_CLASS}`}>
          <p className="mb-3">{archived ? w.noArchived : w.none}</p>
          {!archived && (
            <Link href={`${base}/new`} className="underline">
              {w.addFirst}
            </Link>
          )}
        </div>
      ) : (
        <ProductsTable
          slug={store.slug}
          archived={archived}
          locale={locale}
          bulk={bulk}
          priceHeader={market ? fillWords(store.audience === "businesses" ? w.priceInExclVat : w.priceIn, { market: market.name }) : w.price}
          rows={products.map((p) => ({ id: p.id, title: p.title, status: p.status, image: p.image, variants: p.variants, digitalVariants: p.digitalVariants, stock: p.stock, price: p.price }))}
        />
      )}
    </AdminTextScope>
  );
}
