import Link from "next/link";

import { CARD_CLASS } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { screensEn, type ScreensMessages } from "@/lib/admin-messages/screens.en";

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

/** The words of these parts (`screens.unitGaps`, D312): English unless the page hands in the admin's. */
type GapWords = ScreensMessages["unitGaps"];
const GAP_WORDS: GapWords = screensEn.unitGaps;

export const needsReasonWords = (reason: NeedsContent["reason"], words: GapWords = GAP_WORDS): string =>
  reason.kind === "flag" ? words.byMeasure : fillWords(words.category, { category: reason.category });

/** The notice above the products, when any product needs a content. */
export function NeedsContentNotice({ count, href, words = GAP_WORDS }: { count: number; href: string; words?: GapWords }) {
  if (count === 0) return null;
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel bg-sunken px-4 py-3 text-sm">
      <span>{countWords(count, words.notice)}</span>
      <Link href={href} className="font-medium underline">
        {words.show}
      </Link>
    </p>
  );
}

/** The products that need a content, each with why and which variants lack it, linking to its editor. */
export function NeedsContentList({ products, base, words = GAP_WORDS }: { products: NeedsContent[]; base: string; words?: GapWords }) {
  if (products.length === 0) {
    return (
      <div className={`p-8 text-center ${CARD_CLASS}`}>
        <p>{words.none}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-sm text-muted">{words.intro}</p>
      <table className="w-full overflow-hidden rounded-panel border border-line bg-card text-left text-sm">
        <caption className="sr-only">{words.caption}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-4 py-2 font-medium">
              {words.product}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {words.why}
            </th>
            <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
              {words.variants}
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.productId} className="border-b border-line last:border-0">
              <td className="px-4 py-2">
                <Link href={`${base}/${product.productId}`} className="font-medium hover:underline">
                  {product.title}
                </Link>
              </td>
              <td className="px-4 py-2">{needsReasonWords(product.reason, words)}</td>
              <td className="hidden px-4 py-2 font-mono text-xs sm:table-cell">{product.skus.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
