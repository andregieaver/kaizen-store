import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { formatMoney } from "@/lib/money";
import { requireMember } from "@/server/auth";
import { listAdminProducts } from "@/server/products";

export const metadata: Metadata = { title: "Products" };

type Props = PageProps<"/admin/[store]/products">;

export default async function ProductsPage({ params, searchParams }: Props) {
  const { store } = await requireMember((await params).store);
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
  const { store } = await requireMember(storeSlug);
  const archived = (await searchParams).show === "archived";
  const products = await listAdminProducts(store, { archived });
  const locale = store.markets[0]?.locale ?? "en";
  const base = `/admin/${store.slug}/products`;

  return (
    <>
      <nav aria-label="Product filters" className="flex gap-2 text-sm">
        <Link href={base} aria-current={archived ? undefined : "page"} className="rounded px-2 py-1 aria-[current=page]:bg-background aria-[current=page]:font-semibold">
          Current
        </Link>
        <Link
          href={`${base}?show=archived`}
          aria-current={archived ? "page" : undefined}
          className="rounded px-2 py-1 aria-[current=page]:bg-background aria-[current=page]:font-semibold"
        >
          Archived
        </Link>
      </nav>
      {products.length === 0 ? (
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
                Price{store.markets[0] && ` (${store.markets[0].name})`}
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
