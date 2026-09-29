import { newPageContent, type PageBlock, type PageContent, type ProductBlock, type ProductPart } from "./page-content";

/**
 * Product layouts (D79): a product's page is laid out by a layout the store
 * made in the page builder, with product components (`ProductBlock`) where
 * the product's parts go. Without one, the built-in layout below draws the
 * page as it always was: the back link and pictures on the left, the rest
 * on the right, stacked on phones.
 */

const part = (id: string, name: ProductPart, extra: Partial<ProductBlock> = {}): ProductBlock => ({
  id,
  type: "product",
  part: name,
  ...extra,
});

export const DEFAULT_PRODUCT_LAYOUT: PageContent = {
  ...newPageContent(),
  title: "Standard",
  slug: "standard",
  rows: [
    {
      id: "product-row",
      type: "row",
      layout: "2",
      columns: [
        { id: "product-media", blocks: [part("product-back", "back"), part("product-gallery", "gallery")] },
        {
          id: "product-details",
          blocks: [
            part("product-title", "title"),
            part("product-price", "price"),
            part("product-campaigns", "campaigns"),
            part("product-notice", "notice"),
            part("product-host", "host"),
            part("product-buy", "buy"),
            part("product-description", "description"),
            part("product-withdrawal", "withdrawal"),
            part("product-safety", "safety"),
          ],
        },
      ],
    },
  ],
};

/** Whether a block is a part of a product's page, which only product layouts hold. */
export const isProductBlock = (block: PageBlock): block is ProductBlock => block.type === "product";

/** The product components a page holds; a page that is not a product layout must hold none. */
export const productBlocks = (content: Pick<PageContent, "rows">): ProductBlock[] =>
  content.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks.filter(isProductBlock)));
