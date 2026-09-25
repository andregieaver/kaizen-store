import Image from "next/image";
import type { CSSProperties } from "react";

import { ROW_LAYOUTS, type PageContent, type PageRow } from "@/lib/page-content";

import { hasContent, RichText } from "./rich-text";

/** A page's title, picture and rows (D42, D43): on the site, and in the admin's preview of a draft. */
export function PageArticle({ content }: { content: PageContent }) {
  return (
    <article className="flex flex-col gap-8">
      <h1 className="text-4xl font-semibold tracking-tight text-balance">{content.title}</h1>
      {content.thumbnail && (
        <Image
          src={content.thumbnail.url}
          alt={content.thumbnail.alt}
          width={content.thumbnail.width}
          height={content.thumbnail.height}
          unoptimized
          priority
          className="h-auto w-full rounded-lg bg-surface object-cover"
        />
      )}
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
