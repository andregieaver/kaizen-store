import "server-only";

import type { PageContent, PageType } from "@/lib/page-content";
import { productBlocks } from "@/lib/product-layout";
import { siteLayoutProblem } from "@/lib/site-layout";

/** Whose pages: a store's id, or null for Kaizen's own. */
type PageOwner = string | null;

/**
 * What a page of a type may hold, beyond `pageInput`: checked when a page
 * is saved, and when a global part (D98) changes the pages that use it.
 */
export function pageRulesProblem(owner: PageOwner, type: PageType, content: PageContent): string | null {
  return ownerGridProblem(owner, content.rows) ?? productLayoutProblem(owner, type, content) ?? siteLayoutProblem(owner, type, content);
}

/**
 * Product components (D79) show the product a layout is used for, so only a
 * store's product layouts hold them, and a layout has no categories or tags.
 */
function productLayoutProblem(owner: PageOwner, type: PageType, content: PageContent): string | null {
  const parts = productBlocks(content).length > 0;
  if (type !== "product_layout") return parts ? "Product components belong in product layouts, which show a product." : null;
  if (owner === null) return "Product layouts are a store's.";
  if (content.categories.length > 0 || content.tags.length > 0) return "A product layout has no categories or tags.";
  return null;
}

/**
 * A store's grids of products always show its own (D53), in the shopper's
 * market; Kaizen's name the store and market.
 */
function ownerGridProblem(owner: PageOwner, rows: PageContent["rows"]): string | null {
  for (const block of rows.flatMap((r) => r.columns.flatMap((c) => c.blocks))) {
    if (block.type !== "contentGrid" || block.source.type !== "products") continue;
    if (owner === null && (!block.source.storeId || !block.source.market)) {
      return "Choose the store and market for each content grid of products.";
    }
    if (owner !== null && block.source.storeId && block.source.storeId !== owner) {
      return "A content grid on a store's page shows that store's own products.";
    }
  }
  return null;
}
