import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { BulkRecent } from "@/components/admin/bulk-recent";
import { ProductsGrid } from "@/components/admin/products-grid";
import { DataPageHead, DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, label, primary } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { gridSelectionProblem } from "@/lib/bulk-admin";
import { BULK_GRID_MARKETS_MAX } from "@/lib/data-limits";
import { loadGrid } from "@/server/bulk-edit";
import { memberCan, requirePermission } from "@/server/permissions";
import { getEditorContext } from "@/server/products";

import { applyGridAction, previewGridAction, undoBatchAction } from "./actions";

export const metadata: Metadata = { title: "Edit products in a grid" };

type Props = PageProps<"/admin/[store]/products/bulk">;

const list = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value.join(",") : (value ?? ""))
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 200);

/**
 * The bulk grid (wave 2, D165, `docs/wave-2-data.md` 2.6): the variants of the products chosen in the list, edited as a table, reviewed, applied and, for
 * seven days, undone. Needs the right to change products. Opened from the list with `?ids=`, at most 50 products; without ids it shows the recent bulk
 * changes, where an undo can be made later.
 */
export default async function BulkGridPage({ params, searchParams }: Props) {
  const gated = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const w = adminText(adminLangOf(gated.account.adminLocale), "products").gridPage;
  return (
    <div className="flex flex-col gap-6">
      <DataPageHead backHref={`/admin/${store.slug}/products`} backLabel={w.back} title={w.title} intro={w.intro} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "products:read");
  if (!memberCan(member, "products:write")) notFound();
  const { store } = member;
  const query = await searchParams;
  const ids = list(query.ids);
  const markets = list(query.markets).map((m) => m.toUpperCase());
  const base = `/admin/${store.slug}/products`;
  const editor = await getEditorContext(store);
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "products");
  const w = all.gridPage;
  const recent = (
    <Suspense fallback={<DataSkeleton />}>
      <BulkRecent storeId={store.id} timeZone={store.timeZone} undo={undoBatchAction.bind(null, store.slug)} heading={all.recent.heading} locale={ADMIN_LANG_FACTS[lang].locale} />
    </Suspense>
  );

  if (ids.length === 0) {
    return (
      <AdminTextScope texts={adminTexts(lang, ["products"])}>
        <Notice title={w.chooseFirst}>
          <p>
            {w.choosePrefix}
            <Link href={base} className="underline underline-offset-2">
              {w.chooseLink}
            </Link>
            {w.chooseSuffix}
          </p>
        </Notice>
        {recent}
      </AdminTextScope>
    );
  }

  const problem = gridSelectionProblem(ids.length, all.bulkLib);
  if (problem) {
    return (
      <Notice title={w.tooMany}>
        <p>{problem}</p>
      </Notice>
    );
  }
  const data = await loadGrid(member, ids, markets.length > 0 ? markets : undefined);
  if (!data.ok) {
    return (
      <Notice title={w.notOpened}>
        <p>{data.problem}</p>
      </Notice>
    );
  }
  const shown = data.markets.map((m) => m.code);
  const locale = store.markets[0]?.locale ?? "en";
  const rows = data.rows.map((r) => ({ productId: r.productId, variantId: r.variantId, title: r.title, handle: r.handle, options: r.options, active: r.active, cells: r.cells }));
  return (
    <AdminTextScope texts={adminTexts(lang, ["products"])}>
      <form method="get" className={`${card} flex flex-wrap items-end gap-3`}>
        <input type="hidden" name="ids" value={ids.join(",")} />
        <fieldset className="flex flex-col gap-1">
          <legend className={label}>{fillWords(w.priceColumns, { max: BULK_GRID_MARKETS_MAX })}</legend>
          <div className="flex flex-wrap gap-3">
            {editor.markets.map((m) => (
              <label key={m.code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="markets" value={m.code} defaultChecked={shown.includes(m.code)} /> {fillWords(all.panel.marketLine, { name: m.name, currency: m.currency })}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className={primary}>
          {w.showMarkets}
        </button>
      </form>
      {data.notFound > 0 && <Notice>{fillWords(w.notFound, { n: data.notFound })}</Notice>}
      {rows.length === 0 ? (
        <Notice>{w.noVariants}</Notice>
      ) : (
        <ProductsGrid
          key={`${rows.map((r) => r.variantId).join(",")}|${shown.join(",")}`}
          rows={rows}
          markets={data.markets}
          mainCurrency={data.mainCurrency}
          locale={locale}
          tools={{
            preview: previewGridAction.bind(null, store.slug),
            apply: applyGridAction.bind(null, store.slug),
            undo: undoBatchAction.bind(null, store.slug),
          }}
        />
      )}
      {recent}
    </AdminTextScope>
  );
}
