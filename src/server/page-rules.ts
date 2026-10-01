import "server-only";

import { pageBlocks, type PageContent, type PageType } from "@/lib/page-content";
import { productBlocks } from "@/lib/product-layout";
import { siteLayoutProblem } from "@/lib/site-layout";

/** Whose pages: a store's id, or null for Kaizen's own. */
type PageOwner = string | null;

/**
 * What a page of a type may hold, beyond `pageInput`: checked when a page
 * is saved, and when a global part (D98) changes the pages that use it.
 */
export function pageRulesProblem(owner: PageOwner, type: PageType, content: PageContent): string | null {
  return (
    ownerGridProblem(owner, content.rows) ??
    productLayoutProblem(owner, type, content) ??
    siteLayoutProblem(owner, type, content) ??
    searchProblem(owner, type, content) ??
    plansProblem(owner, content) ??
    customFieldProblem(owner, type, content) ??
    storePartProblem(owner, type, content)
  );
}

/** The store's search (D112) is drawn in a store's pages and articles: Kaizen has no store to search, and headers, footers and product layouts have their own components. */
function searchProblem(owner: PageOwner, type: PageType, content: PageContent): string | null {
  if (!pageBlocks(content).some((block) => block.type === "search")) return null;
  if (owner === null) return "Search belongs in a store's pages.";
  if (type !== "page" && type !== "article") return "Search belongs in a store's pages and articles.";
  return null;
}

/** Kaizen's plans (D142) are the platform's to sell: only Kaizen's own pages hold the component. */
function plansProblem(owner: PageOwner, content: PageContent): string | null {
  if (owner !== null && pageBlocks(content).some((block) => block.type === "plans")) return "Kaizen's plans belong on Kaizen's own pages.";
  return null;
}

/** Custom fields (D118) belong to the page or article they are on, so only a store's pages and articles hold the component: Kaizen has none, and headers, footers and product layouts (which have their own product part) show no page's fields. */
function customFieldProblem(owner: PageOwner, type: PageType, content: PageContent): string | null {
  if (!pageBlocks(content).some((block) => block.type === "customField" || block.type === "fieldLoop")) return null;
  if (owner === null) return "Custom fields belong in a store's pages and articles.";
  if (type !== "page" && type !== "article") {
    // A header, footer or product layout has no page of its own to take fields from: only the store's own fields (D120) can be shown there.
    const foreign = pageBlocks(content).some((block) => block.type === "fieldLoop" || (block.type === "customField" && block.source !== "store"));
    if (foreign) return "Custom fields belong in a store's pages and articles; in a header, footer or product layout the component can only show the store's own fields (choose The store), and a product layout has its own Custom fields part.";
  }
  return null;
}

/** A store's working pages (D113) are components of a store's pages, not of articles, headers, footers or Kaizen's own. */
function storePartProblem(owner: PageOwner, type: PageType, content: PageContent): string | null {
  if (!pageBlocks(content).some((block) => block.type === "storePart")) return null;
  if (owner === null || type !== "page") return "The cart, checkout, account and other shop components belong in a store's pages.";
  return null;
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
    if (owner === null && block.source.recommend) {
      return "Recommendations work on a store's own pages, not on Kaizen's.";
    }
    if (owner !== null && block.source.storeId && block.source.storeId !== owner) {
      return "A content grid on a store's page shows that store's own products.";
    }
  }
  return null;
}
