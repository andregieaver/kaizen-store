import type { CSSProperties } from "react";

import { ROW_LAYOUTS, type PageContent, type PageRow } from "@/lib/page-content";

import { hasContent, RichText } from "./rich-text";

/**
 * A page's rows (D42, D43): on the site, and in the admin's preview of a
 * draft. Only the rows show (D45); the title is the page's heading for
 * screen readers and search engines, and the picture is for sharing.
 */
export function PageArticle({ content }: { content: PageContent }) {
  return (
    <article className="flex flex-col gap-8">
      <h1 className="sr-only">{content.title}</h1>
      {content.rows.filter(rowHasContent).map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </article>
  );
}

const rowHasContent = (row: PageRow) => row.columns.some((c) => c.blocks.some((b) => hasContent(b.doc)));

/** A row's columns side by side, sized by its layout; on phones they stack. */
function Row({ row }: { row: PageRow }) {
  const widths = ROW_LAYOUTS[row.layout].widths;
  return (
    <div
      style={{ "--columns": widths.map((w) => `minmax(0, ${w}fr)`).join(" ") } as CSSProperties}
      className="grid gap-8 md:[grid-template-columns:var(--columns)]"
    >
      {row.columns.map((column) => (
        <div key={column.id} className="flex min-w-0 flex-col gap-6">
          {column.blocks
            .filter((block) => hasContent(block.doc))
            .map((block) => (
              <RichText key={block.id} doc={block.doc} />
            ))}
        </div>
      ))}
    </div>
  );
}
