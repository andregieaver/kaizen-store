import { Suspense, type ReactNode } from "react";

import { blockFonts, blockHasContent, blockShowsUnbound, columnLines, columnsAsRow, partFonts, rowShows, type ColumnsBlock, type PageBlock, type PageColumn, type PageContent, type PageRow } from "@/lib/page-content";
import { inlineMarkOf } from "@/lib/inline-edit";

import { withoutBindings } from "@/lib/field-binding";
import { t } from "@/lib/i18n";
import { blockTarget, motionNeeds, partFx } from "@/lib/motion-attrs";
import { flowRows } from "@/lib/page-modal";
import { rowWidthStyle } from "@/lib/part-css";
import { ROW_GAP, meetsAbove, rowAbove } from "@/lib/row-join";
import type { ThemeLayers } from "@/lib/section-styles";
import { themedRows } from "@/lib/theme-elements";
import { withStoreLinks } from "@/lib/store-links";
import { themeLayersFor } from "@/server/theme-elements";
import { storeLinkBase } from "@/server/store-links";
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
import { PageModal } from "./lazy/blocks";
import { PlansSection } from "./plans-section";
import { ThemeStoreSection } from "./theme-store-section";
import { themePartDraws } from "@/lib/theme-store-parts";
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
  editable = false,
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
  /**
   * A page or an article of its own that signed-in staff may change the words of where they stand (D192): its article carries the page's id
   * and its headings and texts their kind and id. Only where `PageEditLink` is drawn beside it; a layout, a header or a 404 page has no use for them.
   */
  editable?: boolean;
}) {
  // A preview draws what the blocks hold; a block still bound to a field is drawn only if it keeps its own content (D118).
  const content = inAdmin ? withoutBindings(given) : given;
  const rows = content.rows.filter((row) => rowShows(row) && !themeRowLeftOut(row, place));
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
    // The page's id, for the signed-in staff's "Edit text" (D192), which finds the headings and texts it may edit inside it.
    <article className="flex flex-col gap-8" {...(motion.any ? { "data-fx-clip": "" } : {})} {...(editable && !inAdmin && place.pageId ? { "data-kz-page": place.pageId } : {})}>
      {/* The page's own CSS (D100), for the whole page. */}
      {!inAdmin && <CustomCss css={content.css} name={`page-${place.pageId ?? "layout"}`} />}
      {!hasMainHeading && !titled && <h1 className="sr-only">{content.title}</h1>}
      {rows.map((row, index) => (
        <PageRowView
          key={row.id}
          row={row}
          // The row drawn above it in the page's flow (a modal's row is not), which it meets when both draw a box (D262).
          above={rowAbove(rows, index)}
          place={place}
          renderBlock={renderBlock}
          inAdmin={inAdmin}
          first={row === first}
          editable={editable}
        />
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

/** A theme store part with nothing for the theme the address names (D285), which is left out. */
const themePartLeftOut = (block: PageBlock, place: GridPlace) => block.type === "themeStore" && !themePartDraws(block.part, place);

/** A row holding only such parts, left out with them rather than drawn empty. */
const themeRowLeftOut = (row: PageRow, place: GridPlace) => {
  const blocks = row.columns.flatMap((column) => column.blocks);
  return blocks.length > 0 && blocks.every((block) => themePartLeftOut(block, place));
};

/** Whether every visitor sees a part (its display is Always, D179 phase 4). */
const seenByAll = (part: { visibility?: { show?: unknown } }) => part.visibility?.show === undefined || part.visibility.show === "always";

/**
 * One row on the site, with its columns and blocks; also a header's or
 * footer's rows (D80), whose site components `renderBlock` draws. A modal's
 * row (D121) is taken out of the page's flow and drawn in a dialog.
 */
export function PageRowView(props: {
  row: PageRow;
  /** The row drawn above it in a page's flow: where both draw a box, they meet with no room between them (D262, `meetsAbove()`). */
  above?: PageRow;
  place: GridPlace;
  renderBlock?: (block: PageBlock) => ReactNode;
  /** A preview in the admin: a modal there does not open by itself. */
  inAdmin?: boolean;
  /** The first row in the flow of what is drawn (D128): its entrances play by CSS at once, without waiting for scripts. */
  first?: boolean;
  /** Drawn below the first screen at first (a footer's rows): even its first row's pictures load only as they come near. */
  late?: boolean;
  /** Its headings and texts are marked for the staff's "Edit text" (D192): `PageArticle`'s. */
  editable?: boolean;
}) {
  // A row is drawn with its site's theme laid under it (D182: what its Theme tab says for rows, headings, text and buttons): a store's, or
  // Kaizena Flow's own where the place has no owner (D235). A place that brings the layers (a preview of an installed theme, D244, or a
  // layout drawn with its store at hand) is drawn with them at once.
  // A store's row is drawn with its links to the store's own paths under the market shown (`src/lib/store-links.ts`).
  if (props.place.owner) return <StoreRowView {...props} />;
  const layers = props.place.theme;
  return layers ? <RowView {...props} {...themedPair(props.row, props.above, layers)} /> : <ThemedRowView {...props} />;
}

async function ThemedRowView(props: Parameters<typeof PageRowView>[0]) {
  const layers = await themeLayersFor(props.place.owner);
  return <RowView {...props} {...themedPair(props.row, props.above, layers)} />;
}

async function StoreRowView(props: Parameters<typeof PageRowView>[0]) {
  const [layers, base] = await Promise.all([props.place.theme ?? themeLayersFor(props.place.owner), storeLinkBase(props.place.owner, props.place.market)]);
  const row = base ? withStoreLinks(props.row, base) : props.row;
  return <RowView {...props} {...themedPair(row, props.above, layers)} />;
}

/** A row and the row above it, as drawn with a theme's layers, so whether they meet is asked of what is drawn (a section style's background counts). */
function themedPair(row: PageRow, above: PageRow | undefined, layers: ThemeLayers): { row: PageRow; above: PageRow | undefined } {
  const [themed, themedAbove] = themedRows(above ? [row, above] : [row], layers.elements, layers.sections);
  return { row: themed, above: themedAbove };
}

function RowView({
  row,
  above,
  place,
  renderBlock,
  inAdmin = false,
  first = false,
  late = false,
  editable = false,
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
          <RowMarkup
            row={row}
            place={place}
            renderBlock={renderBlock}
            first={first}
            eager={first && !late}
            preview={inAdmin}
            editable={editable}
            meets={meetsAbove(above, row)}
          />
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
  eager = false,
  preview = false,
  editable = false,
  meets = false,
}: {
  row: PageRow;
  place: GridPlace;
  renderBlock?: (block: PageBlock) => ReactNode;
  inPanel?: boolean;
  first?: boolean;
  /** It may be on the first screen: its background pictures load at once (`PartBackground`). */
  eager?: boolean;
  /** The admin's preview: every part but a Never one is drawn (`VisiblePart`). */
  preview?: boolean;
  /** Mark its headings and texts for the staff's "Edit text" (D192). */
  editable?: boolean;
  /** It meets the row above it (D262): the page's room between rows is taken back. */
  meets?: boolean;
}) {
  const box = rowBox(row, "site", inPanel);
  const grid = rowGrid(row);
  // Motion (D128): a row's effects, its columns' (which take the row's entrance when it staggers them) and its blocks'.
  const rowFx = partFx(row.motion, "row", { firstRow: first });
  const lines = columnLines(row);
  // `holder` is the row, or a Columns component drawn as one (D294), whose own column `outer` is in the row.
  const renderColumn = (column: PageColumn, columnIndex: number, holder: PageRow = row, outer?: PageColumn): ReactNode => {
    const col = columnBox(column, holder, "site");
    const colFx = partFx(column.motion, "column", {
      firstRow: first,
      index: columnIndex,
      parentStagger: holder.motion?.enter?.stagger,
      parentEnter: holder.motion?.enter,
    });
    return (
      <VisiblePart key={column.id} show={column.visibility?.show} place={place} preview={preview}>
      <div id={col.id} className={col.className} style={{ ...col.style, ...colFx.style }} {...colFx.attrs}>
        <FontLinks families={partFonts(column)} />
        <PartBackground background={column.background} motion={column.backgroundMotion} firstRow={first} eager={eager} />
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
          if (own === null || themePartLeftOut(block, place)) return null;
          // A heading or text of the page's own that signed-in staff may edit where it stands (D192): marked for them, never on a preview.
          const mark = editable && !preview && place.pageId ? inlineMarkOf({ row, column: outer ?? column, block }, inPanel) : null;
          return (
            <VisiblePart key={block.id} show={block.visibility?.show} place={place} preview={preview}>
            <div id={b.id} className={b.className || undefined} style={{ ...b.style, ...fx.style }} {...fx.attrs} {...(mark && { "data-kz-edit": mark, "data-kz-block": block.id })}>
              <FontLinks families={blockFonts(block)} />
              {own !== undefined ? (
                own
              ) : block.type === "columns" ? (
                renderNested(block, column)
              ) : block.type === "contentGrid" ? (
                <ContentGridSection block={block} place={place} eager={eager} />
              ) : block.type === "menu" ? (
                <MenuSection block={block} place={place} />
              ) : block.type === "search" ? (
                <SearchSection place={place} results={block.results !== false} />
              ) : block.type === "plans" ? (
                <PlansSection block={block} />
              ) : block.type === "themeStore" ? (
                <ThemeStoreSection block={block} place={place} />
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
                <PageBlockView block={block} renderChildren={answerParts} eager={eager} />
              )}
            </div>
            </VisiblePart>
          );
        })}
      </div>
      </VisiblePart>
    );
  };
  /** A Columns component (D294): its lines of columns laid out as a row's, each drawn as a row's column is. */
  const renderNested = (block: ColumnsBlock, outer: PageColumn): ReactNode => {
    const holder = columnsAsRow(block);
    const nestedGrid = rowGrid(holder);
    const nestedLines = columnLines(holder);
    return (
      <div className={nestedGrid.className} style={nestedGrid.style}>
        {nestedLines.length === 1
          ? holder.columns.map((c, i) => renderColumn(c, i, holder, outer))
          : nestedLines.map((line, l) => (
              <div key={line[0]?.id ?? l}>{line.map((c, i) => renderColumn(c, nestedLines.slice(0, l).reduce((n, earlier) => n + earlier.length, 0) + i, holder, outer))}</div>
            ))}
      </div>
    );
  };
  return (
    <div
      className={row.width === "full" || inPanel ? undefined : `mx-auto w-full max-w-(--content-width) ${rowWidthStyle(row).className}`.trim()}
      style={meets ? { marginTop: `calc(${ROW_GAP} * -1)` } : undefined}
    >
      <div id={box.id} className={box.className} style={{ ...box.style, ...rowFx.style }} {...rowFx.attrs}>
        <FontLinks families={partFonts(row)} />
        <PartBackground background={row.background} motion={row.backgroundMotion} firstRow={first} eager={eager} fixed={row.backgroundFixed} align={row.backgroundAlign} />
        <div className={rowInnerClass(row, "site")}>
          <div className={grid.className} style={grid.style}>
            {lines.length === 1
              ? row.columns.map((column, i) => renderColumn(column, i))
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

/** An FAQ's answers' components (D208) as the site draws a column's: each in its box, with its fonts. */
function answerParts(blocks: PageBlock[]): ReactNode {
  return blocks.filter(blockHasContent).map((child) => {
    const b = blockBox(child, "site");
    return (
      <div key={child.id} id={b.id} className={b.className || undefined} style={b.style}>
        <FontLinks families={blockFonts(child)} />
        <PageBlockView block={child} />
      </div>
    );
  });
}
