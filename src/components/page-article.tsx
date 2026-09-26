import { blockFonts, blockHasContent, type PageContent, type PageRow } from "@/lib/page-content";

import type { GridPlace } from "@/server/content-grid";

import { ContentGridSection } from "./content-grid-section";
import { FontLinks } from "./font-links";
import { PageBlockView } from "./page-block";
import { ColumnLinkCover, PartBackground, blockBox, columnBox, rowBox, rowGrid, rowInnerClass } from "./page-parts";

/**
 * A page's rows (D42, D43): on the site, and in the admin's preview of a
 * draft. Only the rows show (D45); the title is the page's heading for
 * screen readers and search engines unless a heading component is the main
 * heading (D49), and the picture is for sharing. Rows,
 * columns and blocks carry their own settings (D47, D48; `page-parts.tsx`).
 * A row keeps to the content's width unless it is set to the full width.
 */
export function PageArticle({
  content,
  place = { pageId: null, owner: null },
  titled = false,
}: {
  content: PageContent;
  /** Where the page is shown: for its content grids (D51, D53). */
  place?: GridPlace;
  /** The title is already shown as the main heading (an article's header, D57). */
  titled?: boolean;
}) {
  const rows = content.rows.filter(rowShows);
  // A heading component at level 1 is the page's main heading (D49); else the title is, for screen readers.
  const hasMainHeading = rows.some((row) =>
    row.columns.some((c) => c.blocks.some((b) => b.type === "heading" && b.level === 1 && blockHasContent(b))),
  );
  return (
    <article className="flex flex-col gap-8">
      {!hasMainHeading && !titled && <h1 className="sr-only">{content.title}</h1>}
      {rows.map((row) => (
        <Row key={row.id} row={row} place={place} />
      ))}
    </article>
  );
}

/** A row shows when something in it does, or it has a background of its own. */
const rowShows = (row: PageRow) =>
  Boolean(row.background) || row.columns.some((c) => c.background || c.blocks.some(blockHasContent));

function Row({ row, place }: { row: PageRow; place: GridPlace }) {
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
                        <FontLinks families={blockFonts(block)} />
                        {block.type === "contentGrid" ? (
                          <ContentGridSection block={block} place={place} />
                        ) : (
                          <PageBlockView block={block} />
                        )}
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
