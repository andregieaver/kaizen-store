import { Suspense, type ReactNode } from "react";

import { blockFonts, blockShowsUnbound, columnLines, partFonts, type PageBlock, type PageColumn, type PageContent, type PageRow } from "@/lib/page-content";

import { withoutBindings } from "@/lib/field-binding";
import { t } from "@/lib/i18n";
import { blockTarget, motionNeeds, partFx } from "@/lib/motion-attrs";
import { flowRows } from "@/lib/page-modal";
import { rowWidthStyle } from "@/lib/part-css";
import { themedRows } from "@/lib/theme-elements";
import { themeElementsFor } from "@/server/theme-elements";
import type { GridPlace } from "@/server/content-grid";
import { placeLang } from "@/server/place-lang";

import { ContentGridSection } from "./content-grid-section";
import { CustomCss } from "./custom-css";
import { CustomFieldSection } from "./custom-field-section";
import { FieldLoopSection } from "./field-loop-section";
import { MenuSection } from "./menu-section";
import { MotionSupport } from "./motion-support";
import { FontLinks } from "./font-links";
import { FormSection } from "./form-section";
import { GoogleReviewsSection } from "./google-reviews-section";
import { PageBlockView } from "./page-block";
import { PageModal } from "./page-modal";
import { PlansSection } from "./plans-section";
import { ColumnLinkCover, PartBackground, blockBox, columnBox, modalPanelClass, rowBox, rowGrid, rowInnerClass } from "./page-parts";
import { PartStyles } from "./part-styles";
import { StorePartSection } from "./store-part-section";
import { SearchSection } from "./search-section";
import { VisiblePart } from "./visible-part";

/**
 * A page's rows (D42, D43): on the site, and in the admin's preview of a
 * draft. Only the rows show (D45); the title is the page's heading for
 * screen readers and search engines unless a heading component is the main
 * heading (D49), and the picture is for sharing. Rows,
 * columns and blocks carry their own settings (D47, D48; `page-parts.tsx`).
 * A row keeps to the content's width unless it is set to the full width.
 */
export function PageArticle({
  content: given,
  place = { pageId: null, owner: null },
  titled = false,
  renderBlock,
  inAdmin = false,
}: {
  content: PageContent;
  /** Where the page is shown: for its content grids (D51, D53). */
  place?: GridPlace;
  /** The title is already shown as the main heading (an article's header, D57). */
  titled?: boolean;
  /** Draws blocks the page itself knows, such as a product layout's product components (D79); null leaves one out. */
  renderBlock?: (block: PageBlock) => ReactNode;
  /** Shown in the admin (a preview), which draws the page's own CSS (D100) itself, kept inside the preview. */
  inAdmin?: boolean;
}) {
  // A preview draws what the blocks hold; a block still bound to a field is drawn only if it keeps its own content (D118).
  const content = inAdmin ? withoutBindings(given) : given;
  const rows = content.rows.filter(rowShows);
  // A heading component at level 1, or a product's title (D79), is the page's main heading (D49); else the title is, for screen readers.
  // (A modal's headings are its own: it is not in the page's flow, D121.)
  // A heading in a part some visitors do not see (D179 phase 4) does not count: the title stays for them.
  const hasMainHeading = flowRows(rows).some((row) =>
    seenByAll(row) &&
    row.columns.some((c) =>
      seenByAll(c) &&
      c.blocks.some((b) => seenByAll(b) && ((b.type === "heading" && b.level === 1 && blockShowsUnbound(b)) || (b.type === "product" && b.part === "title"))),
    ),
  );
  // Motion (D128): the first flow row is drawn without waiting for scripts; the runtime is loaded only if something needs it.
  const first = flowRows(rows)[0];
  const motion = motionNeeds(rows);
  return (
    <article className="flex flex-col gap-8" {...(motion.any ? { "data-fx-clip": "" } : {})}>
      {/* The page's own CSS (D100), for the whole page. */}
      {!inAdmin && <CustomCss css={content.css} name={`page-${place.pageId ?? "layout"}`} />}
      {!hasMainHeading && !titled && <h1 className="sr-only">{content.title}</h1>}
      {rows.map((row) => (
        <PageRowView key={row.id} row={row} place={place} renderBlock={renderBlock} inAdmin={inAdmin} first={row === first} />
      ))}
      <MotionSupport needs={motion} />
    </article>
  );
}

/**
 * The room above and below a page on the site: none at an end whose row has
 * a background of its own, which then meets the header or footer; else the
 * usual room, so text does not start right under the header or end right
 * on the footer.
 */
export const pageRoomClass = (content: Pick<PageContent, "rows">, top: string, bottom: string) => {
  // A modal is not in the page's flow (D121): the first and last rows are the ones drawn in it.
  const rows = flowRows(content.rows.filter(rowShows));
  return [rows[0]?.background ? "" : top, rows.at(-1)?.background ? "" : bottom].filter(Boolean).join(" ");
};

/** Whether every visitor sees a part (its display is Always, D179 phase 4). */
const seenByAll = (part: { visibility?: { show?: unknown } }) => part.visibility?.show === undefined || part.visibility.show === "always";

/** A row shows when something in it does, or it has a background of its own. */
export const rowShows = (row: PageRow) =>
  Boolean(row.background) || row.columns.some((c) => c.background || c.blocks.some(blockShowsUnbound));

/**
 * One row on the site, with its columns and blocks; also a header's or
 * footer's rows (D80), whose site components `renderBlock` draws. A modal's
 * row (D121) is taken out of the page's flow and drawn in a dialog.
 */
export function PageRowView(props: {
  row: PageRow;
  place: GridPlace;
  renderBlock?: (block: PageBlock) => ReactNode;
  /** A preview in the admin: a modal there does not open by itself. */
  inAdmin?: boolean;
  /** The first row in the flow of what is drawn (D128): its entrances play by CSS at once, without waiting for scripts. */
  first?: boolean;
}) {
  // A store's row is drawn with its theme laid under it (D182: what its Theme tab says for rows, headings, text and buttons).
  return props.place.owner ? <ThemedRowView {...props} /> : <RowView {...props} />;
}

async function ThemedRowView({ row, ...rest }: Parameters<typeof PageRowView>[0]) {
  const [themed] = themedRows([row], await themeElementsFor(rest.place.owner));
  return <RowView row={themed} {...rest} />;
}

function RowView({
  row,
  place,
  renderBlock,
  inAdmin = false,
  first = false,
}: Parameters<typeof PageRowView>[0]) {
  return (
    <>
      {/* What the row's settings say at each screen size (D179). */}
      <PartStyles rows={[row]} owner={place.owner} />
      {/* Who sees the row (D179 phase 4): the server leaves it out for anyone else. */}
      <VisiblePart show={row.visibility?.show} place={place} preview={inAdmin}>
        {row.modal ? (
          <ModalRow row={row} place={place} renderBlock={renderBlock} inAdmin={inAdmin} />
        ) : (
          <RowMarkup row={row} place={place} renderBlock={renderBlock} first={first} preview={inAdmin} />
        )}
      </VisiblePart>
    </>
  );
}

/**
 * A modal's row (D121) in its dialog, drawn in the language of the place it
 * is shown in. Nothing opens by itself on a store's working pages or in the
 * admin.
 */
export async function ModalRow({
  row,
  place,
  renderBlock,
  inAdmin,
}: {
  row: PageRow;
  place: GridPlace;
  renderBlock?: (block: PageBlock) => ReactNode;
  inAdmin: boolean;
}) {
  const m = t(await placeLang(place)).modal;
  // In the panel the row keeps to the panel's width and to what it holds, not the page's.
  const panelRow: PageRow = { ...row, width: undefined, contentWidth: undefined, fullHeight: undefined };
  return (
    <PageModal
      config={row.modal!}
      storeId={place.owner}
      auto={!inAdmin && !place.route}
      labels={{ close: m.close, dialog: m.dialog }}
      panelClassName={modalPanelClass(row)}
    >
      <RowMarkup row={panelRow} place={place} renderBlock={renderBlock} inPanel preview={inAdmin} />
    </PageModal>
  );
}

/** A row's markup: its background, columns and blocks; `inPanel` inside a modal's panel (D121). */
function RowMarkup({
  row,
  place,
  renderBlock,
  inPanel = false,
  first = false,
  preview = false,
}: {
  row: PageRow;
  place: GridPlace;
  renderBlock?: (block: PageBlock) => ReactNode;
  inPanel?: boolean;
  first?: boolean;
  /** The admin's preview: every part but a Never one is drawn (`VisiblePart`). */
  preview?: boolean;
}) {
  const box = rowBox(row, "site", inPanel);
  const grid = rowGrid(row);
  // Motion (D128): a row's effects, its columns' (which take the row's entrance when it staggers them) and its blocks'.
  const rowFx = partFx(row.motion, "row", { firstRow: first });
  const lines = columnLines(row);
  const renderColumn = (column: PageColumn, columnIndex: number) => {
    const col = columnBox(column, row, "site");
    const colFx = partFx(column.motion, "column", {
      firstRow: first,
      index: columnIndex,
      parentStagger: row.motion?.enter?.stagger,
      parentEnter: row.motion?.enter,
    });
    return (
      <VisiblePart key={column.id} show={column.visibility?.show} place={place} preview={preview}>
      <div id={col.id} className={col.className} style={{ ...col.style, ...colFx.style }} {...colFx.attrs}>
        <FontLinks families={partFonts(column)} />
        <PartBackground background={column.background} motion={column.backgroundMotion} firstRow={first} />
        <ColumnLinkCover column={column} />
        {column.blocks.filter(blockShowsUnbound).map((block, blockIndex) => {
          const b = blockBox(block, "site");
          const fx = partFx(block.motion, blockTarget(block), {
            firstRow: first,
            image: block.type === "image",
            index: blockIndex,
            parentStagger: column.motion?.enter?.stagger,
            parentEnter: column.motion?.enter,
          });
          // A product or site component with nothing to show leaves no space behind (D79, D80).
          const own = renderBlock && (block.type === "product" || block.type === "site") ? renderBlock(block) : undefined;
          if (own === null) return null;
          return (
            <VisiblePart key={block.id} show={block.visibility?.show} place={place} preview={preview}>
            <div id={b.id} className={b.className || undefined} style={{ ...b.style, ...fx.style }} {...fx.attrs}>
              <FontLinks families={blockFonts(block)} />
              {own !== undefined ? (
                own
              ) : block.type === "contentGrid" ? (
                <ContentGridSection block={block} place={place} />
              ) : block.type === "menu" ? (
                <MenuSection block={block} place={place} />
              ) : block.type === "search" ? (
                <SearchSection place={place} results={block.results !== false} />
              ) : block.type === "plans" ? (
                <PlansSection block={block} />
              ) : block.type === "customField" ? (
                <CustomFieldSection block={block} place={place} />
              ) : block.type === "fieldLoop" ? (
                <FieldLoopSection block={block} place={place} />
              ) : block.type === "storePart" ? (
                <StorePartSection block={block} place={place} />
              ) : block.type === "emailForm" || block.type === "newsletter" ? (
                <FormSection block={block} place={place} />
              ) : block.type === "testimonials" && block.source === "google" ? (
                // Asked of Google as the page is shown (never kept): the rest of the page does not wait.
                <Suspense fallback={null}>
                  <GoogleReviewsSection block={block} place={place} />
                </Suspense>
              ) : (
                <PageBlockView block={block} />
              )}
            </div>
            </VisiblePart>
          );
        })}
      </div>
      </VisiblePart>
    );
  };
  return (
    <div className={row.width === "full" || inPanel ? undefined : `mx-auto w-full max-w-(--content-width) ${rowWidthStyle(row).className}`.trim()}>
      <div id={box.id} className={box.className} style={{ ...box.style, ...rowFx.style }} {...rowFx.attrs}>
        <FontLinks families={partFonts(row)} />
        <PartBackground background={row.background} motion={row.backgroundMotion} firstRow={first} fixed={row.backgroundFixed} align={row.backgroundAlign} />
        <div className={rowInnerClass(row, "site")}>
          <div className={grid.className} style={grid.style}>
            {lines.length === 1
              ? row.columns.map(renderColumn)
              : // A row of several lines (D187): each line is a box of its own in the row's grid.
                lines.map((line, l) => (
                  <div key={line[0]?.id ?? l}>{line.map((column, i) => renderColumn(column, lines.slice(0, l).reduce((n, earlier) => n + earlier.length, 0) + i))}</div>
                ))}
          </div>
        </div>
      </div>
    </div>
  );
}
