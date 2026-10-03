import type { GridSource } from "./page-content";

/**
 * What each kind of content a grid can show means for the code that reads `block.source.type` (D155): one table, keyed by
 * every source, so adding a source to `GridSource` fails to compile here until each question is answered, instead of the
 * new source silently taking a product's or a page's behaviour somewhere. Readers ask `sourceTraits(source)`.
 */
export type SourceTraits = {
  /** Items are looked up in the database (pages, articles, products); false: the owner wrote them in the block. */
  lookedUp: boolean;
  /** Real products: live prices with a VAT label, campaigns, stock, recommendations, filters, the theme's product cards. */
  products: boolean;
  /** Chosen by categories and tags, sorted and limited. */
  terms: boolean;
  /** The kind of thing a tile's custom fields (D120) belong to, or null when tiles have none. */
  fieldEntity: "product" | "page" | "article" | null;
  /** The button's default words: "View product" or "Read more". */
  button: "viewProduct" | "readMore";
};

export const SOURCE_TRAITS: Record<GridSource["type"], SourceTraits> = {
  pages: { lookedUp: true, products: false, terms: true, fieldEntity: "page", button: "readMore" },
  articles: { lookedUp: true, products: false, terms: true, fieldEntity: "article", button: "readMore" },
  products: { lookedUp: true, products: true, terms: true, fieldEntity: "product", button: "viewProduct" },
  custom: { lookedUp: false, products: false, terms: false, fieldEntity: null, button: "readMore" },
};

/** The traits of a grid's source; the exhaustive switch makes a new source a compile error here too. */
export function sourceTraits(source: GridSource): SourceTraits {
  switch (source.type) {
    case "pages":
    case "articles":
    case "products":
    case "custom":
      return SOURCE_TRAITS[source.type];
    default:
      return assertNever(source);
  }
}

/** The end of a switch over every source: a source added to the union and not handled there is a compile error, and a throw if it ever got through. */
export function assertNever(value: never): never {
  throw new Error(`A content grid has an unknown source: ${JSON.stringify(value)}`);
}
