import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { NeedsContentList, NeedsContentNotice } from "@/components/admin/unit-price-gaps-view";
import { formatMoney } from "@/lib/money";
import { requirePermission } from "@/server/permissions";
import { listAdminProducts } from "@/server/products";
import { productsNeedingMeasure } from "@/server/unit-price-gaps";

export const metadata: Metadata = { title: "Products" };

type Props = PageProps<"/admin/[store]/products">;

export default async function ProductsPage({ params, searchParams }: Props) {
  const { store } = await requirePermission((await params).store, "products:read");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Products</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/${store.slug}/products/categories`}
            className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium"
          >
            Categories and tags
          </Link>
          <Link
            href={`/admin/${store.slug}/products/new`}
            className="inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
          >
            Add product
          </Link>
        </div>
      </div>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-background" />}>
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
  const { store } = await requirePermission(storeSlug, "products:read");
  const query = await searchParams;
  const archived = query.show === "archived";
  const needsFilter = !archived && query.needs === "unit-price";
  const locale = store.markets[0]?.locale ?? "en";
  // Unit price (D160): active products that need a content and have none, for the notice and its filter.
  const [products, needing] = await Promise.all([
    needsFilter ? Promise.resolve([]) : listAdminProducts(store, { archived }),
    archived ? Promise.resolve([]) : productsNeedingMeasure(store.id, store.localization.locales[0] ?? locale),
  ]);
  const base = `/admin/${store.slug}/products`;
  const needsHref = `${base}?needs=unit-price`;

  return (
    <>
      {!needsFilter && <NeedsContentNotice count={needing.length} href={needsHref} />}
      <nav aria-label="Product filters" className="flex gap-2 text-sm">
        <Link
          href={base}
          aria-current={archived || needsFilter ? undefined : "page"}
          className="rounded px-2 py-1 aria-[current=page]:bg-background aria-[current=page]:font-semibold"
        >
          Current
        </Link>
        <Link
          href={`${base}?show=archived`}
          aria-current={archived ? "page" : undefined}
          className="rounded px-2 py-1 aria-[current=page]:bg-background aria-[current=page]:font-semibold"
        >
          Archived
        </Link>
        {(needing.length > 0 || needsFilter) && (
          <Link
            href={needsHref}
            aria-current={needsFilter ? "page" : undefined}
            className="rounded px-2 py-1 aria-[current=page]:bg-background aria-[current=page]:font-semibold"
          >
            Needs content
          </Link>
        )}
      </nav>
      {needsFilter ? (
        <NeedsContentList products={needing} base={base} />
      ) : products.length === 0 ? (
        <div className="rounded-lg border border-border bg-background p-8 text-center">
          <p className="mb-3">{archived ? "No archived products." : "No products yet."}</p>
          {!archived && (
            <Link href={`${base}/new`} className="underline">
              Add your first product
            </Link>
          )}
        </div>
      ) : (
        <table className="w-full overflow-hidden rounded-lg border border-border bg-background text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 font-medium">
                Product
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                Stock
              </th>
              <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                Price{store.markets[0] && ` (${store.markets[0].name}${store.audience === "businesses" ? ", excl. VAT" : ""})`}
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <Link href={`${base}/${product.id}`} className="flex items-center gap-3 font-medium hover:underline">
                    {product.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail
                      <img src={product.image} alt="" width={40} height={40} loading="lazy" className="size-10 rounded border border-border object-cover" />
                    ) : (
                      <span aria-hidden="true" className="size-10 rounded border border-dashed border-border" />
                    )}
                    <span>
                      {product.title}
                      {product.variants > 1 && (
                        <span className="block text-xs font-normal text-muted">{product.variants} variants</span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-2">
                  {product.status === "active" ? "Published" : product.status === "draft" ? "Draft" : "Archived"}
                </td>
                <td className="hidden px-4 py-2 sm:table-cell">
                  {product.digitalVariants > 0 && product.digitalVariants === product.variants ? (
                    <span className="text-muted">Digital</span>
                  ) : product.stock === 0 ? (
                    <span className="text-muted">Out of stock</span>
                  ) : (
                    product.stock
                  )}
                  {product.digitalVariants > 0 && product.digitalVariants < product.variants && (
                    <span className="block text-xs text-muted">and digital</span>
                  )}
                </td>
                <td className="hidden px-4 py-2 sm:table-cell">
                  {product.price
                    ? product.price.min === product.price.max
                      ? formatMoney(product.price.min, product.price.currency, locale)
                      : `${formatMoney(product.price.min, product.price.currency, locale)} – ${formatMoney(product.price.max, product.price.currency, locale)}`
                    : <span className="text-muted">No price</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
