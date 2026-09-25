import { blockHasContent, type PageContent, type PageRow } from "@/lib/page-content";

import { PageBlockView } from "./page-block";
import { ColumnLinkCover, PartBackground, blockBox, columnBox, rowBox, rowGrid, rowInnerClass } from "./page-parts";

/**
 * A page's rows (D42, D43): on the site, and in the admin's preview of a
 * draft. Only the rows show (D45); the title is the page's heading for
 * screen readers and search engines, and the picture is for sharing. Rows,
 * columns and blocks carry their own settings (D47, D48; `page-parts.tsx`).
 * A row keeps to the content's width unless it is set to the full width.
 */
export function PageArticle({ content }: { content: PageContent }) {
  return (
    <article className="flex flex-col gap-8">
      <h1 className="sr-only">{content.title}</h1>
      {content.rows.filter(rowShows).map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </article>
  );
}

/** A row shows when something in it does, or it has a background of its own. */
const rowShows = (row: PageRow) =>
  Boolean(row.background) || row.columns.some((c) => c.background || c.blocks.some(blockHasContent));

function Row({ row }: { row: PageRow }) {
  const box = rowBox(row, "site");
  const grid = rowGrid(row);
  return (
    <div className={row.width === "full" ? undefined : "mx-auto w-full max-w-5xl px-4"}>
      <div id={box.id} className={box.className} style={box.style}>
        <PartBackground background={row.background} />
        <div className={rowInnerClass(row, "site")}>
          <div className={grid.className} style={grid.style}>
            {row.columns.map((column) => {
              const col = columnBox(column, row, "site");
              return (
                <div key={column.id} id={col.id} className={col.className} style={col.style}>
                  <PartBackground background={column.background} />
                  <ColumnLinkCover column={column} />
                  {column.blocks.filter(blockHasContent).map((block) => {
                    const b = blockBox(block, "site");
                    return (
                      <div key={block.id} id={b.id} className={b.className || undefined} style={b.style}>
                        <PageBlockView block={block} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
