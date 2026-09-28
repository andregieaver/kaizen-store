"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type Over,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useEffect,
  useEffectEvent,
  useId,
  useState,
  useTransition,
  type CSSProperties,
  type PointerEventHandler,
  type ReactNode,
} from "react";

import { ContentGridView } from "@/components/content-grid";
import { t } from "@/lib/i18n";
import { FontLinks } from "@/components/font-links";

import { HEADING_SIZES as HEADING_SIZE_CLASS, PageBlockView } from "@/components/page-block";
import { PartBackground, blockBox, columnBox, rowBox, rowGrid, rowInnerClass } from "@/components/page-parts";
import {
  BLOCKS_MAX,
  ROW_LAYOUTS,
  ROW_LAYOUT_KEYS,
  ROWS_MAX,
  BLUR_MAX,
  BORDER_MAX,
  BORDER_STYLES,
  BUTTON_LABEL_MAX,
  FONT_WEIGHTS,
  GRID_COLUMNS_MAX,
  GRID_CONTENT,
  GRID_ELEMENTS,
  GRID_GAP_MAX,
  GRID_LIMIT_MAX,
  GRID_SORTS,
  PRICE_SORTS,
  HEADING_DEFAULT_SIZE,
  HEADING_MAX,
  HEADING_SIZES,
  HTML_ID_MAX,
  IMAGE_SHAPES,
  RADIUS_MAX,
  ROW_PADDING,
  SHADOWS,
  SPACING_MAX,
  blockFonts,
  blockHasContent,
  blockText,
  classNameProblem,
  htmlIdProblem,
  isLinkAddress,
  gridImageShape,
  pageBlocks,
  pageParts,
  richTextPlain,
  ALT_MAX,
  type RowBackground,
  type BlockType,
  type BorderStyle,
  type ButtonBlock,
  type FontWeight,
  type HeadingBlock,
  type HeadingLevel,
  type HeadingSize,
  type RichTextBlock,
  type Shadow,
  type ColumnLink,
  type ContentGridBlock,
  type GridColumns,
  type GridContent,
  type GridElement,
  type GridSort,
  type GridSource,
  type ImageShape,
  type PartBase,
  type PageBlock,
  type PageColumn,
  type ImageBlock,
  type PageRow,
  type RowLayout,
  type Sides,
  type Spacing,
  PRODUCT_PARTS,
  SITE_PARTS,
  COLUMN_JUSTIFY,
  LOGO_HEIGHT,
  RELATED_MAX,
  type ProductBlock,
  type ProductPart,
  type MenuBlock,
  type SiteBlock,
  type SitePart,
  type ColumnJustify,
} from "@/lib/page-content";
import {
  copyBlock,
  copyColumn,
  copyRow,
  duplicateBlock,
  duplicateColumn,
  duplicateRow,
  findBlock,
  htmlIds,
  insertBlock,
  insertColumn,
  insertRow,
  moveBlock,
  moveColumnTo,
  moveRow,
  newBlock,
  newRow,
  removeBlock,
  removeColumn,
  removeRow,
  setRowLayout,
  partOf,
  patchBlock,
  patchColumn,
  patchPart,
  patchRow,
  setSpacing,
  spacingOf,
  updateBlock,
  type BlockPatch,
  type RowPatch,
  type Styled,
} from "@/lib/page-rows";
import { blockTextFields, setBlockText } from "@/lib/page-translation";

import type { GridData } from "@/lib/content-grid";
import { siteFontFamilies, type SiteFonts } from "@/lib/fonts";
import { SAVED_KIND_LABELS, SAVED_NAME_MAX, type SavedPart, type SavedPartKind } from "@/lib/saved-parts";
import { byName, categoryTree, type Term } from "@/lib/taxonomy";
import type { GridStore } from "@/server/content-grid";
import type { MenuPreview } from "@/server/menus";

import { ButtonLookFields, Check, Choices, ColorField, editorFor, OptionalColor, TextAlignFields } from "./block-fields";
import { FontPicker, type InstallFont } from "./font-picker";
import { ImageUploadButton, type Upload } from "./image-upload";
import { VideoUploadButton, type StartVideo } from "./video-upload";
import type { PageOwnerContext } from "./page-context";
import { Modal } from "./modal";
import { RichTextEditor } from "./rich-text-editor";

/**
 * The page builder (D43, D44): a left sidebar with tabs (components, rows,
 * and two for later), the canvas, and the page's own settings on the right.
 * The canvas shows the page's rows as the site will:
 * pointing at (or tapping) a row, column or block outlines it and shows its
 * tools, to drag, edit, duplicate or delete it. Rich text is edited in a
 * dialog. Rows are dragged from the sidebar onto the canvas and components
 * into columns; blocks move into any column, columns within their row. The
 * sidebar's tiles also add when pressed, and the drag handles work with the
 * keyboard.
 */

type Rows = (update: (rows: PageRow[]) => PageRow[]) => void;

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** What is dragged, and what it is dropped on. */
type DragData =
  | { kind: "palette-row"; layout: RowLayout }
  | { kind: "palette-block"; type: BlockType; part?: ProductPart | SitePart }
  | { kind: "row"; rowId: string }
  | { kind: "block"; blockId: string; columnId: string }
  | { kind: "column"; columnId: string; rowId: string }
  | { kind: "saved"; partId: string; part: SavedPartKind }
  | { kind: "canvas-end" };

const dataOf = (item: Active | Over | null): DragData | null => (item?.data.current as DragData | undefined) ?? null;
const movesRows = (data: DragData | null) =>
  data?.kind === "palette-row" || data?.kind === "row" || (data?.kind === "saved" && data.part === "row");
/** A column on the page, or a saved one on its way to the page. */
const movesColumn = (data: DragData | null) => data?.kind === "column" || (data?.kind === "saved" && data.part === "column");

/**
 * Rows land between rows; components and blocks land in columns, before or
 * after a block; a column lands beside another column, in any row, or last
 * in the row it is dropped on.
 */
const collision: CollisionDetection = (args) => {
  const active = dataOf(args.active);
  const targets = args.droppableContainers.filter((container) => {
    const data = container.data.current as DragData | undefined;
    if (container.id === args.active.id || !data) return false;
    if (movesRows(active)) return data.kind === "row" || data.kind === "canvas-end";
    if (active?.kind === "column") return data.kind === "column" || data.kind === "row";
    // A saved column can also start a row of its own, last.
    if (movesColumn(active)) return data.kind === "column" || data.kind === "row" || data.kind === "canvas-end";
    return data.kind === "block" || data.kind === "column";
  });
  const within = pointerWithin({ ...args, droppableContainers: targets });
  if (within.length > 0) {
    // The innermost says where: a block rather than its column, a column rather than its row.
    const kindOf = (hit: (typeof within)[number]) => (hit.data?.droppableContainer.data.current as DragData | undefined)?.kind;
    for (const kind of ["block", "column", "row"] as const) {
      const hit = within.find((h) => kindOf(h) === kind);
      if (hit) return [hit];
    }
    return within;
  }
  return closestCenter({ ...args, droppableContainers: targets });
};

type Move = { active: Active; over: Over | null; activatorEvent: Event; delta: { x: number; y: number } };

/**
 * Whether the pointer is below (or, for columns, right of) the middle of
 * what it is over. Dragged with the keyboard, there is no pointer: the
 * dragged item's middle counts instead.
 */
function below({ active, activatorEvent, delta }: Move, over: Over, axis: "y" | "x" = "y"): boolean {
  let point: { x: number; y: number } | null = null;
  if ("clientX" in activatorEvent && typeof activatorEvent.clientX === "number") {
    const start = activatorEvent as PointerEvent;
    point = { x: start.clientX + delta.x, y: start.clientY + delta.y };
  } else {
    const rect = active.rect.current.translated;
    if (rect) point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  if (!point) return false;
  return axis === "y" ? point.y > over.rect.top + over.rect.height / 2 : point.x > over.rect.left + over.rect.width / 2;
}

const blockLabels: Record<BlockType, string> = {
  richText: "Rich text",
  heading: "Heading",
  image: "Image",
  button: "Button",
  contentGrid: "Content grid",
  product: "Product",
  site: "Site",
  menu: "Menu",
  separator: "Separator line",
  dualButton: "Dual button",
  accordion: "Accordion",
  tabs: "Tabs",
  faq: "FAQs",
  video: "Video",
  html: "HTML",
};
/** The palette's components, in order. */
const BLOCK_TYPES = ["richText", "heading", "image", "video", "button", "dualButton", "tabs", "accordion", "faq", "contentGrid", "menu", "separator", "html"] as const satisfies readonly BlockType[];
/** What a block is called when asking before it is deleted. */
const blockThis: Record<BlockType, string> = {
  richText: "this text",
  heading: "this heading",
  image: "this picture",
  button: "this button",
  contentGrid: "this content grid",
  product: "this product component",
  site: "this site component",
  menu: "this menu",
  separator: "this separator line",
  dualButton: "these buttons",
  accordion: "this accordion",
  tabs: "these tabs",
  faq: "these questions",
  video: "this video",
  html: "this HTML",
};

const rowHasText = (row: PageRow) => row.columns.some(columnHasText);
const columnHasText = (column: PageColumn) => column.blocks.some(blockHasText);
/** Worth asking before it is deleted: text written, or a picture chosen. */
const blockHasText = (block: PageBlock) => blockHasContent(block);

/** What a dialog is open for. */
type Dialog =
  | { kind: "edit-block"; blockId: string }
  | { kind: "edit-row"; rowId: string; columnId: string | null }
  | { kind: "delete"; what: string; run: () => void }
  | { kind: "save-as"; part: SavedPartDraft; back: Dialog | null }
  | { kind: "edit-saved"; partId: string };

/** A row, column or component about to be saved, or being changed. */
type SavedPartDraft = Pick<SavedPart, "kind" | "content">;

/**
 * What the builder needs from its page and owner (D53): the page it is
 * on, whose it is, the owner's page terms and (on Kaizen's pages) the
 * stores whose products a content grid can show, and the owner's actions
 * for saved parts and grids.
 */
export type GridContext = {
  pageId: string | null;
  owner: string | null;
  pageTerms: Term[];
  /** The owner's article categories and tags (D57), for a grid of articles. */
  articleTerms: Term[];
  stores: GridStore[];
  /** The owner's menus (D85), for menu components, and where they are edited. */
  menus: MenuPreview[];
  menusHref: string;
  actions: PageOwnerContext["actions"];
};

/**
 * Translating the page (D55): the canvas shows it in another language
 * (`name`), whose texts are edited over the main language's (`mainName`,
 * shown from `source`). Rows, columns and settings are the main language's
 * and cannot change here.
 */
export type Translating = { name: string; mainName: string; source: PageRow[] };

/** What the canvas can ask of the builder. */
type Actions = {
  /** Only texts change while translating (D55). */
  translating: boolean;
  grid: GridContext;
  onRows: Rows;
  open: (dialog: Dialog) => void;
  onAddBlock: (type: BlockType, columnId: string) => void;
  onColumn: (columnId: string) => void;
  blocksFull: boolean;
};

/** The site's own fonts for the canvas, and installing a family a block chooses (D59). */
export type BuilderFonts = {
  site: SiteFonts;
  style: CSSProperties | undefined;
  install: InstallFont;
  /** A store's theme (D60), so the canvas shows its colours and shapes. */
  theme: { css: string; attributes: Record<string, string> } | null;
};

export function PageBuilder({
  rows,
  onRows,
  saved,
  upload,
  startVideo = null,
  aside,
  grid,
  fonts,
  translate = null,
  library = [],
  productParts = false,
  siteParts = null,
}: {
  rows: PageRow[];
  onRows: Rows;
  /** A product layout (D79): its palette offers the product's parts. */
  productParts?: boolean;
  /** A header or footer (D80): its palette offers the site's parts its owner has. */
  siteParts?: SitePart[] | null;
  grid: GridContext;
  fonts: BuilderFonts;
  /** Kaizen's saved parts, for a store's pages: a starter library to copy from, not to change (D56). */
  library?: SavedPart[];
  /** Set while the page's texts are translated (D55). */
  translate?: Translating | null;
  /** Uploads a picture, shrunk in the browser first; null where uploads are not set up. */
  upload: Upload | null;
  /** Starts a row's background video upload; null where uploads are not set up. */
  startVideo?: StartVideo | null;
  /** Kaizen's saved rows, columns and components (D46). */
  saved: SavedPart[];
  aside: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState<DragData | null>(null);
  /** Where a dragged row, component or block would land, to show it. */
  const [target, setTarget] = useState<{ id: string; after: boolean } | null>(null);
  /** The column last worked in, where pressing a component adds it. */
  const [lastColumn, setLastColumn] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [parts, setParts] = useState<SavedPart[]>(saved);
  /** A saved part by id: the owner's, or one from Kaizen's library. */
  const findPart = (id: string) => parts.find((p) => p.id === id) ?? library.find((p) => p.id === id);
  const [tab, setTab] = useState<Tab>("components");
  const blockCount = pageBlocks({ rows }).length;
  const blocksFull = blockCount >= BLOCKS_MAX;
  const rowsFull = rows.length >= ROWS_MAX;

  const addRow = (layout: RowLayout, index = rows.length) => {
    if (!rowsFull) onRows((current) => insertRow(current, newRow(layout, newId), index));
  };
  const addBlock = (type: BlockType, columnId: string | null, index = Number.MAX_SAFE_INTEGER, part?: ProductPart | SitePart) => {
    if (blocksFull) return;
    const block = newBlock(type, newId, part);
    onRows((current) => {
      if (columnId && current.some((r) => r.columns.some((c) => c.id === columnId))) {
        return insertBlock(current, columnId, block, index);
      }
      // No column chosen yet: a new one-column row at the end.
      const row = newRow("1", newId);
      row.columns[0].blocks.push(block);
      return insertRow(current, row, current.length);
    });
    // A new text block opens for writing straight away.
    setDialog({ kind: "edit-block", blockId: block.id });
  };

  /** Puts a copy of a saved part on the page: a row at `index`, a column into a row (or a row of its own), a block into a column. */
  const placeSaved = (
    saved: SavedPart,
    place: { index?: number; rowId?: string; columnIndex?: number; columnId?: string | null; blockIndex?: number } = {},
  ) => {
    const part = library.includes(saved) ? forStore(saved) : saved;
    if (part.kind === "row") {
      // A saved part's custom ids come along unless the page already uses them (D48).
      const row = copyRow(part.content, newId, htmlIds(rows));
      if (!rowsFull) onRows((current) => insertRow(current, row, place.index ?? current.length));
    } else if (part.kind === "column") {
      const column = copyColumn(part.content, newId, htmlIds(rows));
      onRows((current) => {
        if (place.rowId) return insertColumn(current, place.rowId, column, place.columnIndex ?? Number.MAX_SAFE_INTEGER);
        return insertRow(current, { id: newId(), type: "row", layout: "1", columns: [column] }, current.length);
      });
    } else if (!blocksFull) {
      const block = copyBlock(part.content, newId, htmlIds(rows));
      const columnId = place.columnId === undefined ? lastColumn : place.columnId;
      onRows((current) => {
        if (columnId && current.some((r) => r.columns.some((c) => c.id === columnId))) {
          return insertBlock(current, columnId, block, place.blockIndex ?? Number.MAX_SAFE_INTEGER);
        }
        const row = newRow("1", newId);
        row.columns[0].blocks.push(block);
        return insertRow(current, row, current.length);
      });
    }
  };

  const onDragMove = (move: DragMoveEvent) => {
    const { active, over } = move;
    const data = dataOf(over);
    const from = dataOf(active);
    // A column shows where it lands beside another row's columns; in its own row they make room.
    const next = !over
      ? null
      : movesColumn(from)
        ? data?.kind === "column" && (from?.kind !== "column" || data.rowId !== from.rowId)
          ? { id: String(over.id), after: below(move, over, "x") }
          : null
        : data?.kind === "row" || data?.kind === "block"
          ? { id: String(over.id), after: below(move, over) }
          : null;
    setTarget((current) => (current?.id === next?.id && current?.after === next?.after ? current : next));
  };

  const onDragEnd = (end: DragEndEvent) => {
    const { active, over } = end;
    setDragging(null);
    setTarget(null);
    const from = dataOf(active);
    const to = dataOf(over);
    if (!from || !to || !over) return;
    const after = below(end, over);

    if (from.kind === "saved") {
      const part = findPart(from.partId);
      if (!part) return;
      if (part.kind === "row") {
        const index =
          to.kind === "canvas-end" ? rows.length : to.kind === "row" ? rows.findIndex((r) => r.id === to.rowId) : -1;
        if (index >= 0) placeSaved(part, { index: to.kind === "row" && after ? index + 1 : index });
      } else if (part.kind === "column") {
        if (to.kind === "canvas-end") placeSaved(part);
        else if (to.kind === "row") placeSaved(part, { rowId: to.rowId });
        else if (to.kind === "column") {
          const row = rows.find((r) => r.id === to.rowId);
          const index = row?.columns.findIndex((c) => c.id === to.columnId) ?? -1;
          if (row && index >= 0) placeSaved(part, { rowId: row.id, columnIndex: index + (below(end, over, "x") ? 1 : 0) });
        }
      } else if (to.kind === "column" || to.kind === "block") {
        const place = to.kind === "block" ? findBlock(rows, to.blockId) : null;
        placeSaved(part, { columnId: to.columnId, blockIndex: place ? place.index + (after ? 1 : 0) : undefined });
        setLastColumn(to.columnId);
      }
      return;
    }

    if (from.kind === "palette-row" || from.kind === "row") {
      const index =
        to.kind === "canvas-end" ? rows.length : to.kind === "row" ? rows.findIndex((r) => r.id === to.rowId) : -1;
      if (index < 0) return;
      if (from.kind === "palette-row") addRow(from.layout, to.kind === "row" && after ? index + 1 : index);
      // A row already on the page takes the place of the row it is over.
      else onRows((current) => moveRow(current, from.rowId, to.kind === "canvas-end" ? current.length : index));
      return;
    }

    if (from.kind === "column") {
      // Onto a row, outside its columns: last in that row.
      if (to.kind === "row") {
        const row = rows.find((r) => r.id === to.rowId);
        if (row) onRows((current) => moveColumnTo(current, from.columnId, row.id, row.columns.length));
        return;
      }
      if (to.kind !== "column") return;
      const row = rows.find((r) => r.id === to.rowId);
      const index = row?.columns.findIndex((c) => c.id === to.columnId) ?? -1;
      if (!row || index < 0) return;
      // In its own row a column takes the place of the one it is over; elsewhere it goes beside it.
      const place = to.rowId === from.rowId ? index : index + (below(end, over, "x") ? 1 : 0);
      onRows((current) => moveColumnTo(current, from.columnId, row.id, place));
      return;
    }

    if (to.kind !== "column" && to.kind !== "block") return;
    const columnId = to.columnId;
    const place = to.kind === "block" ? findBlock(rows, to.blockId) : null;
    if (from.kind === "palette-block") {
      addBlock(from.type, columnId, place ? place.index + (after ? 1 : 0) : Number.MAX_SAFE_INTEGER, from.part);
      setLastColumn(columnId);
    } else if (from.kind === "block") {
      onRows((current) => {
        if (!place) return moveBlock(current, from.blockId, columnId, Number.MAX_SAFE_INTEGER);
        // In its own column a block takes the place of the one it is over; elsewhere it goes before or after it.
        const index = from.columnId === columnId ? place.index : place.index + (after ? 1 : 0);
        return moveBlock(current, from.blockId, columnId, index);
      });
    }
  };

  const announce = (id: string | number) => {
    const key = String(id);
    const row = rows.findIndex((r) => r.id === key);
    if (row >= 0) return `row ${row + 1}`;
    for (const [r, each] of rows.entries()) {
      const column = each.columns.findIndex((c) => `column:${c.id}` === key);
      if (column >= 0) return `row ${r + 1}, column ${column + 1}`;
    }
    const block = findBlock(rows, key);
    if (block) return `a block in row ${rows.findIndex((r) => r.id === block.rowId) + 1}`;
    return "the page";
  };

  const actions: Actions = {
    translating: translate !== null,
    grid,
    onRows,
    open: setDialog,
    onAddBlock: (type, columnId) => {
      addBlock(type, columnId);
      setLastColumn(columnId);
    },
    onColumn: setLastColumn,
    blocksFull,
  };

  return (
    <DndContext
      id="page-builder"
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={({ active }) => setDragging(dataOf(active))}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setTarget(null);
      }}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${announce(active.id)}.`,
          onDragOver: ({ over }) => (over ? `Over ${announce(over.id)}.` : undefined),
          onDragEnd: ({ over }) => (over ? `Dropped at ${announce(over.id)}.` : "Dropped."),
          onDragCancel: () => "Moving was cancelled.",
        },
        screenReaderInstructions: {
          draggable: "To move it, press Space or Enter, then the arrow keys, and Space or Enter again to drop it.",
        },
      }}
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
        {translate ? (
          <TranslateNote translate={translate} />
        ) : (
        <Sidebar
          tab={tab}
          onTab={setTab}
          onAddRow={(layout) => addRow(layout)}
          onAddBlock={(type, part) => addBlock(type, lastColumn, Number.MAX_SAFE_INTEGER, part)}
          productParts={productParts}
          siteParts={siteParts}
          parts={parts}
          library={library}
          onOpenSaved={(partId) => setDialog({ kind: "edit-saved", partId })}
          onUseLibrary={(part) => placeSaved(part)}
          rowsFull={rowsFull}
          blocksFull={blocksFull}
        />
        )}

        {/* The canvas draws with the site's own fonts (D59) and a store's theme (D60), as the site does. */}
        <div
          style={fonts.style}
          className={`min-w-0 ${fonts.theme ? "rounded-md bg-background text-foreground" : ""}`}
          {...(fonts.theme && { ...fonts.theme.attributes, "data-theme-canvas": "" })}
        >
          <FontLinks families={siteFontFamilies(fonts.site)} />
          {fonts.theme && <style>{fonts.theme.css}</style>}
          <Canvas rows={rows} dragging={dragging} target={target} actions={actions} />
        </div>

        {/* On phones the title and settings come first. */}
        <div className="order-first flex min-w-0 flex-col gap-6 lg:order-none">{aside}</div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging?.kind === "palette-row" ? (
          <Tile label={ROW_LAYOUTS[dragging.layout].label} preview={<LayoutPreview layout={dragging.layout} />} lifted />
        ) : dragging?.kind === "palette-block" ? (
          <Tile
            label={
              dragging.part
                ? dragging.type === "site"
                  ? SITE_PARTS[dragging.part as SitePart]
                  : PRODUCT_PARTS[dragging.part as ProductPart]
                : blockLabels[dragging.type]
            }
            preview={<BlockIcon type={dragging.type} />}
            lifted
          />
        ) : dragging?.kind === "block" ? (
          <BlockPreview block={findBlock(rows, dragging.blockId)?.block ?? null} />
        ) : dragging?.kind === "saved" ? (
          <SavedTile part={findPart(dragging.partId) ?? null} lifted />
        ) : dragging?.kind === "column" ? (
          <ColumnPreview column={rows.flatMap((r) => r.columns).find((c) => c.id === dragging.columnId) ?? null} />
        ) : null}
      </DragOverlay>

      <Dialogs
        dialog={dialog}
        rows={rows}
        onRows={onRows}
        open={setDialog}
        onClose={() => setDialog(null)}
        parts={parts}
        onParts={(next, savedId) => {
          setParts(next);
          if (savedId) setTab("saved");
        }}
        onUse={(part) => placeSaved(part)}
        upload={upload}
        startVideo={startVideo}
        grid={grid}
        fonts={fonts}
        translate={translate}
      />
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// The left sidebar
// ---------------------------------------------------------------------------

const TABS = [
  { key: "components", label: "Components" },
  { key: "rows", label: "Rows" },
  { key: "saved", label: "Saved" },
  { key: "layers", label: "Layers" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Sidebar({
  tab,
  onTab: setTab,
  onAddRow,
  onAddBlock,
  productParts,
  siteParts,
  parts,
  library,
  onOpenSaved,
  onUseLibrary,
  rowsFull,
  blocksFull,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  onAddRow: (layout: RowLayout) => void;
  onAddBlock: (type: BlockType, part?: ProductPart | SitePart) => void;
  productParts: boolean;
  /** A header or footer (D80): the site parts its owner has. */
  siteParts: SitePart[] | null;
  parts: SavedPart[];
  library: SavedPart[];
  onOpenSaved: (partId: string) => void;
  onUseLibrary: (part: SavedPart) => void;
  rowsFull: boolean;
  blocksFull: boolean;
}) {
  const id = useId();
  const select = (index: number) => {
    const next = TABS[(index + TABS.length) % TABS.length].key;
    setTab(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <aside
      aria-label="Building blocks"
      className="flex min-w-0 flex-col rounded-lg border border-border bg-background lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
    >
      <div role="tablist" aria-label="Building blocks" className="grid grid-cols-4 border-b border-border">
        {TABS.map((t, index) => (
          <button
            key={t.key}
            id={`${id}-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`${id}-${t.key}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") select(index + 1);
              if (event.key === "ArrowLeft") select(index - 1);
            }}
            className="min-h-11 truncate border-b-2 border-transparent px-1 text-xs font-medium text-muted aria-selected:border-foreground aria-selected:text-foreground"
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div
          key={t.key}
          id={`${id}-${t.key}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${t.key}`}
          hidden={tab !== t.key}
          className="flex flex-col gap-3 p-4"
        >
          {t.key === "components" && (
            <>
              <p className="text-xs text-muted">
                Drag a component into a column, or press it to add it to the column you last worked in.
              </p>
              {productParts && (
                <>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">The product</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {PRODUCT_PART_KEYS.map((part) => (
                      <PaletteTile
                        key={part}
                        id={`palette:product:${part}`}
                        data={{ kind: "palette-block", type: "product", part }}
                        label={PRODUCT_PARTS[part]}
                        preview={<BlockIcon type="product" />}
                        onAdd={() => onAddBlock("product", part)}
                        disabled={blocksFull}
                      />
                    ))}
                  </div>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Around it</h3>
                </>
              )}
              {siteParts && (
                <>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">The site</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {siteParts.map((part) => (
                      <PaletteTile
                        key={part}
                        id={`palette:site:${part}`}
                        data={{ kind: "palette-block", type: "site", part }}
                        label={SITE_PARTS[part]}
                        preview={<BlockIcon type="site" />}
                        onAdd={() => onAddBlock("site", part)}
                        disabled={blocksFull}
                      />
                    ))}
                  </div>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">More</h3>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                {BLOCK_TYPES.map((type) => (
                  <PaletteTile
                    key={type}
                    id={`palette:block:${type}`}
                    data={{ kind: "palette-block", type }}
                    label={blockLabels[type]}
                    preview={<BlockIcon type={type} />}
                    onAdd={() => onAddBlock(type)}
                    disabled={blocksFull}
                  />
                ))}
              </div>
            </>
          )}
          {t.key === "rows" && (
            <>
              <p className="text-xs text-muted">
                Drag a row onto the page, or press it to add it at the end. Each row holds its columns side by side;
                on phones they stack.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {ROW_LAYOUT_KEYS.map((layout) => (
                  <PaletteTile
                    key={layout}
                    id={`palette:row:${layout}`}
                    data={{ kind: "palette-row", layout }}
                    label={ROW_LAYOUTS[layout].label}
                    preview={<LayoutPreview layout={layout} />}
                    onAdd={() => onAddRow(layout)}
                    disabled={rowsFull}
                  />
                ))}
              </div>
            </>
          )}
          {t.key === "saved" && (
            <>
              <SavedList parts={parts} onOpen={onOpenSaved} />
              {library.length > 0 && <LibraryList parts={library} onUse={onUseLibrary} />}
            </>
          )}
          {t.key === "layers" && <p className="text-sm text-muted">Coming soon.</p>}
        </div>
      ))}
    </aside>
  );
}

/**
 * A tile to drag onto the page. Only the pointer drags it: the keyboard
 * presses it like any button, which adds it.
 */
function PaletteTile({
  id,
  data,
  label,
  preview,
  onAdd,
  disabled,
}: {
  id: string;
  data: DragData;
  label: string;
  preview: ReactNode;
  onAdd: () => void;
  disabled: boolean;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, data, disabled });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLButtonElement> | undefined}
      onClick={onAdd}
      disabled={disabled}
      aria-label={`Add ${label.toLowerCase()}`}
      className={`touch-none text-left disabled:opacity-40 ${isDragging ? "opacity-40" : ""}`}
    >
      <Tile label={label} preview={preview} />
    </button>
  );
}

function Tile({ label, preview, lifted = false }: { label: string; preview: ReactNode; lifted?: boolean }) {
  return (
    <span
      className={`flex cursor-grab flex-col gap-2 rounded-md p-1 hover:bg-surface ${lifted ? "w-36 bg-background shadow-xl" : ""}`}
    >
      {preview}
      <span className="text-xs">{label}</span>
    </span>
  );
}

/** A row's columns as bars, like a small picture of the row. */
function LayoutPreview({ layout }: { layout: RowLayout }) {
  return (
    <span aria-hidden className="flex h-9 gap-1">
      {ROW_LAYOUTS[layout].widths.map((width, index) => (
        // A column as wide as what it holds (0, D80) shows as a narrow bar.
        <span key={index} style={width ? { flexGrow: width } : { flexBasis: "0.75rem" }} className={`${width ? "basis-0" : "shrink-0"} rounded-sm bg-foreground/75`} />
      ))}
    </span>
  );
}

/**
 * Saved rows, columns and components (D46), by kind. Drag one onto the page
 * to use a copy; press one to change it (or add it from there).
 */
function SavedList({ parts, onOpen }: { parts: SavedPart[]; onOpen: (partId: string) => void }) {
  if (parts.length === 0) {
    return (
      <p className="text-xs text-muted">
        Nothing saved yet. Open a row&apos;s, column&apos;s or component&apos;s settings (the wrench) and choose Save as.
      </p>
    );
  }
  return (
    <>
      <p className="text-xs text-muted">
        Drag one onto the page to use a copy, or press it to change it. Pages that use it keep their own copy.
      </p>
      {(["row", "column", "block"] as const).map((kind) => {
        const own = parts.filter((p) => p.kind === kind);
        if (own.length === 0) return null;
        return (
          <section key={kind} aria-label={SAVED_KIND_LABELS[kind].many} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{SAVED_KIND_LABELS[kind].many}</h3>
            <ul className="flex flex-col gap-1">
              {own.map((part) => (
                <li key={part.id}>
                  <SavedItem part={part} onOpen={() => onOpen(part.id)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/**
 * Kaizen's saved parts in a store's builder (D56): a starter library. Each
 * is dragged onto the page, or pressed to add it where the last work was;
 * the store gets a copy and the library stays as it is.
 */
function LibraryList({ parts, onUse }: { parts: SavedPart[]; onUse: (part: SavedPart) => void }) {
  return (
    <section aria-labelledby="library-heading" className="mt-2 flex flex-col gap-3 border-t border-border pt-4">
      <div>
        <h3 id="library-heading" className="text-sm font-medium">
          Kaizen&apos;s library
        </h3>
        <p className="text-xs text-muted">Ready-made parts to start from. Drag one onto the page, or press it to add a copy.</p>
      </div>
      {(["row", "column", "block"] as const).map((kind) => {
        const own = parts.filter((p) => p.kind === kind);
        if (own.length === 0) return null;
        return (
          <section key={kind} aria-label={`Library ${SAVED_KIND_LABELS[kind].many.toLowerCase()}`} className="flex flex-col gap-2">
            <h4 className="text-xs font-medium tracking-wide text-muted uppercase">{SAVED_KIND_LABELS[kind].many}</h4>
            <ul className="flex flex-col gap-1">
              {own.map((part) => (
                <li key={part.id}>
                  <SavedItem part={part} onOpen={() => onUse(part)} action="add a copy" />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

/**
 * A part from Kaizen's library made fit for a store's page (D56): its
 * content grids show the store's own products and drop Kaizen's categories
 * and tags, which are not the store's.
 */
function forStore(part: SavedPart): SavedPart {
  const block = (b: PageBlock): PageBlock =>
    b.type === "contentGrid"
      ? { ...b, source: b.source.type === "products" ? { type: "products" } : b.source, categories: [], tags: [] }
      : b;
  const column = (c: PageColumn): PageColumn => ({ ...c, blocks: c.blocks.map(block) });
  if (part.kind === "block") return { ...part, content: block(part.content) };
  if (part.kind === "column") return { ...part, content: column(part.content) };
  return { ...part, content: { ...part.content, columns: part.content.columns.map(column) } };
}

/** A saved part: the pointer drags it onto the page; pressing it (mouse or keyboard) opens it. */
function SavedItem({ part, onOpen, action = "open to change or add" }: { part: SavedPart; onOpen: () => void; action?: string }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `saved:${part.id}`,
    data: { kind: "saved", partId: part.id, part: part.kind } satisfies DragData,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLButtonElement> | undefined}
      onClick={onOpen}
      aria-label={`${part.name}, saved ${SAVED_KIND_LABELS[part.kind].one.toLowerCase()}: ${action}`}
      className={`w-full touch-none text-left ${isDragging ? "opacity-40" : ""}`}
    >
      <SavedTile part={part} />
    </button>
  );
}

function SavedTile({ part, lifted = false }: { part: SavedPart | null; lifted?: boolean }) {
  if (!part) return null;
  return (
    <span
      className={`flex cursor-grab items-center gap-3 rounded-md border border-border p-2 hover:bg-surface ${
        lifted ? "w-56 bg-background shadow-xl" : ""
      }`}
    >
      <span className="w-12 shrink-0">
        {part.kind === "row" ? (
          <LayoutPreview layout={part.content.layout} />
        ) : part.kind === "column" ? (
          <span aria-hidden className="flex h-9 justify-center">
            <span className="w-4 rounded-sm bg-foreground/75" />
          </span>
        ) : (
          <BlockIcon type={part.content.type} />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{part.name}</span>
        <span className="text-xs text-muted">{SAVED_KIND_LABELS[part.kind].one}</span>
      </span>
    </span>
  );
}

/** A block on its way to another place: its kind and the start of its text. */
function BlockPreview({ block }: { block: PageBlock | null }) {
  if (!block) return null;
  const text = (blockText(block) || (block.type === "button" ? block.label : "")).replace(/\s+/g, " ").trim();
  return (
    <div className="w-64 rounded-md border border-foreground bg-background p-3 shadow-xl">
      <p className="text-xs text-muted">{blockLabels[block.type]}</p>
      <p className="truncate text-sm">{text || "Empty"}</p>
    </div>
  );
}

/** A column on its way to another place: how many blocks it takes, and the start of its text. */
function ColumnPreview({ column }: { column: PageColumn | null }) {
  if (!column) return null;
  const text = column.blocks.map(blockText).join(" ").replace(/\s+/g, " ").trim();
  const count = column.blocks.length;
  return (
    <div className="w-64 rounded-md border-2 border-dashed border-blue-600 bg-background p-3 shadow-xl">
      <p className="text-xs text-muted">
        Column · {count === 1 ? "1 component" : `${count} components`}
      </p>
      <p className="truncate text-sm">{text || "Empty"}</p>
    </div>
  );
}

function BlockIcon({ type }: { type: BlockType }) {
  switch (type) {
    case "image":
      return <ImageIcon />;
    case "heading":
      return <LetterIcon letter="H" bold />;
    case "button":
      return <ButtonIcon />;
    case "contentGrid":
      return <GridIcon />;
    case "product":
      return <ProductIcon />;
    case "site":
      return <SiteIcon />;
    case "menu":
      return <MenuIcon />;
    case "separator":
      return <SeparatorIcon />;
    case "dualButton":
      return <DualButtonIcon />;
    case "accordion":
      return <AccordionIcon />;
    case "tabs":
      return <TabsIcon />;
    case "faq":
      return <LetterIcon letter="?" bold />;
    case "video":
      return <VideoIcon />;
    case "html":
      return <HtmlIcon />;
    default:
      return <LetterIcon letter="T" />;
  }
}

function HtmlIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
      </svg>
    </span>
  );
}

function VideoIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m10 9 5 3-5 3z" fill="currentColor" />
      </svg>
    </span>
  );
}

function TabsIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col justify-center rounded-sm bg-foreground/75 px-2 text-background">
      <span className="flex gap-0.5">
        <span className="h-2 w-5 rounded-t-sm border-2 border-b-0 border-current" />
        <span className="mt-1 h-1 w-4 rounded-t-sm bg-current opacity-60" />
        <span className="mt-1 h-1 w-4 rounded-t-sm bg-current opacity-60" />
      </span>
      <span className="h-3.5 w-full rounded-sm rounded-tl-none border-2 border-current" />
    </span>
  );
}

function AccordionIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col justify-center gap-0.5 rounded-sm bg-foreground/75 px-3 text-background">
      {["▾", "▸", "▸"].map((mark, i) => (
        <span key={i} className="flex items-center justify-between border-b border-current/40 text-[8px] leading-[10px]">
          <span className="h-0.5 w-6 rounded-full bg-current" />
          {mark}
        </span>
      ))}
    </span>
  );
}

function DualButtonIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center gap-1 rounded-sm bg-foreground/75 text-background">
      <span className="h-3.5 w-5 rounded-full bg-current" />
      <span className="h-3.5 w-5 rounded-full border-2 border-current" />
    </span>
  );
}

function SeparatorIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col items-center justify-center gap-1 rounded-sm bg-foreground/75 text-background">
      <span className="h-0.5 w-8 rounded-full bg-current opacity-50" />
      <span className="h-0.5 w-10 rounded-full bg-current" />
      <span className="h-0.5 w-8 rounded-full bg-current opacity-50" />
    </span>
  );
}

function GridIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <span className="grid grid-cols-3 gap-0.5">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="size-2 rounded-[2px] bg-current" />
        ))}
      </span>
    </span>
  );
}

function ButtonIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <span className="rounded-full border-2 border-current px-2 text-[10px] leading-4 font-semibold">OK</span>
    </span>
  );
}

function ImageIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="M21 16l-5-5-8 8" />
      </svg>
    </span>
  );
}

function LetterIcon({ letter, bold = false }: { letter: string; bold?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-9 items-center justify-center rounded-sm bg-foreground/75 font-serif text-lg text-background ${bold ? "font-bold" : ""}`}
    >
      {letter}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

/**
 * The page as the site shows it (the same markup and spacing as
 * `PageArticle`). Rows get 16 px of room around them and columns 8 px above
 * and below, taken back by negative margins, so each can be pointed at
 * outside what it holds.
 */
function Canvas({
  rows,
  dragging,
  target,
  actions,
}: {
  rows: PageRow[];
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  actions: Actions;
}) {
  return (
    <section
      aria-labelledby="content-heading"
      data-builder-dragging={dragging ? "" : undefined}
      // Links in the text are for visitors; in the editor they do nothing.
      onClickCapture={(event) => {
        if ((event.target as Element).closest("a")) event.preventDefault();
      }}
      className="min-w-0 rounded-lg border border-border bg-background px-6 pt-10 pb-8"
    >
      <h2 id="content-heading" className="sr-only">
        Content
      </h2>
      <div className="flex flex-col gap-8">
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-8">
            {rows.map((row, index) => (
              <RowItem
                key={row.id}
                row={row}
                name={`Row ${index + 1}`}
                line={target?.id === row.id && dragging?.kind !== "row" ? (target.after ? "after" : "before") : null}
                dragging={dragging}
                target={target}
                actions={actions}
              />
            ))}
          </ol>
        </SortableContext>
        <CanvasEnd empty={rows.length === 0} active={movesRows(dragging)} />
      </div>
    </section>
  );
}

/** Below the last row: where a row dropped goes last, and what an empty page says. */
function CanvasEnd({ empty, active }: { empty: boolean; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas-end", data: { kind: "canvas-end" } satisfies DragData });
  if (!empty && !active) return <div ref={setNodeRef} className="-mt-8" />;
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-28 items-center justify-center rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted ${
        isOver ? "border-blue-600 bg-surface" : "border-border"
      }`}
    >
      {empty ? "The page is empty. Drag a row here from Rows, or press one to add it." : "Drop the row here to put it last."}
    </div>
  );
}

/** Where a dragged row or block will land, or (`vertical`) a column beside the columns of a row. */
function Line({ at, vertical = false }: { at: "before" | "after" | null; vertical?: boolean }) {
  if (!at) return null;
  const place = vertical
    ? `inset-y-0 w-1 ${at === "before" ? "-left-[18px]" : "-right-[18px]"}`
    : `inset-x-0 h-1 ${at === "before" ? "-top-3" : "-bottom-3"}`;
  return <span aria-hidden className={`pointer-events-none absolute z-30 rounded-full bg-blue-600 ${place}`} />;
}

const toolClass =
  "flex size-7 items-center justify-center rounded hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40";
/** A drag handle in the tools; the button is made where `useSortable` is, with its ref and listeners. */
const handleClass = `${toolClass} cursor-grab touch-none active:cursor-grabbing`;

/**
 * A row, column or block's tools: shown with its outline while it is
 * pointed at or holds the focus, and only for the innermost one (the rules
 * are in globals.css, `[data-builder-item]`).
 */
function Tools({
  label,
  handle,
  onEdit,
  editLabel,
  onDuplicate,
  duplicateDisabled = false,
  onDelete,
  deleteDisabled = false,
}: {
  label: string;
  /** The drag handle, made where `useSortable` is (see `handleClass`); none while translating. */
  handle?: ReactNode;
  onEdit: () => void;
  editLabel: string;
  onDuplicate?: () => void;
  duplicateDisabled?: boolean;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  const tool = toolClass;
  const lower = label.toLowerCase();
  return (
    <div
      data-builder-tools
      className="absolute top-0 left-0 z-20 flex -translate-y-full items-center gap-0.5 rounded-t-md bg-blue-600 px-1 text-white shadow"
    >
      {handle}
      <button type="button" onClick={onEdit} aria-label={`${editLabel} (${lower})`} title={editLabel} className={tool}>
        <Icon name="wrench" />
      </button>
      {onDuplicate && (
        <button
          type="button"
          onClick={onDuplicate}
          disabled={duplicateDisabled}
          aria-label={`Duplicate ${lower}`}
          title="Duplicate"
          className={tool}
        >
          <Icon name="copy" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled}
          aria-label={`Delete ${lower}`}
          title="Delete"
          className={tool}
        >
          <Icon name="trash" />
        </button>
      )}
      <span className="px-1 text-xs whitespace-nowrap">{label}</span>
    </div>
  );
}

function RowItem({
  row,
  name,
  line,
  dragging,
  target,
  actions,
}: {
  row: PageRow;
  name: string;
  line: "before" | "after" | null;
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  actions: Actions;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    data: { kind: "row", rowId: row.id } satisfies DragData,
    disabled: actions.translating,
  });
  const remove = () => actions.onRows((rows) => removeRow(rows, row.id));
  const box = rowBox(row, "canvas");
  const grid = rowGrid(row);

  return (
    <li
      ref={setNodeRef}
      data-builder-item="row"
      tabIndex={0}
      aria-label={`${name}, ${ROW_LAYOUTS[row.layout].label.toLowerCase()}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // A full-width row reaches the canvas's edges; its band for pointing is then above and below only.
      className={`${row.width === "full" ? "-mx-6 -my-4 py-4" : "-m-4 p-4"} ${isDragging ? "z-30 bg-background opacity-80 shadow-xl" : ""}`}
    >
      {!actions.translating && (
      <Tools
        label={name}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${name.toLowerCase()} to move it`}
            className={handleClass}
          >
            <Icon name="grip" />
          </button>
        }
        onEdit={() => actions.open({ kind: "edit-row", rowId: row.id, columnId: null })}
        editLabel="Settings"
        onDuplicate={() => actions.onRows((rows) => duplicateRow(rows, row.id, newId))}
        onDelete={() => (rowHasText(row) ? actions.open({ kind: "delete", what: `${name.toLowerCase()} and everything in it`, run: remove }) : remove())}
      />
      )}
      <Line at={line} />
      <SortableContext items={row.columns.map((c) => `column:${c.id}`)} strategy={horizontalListSortingStrategy}>
        <div className={box.className} style={box.style}>
          <PartBackground background={row.background} />
          <div className={rowInnerClass(row, "canvas")}>
            <div className={grid.className} style={grid.style}>
              {row.columns.map((column, index) => (
                <ColumnItem
                  key={column.id}
                  column={column}
                  row={row}
                  name={`${name}, column ${index + 1}`}
                  dragging={dragging}
                  target={target}
                  actions={actions}
                />
              ))}
            </div>
          </div>
        </div>
      </SortableContext>
    </li>
  );
}

function ColumnItem({
  column,
  row,
  name,
  dragging,
  target,
  actions,
}: {
  column: PageColumn;
  row: PageRow;
  name: string;
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  actions: Actions;
}) {
  const rowId = row.id;
  const count = row.columns.length;
  const box = columnBox(column, row, "canvas");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: `column:${column.id}`,
    data: { kind: "column", columnId: column.id, rowId } satisfies DragData,
    disabled: actions.translating,
  });
  const droppingBlock = dragging?.kind === "palette-block" || dragging?.kind === "block";
  const remove = () => actions.onRows((rows) => removeColumn(rows, column.id));
  const columnLine = target?.id === `column:${column.id}` ? (target.after ? "after" : "before") : null;
  // A block from its own column shows its new place by moving; anything else by a line.
  const line = (blockId: string) =>
    target?.id === blockId && !(dragging?.kind === "block" && dragging.columnId === column.id)
      ? target.after
        ? "after"
        : "before"
      : null;

  return (
    <div
      ref={setNodeRef}
      data-builder-item="column"
      tabIndex={0}
      role="group"
      aria-label={name}
      onFocusCapture={() => actions.onColumn(column.id)}
      onPointerDownCapture={() => actions.onColumn(column.id)}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`-my-2 flex min-w-0 flex-col gap-6 rounded-sm py-2 ${isDragging ? "opacity-40" : ""} ${
        droppingBlock && isOver ? "bg-blue-50 dark:bg-blue-950" : ""
      }`}
    >
      {actions.translating ? (
        // Translating, a column has only its link's description to say (D55).
        column.link && (
          <Tools
            label={name.replace(/^Row \d+, c/, "C")}
            onEdit={() => actions.open({ kind: "edit-row", rowId, columnId: column.id })}
            editLabel="Translate"
          />
        )
      ) : (
      <Tools
        label={name.replace(/^Row \d+, c/, "C")}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${name.toLowerCase()} to move it`}
            className={handleClass}
          >
            <Icon name="grip" />
          </button>
        }
        onEdit={() => actions.open({ kind: "edit-row", rowId, columnId: column.id })}
        editLabel="Settings"
        onDuplicate={() => actions.onRows((rows) => duplicateColumn(rows, column.id, newId))}
        duplicateDisabled={count >= 6}
        onDelete={() =>
          columnHasText(column) ? actions.open({ kind: "delete", what: `${name.toLowerCase()} and its text`, run: remove }) : remove()
        }
        deleteDisabled={count <= 1}
      />
      )}
      <Line at={columnLine} vertical />
      {/* The column itself, as the site draws it, inside its band for pointing. */}
      <div className={box.className} style={box.style}>
      <PartBackground background={column.background} />
      {column.link && (
        <span className="pointer-events-none absolute top-0 right-0 z-10 max-w-[80%] -translate-y-full truncate rounded-t bg-foreground/80 px-1.5 py-0.5 text-[11px] text-background">
          Links to {column.link.href || "…"}
        </span>
      )}
      <SortableContext items={column.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        {column.blocks.map((block, index) => (
          <BlockItem
            key={block.id}
            block={block}
            columnId={column.id}
            name={`${name}, ${blockLabels[block.type].toLowerCase()} ${index + 1}`}
            line={line(block.id)}
            actions={actions}
          />
        ))}
      </SortableContext>
      {column.blocks.length === 0 && !actions.translating && (
        <div
          className={`flex min-h-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed p-3 text-center text-xs text-muted ${
            droppingBlock ? "border-blue-600" : "border-border"
          }`}
        >
          Drag a component here
          <button
            type="button"
            onClick={() => actions.onAddBlock("richText", column.id)}
            disabled={actions.blocksFull}
            aria-label={`Add rich text to ${name.toLowerCase()}`}
            className="underline hover:text-foreground disabled:opacity-40"
          >
            or add rich text
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

function BlockItem({
  block,
  columnId,
  name,
  line,
  actions,
}: {
  block: PageBlock;
  columnId: string;
  name: string;
  line: "before" | "after" | null;
  actions: Actions;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    data: { kind: "block", blockId: block.id, columnId } satisfies DragData,
    disabled: actions.translating,
  });
  const remove = () => actions.onRows((rows) => removeBlock(rows, block.id));
  const edit = () => actions.open({ kind: "edit-block", blockId: block.id });

  return (
    <div
      ref={setNodeRef}
      data-builder-item="block"
      tabIndex={0}
      role="group"
      aria-label={name}
      onDoubleClick={edit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          event.preventDefault();
          edit();
        }
      }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "opacity-40" : ""}
    >
      {actions.translating ? (
        <Tools label={blockLabels[block.type]} onEdit={edit} editLabel="Translate" />
      ) : (
      <Tools
        label={blockLabels[block.type]}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${name.toLowerCase()} to move it`}
            className={handleClass}
          >
            <Icon name="grip" />
          </button>
        }
        onEdit={edit}
        editLabel="Edit"
        onDuplicate={() => actions.onRows((rows) => duplicateBlock(rows, block.id, newId))}
        onDelete={() =>
          blockHasText(block)
            ? actions.open({ kind: "delete", what: blockThis[block.type], run: remove })
            : remove()
        }
      />
      )}
      <Line at={line} />
      <div className={blockBox(block, "canvas").className || undefined} style={blockBox(block, "canvas").style}>
        <FontLinks families={blockFonts(block)} />
        {block.type === "contentGrid" ? (
          <GridPreview block={block} grid={actions.grid} />
        ) : block.type === "product" ? (
          <ProductStandIn block={block} />
        ) : block.type === "site" ? (
          <SiteStandIn block={block} />
        ) : block.type === "menu" && blockHasContent(block) ? (
          <MenuStandIn block={block} menus={actions.grid.menus} />
        ) : blockHasContent(block) ? (
          <PageBlockView block={block} />
        ) : (
          <p className="rounded-md bg-surface p-3 text-sm text-muted">{EMPTY_BLOCK[block.type]}</p>
        )}
      </div>
    </div>
  );
}

/** What the canvas shows for a block with nothing to show yet. */
const EMPTY_BLOCK: Record<BlockType, string> = {
  richText: "Empty text. Double-click or use the wrench to write.",
  heading: "Empty heading. Double-click or use the wrench to write it.",
  image: "No picture yet. Double-click or use the wrench to choose one.",
  button: "A button needs its text and an address. Double-click or use the wrench.",
  contentGrid: "Content grid.",
  product: "Product component.",
  site: "Site component.",
  menu: "A menu: double-click or use the wrench to choose which.",
  separator: "Separator line.",
  dualButton: "Two buttons, each needing its text and an address. Double-click or use the wrench.",
  accordion: "An accordion: its sections need titles. Double-click or use the wrench.",
  tabs: "Tabs: each needs a title. Double-click or use the wrench.",
  faq: "Questions and answers: each needs both. Double-click or use the wrench.",
  video: "No video yet. Double-click or use the wrench to upload one or give a YouTube or Vimeo address.",
  html: "No HTML yet. Double-click or use the wrench to paste some.",
};

export { ColorField };

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function Dialogs({
  dialog,
  rows,
  onRows,
  open,
  onClose,
  parts,
  onParts,
  onUse,
  upload,
  startVideo,
  grid,
  fonts,
  translate,
}: {
  grid: GridContext;
  fonts: BuilderFonts;
  translate: Translating | null;
  dialog: Dialog | null;
  rows: PageRow[];
  onRows: Rows;
  open: (dialog: Dialog) => void;
  onClose: () => void;
  parts: SavedPart[];
  /** New saved parts from the server; `savedId` when one was just saved. */
  onParts: (parts: SavedPart[], savedId?: string) => void;
  onUse: (part: SavedPart) => void;
  upload: Upload | null;
  startVideo: StartVideo | null;
}) {
  if (translate) return <TranslateDialogs dialog={dialog} rows={rows} onRows={onRows} onClose={onClose} translate={translate} />;
  const done = (
    <button type="button" onClick={onClose} className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
      Done
    </button>
  );
  const saveAs = (part: SavedPartDraft) => (
    <button
      type="button"
      onClick={() => open({ kind: "save-as", part, back: dialog })}
      className="mr-auto min-h-10 rounded-md border border-border px-4 text-sm"
    >
      Save as…
    </button>
  );
  const block = dialog?.kind === "edit-block" ? findBlock(rows, dialog.blockId)?.block : null;
  const editor = block ? editorFor(block) : undefined;
  const row = dialog?.kind === "edit-row" ? rows.find((r) => r.id === dialog.rowId) : null;
  const column = dialog?.kind === "edit-row" && dialog.columnId ? row?.columns.find((c) => c.id === dialog.columnId) : null;
  const savedPart = dialog?.kind === "edit-saved" ? parts.find((p) => p.id === dialog.partId) : null;
  const layoutChoice = (row: PageRow) => (
    <LayoutChoice value={row.layout} onChange={(layout) => onRows((current) => setRowLayout(current, row.id, layout, newId))} />
  );
  /** The id and classes of the row, column or block a dialog is for (D48). */
  const advancedFields = (target: Styled) => {
    const part = partOf(rows, target);
    if (!part) return null;
    const others = new Set(
      pageParts(rows).flatMap((p) => (p !== part && p.htmlId ? [p.htmlId.trim()] : [])),
    );
    return (
      <AdvancedFields part={part} taken={others} onChange={(patch) => onRows((current) => patchPart(current, target, patch))} />
    );
  };
  /** The border, rounded corners and shadow of the row, column or block a dialog is for (D49). */
  const frameFields = (target: Styled) => (
    <FrameFields
      value={partOf(rows, target) ?? {}}
      onChange={(patch) => onRows((current) => patchPart(current, target, patch))}
    />
  );
  /** A block's own font (D59), over the site's; `fallback` says what none means. */
  const fontField = (label: string, value: string | undefined, fallback: string, onChange: (font: string | undefined) => void) => (
    <FontPicker label={label} value={value} defaultLabel={fallback} install={fonts.install} onChange={onChange} />
  );
  /** Margin and padding of the row, column or block a dialog is for (D47). */
  const spacingFields = (target: Styled) => (
    <SpacingFields
      value={spacingOf(rows, target)}
      defaults={target.kind === "row" ? { padding: ROW_PADDING } : undefined}
      onChange={(style) => onRows((current) => setSpacing(current, target, style))}
    />
  );

  return (
    <>
      <Modal
        open={block?.type === "richText"}
        onClose={onClose}
        title="Edit rich text"
        footer={
          block && (
            <>
              {saveAs({ kind: "block", content: block })}
              {done}
            </>
          )
        }
        wide
      >
        {block?.type === "richText" && (
          <SettingsTabs
            key={block.id}
            general={
              <RichTextEditor
                // A new block opens with nothing written; the editor starts from what is stored.
                key={block.id}
                value={block.doc}
                onChange={(doc) =>
                  onRows((current) => updateBlock(current, block.id, (b) => (b.type === "richText" ? { ...b, doc } : b)))
                }
                label="Text"
              />
            }
            style={
              <>
                {fontField("Font", block.font, "The site's body font", (font) =>
                  onRows((current) => patchBlock<RichTextBlock>(current, block.id, { font })),
                )}
                <TextAlignFields
                  value={block.align}
                  onChange={(align) => onRows((current) => patchBlock<RichTextBlock>(current, block.id, { align }))}
                />
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </Modal>

      <Modal
        open={block?.type === "image"}
        onClose={onClose}
        title="Image"
        footer={
          block && (
            <>
              {saveAs({ kind: "block", content: block })}
              {done}
            </>
          )
        }
        wide
      >
        {block?.type === "image" && (
          <SettingsTabs
            key={block.id}
            general={
              <ImageFields
                block={block}
                upload={upload}
                onChange={(next) => onRows((current) => updateBlock(current, block.id, () => next))}
              />
            }
            style={
              <>
                <ShapeChoice
                  value={block.shape}
                  onChange={(shape) => onRows((current) => patchBlock<ImageBlock>(current, block.id, { shape }))}
                />
                {fontField("Caption font", block.font, "The site's body font", (font) =>
                  onRows((current) => patchBlock<ImageBlock>(current, block.id, { font })),
                )}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </Modal>

      <Modal
        open={block?.type === "heading"}
        onClose={onClose}
        title="Heading"
        footer={
          block && (
            <>
              {saveAs({ kind: "block", content: block })}
              {done}
            </>
          )
        }
        wide
      >
        {block?.type === "heading" && (
          <SettingsTabs
            key={block.id}
            general={
              <HeadingFields
                block={block}
                otherMainHeading={pageBlocks({ rows }).some((b) => b.id !== block.id && b.type === "heading" && b.level === 1)}
                onChange={(next) => onRows((current) => updateBlock(current, block.id, () => next))}
              />
            }
            style={
              <>
                {fontField("Font", block.font, "The site's heading font", (font) =>
                  onRows((current) => patchBlock<HeadingBlock>(current, block.id, { font })),
                )}
                <HeadingStyleFields
                  block={block}
                  onChange={(patch) => onRows((current) => patchBlock<HeadingBlock>(current, block.id, patch))}
                />
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </Modal>

      <Modal
        open={block?.type === "button"}
        onClose={onClose}
        title="Button"
        footer={
          block && (
            <>
              {saveAs({ kind: "block", content: block })}
              {done}
            </>
          )
        }
        wide
      >
        {block?.type === "button" && (
          <SettingsTabs
            key={block.id}
            general={
              <ButtonFields block={block} onChange={(next) => onRows((current) => updateBlock(current, block.id, () => next))} />
            }
            style={
              <>
                {fontField("Font", block.font, "The site's body font", (font) =>
                  onRows((current) => patchBlock<ButtonBlock>(current, block.id, { font })),
                )}
                <ButtonStyleFields
                  block={block}
                  onChange={(patch) => onRows((current) => patchBlock<ButtonBlock>(current, block.id, patch))}
                />
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </Modal>

      {/* The newer components, each described in `BLOCK_EDITORS`. */}
      <Modal
        open={Boolean(editor)}
        onClose={onClose}
        title={editor?.title ?? ""}
        footer={
          block && (
            <>
              {saveAs({ kind: "block", content: block })}
              {done}
            </>
          )
        }
        wide
      >
        {block && editor && (
          <SettingsTabs
            key={block.id}
            general={<editor.General block={block} context={{ upload, startVideo }} onChange={(patch) => onRows((current) => patchBlock(current, block.id, patch))} />}
            style={
              <>
                {editor.font &&
                  fontField(editor.font.label, (block as { font?: string }).font, editor.font.fallback, (font) =>
                    onRows((current) => patchBlock(current, block.id, { font } as Partial<PageBlock>)),
                  )}
                {editor.Style && (
                  <editor.Style block={block} context={{ upload, startVideo }} onChange={(patch) => onRows((current) => patchBlock(current, block.id, patch))} />
                )}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </Modal>

      <Modal
        open={block?.type === "product"}
        onClose={onClose}
        title={block?.type === "product" ? PRODUCT_PARTS[block.part] : "Product"}
        footer={
          block && (
            <>
              {saveAs({ kind: "block", content: block })}
              {done}
            </>
          )
        }
        wide
      >
        {block?.type === "product" && (
          <SettingsTabs
            key={block.id}
            general={
              <ProductFields block={block} onChange={(patch) => onRows((current) => patchBlock<ProductBlock>(current, block.id, patch))} />
            }
            style={
              <>
                {fontField("Font", block.font, "The site's fonts", (font) =>
                  onRows((current) => patchBlock<ProductBlock>(current, block.id, { font })),
                )}
                {ALIGNED_PARTS.includes(block.part) && (
                  <TextAlignFields value={block.align} onChange={(align) => onRows((current) => patchBlock<ProductBlock>(current, block.id, { align }))} />
                )}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </Modal>

      <Modal
        open={block?.type === "site"}
        onClose={onClose}
        title={block?.type === "site" ? SITE_PARTS[block.part] : "Site"}
        footer={
          block && (
            <>
              {saveAs({ kind: "block", content: block })}
              {done}
            </>
          )
        }
        wide
      >
        {block?.type === "site" && (
          <SettingsTabs
            key={block.id}
            general={<SiteFields block={block} onChange={(patch) => onRows((current) => patchBlock<SiteBlock>(current, block.id, patch))} />}
            style={
              <>
                {fontField("Font", block.font, "The site's fonts", (font) =>
                  onRows((current) => patchBlock<SiteBlock>(current, block.id, { font })),
                )}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </Modal>

      <Modal
        open={block?.type === "menu"}
        onClose={onClose}
        title="Menu"
        footer={
          block && (
            <>
              {saveAs({ kind: "block", content: block })}
              {done}
            </>
          )
        }
        wide
      >
        {block?.type === "menu" && (
          <SettingsTabs
            key={block.id}
            general={
              <MenuFields
                block={block}
                menus={grid.menus}
                menusHref={grid.menusHref}
                onChange={(patch) => onRows((current) => patchBlock<MenuBlock>(current, block.id, patch))}
              />
            }
            style={
              <>
                <TextAlignFields
                  what="Position"
                  value={block.align}
                  onChange={(align) => onRows((current) => patchBlock<MenuBlock>(current, block.id, { align }))}
                />
                {fontField("Font", block.font, "The site's fonts", (font) =>
                  onRows((current) => patchBlock<MenuBlock>(current, block.id, { font })),
                )}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </Modal>

      <Modal
        open={block?.type === "contentGrid"}
        onClose={onClose}
        title="Content grid"
        footer={
          block && (
            <>
              {saveAs({ kind: "block", content: block })}
              {done}
            </>
          )
        }
        wide
      >
        {block?.type === "contentGrid" && (
          <SettingsTabs
            key={block.id}
            general={
              <ContentGridFields
                block={block}
                grid={grid}
                onChange={(patch) => onRows((current) => patchBlock<ContentGridBlock>(current, block.id, patch))}
              />
            }
            style={
              <>
                {fontField("Font of the tiles", block.font, "The site's body font", (font) =>
                  onRows((current) => patchBlock<ContentGridBlock>(current, block.id, { font })),
                )}
                {fontField(
                  "Font of the tiles' headings",
                  block.headingFont,
                  block.font ? "The tiles' font" : "The site's heading font",
                  (headingFont) => onRows((current) => patchBlock<ContentGridBlock>(current, block.id, { headingFont })),
                )}
                <GridStyleFields
                  block={block}
                  onChange={(patch) => onRows((current) => patchBlock<ContentGridBlock>(current, block.id, patch))}
                />
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(row)}
        onClose={onClose}
        title={column ? "Column" : "Row"}
        footer={
          row && (
            <>
              {saveAs(column ? { kind: "column", content: column } : { kind: "row", content: row })}
              {done}
            </>
          )
        }
        wide
      >
        {row && column && (
          <SettingsTabs
            key={column.id}
            general={
              <>
                <ColumnLinkFields
                  link={column.link}
                  onChange={(link) => onRows((current) => patchColumn(current, column.id, { link }))}
                />
                <div className="flex flex-col gap-4 border-t border-border pt-4">
                  <Check
                    label="Components side by side"
                    hint="In a line that wraps when it runs out of room, rather than one under another, as a header's icons."
                    checked={Boolean(column.inline)}
                    onChange={(inline) =>
                      onRows((current) => patchColumn(current, column.id, inline ? { inline } : { inline: undefined, justify: undefined }))
                    }
                  />
                  {column.inline && (
                    <Choices
                      legend="Where they sit"
                      options={(Object.keys(COLUMN_JUSTIFY) as ColumnJustify[]).map((value) => ({ value, label: COLUMN_JUSTIFY[value] }))}
                      value={column.justify ?? "start"}
                      onChange={(justify) => onRows((current) => patchColumn(current, column.id, { justify: justify === "start" ? undefined : justify }))}
                    />
                  )}
                </div>
                <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
                  <legend className="float-left mb-2 w-full text-sm font-medium">Row layout</legend>
                  <p className="text-sm text-muted">
                    A column&apos;s width comes from its row&apos;s layout. With fewer columns, the text of the
                    columns that go moves to the last one.
                  </p>
                  {layoutChoice(row)}
                </fieldset>
              </>
            }
            style={
              <>
                <BackgroundFields
                  value={column.background}
                  upload={upload}
                  // Columns are offered no video (only rows take one).
                  onChange={(background) =>
                    onRows((current) => patchColumn(current, column.id, { background: background?.type === "video" ? undefined : background }))
                  }
                  backdropBlur={column.backdropBlur}
                  onBackdropBlur={(backdropBlur) => onRows((current) => patchColumn(current, column.id, { backdropBlur }))}
                />
                {spacingFields({ kind: "column", id: column.id })}
                {frameFields({ kind: "column", id: column.id })}
              </>
            }
            advanced={advancedFields({ kind: "column", id: column.id })}
          />
        )}
        {row && !column && (
          <SettingsTabs
            key={row.id}
            general={
              <>
                <p className="text-sm text-muted">
                  With fewer columns, the text of the columns that go moves to the last one.
                </p>
                {layoutChoice(row)}
                <RowFields row={row} onChange={(patch) => onRows((current) => patchRow(current, row.id, patch))} />
              </>
            }
            style={
              <>
                <BackgroundFields
                  value={row.background}
                  upload={upload}
                  startVideo={startVideo}
                  onChange={(background) => onRows((current) => patchRow(current, row.id, { background }))}
                  backdropBlur={row.backdropBlur}
                  onBackdropBlur={(backdropBlur) => onRows((current) => patchRow(current, row.id, { backdropBlur }))}
                />
                {spacingFields({ kind: "row", id: row.id })}
                {frameFields({ kind: "row", id: row.id })}
              </>
            }
            advanced={advancedFields({ kind: "row", id: row.id })}
          />
        )}
      </Modal>

      <Modal
        open={dialog?.kind === "delete"}
        onClose={onClose}
        title="Delete?"
        footer={
          <>
            <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-border px-4 text-sm">
              Keep it
            </button>
            <button
              type="button"
              onClick={() => {
                if (dialog?.kind === "delete") dialog.run();
                onClose();
              }}
              className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-medium text-white"
            >
              Delete
            </button>
          </>
        }
      >
        <p className="text-sm">
          Delete {dialog?.kind === "delete" ? dialog.what : ""}? Until you save the draft, the saved page keeps it.
        </p>
      </Modal>

      {dialog?.kind === "save-as" && (
        <SaveAsDialog
          create={grid.actions.createPart}
          part={dialog.part}
          onCancel={() => (dialog.back ? open(dialog.back) : onClose())}
          onSaved={(next, id) => {
            onParts(next, id);
            onClose();
          }}
        />
      )}

      {savedPart && (
        <SavedPartDialog
          key={savedPart.id + savedPart.updatedAt}
          actions={grid.actions}
          part={savedPart}
          onClose={onClose}
          onParts={onParts}
          onUse={() => {
            onUse(savedPart);
            onClose();
          }}
          upload={upload}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Translating (D55)
// ---------------------------------------------------------------------------

/** In place of the sidebar while translating: what can be done here, and where the rest is. */
function TranslateNote({ translate }: { translate: Translating }) {
  return (
    <section aria-labelledby="translate-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5 text-sm">
      <h2 id="translate-heading" className="font-medium">
        Translating into {translate.name}
      </h2>
      <p>
        Point at a text on the page and press <strong>Translate</strong> (or double-click it) to write it in {translate.name}.
        The title and search texts are on the right.
      </p>
      <p className="text-muted">
        A text you leave as it is shows in {translate.mainName}. Rows, pictures and settings are the same in every
        language: change them in {translate.mainName}.
      </p>
    </section>
  );
}

const translateField = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

/** The main language's text beside the one being written. */
function Original({ mainName, text }: { mainName: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="rounded-md bg-surface p-3 text-sm">
      <span className="block text-xs text-muted">In {mainName}</span>
      <span className="whitespace-pre-line">{text}</span>
    </div>
  );
}

/** One line (or a few) of text in the language being translated into. */
function TranslateText({
  label,
  value,
  max,
  original,
  mainName,
  multiline = false,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  original: string;
  mainName: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          maxLength={max}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          className={`${translateField} py-2`}
        />
      ) : (
        <input id={id} value={value} maxLength={max} onChange={(event) => onChange(event.target.value)} className={translateField} />
      )}
      <Original mainName={mainName} text={original} />
    </div>
  );
}

/** A saved component of a newer kind (D91), with its General fields from `BLOCK_EDITORS`. */
function SavedBlockFields({ block, upload, onChange }: { block: PageBlock; upload: Upload | null; onChange: (patch: Partial<PageBlock>) => void }) {
  const editor = editorFor(block);
  if (!editor) return <p className="text-sm text-muted">{blockLabels[block.type]}: change its settings where it is used.</p>;
  return <editor.General block={block} context={{ upload, startVideo: null }} onChange={onChange} />;
}

/** A block's texts in the language being translated into, as `mapBlockTexts()` lists them, each beside the main language's. */
function TranslateBlockTexts({
  block,
  original,
  name,
  mainName,
  onChange,
}: {
  block: PageBlock;
  original: PageBlock | null;
  name: string;
  mainName: string;
  onChange: (block: PageBlock) => void;
}) {
  const fields = blockTextFields(block);
  const was = new Map(original ? blockTextFields(original).map((field) => [field.key, field.value]) : []);
  if (fields.length === 0) return <p className="text-sm text-muted">This component has no text of its own.</p>;
  return (
    <div className="flex flex-col gap-5">
      {fields.map((field) => {
        const before = was.get(field.key);
        return typeof field.value === "string" ? (
          <TranslateText
            key={field.key}
            label={`${field.label} in ${name}`}
            value={field.value}
            max={field.max}
            original={typeof before === "string" ? before : ""}
            mainName={mainName}
            multiline={field.max > 120}
            onChange={(value) => onChange(setBlockText(block, field.key, value))}
          />
        ) : (
          <div key={field.key} className="flex flex-col gap-3">
            <RichTextEditor value={field.value} onChange={(doc) => onChange(setBlockText(block, field.key, doc))} label={`${field.label} in ${name}`} />
            <Original mainName={mainName} text={before && typeof before !== "string" ? richTextPlain(before) : ""} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The dialogs while translating (D55): a part's texts only, each beside
 * the main language's. A text left as it was keeps showing in that language.
 */
function TranslateDialogs({
  dialog,
  rows,
  onRows,
  onClose,
  translate,
}: {
  dialog: Dialog | null;
  rows: PageRow[];
  onRows: Rows;
  onClose: () => void;
  translate: Translating;
}) {
  const { name, mainName, source } = translate;
  const block = dialog?.kind === "edit-block" ? findBlock(rows, dialog.blockId)?.block : null;
  const original = block ? findBlock(source, block.id)?.block : null;
  const row = dialog?.kind === "edit-row" ? rows.find((r) => r.id === dialog.rowId) : null;
  const column = dialog?.kind === "edit-row" && dialog.columnId ? row?.columns.find((c) => c.id === dialog.columnId) : null;
  const originalColumn = column ? source.flatMap((r) => r.columns).find((c) => c.id === column.id) : null;
  const set = <T extends PageBlock>(patch: Partial<T>) => {
    if (block) onRows((current) => updateBlock(current, block.id, (b) => ({ ...b, ...patch }) as PageBlock));
  };
  const texts = (b: PageBlock, o: PageBlock | null | undefined) => {
    const was = <K extends string>(key: K) => ((o as Record<K, unknown> | null | undefined)?.[key] as string | undefined) ?? "";
    switch (b.type) {
      case "richText":
        return (
          <div className="flex flex-col gap-3">
            <RichTextEditor key={b.id} value={b.doc} onChange={(doc) => set<RichTextBlock>({ doc })} label={`Text in ${name}`} />
            <Original mainName={mainName} text={o?.type === "richText" ? richTextPlain(o.doc) : ""} />
          </div>
        );
      case "heading":
        return (
          <TranslateText label={`Heading in ${name}`} value={b.text} max={HEADING_MAX} original={was("text")} mainName={mainName} onChange={(text) => set<HeadingBlock>({ text })} />
        );
      case "button":
        return (
          <TranslateText label={`Button text in ${name}`} value={b.label} max={BUTTON_LABEL_MAX} original={was("label")} mainName={mainName} onChange={(label) => set<ButtonBlock>({ label })} />
        );
      case "image":
        return (
          <div className="flex flex-col gap-5">
            {b.image && (
              <TranslateText
                label={`Description of the picture in ${name}`}
                value={b.image.alt}
                max={ALT_MAX}
                original={o?.type === "image" ? (o.image?.alt ?? "") : ""}
                mainName={mainName}
                multiline
                onChange={(alt) => set<ImageBlock>({ image: b.image && { ...b.image, alt } })}
              />
            )}
            <TranslateText label={`Caption in ${name}`} value={b.caption} max={ALT_MAX} original={was("caption")} mainName={mainName} onChange={(caption) => set<ImageBlock>({ caption })} />
          </div>
        );
      case "product":
        return (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted">
              The product shows its own texts in {name}.{b.heading ? " Here is the component's own heading." : " This component has no text of its own."}
            </p>
            {b.heading && (
              <TranslateText label={`Heading in ${name}`} value={b.heading} max={HEADING_MAX} original={was("heading")} mainName={mainName} onChange={(heading) => set<ProductBlock>({ heading })} />
            )}
          </div>
        );
      case "contentGrid":
        return (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted">
              The tiles show each page or product in {name} by themselves. Here are the grid&apos;s own texts.
            </p>
            <TranslateText label={`Button text in ${name}`} value={b.buttonLabel} max={BUTTON_LABEL_MAX} original={was("buttonLabel")} mainName={mainName} onChange={(buttonLabel) => set<ContentGridBlock>({ buttonLabel })} />
            <TranslateText label={`Text when nothing matches, in ${name}`} value={b.emptyText} max={300} original={was("emptyText")} mainName={mainName} onChange={(emptyText) => set<ContentGridBlock>({ emptyText })} />
          </div>
        );
      default:
        // The newer components: every text they list in `mapBlockTexts()`, each beside the main language's.
        return <TranslateBlockTexts block={b} original={o ?? null} name={name} mainName={mainName} onChange={(next) => onRows((current) => updateBlock(current, b.id, () => next))} />;
    }
  };
  const done = (
    <button type="button" onClick={onClose} className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
      Done
    </button>
  );
  return (
    <>
      <Modal open={Boolean(block)} onClose={onClose} title={block ? `Translate ${blockLabels[block.type].toLowerCase()}` : "Translate"} footer={done} wide>
        {block && texts(block, original)}
      </Modal>
      <Modal open={Boolean(column?.link)} onClose={onClose} title="Translate the column's link" footer={done}>
        {column?.link && (
          <TranslateText
            label={`Description of the link in ${name}`}
            value={column.link.label}
            max={200}
            original={originalColumn?.link?.label ?? ""}
            mainName={mainName}
            onChange={(label) => {
              const link = column.link && { ...column.link, label };
              onRows((current) => patchColumn(current, column.id, { link }));
            }}
          />
        )}
      </Modal>
    </>
  );
}

const SIDES = ["top", "right", "bottom", "left"] as const;
const NO_SIDES: Sides = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Margin (space outside) and padding (space inside), each for the top,
 * right, bottom and left, in pixels (D47). Changes show on the canvas at once.
 * `defaults` is what a part has until given its own (a row's padding); set
 * to 0 there, it is kept, so the default does not come back.
 */
function SpacingFields({
  value,
  defaults,
  onChange,
}: {
  value: Spacing | undefined;
  defaults?: Spacing;
  onChange: (value: Spacing) => void;
}) {
  const id = useId();
  const set = (kind: "margin" | "padding", side: (typeof SIDES)[number], text: string) => {
    const number = Math.max(0, Math.min(SPACING_MAX, Math.round(Number(text) || 0)));
    const sides = { ...NO_SIDES, ...(value?.[kind] ?? defaults?.[kind]), [side]: number };
    const empty = SIDES.every((s) => sides[s] === 0);
    const next: Spacing = { ...value };
    if (empty && !defaults?.[kind]) delete next[kind];
    else next[kind] = sides;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      {(["margin", "padding"] as const).map((kind) => (
        <fieldset key={kind} className="flex flex-col gap-2">
          <legend className="text-sm font-medium">
            {kind === "margin" ? "Margin" : "Padding"}{" "}
            <span className="font-normal text-muted">
              ({kind === "margin" ? "space outside" : "space inside"}, in pixels)
            </span>
          </legend>
          <div className="grid grid-cols-4 gap-2">
            {SIDES.map((side) => (
              <label key={side} htmlFor={`${id}-${kind}-${side}`} className="flex flex-col gap-1 text-xs text-muted">
                {side[0].toUpperCase() + side.slice(1)}
                <input
                  id={`${id}-${kind}-${side}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={SPACING_MAX}
                  step={4}
                  value={value?.[kind]?.[side] ?? defaults?.[kind]?.[side] ?? 0}
                  onChange={(event) => set(kind, side, event.target.value)}
                  className="min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/** A picture block's picture, description and caption (D47). */
function ImageFields({
  block,
  upload,
  onChange,
}: {
  block: ImageBlock;
  upload: Upload | null;
  onChange: (block: ImageBlock) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      {block.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded picture
        <img src={block.image.url} alt="" className="max-h-72 w-full rounded-md border border-border bg-surface object-contain" />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border bg-surface text-sm text-muted">
          No picture yet
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ImageUploadButton
          upload={upload}
          label={block.image ? "Replace picture" : "Upload picture"}
          onUploaded={(image) => onChange({ ...block, image: { ...image, alt: block.image?.alt ?? "" } })}
        />
        {block.image && (
          <button type="button" onClick={() => onChange({ ...block, image: null })} className="px-2 py-2 text-sm underline">
            Remove
          </button>
        )}
      </div>
      {block.image && (
        <label htmlFor={`${id}-alt`} className="flex flex-col gap-1 text-sm font-medium">
          Description
          <textarea
            id={`${id}-alt`}
            rows={2}
            maxLength={300}
            value={block.image.alt}
            onChange={(event) => block.image && onChange({ ...block, image: { ...block.image, alt: event.target.value } })}
            placeholder="What the picture shows, for people who cannot see it"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
          <span className="text-xs font-normal text-muted">Leave it empty only if the picture is decoration.</span>
        </label>
      )}
      <label htmlFor={`${id}-caption`} className="flex flex-col gap-1 text-sm font-medium">
        <span>
          Caption <span className="font-normal text-muted">(optional, shown under the picture)</span>
        </span>
        <input
          id={`${id}-caption`}
          value={block.caption}
          maxLength={300}
          onChange={(event) => onChange({ ...block, caption: event.target.value })}
          className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal"
        />
      </label>
    </div>
  );
}

const SETTINGS_TABS = [
  { key: "general", label: "General" },
  { key: "style", label: "Style" },
  { key: "advanced", label: "Advanced" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** A settings dialog's three tabs (D48): what it holds, how it looks, and its id and classes. */
function SettingsTabs(panels: Record<SettingsTab, ReactNode>) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const id = useId();
  const select = (index: number) => {
    const next = SETTINGS_TABS[(index + SETTINGS_TABS.length) % SETTINGS_TABS.length].key;
    setTab(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Settings" className="sticky -top-5 z-10 -mx-5 -mt-5 flex border-b border-border bg-background px-3">
        {SETTINGS_TABS.map((t, index) => (
          <button
            key={t.key}
            id={`${id}-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") select(index + 1);
              if (event.key === "ArrowLeft") select(index - 1);
            }}
            className="min-h-11 border-b-2 border-transparent px-3 text-sm font-medium text-muted aria-selected:border-foreground aria-selected:text-foreground"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="flex flex-col gap-5">
        {panels[tab]}
      </div>
    </div>
  );
}




/**
 * A row's or column's background (D48): none, a colour, or a picture (or,
 * for rows, given `startVideo`, a video) with a colour and blur over it,
 * previewed as the page draws it. With none or a colour (see-through if
 * wanted), what is behind the part can be blurred (D86).
 */
function BackgroundFields({
  value,
  upload,
  startVideo,
  onChange,
  backdropBlur,
  onBackdropBlur,
}: {
  value: RowBackground | undefined;
  upload: Upload | null;
  /** Given for rows, which alone take a video; null where uploads are not set up. */
  startVideo?: StartVideo | null;
  onChange: (background: RowBackground | undefined) => void;
  backdropBlur: number | undefined;
  onBackdropBlur: (blur: number | undefined) => void;
}) {
  // A picture or video chosen as the kind waits for its upload before it is kept.
  const [kind, setKind] = useState<"none" | RowBackground["type"]>(value?.type ?? "none");
  const choose = (next: typeof kind) => {
    setKind(next);
    // A picture or video is drawn over what is behind, so blurring that would show nothing.
    if ((next === "image" || next === "video") && backdropBlur) onBackdropBlur(undefined);
    if (next === "none") onChange(undefined);
    if (next === "color") onChange({ type: "color", color: value?.type === "color" ? value.color : "#f3f4f6" });
    if (next === "image") onChange(value?.type === "image" ? value : undefined);
    if (next === "video") onChange(value?.type === "video" ? value : undefined);
  };
  const media = value?.type === "image" || value?.type === "video" ? value : null;
  const kept = { overlay: media?.overlay ?? null, ...(media?.blur ? { blur: media.blur } : {}) };
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend="Background"
        options={[
          { value: "none", label: "None" },
          { value: "color", label: "Colour" },
          { value: "image", label: "Picture" },
          ...(startVideo !== undefined ? [{ value: "video" as const, label: "Video" }] : []),
        ]}
        value={kind}
        onChange={choose}
      />
      {kind === "color" && value?.type === "color" && (
        <div className="flex flex-wrap items-end gap-6">
          <ColorField label="Background colour" value={value.color} onChange={(color) => onChange({ ...value, color })} />
          <RangeField
            label="Opacity"
            min={0}
            max={100}
            step={5}
            value={value.opacity ?? 100}
            shown={`${value.opacity ?? 100}%`}
            onChange={(opacity) => {
              const next: RowBackground = { type: "color", color: value.color };
              onChange(opacity >= 100 ? next : { ...next, opacity });
            }}
          />
        </div>
      )}
      {(kind === "none" || kind === "color") && (
        <>
          <Check
            label="Blur what is behind"
            hint={
              kind === "none"
                ? "Frosted glass: whatever lies behind shows through, blurred, such as a picture under a header that lies over the page."
                : "Frosted glass: with a see-through colour, whatever lies behind shows through it, blurred."
            }
            checked={Boolean(backdropBlur)}
            onChange={(on) => onBackdropBlur(on ? 12 : undefined)}
          />
          {backdropBlur ? (
            <div className="pl-7">
              <RangeField
                label="Blur"
                min={1}
                max={BLUR_MAX}
                step={1}
                value={backdropBlur}
                shown={`${backdropBlur} px`}
                onChange={onBackdropBlur}
              />
            </div>
          ) : null}
        </>
      )}
      {(kind === "image" || kind === "video") && (
        <div className="flex flex-col gap-3">
          {media?.type === kind ? (
            // The picture or video as the page draws it, with its colour and blur, so changes show here at once.
            <div className="relative isolate h-48 w-full overflow-hidden rounded-md border border-border">
              <PartBackground background={media} />
            </div>
          ) : (
            <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-border bg-surface text-sm text-muted">
              {kind === "video" ? "No video yet" : "No picture yet"}
            </div>
          )}
          {kind === "image" ? (
            <ImageUploadButton
              upload={upload}
              label={media?.type === "image" ? "Replace picture" : "Upload picture"}
              onUploaded={(uploaded) => onChange({ type: "image", image: uploaded, ...kept })}
            />
          ) : (
            <VideoUploadButton
              startVideo={startVideo ?? null}
              upload={upload}
              label={media?.type === "video" ? "Replace video" : "Upload video"}
              onUploaded={(uploaded) => onChange({ type: "video", ...uploaded, ...kept })}
            />
          )}
          {media?.type === kind && (
            <>
              <Check
                label={kind === "video" ? "Colour over the video" : "Colour over the picture"}
                hint="Makes text on it easier to read."
                checked={Boolean(media.overlay)}
                onChange={(on) => onChange({ ...media, overlay: on ? { color: "#000000", opacity: 40 } : null })}
              />
              {media.overlay && (
                <OverlayFields overlay={media.overlay} onChange={(overlay) => onChange({ ...media, overlay })} />
              )}
              <Check
                label={kind === "video" ? "Blur the video" : "Blur the picture"}
                hint="Softens a busy background behind text."
                checked={Boolean(media.blur)}
                onChange={(on) => onChange(withBlur(media, on ? 6 : 0))}
              />
              {media.blur ? (
                <div className="pl-7">
                  <RangeField
                    label="Blur"
                    min={1}
                    max={BLUR_MAX}
                    step={1}
                    value={media.blur}
                    shown={`${media.blur} px`}
                    onChange={(blur) => onChange(withBlur(media, blur))}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

type MediaBackground = Extract<RowBackground, { type: "image" | "video" }>;

/** A picture or video background with this much blur; none is left out, so the page stays as small as it can. */
const withBlur = <T extends MediaBackground>(media: T, blur: number): T => {
  const next = { ...media };
  if (blur > 0) next.blur = blur;
  else delete next.blur;
  return next;
};

/** A slider with its value shown beside it. */
function RangeField({
  label,
  min,
  max,
  step,
  value,
  shown,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  shown: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex min-h-10 items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-40"
        />
        <output htmlFor={id} className="w-12 text-sm tabular-nums">
          {shown}
        </output>
      </div>
    </div>
  );
}

function OverlayFields({
  overlay,
  onChange,
}: {
  overlay: { color: string; opacity: number };
  onChange: (overlay: { color: string; opacity: number }) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-6 pl-7">
      <ColorField label="Overlay colour" value={overlay.color} onChange={(color) => onChange({ ...overlay, color })} />
      <RangeField
        label="Opacity"
        min={0}
        max={100}
        step={5}
        value={overlay.opacity}
        shown={`${overlay.opacity}%`}
        onChange={(opacity) => onChange({ ...overlay, opacity })}
      />
    </div>
  );
}

/** A row's width, height, order on phones and how its columns line up (D48). */
function RowFields({ row, onChange }: { row: PageRow; onChange: (patch: RowPatch) => void }) {
  const full = row.width === "full";
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <Choices
        legend="Row width"
        options={[
          { value: "content", label: "Content width" },
          { value: "full", label: "Full width" },
        ]}
        value={row.width ?? "content"}
        onChange={(width) => onChange(width === "full" ? { width } : { width: undefined, contentWidth: undefined })}
      />
      <Choices
        legend="Content width"
        hint={full ? "what the row holds" : "for a full-width row"}
        disabled={!full}
        options={[
          { value: "content", label: "Content width" },
          { value: "full", label: "Full width" },
        ]}
        value={row.contentWidth ?? "content"}
        onChange={(contentWidth) => onChange({ contentWidth: contentWidth === "full" ? contentWidth : undefined })}
      />
      <Check
        label="As tall as the screen"
        hint="At least the height of the browser window."
        checked={Boolean(row.fullHeight)}
        onChange={(fullHeight) => onChange({ fullHeight })}
      />
      <Check
        label="Side by side on phones"
        hint="The columns stay side by side on phones instead of stacking, as in a header."
        checked={Boolean(row.sideBySide)}
        onChange={(sideBySide) => onChange({ sideBySide: sideBySide || undefined })}
      />
      <Check
        label="Reverse the columns on phones"
        hint="On phones the columns stack; this puts the last one first."
        checked={Boolean(row.reverseOnMobile)}
        disabled={Boolean(row.sideBySide)}
        onChange={(reverseOnMobile) => onChange({ reverseOnMobile })}
      />
      <Check
        label="Equal column height"
        hint="Every column as tall as the tallest, so their backgrounds line up."
        checked={Boolean(row.equalHeight)}
        onChange={(equalHeight) => onChange({ equalHeight })}
      />
      <Choices
        legend="Column content"
        options={[
          { value: "top", label: "Top" },
          { value: "middle", label: "Middle" },
          { value: "bottom", label: "Bottom" },
        ]}
        value={row.align ?? "top"}
        onChange={(align) => onChange({ align: align === "top" ? undefined : align })}
      />
    </div>
  );
}

/** Whether the whole column is a link, where to, and its name for screen readers (D48). */
function ColumnLinkFields({ link, onChange }: { link: ColumnLink | undefined; onChange: (link: ColumnLink | undefined) => void }) {
  const id = useId();
  const href = link?.href.trim() ?? "";
  const problem =
    link && href === ""
      ? "Give the link an address, or switch it off."
      : link && !isLinkAddress(href)
        ? "Use a web address (https://…), a page on the site (/about), mailto: or tel:."
        : null;
  return (
    <div className="flex flex-col gap-3">
      <Check
        label="Make the whole column a link"
        hint="Pressing anywhere in the column opens the address. Links in its text still work."
        checked={Boolean(link)}
        onChange={(on) => onChange(on ? { href: "", label: "" } : undefined)}
      />
      {link && (
        <div className="flex flex-col gap-3 pl-7">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-href`} className="text-sm font-medium">
              Address
            </label>
            <input
              id={`${id}-href`}
              value={link.href}
              maxLength={2000}
              spellCheck={false}
              placeholder="https://… or /about"
              aria-invalid={Boolean(problem)}
              aria-describedby={`${id}-href-hint`}
              onChange={(event) => onChange({ ...link, href: event.target.value })}
              className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal aria-invalid:border-red-700"
            />
            <span
              id={`${id}-href-hint`}
              className={`text-xs font-normal ${problem ? "text-red-700 dark:text-red-400" : "text-muted"}`}
            >
              {problem ?? "A page on this site, another site, an email or a phone number."}
            </span>
          </div>
          <label htmlFor={`${id}-label`} className="flex flex-col gap-1 text-sm font-medium">
            <span>
              Description <span className="font-normal text-muted">(optional, for screen readers)</span>
            </span>
            <input
              id={`${id}-label`}
              value={link.label}
              maxLength={200}
              placeholder="Where the link leads; else the column's text is read"
              onChange={(event) => onChange({ ...link, label: event.target.value })}
              className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal"
            />
          </label>
        </div>
      )}
    </div>
  );
}



const SHAPE_PICTURES: Record<ImageShape | "original", string> = {
  original: "h-4 w-6 rounded-sm border-dashed",
  landscape: "h-[18px] w-6 rounded-sm",
  portrait: "h-6 w-[18px] rounded-sm",
  panorama: "h-2.5 w-7 rounded-sm",
  square: "size-5 rounded-sm",
  circle: "size-5 rounded-full",
};

/** How a picture is cropped (D48). */
function ShapeChoice({ value, onChange }: { value: ImageShape | undefined; onChange: (shape: ImageShape | undefined) => void }) {
  const options = (["original", ...(Object.keys(IMAGE_SHAPES) as ImageShape[])] as const).map((shape) => ({
    value: shape,
    label: shape === "original" ? "Original" : IMAGE_SHAPES[shape],
    picture: <span aria-hidden className={`inline-block border-2 border-current ${SHAPE_PICTURES[shape]}`} />,
  }));
  return (
    <Choices
      legend="Shape"
      hint="the picture is cropped to it"
      options={options}
      value={value ?? "original"}
      onChange={(shape) => onChange(shape === "original" ? undefined : shape)}
    />
  );
}

/** A part's own id and classes, for the site (D48). */
function AdvancedFields({
  part,
  taken,
  onChange,
}: {
  part: PartBase;
  /** The ids other parts of the page use. */
  taken: Set<string>;
  onChange: (patch: Partial<PartBase>) => void;
}) {
  const id = useId();
  const htmlId = part.htmlId?.trim() ?? "";
  const idProblem = htmlId
    ? (htmlIdProblem(htmlId) ?? (taken.has(htmlId) ? "Another part of this page has this id." : null))
    : null;
  const classProblem = classNameProblem(part.className ?? "");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">These are used on the site only; the editor leaves them out.</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-id`} className="text-sm font-medium">
          Id
        </label>
        <input
          id={`${id}-id`}
          value={part.htmlId ?? ""}
          maxLength={HTML_ID_MAX}
          spellCheck={false}
          autoCapitalize="off"
          aria-invalid={Boolean(idProblem)}
          aria-describedby={`${id}-id-hint`}
          onChange={(event) => onChange({ htmlId: event.target.value || undefined })}
          className="min-h-10 rounded-md border border-border bg-background px-3 font-mono text-sm font-normal aria-invalid:border-red-700"
        />
        <span id={`${id}-id-hint`} className={`text-xs font-normal ${idProblem ? "text-red-700 dark:text-red-400" : "text-muted"}`}>
          {idProblem ??
            (htmlId
              ? `A link to #${htmlId} opens the page here.`
              : "Lets a link lead straight here: with the id prices, a link to #prices opens the page at this part.")}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-classes`} className="text-sm font-medium">
          Classes
        </label>
        <input
          id={`${id}-classes`}
          value={part.className ?? ""}
          maxLength={400}
          spellCheck={false}
          autoCapitalize="off"
          aria-invalid={Boolean(classProblem)}
          aria-describedby={`${id}-classes-hint`}
          onChange={(event) => onChange({ className: event.target.value || undefined })}
          className="min-h-10 rounded-md border border-border bg-background px-3 font-mono text-sm font-normal aria-invalid:border-red-700"
        />
        <span
          id={`${id}-classes-hint`}
          className={`text-xs font-normal ${classProblem ? "text-red-700 dark:text-red-400" : "text-muted"}`}
        >
          {classProblem ?? "Separated by spaces. A class changes the look only where the site's styles define it."}
        </span>
      </div>
    </div>
  );
}

/** Four sides in pixels, for a border's width (D49). */
function SidesFields({
  legend,
  hint,
  value,
  max,
  onChange,
}: {
  legend: string;
  hint: string;
  value: Sides;
  max: number;
  onChange: (sides: Sides) => void;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">
        {legend} <span className="font-normal text-muted">({hint})</span>
      </legend>
      <div className="grid grid-cols-4 gap-2">
        {SIDES.map((side) => (
          <label key={side} htmlFor={`${id}-${side}`} className="flex flex-col gap-1 text-xs text-muted">
            {side[0].toUpperCase() + side.slice(1)}
            <input
              id={`${id}-${side}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={max}
              value={value[side]}
              onChange={(event) =>
                onChange({ ...value, [side]: Math.max(0, Math.min(max, Math.round(Number(event.target.value) || 0))) })
              }
              className="min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NumberField({
  label,
  hint,
  value,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label} <span className="font-normal text-muted">({hint})</span>
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.max(0, Math.min(max, Math.round(Number(event.target.value) || 0))))}
        className="min-h-10 w-28 rounded-md border border-border bg-background px-2 text-sm"
      />
    </div>
  );
}

/** A border (its line, width on each side and colour), rounded corners and a shadow (D49). */
function FrameFields({
  value,
  onChange,
  what,
}: {
  /** Whose, when a dialog has two sets, such as a content grid's tiles. */
  what?: string;
  value: Pick<PartBase, "border" | "radius" | "shadow">;
  onChange: (patch: Partial<PartBase>) => void;
}) {
  const border = value.border;
  const name = (label: string) => (what ? `${what} ${label.toLowerCase()}` : label);
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <Choices
        legend={name("Border")}
        options={[
          { value: "none", label: "None" },
          ...(Object.keys(BORDER_STYLES) as BorderStyle[]).map((style) => ({ value: style, label: BORDER_STYLES[style] })),
        ]}
        value={border?.style ?? "none"}
        onChange={(style) =>
          onChange({
            border:
              style === "none"
                ? undefined
                : { width: border?.width ?? { top: 1, right: 1, bottom: 1, left: 1 }, color: border?.color ?? "#d1d5db", style },
          })
        }
      />
      {border && (
        <>
          <SidesFields
            legend={name("Border width")}
            hint="in pixels"
            value={border.width}
            max={BORDER_MAX}
            onChange={(width) => onChange({ border: { ...border, width } })}
          />
          <ColorField label={name("Border colour")} value={border.color} onChange={(color) => onChange({ border: { ...border, color } })} />
        </>
      )}
      <NumberField
        label={name("Rounded corners")}
        hint="radius, in pixels"
        value={value.radius ?? 0}
        max={RADIUS_MAX}
        onChange={(radius) => onChange({ radius: radius || undefined })}
      />
      <Choices
        legend={name("Shadow")}
        options={[
          { value: "none", label: "None" },
          ...(Object.keys(SHADOWS) as Shadow[]).map((shadow) => ({ value: shadow, label: SHADOWS[shadow].label })),
        ]}
        value={value.shadow ?? "none"}
        onChange={(shadow) => onChange({ shadow: shadow === "none" ? undefined : shadow })}
      />
    </div>
  );
}


const LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** A heading's text and level (D49). */
function HeadingFields({
  block,
  otherMainHeading = false,
  onChange,
}: {
  block: HeadingBlock;
  /** Whether another heading on the page is at level 1. */
  otherMainHeading?: boolean;
  onChange: (block: HeadingBlock) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          Heading
        </label>
        <input
          id={`${id}-text`}
          value={block.text}
          maxLength={HEADING_MAX}
          onChange={(event) => onChange({ ...block, text: event.target.value })}
          className="min-h-11 rounded-md border border-border bg-background px-3 text-base font-semibold"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Choices
          legend="Level"
          hint="for search engines and screen readers; the size is under Style"
          options={LEVELS.map((level) => ({ value: String(level), label: `H${level}` }))}
          value={String(block.level)}
          onChange={(level) => onChange({ ...block, level: Number(level) as HeadingLevel })}
        />
        <p className={`text-xs ${block.level === 1 && otherMainHeading ? "text-red-700 dark:text-red-400" : "text-muted"}`}>
          {block.level === 1
            ? otherMainHeading
              ? "Another heading on this page is H1. A page has one main heading: make one of them H2."
              : "H1 is the page's main heading, used once; the page's title is then no longer read out in its place."
            : "H1 is the page's main heading; sections below it are H2, and parts of those H3 and so on."}
        </p>
      </div>
    </div>
  );
}

/** A heading's size, weight, alignment and colour (D49). */
function HeadingStyleFields({ block, onChange }: { block: HeadingBlock; onChange: (patch: BlockPatch<HeadingBlock>) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend="Size"
        options={(Object.keys(HEADING_SIZES) as HeadingSize[]).map((size) => ({ value: size, label: HEADING_SIZES[size] }))}
        value={block.size ?? HEADING_DEFAULT_SIZE[block.level]}
        onChange={(size) => onChange({ size })}
      />
      <Choices
        legend="Weight"
        hint="the theme's unless chosen"
        options={[
          { value: "theme" as const, label: "Theme's" },
          ...(Object.keys(FONT_WEIGHTS) as FontWeight[]).map((weight) => ({ value: weight, label: FONT_WEIGHTS[weight] })),
        ]}
        value={block.weight ?? "theme"}
        onChange={(weight) => onChange({ weight: weight === "theme" ? undefined : weight })}
      />
      <TextAlignFields value={block.align} onChange={(align) => onChange({ align })} />
      <OptionalColor
        label="Text colour"
        hint="Otherwise the site's text colour."
        value={block.textColor}
        fallback="#111827"
        onChange={(textColor) => onChange({ textColor })}
      />
    </div>
  );
}

/** A button's text, address and whether it opens a new tab (D49). */
function ButtonFields({ block, onChange }: { block: ButtonBlock; onChange: (block: ButtonBlock) => void }) {
  const id = useId();
  const href = block.href.trim();
  const problem =
    href === ""
      ? "The button shows on the site once it has an address."
      : isLinkAddress(href)
        ? null
        : "Use a web address (https://…), a page on the site (/about), mailto: or tel:.";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-label`} className="text-sm font-medium">
          Text
        </label>
        <input
          id={`${id}-label`}
          value={block.label}
          maxLength={BUTTON_LABEL_MAX}
          placeholder="Start your store"
          onChange={(event) => onChange({ ...block, label: event.target.value })}
          className="min-h-10 rounded-md border border-border bg-background px-3 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-href`} className="text-sm font-medium">
          Address
        </label>
        <input
          id={`${id}-href`}
          value={block.href}
          maxLength={2000}
          spellCheck={false}
          placeholder="https://… or /about"
          aria-invalid={Boolean(problem && href)}
          aria-describedby={`${id}-href-hint`}
          onChange={(event) => onChange({ ...block, href: event.target.value })}
          className="min-h-10 rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-red-700"
        />
        <span
          id={`${id}-href-hint`}
          className={`text-xs ${problem && href ? "text-red-700 dark:text-red-400" : "text-muted"}`}
        >
          {problem ?? "A page on this site, another site, an email or a phone number."}
        </span>
      </div>
      <Check
        label="Open in a new tab"
        hint="Screen readers are told it opens a new tab."
        checked={Boolean(block.newTab)}
        onChange={(newTab) => onChange({ ...block, newTab: newTab || undefined })}
      />
    </div>
  );
}

/** A button's look: kind, size, corners, width, place and colours (D49). */
function ButtonStyleFields({ block, onChange }: { block: ButtonBlock; onChange: (patch: BlockPatch<ButtonBlock>) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <ButtonLookFields look={block} onChange={onChange} />
      <Choices
        legend="Weight"
        options={(Object.keys(FONT_WEIGHTS) as FontWeight[]).map((weight) => ({ value: weight, label: FONT_WEIGHTS[weight] }))}
        value={block.weight ?? "medium"}
        onChange={(weight) => onChange({ weight: weight === "medium" ? undefined : weight })}
      />
      <Check
        label="Full width"
        hint="As wide as its column."
        checked={Boolean(block.fullWidth)}
        onChange={(fullWidth) => onChange({ fullWidth })}
      />
      <TextAlignFields what="Position" value={block.align} onChange={(align) => onChange({ align })} />
    </div>
  );
}


/** Merges settings into an optional object; ones set to undefined go, and an empty object goes too. */
function mergeOptional<T extends object>(current: T | undefined, patch: Partial<T>): T | undefined {
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
  return Object.keys(next).length > 0 ? (next as T) : undefined;
}

/**
 * A content grid on the canvas (D51): its items as the site will show them,
 * asked of the server again when what it shows changes (not its look).
 */
function GridPreview({ block, grid }: { block: ContentGridBlock; grid: GridContext }) {
  const pageId = grid.pageId;
  const key = JSON.stringify([block.source, block.categories, block.tags, block.sort, block.limit]);
  const [result, setResult] = useState<{ key: string; data: GridData | { problem: string } } | null>(null);
  const load = useEffectEvent((forKey: string) => {
    void grid.actions.gridPreview(block, pageId).then((data) => setResult({ key: forKey, data }));
  });
  useEffect(() => load(key), [key]);

  const note = (text: string) => <p className="rounded-md bg-surface p-3 text-sm text-muted">{text}</p>;
  if (!result) return note("Content grid: finding what it shows …");
  if ("problem" in result.data) return note(`Content grid: ${result.data.problem}`);
  const stale = result.key !== key;
  if (result.data.items.length === 0) {
    return note(
      block.emptyText
        ? `Content grid: nothing matches yet, so the site shows “${block.emptyText}”.`
        : "Content grid: nothing matches yet, so the site shows nothing here. Double-click to change what it shows.",
    );
  }
  const m = t(result.data.lang);
  return (
    <div className={stale ? "opacity-60 transition-opacity" : undefined}>
      {/* The site's controls over a grid shoppers filter (D83), as they will look; they work on the site. */}
      {block.filters && block.source.type === "products" && (
        <div aria-hidden className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{m.listing.count(result.data.items.length)}</p>
          <span className="inline-flex min-h-11 items-center gap-2 rounded-button border border-border px-4 text-sm font-medium">
            {m.listing.open}
          </span>
        </div>
      )}
      <ContentGridView block={block} data={result.data} />
    </div>
  );
}

/** Categories and tags to show, as checkboxes: none chosen shows all. */
function TermChecks({
  terms,
  value,
  onChange,
}: {
  terms: Term[];
  value: { categories: string[]; tags: string[] };
  onChange: (value: { categories: string[]; tags: string[] }) => void;
}) {
  const tree = categoryTree(terms);
  const tags = terms.filter((t) => t.kind === "tag").sort(byName);
  const toggle = (key: "categories" | "tags", id: string, on: boolean) => {
    const ids = value[key].filter((x) => x !== id);
    onChange({ ...value, [key]: on ? [...ids, id] : ids });
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(
        [
          ["categories", "Categories", tree],
          ["tags", "Tags", tags.map((t) => ({ ...t, depth: 0 }))],
        ] as const
      ).map(([key, legend, list]) => (
        <fieldset key={key} className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{legend}</legend>
          {list.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            list.map((term) => (
              <label key={term.id} className="flex min-h-8 items-center gap-2 text-sm" style={{ paddingLeft: `${term.depth * 1.25}rem` }}>
                <input
                  type="checkbox"
                  checked={value[key].includes(term.id)}
                  onChange={(event) => toggle(key, term.id, event.target.checked)}
                  className="size-4"
                />
                {term.name}
              </label>
            ))
          )}
        </fieldset>
      ))}
    </div>
  );
}

/** Tiles side by side on phones, tablets and computers. */
function ColumnsFields({ value, onChange }: { value: GridColumns; onChange: (value: GridColumns) => void }) {
  const screens = [
    ["mobile", "Columns on phones"],
    ["tablet", "On tablets"],
    ["desktop", "On computers"],
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      {screens.map(([screen, legend]) => (
        <Choices
          key={screen}
          legend={legend}
          options={Array.from({ length: GRID_COLUMNS_MAX[screen] }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
          value={String(value[screen])}
          onChange={(n) => onChange({ ...value, [screen]: Number(n) })}
        />
      ))}
    </div>
  );
}

const gridField = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";

/** What a content grid shows and how many to a row (D51). */
function ContentGridFields({
  block,
  grid,
  onChange,
}: {
  block: ContentGridBlock;
  grid: GridContext;
  onChange: (patch: BlockPatch<ContentGridBlock>) => void;
}) {
  const id = useId();
  const source = block.source;
  // On a store's page (D53) its own products, in the shopper's market.
  const own = grid.owner !== null;
  const storeId = source.type === "products" ? (grid.owner ?? source.storeId ?? null) : null;
  const [storeTerms, setStoreTerms] = useState<{ storeId: string; terms: Term[] } | null>(null);
  const loadTerms = useEffectEvent((forStore: string) => {
    void grid.actions.gridTerms(forStore).then((terms) => setStoreTerms({ storeId: forStore, terms }));
  });
  useEffect(() => {
    if (storeId) loadTerms(storeId);
  }, [storeId]);
  const terms =
    source.type === "pages"
      ? grid.pageTerms
      : source.type === "articles"
        ? grid.articleTerms
        : storeId && storeTerms?.storeId === storeId
          ? storeTerms.terms
          : [];
  const store = source.type === "products" ? grid.stores.find((s) => s.id === source.storeId) : undefined;
  const products = source.type === "products";
  const sorts = (Object.keys(GRID_SORTS) as GridSort[]).filter((sort) => products || !PRICE_SORTS.includes(sort));
  const productsOf = (s: GridStore | undefined): GridSource => ({
    type: "products",
    storeId: s?.id ?? "",
    market: s?.markets[0]?.code ?? "",
  });

  return (
    <div className="flex flex-col gap-5">
      <Choices
        legend="Show"
        options={(Object.keys(GRID_CONTENT) as GridContent[]).map((type) => ({ value: type, label: GRID_CONTENT[type] }))}
        value={source.type}
        onChange={(type) =>
          onChange(
            type === "pages" || type === "articles"
              ? { source: { type }, categories: [], tags: [], sort: PRICE_SORTS.includes(block.sort) ? "newest" : block.sort }
              : { source: own ? { type: "products" } : productsOf(grid.stores[0]), categories: [], tags: [] },
          )
        }
      />
      {products && own && (
        <p className="text-sm text-muted">
          The store&apos;s own products, priced in the market of the shopper viewing the page, in its language.
        </p>
      )}
      {products &&
        !own &&
        (grid.stores.length === 0 ? (
          <p className="text-sm text-muted">No store is open yet, so there are no products to show.</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-store`} className="text-sm font-medium">
                Store
              </label>
              <select
                id={`${id}-store`}
                value={store?.id ?? ""}
                onChange={(event) => onChange({ source: productsOf(grid.stores.find((s) => s.id === event.target.value)), categories: [], tags: [] })}
                className={gridField}
              >
                {!store && <option value="">Choose a store</option>}
                {grid.stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-market`} className="text-sm font-medium">
                Market <span className="font-normal text-muted">(prices and language)</span>
              </label>
              <select
                id={`${id}-market`}
                value={source.type === "products" ? source.market : ""}
                onChange={(event) => onChange({ source: { type: "products", storeId: store?.id ?? "", market: event.target.value } })}
                className={gridField}
              >
                {store?.markets.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code} · {m.currency}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-medium">Only these</p>
        <p className="text-xs text-muted">
          None chosen shows all. A category includes its subcategories; with categories and tags, an item needs one of
          each.
        </p>
        <TermChecks terms={terms} value={{ categories: block.categories, tags: block.tags }} onChange={(ids) => onChange(ids)} />
      </div>
      <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-sort`} className="text-sm font-medium">
            Order
          </label>
          <select
            id={`${id}-sort`}
            value={block.sort}
            onChange={(event) => onChange({ sort: event.target.value as GridSort })}
            className={gridField}
          >
            {sorts.map((sort) => (
              <option key={sort} value={sort}>
                {GRID_SORTS[sort]}
              </option>
            ))}
          </select>
        </div>
        <NumberField
          label="How many"
          hint={`at most ${GRID_LIMIT_MAX}`}
          value={block.limit}
          max={GRID_LIMIT_MAX}
          onChange={(limit) => onChange({ limit: Math.max(1, limit) })}
        />
      </div>
      {products && own && (
        <label className="flex items-start gap-2 border-t border-border pt-4 text-sm">
          <input
            type="checkbox"
            checked={block.filters === true}
            onChange={(event) => onChange({ filters: event.target.checked || undefined })}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">Filter and sort button</span>
            <span className="block text-xs text-muted">
              Shoppers narrow the products by kind, category, feature, option, price and stock, and change their order;
              the grid follows at once. The choices go into the page&apos;s address, so a filtered grid can be shared.
            </span>
          </span>
        </label>
      )}
      <div className="border-t border-border pt-4">
        <ColumnsFields value={block.columns} onChange={(columns) => onChange({ columns })} />
      </div>
      <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
        <legend className="float-left mb-2 w-full text-sm font-medium">In each tile</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(Object.keys(GRID_ELEMENTS) as GridElement[])
            .filter((element) => element !== "price" || products)
            .map((element) => (
              <label key={element} className="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={block.show[element]}
                  onChange={(event) => onChange({ show: { ...block.show, [element]: event.target.checked } })}
                  className="size-4"
                />
                {GRID_ELEMENTS[element]}
              </label>
            ))}
        </div>
      </fieldset>
      {block.show.button && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-button`} className="text-sm font-medium">
            Button text
          </label>
          <input
            id={`${id}-button`}
            value={block.buttonLabel}
            maxLength={BUTTON_LABEL_MAX}
            placeholder={products ? "View product (in the market's language)" : "Read more"}
            onChange={(event) => onChange({ buttonLabel: event.target.value })}
            className={gridField}
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-empty`} className="text-sm font-medium">
          When nothing matches
        </label>
        <input
          id={`${id}-empty`}
          value={block.emptyText}
          maxLength={300}
          placeholder="Show nothing"
          onChange={(event) => onChange({ emptyText: event.target.value })}
          className={gridField}
        />
      </div>
    </div>
  );
}

const GRID_LEVELS = [2, 3, 4, 5, 6] as const;

/** How a content grid's tiles look (D51): picture, heading, excerpt, button and the tile itself. */
function GridStyleFields({ block, onChange }: { block: ContentGridBlock; onChange: (patch: BlockPatch<ContentGridBlock>) => void }) {
  const tile = block.tile;
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend="Pictures"
        hint="cropped alike, so tiles line up"
        options={[
          // Products can follow the store theme's product cards (D60), their default.
          ...(block.source.type === "products" ? [{ value: "theme" as const, label: "Theme's product cards" }] : []),
          ...(["original", ...(Object.keys(IMAGE_SHAPES) as ImageShape[])] as const).map((shape) => ({
            value: shape,
            label: shape === "original" ? "Original" : IMAGE_SHAPES[shape],
            picture: <span aria-hidden className={`inline-block border-2 border-current ${SHAPE_PICTURES[shape]}`} />,
          })),
        ]}
        value={gridImageShape(block) === "theme" && block.source.type !== "products" ? "landscape" : gridImageShape(block)}
        onChange={(shape) => onChange({ imageShape: shape === gridImageShape({ source: block.source }) ? undefined : shape })}
      />
      <Choices
        legend="Heading level"
        hint="under the heading above the grid"
        options={GRID_LEVELS.map((level) => ({ value: String(level), label: `H${level}` }))}
        value={String(block.headingLevel)}
        onChange={(level) => onChange({ headingLevel: Number(level) as ContentGridBlock["headingLevel"] })}
      />
      <Choices
        legend="Heading size"
        options={(Object.keys(HEADING_SIZES) as HeadingSize[]).map((size) => ({ value: size, label: HEADING_SIZES[size] }))}
        value={block.headingSize ?? "sm"}
        onChange={(size) => onChange({ headingSize: size === "sm" ? undefined : size })}
      />
      <NumberField
        label="Excerpt"
        hint="lines at most, 1 to 6"
        value={block.excerptLines}
        max={6}
        onChange={(lines) => onChange({ excerptLines: Math.max(1, lines) })}
      />
      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <p className="text-sm font-medium">Buttons</p>
        <ButtonLookFields look={block.button ?? {}} onChange={(patch) => onChange({ button: mergeOptional(block.button, patch) })} />
      </div>
      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <p className="text-sm font-medium">Tiles</p>
        <NumberField
          label="Space between tiles"
          hint={`in pixels, up to ${GRID_GAP_MAX}`}
          value={block.gap}
          max={GRID_GAP_MAX}
          onChange={(gap) => onChange({ gap })}
        />
        <OptionalColor
          label="Tile background"
          hint="Otherwise none."
          value={tile?.background}
          fallback="#f5f5f4"
          onChange={(background) => onChange({ tile: mergeOptional(tile, { background }) })}
        />
        <NumberField
          label="Space inside each tile"
          hint="padding, in pixels"
          value={tile?.padding ?? 0}
          max={SPACING_MAX}
          onChange={(padding) => onChange({ tile: mergeOptional(tile, { padding: padding || undefined }) })}
        />
        <FrameFields what="Tile" value={tile ?? {}} onChange={(patch) => onChange({ tile: mergeOptional(tile, patch) })} />
      </div>
    </div>
  );
}

/** The nine layouts to choose from, as pictures. */
function LayoutChoice({ value, onChange }: { value: RowLayout; onChange: (layout: RowLayout) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="grid grid-cols-3 gap-3">
      {ROW_LAYOUT_KEYS.map((layout) => (
        <button
          key={layout}
          type="button"
          role="radio"
          aria-checked={value === layout}
          onClick={() => onChange(layout)}
          className="flex flex-col gap-2 rounded-md border border-transparent p-2 text-left hover:bg-surface aria-checked:border-blue-600 aria-checked:bg-blue-50 dark:aria-checked:bg-blue-950"
        >
          <LayoutPreview layout={layout} />
          <span className="text-xs">{ROW_LAYOUTS[layout].label}</span>
        </button>
      ))}
    </div>
  );
}

const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

/** Names a row, column or component and saves it under Saved (D46). */
function SaveAsDialog({
  create,
  part,
  onCancel,
  onSaved,
}: {
  create: PageOwnerContext["actions"]["createPart"];
  part: SavedPartDraft;
  onCancel: () => void;
  onSaved: (parts: SavedPart[], id: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const kind = SAVED_KIND_LABELS[part.kind].one.toLowerCase();
  const submit = () =>
    start(async () => {
      const result = await create({ ...part, name });
      if (result.ok) onSaved(result.parts, result.id);
      else setProblems(result.problems);
    });
  return (
    <Modal
      open
      onClose={onCancel}
      title={`Save this ${kind}`}
      footer={
        <>
          <button type="button" onClick={onCancel} className="min-h-10 rounded-md border border-border px-4 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            form={`${id}-form`}
            disabled={busy}
            className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          >
            {busy ? "Saving …" : "Save"}
          </button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3"
      >
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Name
        </label>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setProblems([]);
          }}
          maxLength={SAVED_NAME_MAX}
          required
          autoFocus
          placeholder={part.kind === "row" ? "Hero with picture" : part.kind === "column" ? "Contact details" : "Delivery promise"}
          className={field}
        />
        <p className="text-xs text-muted">
          It is added under Saved in the left sidebar, to drag onto any page. This page keeps its {kind} as it is.
        </p>
        {problems.length > 0 && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problems.join(" ")}
          </p>
        )}
      </form>
    </Modal>
  );
}

/**
 * A saved part, opened from Saved: its name and content to change, and ways
 * to add it to the page or delete it. Changes reach pages that use it from
 * then on, never the pages that already have it.
 */
function SavedPartDialog({
  actions,
  part,
  onClose,
  onParts,
  onUse,
  upload,
}: {
  actions: PageOwnerContext["actions"];
  part: SavedPart;
  onClose: () => void;
  onParts: (parts: SavedPart[]) => void;
  onUse: () => void;
  upload: Upload | null;
}) {
  const id = useId();
  const [name, setName] = useState(part.name);
  // The content as one row, whatever the kind, so the same edits apply.
  const [rows, setRows] = useState<PageRow[]>(() =>
    part.kind === "row"
      ? [part.content]
      : part.kind === "column"
        ? [{ id: "saved-row", type: "row", layout: "1", columns: [part.content] }]
        : [{ id: "saved-row", type: "row", layout: "1", columns: [{ id: "saved-column", blocks: [part.content] }] }],
  );
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const change: Rows = (update) => {
    setRows(update);
    setDirty(true);
  };
  const content = (): SavedPartDraft =>
    part.kind === "row"
      ? { kind: "row", content: rows[0] }
      : part.kind === "column"
        ? { kind: "column", content: rows[0].columns[0] }
        : { kind: "block", content: rows[0].columns[0].blocks[0] };
  const save = () =>
    start(async () => {
      const result = await actions.updatePart(part.id, { ...content(), name });
      if (!result.ok) return setProblems(result.problems);
      onParts(result.parts);
      onClose();
    });
  const remove = () =>
    start(async () => {
      const result = await actions.deletePart(part.id);
      if (result.ok) onParts(result.parts);
      onClose();
    });
  const row = rows[0];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Saved ${SAVED_KIND_LABELS[part.kind].one.toLowerCase()}`}
      wide
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto self-center text-sm">Delete “{part.name}” from Saved? Pages that use it keep their copy.</span>
            <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-10 rounded-md border border-border px-4 text-sm">
              Keep it
            </button>
            <button type="button" onClick={remove} disabled={busy} className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-medium text-white">
              Delete
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirmDelete(true)} className="mr-auto min-h-10 px-2 text-sm text-red-700 underline dark:text-red-400">
              Delete
            </button>
            <button
              type="button"
              onClick={onUse}
              disabled={dirty}
              title={dirty ? "Save your changes first" : undefined}
              className="min-h-10 rounded-md border border-border px-4 text-sm disabled:opacity-40"
            >
              Add to page
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || (!dirty && name === part.name)}
              className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            >
              {busy ? "Saving …" : "Save changes"}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={SAVED_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            className={field}
          />
        </div>
        {part.kind === "row" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Layout</p>
            <LayoutChoice value={row.layout} onChange={(layout) => change((r) => setRowLayout(r, row.id, layout, newId))} />
          </div>
        )}
        {row.columns.map((column, index) => (
          <section key={column.id} className="flex flex-col gap-3" aria-label={part.kind === "row" ? `Column ${index + 1}` : "Content"}>
            {part.kind === "row" && <h3 className="text-sm font-medium">Column {index + 1}</h3>}
            {column.blocks.map((block, n) => (
              <div key={block.id} className="flex flex-col gap-1">
                {block.type === "richText" ? (
                  <RichTextEditor
                    value={block.doc}
                    onChange={(doc) =>
                      change((r) => updateBlock(r, block.id, (b) => (b.type === "richText" ? { ...b, doc } : b)))
                    }
                    label={`${part.kind === "row" ? `Column ${index + 1}, text` : "Text"} ${n + 1}`}
                  />
                ) : (
                  <div className="rounded-md border border-border p-3">
                    {block.type === "image" ? (
                      <ImageFields block={block} upload={upload} onChange={(next) => change((r) => updateBlock(r, block.id, () => next))} />
                    ) : block.type === "heading" ? (
                      <HeadingFields block={block} onChange={(next) => change((r) => updateBlock(r, block.id, () => next))} />
                    ) : block.type === "contentGrid" ? (
                      <p className="text-sm text-muted">Content grid: change its settings where it is used on a page.</p>
                    ) : block.type === "product" ? (
                      <p className="text-sm text-muted">Product component: change its settings where it is used in a layout.</p>
                    ) : block.type === "site" ? (
                      <p className="text-sm text-muted">Site component: change its settings where it is used in a header or footer.</p>
                    ) : block.type === "menu" ? (
                      <p className="text-sm text-muted">Menu: change its settings where it is used.</p>
                    ) : block.type === "button" ? (
                      <ButtonFields block={block} onChange={(next) => change((r) => updateBlock(r, block.id, () => next))} />
                    ) : (
                      <SavedBlockFields block={block} upload={upload} onChange={(patch) => change((r) => patchBlock(r, block.id, patch))} />
                    )}
                  </div>
                )}
                {part.kind !== "block" && (
                  <button
                    type="button"
                    onClick={() => change((r) => removeBlock(r, block.id))}
                    className="w-fit text-xs text-muted underline hover:text-foreground"
                  >
                    Remove {blockThis[block.type]}
                  </button>
                )}
              </div>
            ))}
            {part.kind !== "block" && (
              <button
                type="button"
                onClick={() => change((r) => insertBlock(r, column.id, newBlock("richText", newId), Number.MAX_SAFE_INTEGER))}
                className="w-fit rounded-md border border-border px-3 py-1.5 text-xs"
              >
                + Rich text
              </button>
            )}
          </section>
        ))}
        {problems.length > 0 && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problems.join(" ")}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICONS = {
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </g>
  ),
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.1 5.1L3.5 17.5a1.4 1.4 0 0 0 2 2l6.1-6.1a4 4 0 0 0 5.1-5.1l-2.4 2.4-2.1-.4-.4-2.1z" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />,
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Menu components (D85)
// ---------------------------------------------------------------------------

function MenuIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h10M4 18h13" />
      </svg>
    </span>
  );
}

/** A menu component's settings: which of the owner's menus, and how its links are laid out. */
function MenuFields({
  block,
  menus,
  menusHref,
  onChange,
}: {
  block: MenuBlock;
  menus: MenuPreview[];
  menusHref: string;
  onChange: (patch: BlockPatch<MenuBlock>) => void;
}) {
  const id = useId();
  const chosen = menus.find((menu) => menu.id === block.menuId);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        One of your menus, with its links as they are set under{" "}
        <a href={menusHref} target="_blank" rel="noopener" className="underline">
          Menus
        </a>
        : a change there shows wherever the menu is used.
      </p>
      {menus.length === 0 ? (
        <p className="text-sm">
          There are no menus yet.{" "}
          <a href={menusHref} target="_blank" rel="noopener" className="underline">
            Create one under Menus
          </a>
          .
        </p>
      ) : (
        <label htmlFor={`${id}-menu`} className="flex flex-col gap-1 text-sm font-medium">
          Menu
          <select
            id={`${id}-menu`}
            value={chosen ? chosen.id : ""}
            onChange={(event) => onChange({ menuId: event.target.value || undefined })}
            className="min-h-10 rounded-md border border-border bg-background px-3 font-normal"
          >
            <option value="">Choose a menu</option>
            {menus.map((menu) => (
              <option key={menu.id} value={menu.id}>
                {menu.name} ({menu.items.length === 1 ? "1 link" : `${menu.items.length} links`})
              </option>
            ))}
          </select>
        </label>
      )}
      {block.menuId && !chosen && <p className="text-sm text-red-700">The menu this showed no longer exists. Choose another.</p>}
      <Choices
        legend="Links"
        options={[
          { value: "row" as const, label: "Side by side" },
          { value: "column" as const, label: "One under another" },
        ]}
        value={block.direction ?? "row"}
        onChange={(direction) => onChange({ direction: direction === "row" ? undefined : direction })}
      />
      <Check
        label="Hide on phones"
        hint="Phones have the menu button and the slide-out menu, with the main menu."
        checked={Boolean(block.hideOnPhones)}
        onChange={(hideOnPhones) => onChange({ hideOnPhones: hideOnPhones || undefined })}
      />
    </div>
  );
}

/** A menu component on the canvas: its links' texts as the site shows them; links under a link side by side are shown in a list under it on the site. */
function MenuStandIn({ block, menus }: { block: MenuBlock; menus: MenuPreview[] }) {
  const menu = menus.find((m) => m.id === block.menuId);
  const column = block.direction === "column";
  if (!menu) return <p className="rounded-md bg-surface p-3 text-sm text-muted">The menu this showed no longer exists. Choose another.</p>;
  if (menu.items.length === 0) return <p className="rounded-md bg-surface p-3 text-sm text-muted">{menu.name} has no links yet.</p>;
  // Side by side, only the top links show on the line; a mark says a link has links under it.
  const shown = column ? menu.items : menu.items.filter((item) => item.depth === 0);
  const hasUnder = (index: number) => menu.items[menu.items.indexOf(shown[index]) + 1]?.depth > shown[index].depth;
  return (
    <div>
      <ul className={`flex gap-x-4 gap-y-1 text-sm ${column ? "flex-col" : "flex-wrap items-center"}`}>
        {shown.map((item, index) => (
          <li key={index} style={column ? { paddingLeft: `${item.depth}rem` } : undefined} className="flex min-h-9 items-center gap-1 font-medium">
            {item.text}
            {!column && hasUnder(index) && <span aria-label="with links under it">▾</span>}
          </li>
        ))}
      </ul>
      {block.hideOnPhones && <span className="block text-[10px] text-muted">Not on phones</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site components (D80)
// ---------------------------------------------------------------------------

/** What each site part shows, for the owner choosing and setting it. */
const SITE_HELP: Record<SitePart, string> = {
  logo: "The site's logo, linking to its front page; its name where there is no logo. The logo is set under Header and footer.",
  menuButton: "The button that opens the menu on phones. It shows on phones only.",
  search: "A link to the store's search.",
  account: "A link to the shopper's account (sign in on Kaizen's site).",
  wishlist: "A link to the wishlist, with how many products are saved.",
  cart: "A link to the cart, with how many products are in it.",
  markets: "The countries the store sells to, to switch between. Shown only with two or more.",
  buyerSwitch: "For stores selling to both: whether prices are shown for a business or a private buyer.",
  signUp: "The Start your store button.",
  business: "Who runs the site: name, organisation number, address and email, required on every page.",
  cookies: "A link to the cookies page, where visitors change their choice.",
};

function SiteIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
      </svg>
    </span>
  );
}

/** A site component's own settings (D80): only those its part has. */
function SiteFields({ block, onChange }: { block: SiteBlock; onChange: (patch: BlockPatch<SiteBlock>) => void }) {
  const lined = block.part === "markets" && block.display === "list";
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{SITE_HELP[block.part]} A part with nothing to show is left out.</p>
      {block.part === "logo" && (
        <NumberField
          label="Height"
          hint={`pixels, ${LOGO_HEIGHT.min} to ${LOGO_HEIGHT.max}; empty: the usual size`}
          value={block.height ?? 0}
          max={LOGO_HEIGHT.max}
          onChange={(height) => onChange({ height: height >= LOGO_HEIGHT.min ? height : undefined })}
        />
      )}
      {block.part === "markets" && (
        <Choices
          legend="Shown as"
          options={[
            { value: "dropdown" as const, label: "A list to open" },
            { value: "list" as const, label: "Links" },
          ]}
          value={block.display ?? "dropdown"}
          onChange={(display) => onChange({ display: display === "dropdown" ? undefined : display, direction: undefined })}
        />
      )}
      {lined && (
        <Choices
          legend="Links"
          options={[
            { value: "row" as const, label: "Side by side" },
            { value: "column" as const, label: "One under another" },
          ]}
          value={block.direction ?? "row"}
          onChange={(direction) => onChange({ direction: direction === "row" ? undefined : direction })}
        />
      )}
      {block.part !== "menuButton" && (
        <Check
          label="Hide on phones"
          hint="Phones have the menu button and the slide-out menu, with the menu, account and countries."
          checked={Boolean(block.hideOnPhones)}
          onChange={(hideOnPhones) => onChange({ hideOnPhones: hideOnPhones || undefined })}
        />
      )}
    </div>
  );
}

/**
 * How a site component looks on the canvas (D80): a sketch of its part; the
 * preview draws it with the site's own logo, menus and details.
 */
function SiteStandIn({ block }: { block: SiteBlock }) {
  const icon = (d: string) => (
    <span className="flex size-10 items-center justify-center rounded-full border border-border">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
  const links = (names: string[]) => (
    <span className={`flex gap-3 text-sm ${block.direction === "column" ? "flex-col" : "flex-wrap items-center"}`}>
      {names.map((name) => (
        <span key={name}>{name}</span>
      ))}
    </span>
  );
  const phones = block.hideOnPhones ? <span className="block text-[10px] text-muted">Not on phones</span> : null;
  const body = (() => {
    switch (block.part) {
      case "logo":
        return (
          <span className="flex items-center gap-2 font-semibold" style={block.height ? { height: block.height } : undefined}>
            <span className="aspect-square h-full min-h-6 rounded-md bg-foreground/80" /> Logo
          </span>
        );
      case "menuButton":
        return (
          <span className="flex items-center gap-2 text-xs text-muted">
            {icon("M4 7h16M4 12h16M4 17h16")} Phones only
          </span>
        );
      case "search":
        return icon("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4");
      case "account":
        return icon("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0");
      case "wishlist":
        return icon("M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z");
      case "cart":
        return icon("M6 7h12l-1 13H7L6 7zM9 7a3 3 0 0 1 6 0");
      case "markets":
        return block.display === "list" ? links(["Norge", "Sverige", "Danmark"]) : <span className="text-sm">Norge ▾</span>;
      case "buyerSwitch":
        return <span className="rounded-full border border-border px-3 py-1 text-xs">Private · Business</span>;
      case "signUp":
        return <span className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">Start your store</span>;
      case "business":
        return (
          <span className="flex flex-col gap-1 text-sm text-muted">
            <span>Business name · Org. 123 456 789</span>
            <span>Street 1, 0150 City</span>
            <span className="underline">hello@example.com</span>
          </span>
        );
      case "cookies":
        return <span className="text-sm text-muted underline">Cookies</span>;
    }
  })();
  return (
    <span className="block">
      {body}
      {phones}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Product components (D79)
// ---------------------------------------------------------------------------

const PRODUCT_PART_KEYS = Object.keys(PRODUCT_PARTS) as ProductPart[];
/** Parts whose text lines up left, centred or right. */
const ALIGNED_PARTS: readonly ProductPart[] = ["back", "title", "price", "host", "description", "withdrawal", "safety"];
/** What each part shows, for the owner choosing and setting it. */
const PART_HELP: Record<ProductPart, string> = {
  back: "A link back to the store's products.",
  gallery: "The product's pictures: the main one swipes, with small ones to choose from.",
  title: "The product's name, the page's main heading, with the heart that saves it to a wishlist.",
  price: "The product's price, from the cheapest variant, with VAT as the shopper sees prices.",
  notice: "For products sold only to businesses: tells a private shopper so, and lets them switch.",
  host: "Who hosts a stay or rental listed for an outside host.",
  buy: "Buying it: the variants with stock and Add to cart for goods, free times for appointments, dates for stays and rentals.",
  description: "The product's description.",
  withdrawal: "The line on the right of withdrawal, where the product has none (bookings, downloads, made to order).",
  safety: "Product safety: the safety information, manufacturer and responsible person in the EU.",
  related: "Products sharing the most of this one's categories and tags, as the store's product cards.",
};
const PART_HEADINGS: Partial<Record<ProductPart, string>> = { description: "Description", safety: "Safety and manufacturer", related: "You may also like" };

function ProductIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 7h12l-1 13H7L6 7z" />
        <path d="M9 7a3 3 0 0 1 6 0" />
      </svg>
    </span>
  );
}

/** A product component's own settings (D79): only those its part has. */
function ProductFields({ block, onChange }: { block: ProductBlock; onChange: (patch: BlockPatch<ProductBlock>) => void }) {
  const headed = block.part in PART_HEADINGS;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        {PART_HELP[block.part]} It shows the product the layout is used for; a part the product has nothing for is left out.
      </p>
      {block.part === "title" && (
        <>
          <Check label="Wishlist heart" hint="Beside the title, to save the product." checked={block.wishlist !== false} onChange={(on) => onChange({ wishlist: on ? undefined : false })} />
          <Choices
            legend="Size"
            options={[
              { value: "standard" as const, label: "Standard" },
              ...(Object.keys(HEADING_SIZES) as HeadingSize[]).map((size) => ({ value: size, label: HEADING_SIZES[size] })),
            ]}
            value={block.size ?? "standard"}
            onChange={(size) => onChange({ size: size === "standard" ? undefined : size })}
          />
        </>
      )}
      {block.part === "price" && (
        <Check label="Large" hint="The price at the size of a heading." checked={block.large !== false} onChange={(on) => onChange({ large: on ? undefined : false })} />
      )}
      {block.part === "gallery" && (
        <Check label="Small pictures below" hint="With two or more pictures, to choose one." checked={block.thumbnails !== false} onChange={(on) => onChange({ thumbnails: on ? undefined : false })} />
      )}
      {headed && (
        <>
          <Check label="Heading" checked={block.showHeading !== false} onChange={(on) => onChange({ showHeading: on ? undefined : false })} />
          {block.showHeading !== false && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Heading text
              <input
                value={block.heading ?? ""}
                maxLength={HEADING_MAX}
                onChange={(event) => onChange({ heading: event.target.value || undefined })}
                placeholder={`${PART_HEADINGS[block.part]} (in the shopper's language)`}
                className={field}
              />
              <span className="font-normal text-xs text-muted">Empty: Kaizen&apos;s own words, in each country&apos;s language.</span>
            </label>
          )}
        </>
      )}
      {block.part === "related" && (
        <>
          <NumberField
            label="How many"
            hint={`1 to ${RELATED_MAX}`}
            value={block.limit ?? 4}
            max={RELATED_MAX}
            onChange={(limit) => onChange({ limit: Math.max(1, limit) })}
          />
          <ColumnsFields value={block.columns ?? { mobile: 2, tablet: 4, desktop: 4 }} onChange={(columns) => onChange({ columns })} />
        </>
      )}
    </div>
  );
}

/**
 * How a product component looks on the canvas (D79): a sketch of its part,
 * as no product is chosen yet; the layout's preview shows it with one.
 */
function ProductStandIn({ block }: { block: ProductBlock }) {
  const lines = (n: number) => (
    <span className="flex flex-col gap-1.5">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`h-2.5 rounded bg-foreground/10 ${i === n - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </span>
  );
  const heading = (fallback: string) =>
    block.showHeading !== false && <span className="font-medium">{block.heading || fallback}</span>;
  const body = (() => {
    switch (block.part) {
      case "back":
        return <span className="text-sm underline">Back to products</span>;
      case "gallery":
        return (
          <span className="flex flex-col gap-2">
            <span className="flex aspect-square items-center justify-center rounded-lg bg-foreground/10 text-muted">
              <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="9" cy="10" r="1.5" />
                <path d="M21 16l-5-5-8 8" />
              </svg>
            </span>
            {block.thumbnails !== false && (
              <span className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-12 rounded-md bg-foreground/10" />
                ))}
              </span>
            )}
          </span>
        );
      case "title":
        return (
          <span className="flex items-start justify-between gap-4">
            <span className={`${block.size ? HEADING_SIZE_CLASS[block.size] : "text-3xl"} font-heading tracking-tight`}>Product name</span>
            {block.wishlist !== false && <span className="size-11 shrink-0 rounded-full border border-border" />}
          </span>
        );
      case "price":
        return (
          <span>
            <span className={block.large !== false ? "text-2xl font-semibold" : "font-semibold"}>499,00</span>{" "}
            <span className="text-sm text-muted">incl. VAT</span>
          </span>
        );
      case "notice":
        return <span className="block rounded-lg border border-border p-4 text-sm">Sold only to businesses. (Shown to private shoppers for such products.)</span>;
      case "host":
        return <span className="text-sm">Hosted by … (for outside hosts&apos; stays and rentals)</span>;
      case "buy":
        return (
          <span className="flex flex-col gap-2">
            <span className="font-medium">Variants</span>
            <span className="divide-y divide-border rounded-lg border border-border">
              {["Variant one", "Variant two"].map((name) => (
                <span key={name} className="flex items-center justify-between gap-4 p-3 text-sm">
                  <span>
                    {name}
                    <span className="block text-muted">In stock</span>
                  </span>
                  <span className="button-primary rounded-button px-4 py-2 text-sm">Add to cart</span>
                </span>
              ))}
            </span>
            <span className="text-xs text-muted">Appointments show free times here; stays and rentals, dates.</span>
          </span>
        );
      case "description":
        return (
          <span className="flex flex-col gap-2">
            {heading("Description")}
            {lines(3)}
          </span>
        );
      case "withdrawal":
        return <span className="text-sm">No right of withdrawal … (only for products without one)</span>;
      case "safety":
        return (
          <span className="flex flex-col gap-2 text-sm">
            {heading("Safety and manufacturer")}
            {lines(2)}
          </span>
        );
      case "related": {
        const columns = block.columns?.desktop ?? 4;
        return (
          <span className="flex flex-col gap-3">
            {heading("You may also like")}
            <span className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {Array.from({ length: Math.min(block.limit ?? 4, columns) }, (_, i) => (
                <span key={i} className="flex flex-col gap-2">
                  <span className="aspect-square rounded-lg bg-foreground/10" />
                  {lines(1)}
                </span>
              ))}
            </span>
          </span>
        );
      }
    }
  })();
  return (
    <span className="relative block rounded-md outline-1 outline-offset-4 outline-border outline-dashed">
      <span className="absolute -top-3 right-1 rounded bg-background px-1 text-[10px] font-medium tracking-wide text-muted uppercase">
        {PRODUCT_PARTS[block.part]}
      </span>
      {body}
    </span>
  );
}
