import Link from "next/link";

import { needsContentNotice } from "@/lib/unit-price-editor";

/**
 * The products page's part of the unit price (D160, `docs/wave-1d-unit-price.md` 2.2): a notice with the count of active products
 * that need a content for the price per kg or litre and still lack it, and the list those products are filtered to. These stay
 * on sale (the shop shows no unit price for them) and are refused the next time they are saved: nothing is hidden or
 * switched off. Presentational: the products come from `productsNeedingMeasure()`.
 */

/** What the server reads says about a product that needs a content (a copy of `ProductNeedingMeasure`, kept free of server code). */
export type NeedsContent = {
  productId: string;
  handle: string;
  title: string;
  reason: { kind: "flag" } | { kind: "category"; category: string };
  skus: string[];
};

export const needsReasonWords = (reason: NeedsContent["reason"]): string =>
  reason.kind === "flag" ? "Sold by measure" : `Category ${reason.category}`;

/** The notice above the products, when any product needs a content. */
export function NeedsContentNotice({ count, href }: { count: number; href: string }) {
  if (count === 0) return null;
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <span>{needsContentNotice(count)}</span>
      <Link href={href} className="font-medium underline">
        Show them
      </Link>
    </p>
  );
}

/** The products that need a content, each with why and which variants lack it, linking to its editor. */
export function NeedsContentList({ products, base }: { products: NeedsContent[]; base: string }) {
  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-8 text-center">
        <p>No product needs content for the unit price.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-sm text-muted">
        These products are on sale without a price per kg or litre. They stay on sale and the shop shows no unit price for them, until
        you give each shipped variant its content in the product&apos;s editor; saving one before then is refused.
      </p>
      <table className="w-full overflow-hidden rounded-lg border border-border bg-background text-left text-sm">
        <caption className="sr-only">Products that need content for the unit price</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-4 py-2 font-medium">
              Product
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Why
            </th>
            <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
              Variants without content
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.productId} className="border-b border-border last:border-0">
              <td className="px-4 py-2">
                <Link href={`${base}/${product.productId}`} className="font-medium hover:underline">
                  {product.title}
                </Link>
              </td>
              <td className="px-4 py-2">{needsReasonWords(product.reason)}</td>
              <td className="hidden px-4 py-2 font-mono text-xs sm:table-cell">{product.skus.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
