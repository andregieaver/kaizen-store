import { z } from "zod";

import { cssProblem, CSS_MAX } from "./custom-css";
import {
  BLOCKS_MAX,
  PAGE_TYPES,
  ROWS_MAX,
  pageRowSchema,
  type PageBlock,
  type PageContent,
  type PageRow,
  type PageType,
} from "./page-content";

/**
 * A whole page's layout saved as a template (D127): the rows of a page, article, product layout, header or footer
 * and the page's own CSS, for pages of the same kind. Nothing of the page's own settings comes with it (title,
 * address, search texts, categories, translations, a header's overlay): the page that uses it keeps its own. Stored
 * as a saved part of kind `page` (`saved_parts`), so it is shared, activated, previewed and used like the others.
 * Shared by the builder (in the browser) and the server, which checks everything again.
 */
export type PageLayout = { pageType: PageType; rows: PageRow[]; css: string };

/** How the templates speak of the kinds of page a layout is for. */
export const LAYOUT_TYPE_LABELS: Record<PageType, { one: string; many: string }> = {
  page: { one: "page", many: "pages" },
  article: { one: "article", many: "articles" },
  product_layout: { one: "product layout", many: "product layouts" },
  header: { one: "header", many: "headers" },
  footer: { one: "footer", many: "footers" },
  variant: { one: "variant", many: "variants" },
};

export const pageLayoutSchema = z
  .object({
    pageType: z.enum(PAGE_TYPES),
    rows: z.array(pageRowSchema).max(ROWS_MAX, `A page layout takes at most ${ROWS_MAX} rows.`),
    css: z
      .string()
      .trim()
      .max(CSS_MAX)
      .default("")
      .superRefine((css, ctx) => {
        const problem = cssProblem(css);
        if (problem) ctx.addIssue({ code: "custom", message: `Custom CSS: ${problem}` });
      }),
  })
  .superRefine((layout, ctx) => {
    const blocks = layoutBlocks(layout);
    if (blocks.length > BLOCKS_MAX) ctx.addIssue({ code: "custom", message: `It holds more than ${BLOCKS_MAX} blocks.` });
    const ids = layout.rows.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "Two parts have the same id. Reload the page and try again." });
    }
  });

/** Every block of a layout, in reading order. */
export const layoutBlocks = (layout: Pick<PageLayout, "rows">): PageBlock[] =>
  layout.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));

/** The layout a page holds now, to save as a template. */
export const layoutOf = (content: Pick<PageContent, "rows" | "css">, pageType: PageType): PageLayout => ({
  pageType,
  rows: content.rows,
  css: content.css ?? "",
});

/** A layout is for pages of its own kind only: a header's rows are made of components no article has. */
export const layoutFits = (layout: Pick<PageLayout, "pageType">, pageType: PageType): boolean =>
  layout.pageType === pageType;
