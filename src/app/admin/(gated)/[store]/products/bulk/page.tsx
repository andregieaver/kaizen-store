import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { BulkRecent } from "@/components/admin/bulk-recent";
import { ProductsGrid } from "@/components/admin/products-grid";
import { DataPageHead, DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, label, primary } from "@/components/admin/data/ui";
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
  return (
    <div className="flex flex-col gap-6">
      <DataPageHead
        backHref={`/admin/${store.slug}/products`}
        backLabel="Products"
        title="Edit products in a grid"
        intro="Change prices, SKUs, stock and cost across many variants at once. You review every change before it is written, and you can undo it for seven days."
      />
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

  if (ids.length === 0) {
    return (
      <>
        <Notice title="Choose products first">
          <p>
            Tick the products to change in <Link href={base} className="underline underline-offset-2">the products list</Link> and choose Edit in a grid, or choose another action in the bar that appears there.
          </p>
        </Notice>
        <Suspense fallback={<DataSkeleton />}>
          <BulkRecent storeId={store.id} timeZone={store.timeZone} undo={undoBatchAction.bind(null, store.slug)} />
        </Suspense>
      </>
    );
  }

  const problem = gridSelectionProblem(ids.length);
  if (problem) {
    return (
      <Notice title="Too many products">
        <p>{problem}</p>
      </Notice>
    );
  }
  const data = await loadGrid(member, ids, markets.length > 0 ? markets : undefined);
  if (!data.ok) {
    return (
      <Notice title="The grid could not be opened">
        <p>{data.problem}</p>
      </Notice>
    );
  }
  const shown = data.markets.map((m) => m.code);
  const locale = store.markets[0]?.locale ?? "en";
  const rows = data.rows.map((r) => ({ productId: r.productId, variantId: r.variantId, title: r.title, handle: r.handle, options: r.options, active: r.active, cells: r.cells }));
  return (
    <>
      <form method="get" className={`${card} flex flex-wrap items-end gap-3`}>
        <input type="hidden" name="ids" value={ids.join(",")} />
        <fieldset className="flex flex-col gap-1">
          <legend className={label}>Price columns (at most {BULK_GRID_MARKETS_MAX})</legend>
          <div className="flex flex-wrap gap-3">
            {editor.markets.map((m) => (
              <label key={m.code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="markets" value={m.code} defaultChecked={shown.includes(m.code)} /> {m.name} ({m.currency})
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className={primary}>
          Show these markets
        </button>
      </form>
      {data.notFound > 0 && <Notice>{data.notFound} of the chosen products are not in this store and are left out.</Notice>}
      {rows.length === 0 ? (
        <Notice>The chosen products have no variants to edit.</Notice>
      ) : (
        <ProductsGrid
          key={JSON.stringify(rows.map((r) => r.cells))}
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
      <Suspense fallback={<DataSkeleton />}>
        <BulkRecent storeId={store.id} timeZone={store.timeZone} undo={undoBatchAction.bind(null, store.slug)} />
      </Suspense>
    </>
  );
}
