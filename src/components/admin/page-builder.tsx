"use client";

import { ButtonHoverField, HoverTimingFields } from "./hover-fields";
import { OPTIONS_FROM } from "@/lib/variant-options";
import { HOVER_DURATION_DEFAULT } from "@/lib/hover-timing";
import { DEFAULT_BREAKPOINTS, PAGE_CONTAINER, type Breakpoints, type Size } from "@/lib/breakpoints";
import { breakpointClassCss, canvasHiddenCss, partCss } from "@/lib/part-css";
import { themeAttributes, themeCss, themeTabValue, withThemeTab, type StoreTheme, type ThemeSettings, type ThemeTabValue } from "@/lib/theme";
import { ROW_GAP, meetsAbove } from "@/lib/row-join";
import { THEME_ELEMENT_KEYS, elementAsPart, elementFromPart, rowWidthPatch, sectionStylesSchema, themeElementsSchema, themedRows, type ThemeElementKey } from "@/lib/theme-elements";
import { SECTION_STYLE_NAME, SECTION_STYLES_MAX, isCoreSectionStyle, sectionStyleChoices, sectionStyleLabel } from "@/lib/section-styles";
import { columnSlotAt, slotAnchor, type Box, type ColumnSlot, type SlotLine } from "@/lib/column-slot";
import { InlineMarkupEditor } from "@/components/inline-edit/markup-editor";
import { MarkupInput } from "@/components/admin/markup-input";
import { InlineRichEditor } from "@/components/inline-edit/rich-text-inline";
import { inlineKindOf } from "@/lib/inline-edit";
import {
  carouselAnywhere,
  carouselAt,
  clearAt,
  inheritedAt,
  setAt,
  sizeSource,
  spacingAt,
  stackAt,
  stackPatchAt,
  valueAt,
  viewAt,
} from "@/lib/responsive";
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
  MeasuringStrategy,
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
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  useLayoutEffect,
  type CSSProperties,
  type RefObject,
  type PointerEventHandler,
  type ReactNode,
} from "react";

import { ContentGridView } from "@/components/content-grid";
import { inlinePlain } from "@/lib/inline-text";
import { t } from "@/lib/i18n";
import { FontLinks } from "@/components/font-links";

import { PageBlockView } from "@/components/page-block";
import { SiteForm } from "@/components/site-form";
import { publicForm } from "@/lib/forms";
import { PartBackground, blockBox, columnBox, rowBox, rowFrame, rowGrid, rowInnerClass, rowInnerStyle } from "@/components/page-parts";
import { ColumnDividers, RowWidthHandles } from "./row-resize";
import { useAdminText } from "./admin-text";
import type { BuilderMessages } from "@/lib/admin-messages/builder.en";
import { countWords, fillWords } from "@/lib/admin-fill";
import { MenuGlide } from "@/components/menu-glide";
import { MenuHoverFields } from "./menu-hover-fields";
import { PixelRange } from "./pixel-range";
import { ModalFields, ModalPicker } from "./modal-fields";
import { FoldButton, Rail, RailHeader, RailResizer, RailTabsHeader, railTemplate, useFolded, useRailWidth, type RailSide } from "./builder-rails";
import { TemplatesModal } from "./templates-modal";
import { SharingBadge, SharingChoice, SharingSelect } from "./templates-sharing";
import { TemplatesTab } from "./templates-tab";
import { useTemplateLists, type TemplateController } from "./templates-lists";
import { ApplyLayoutDialog, type PendingLayout } from "./templates-apply";
import { fitsPage, blockedReason, type KindFilter } from "./templates-helpers";
import { PageTypeBadge } from "./templates-parts";
import { TemplatePreviewDialog } from "./templates-preview";
import { useTemplateUse, type TemplateUse } from "./templates-use";
import { ThemeSectionsList, type ThemeSectionActions } from "./theme-sections-list";
import { SavedLayoutDialog } from "./saved-layout-dialog";
import { ModalBar } from "./modal-preview";
import { BackgroundMotionFields, GradientFields } from "./gradient-fields";
import { AnimationFields, MotionFields } from "./motion-fields";
import { ShopPartIcon } from "./shop-part-icons";
import { MotionMark, MotionPreviewToggle, canvasBackground, canvasFx, useCanvasMotion } from "./motion-canvas";
import { menuHoverStyle } from "@/lib/menu-hover";
import {
  BLOCKS_MAX,
  LINE_COLUMNS_MAX,
  ROW_LAYOUTS,
  ROW_LAYOUT_KEYS,
  ROWS_MAX,
  rowLayouts,
  BACKDROP_BLUR_MAX,
  BLUR_MAX,
  BORDER_MAX,
  BORDER_STYLES,
  BUTTON_LABEL_MAX,
  GRID_COLUMNS_MAX,
  GRID_CONTENT,
  GRID_ELEMENTS,
  GRID_GAP_MAX,
  GRID_LIMIT_MAX,
  GRID_SORTS,
  PRICE_SORTS,
  PRODUCT_SORTS,
  HEADING_MAX,
  HTML_ID_MAX,
  IMAGE_SHAPES,
  RADIUS_MAX,
  ROW_PADDING,
  CONTENT_MAX_MAX,
  CONTENT_MAX_MIN,
  COLUMN_SHARE_MAX,
  ROW_HEIGHT_VH,
  SHADOWS,
  shadowOpacityOf,
  SPACING_MAX,
  blockFonts,
  pageFonts,
  bindingOf,
  blockHasContent,
  blockOwnContent,
  blockText,
  classNameProblem,
  htmlIdProblem,
  isLinkAddress,
  gridImageShape,
  pageBlocks,
  DEFAULT_GRID_RECOMMEND,
  ownProducts,
  nestedColumns,
  pageParts,
  columnsAsRow,
  richTextPlain,
  ALT_MAX,
  type RowBackground,
  type BlockType,
  type BorderStyle,
  type ButtonBlock,
  type HeadingBlock,
  type HeadingLevel,
  type RichTextBlock,
  type Shadow,
  type ColumnLink,
  type ContentGridBlock,
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
  COLUMN_JUSTIFY,
  LOGO_HEIGHT,
  RELATED_MAX,
  type ProductBlock,
  type ProductPart,
  type MenuBlock,
  type PlansBlock,
  type DomainSearchBlock,
  type ThemeStoreBlock,
  type SearchBlock,
  type CustomFieldBlock,
  type FieldLoopBlock,
  type StorePartBlock,
  type SiteBlock,
  type SitePart,
  type ColumnJustify,
  type PageType,
  contentSides,
} from "@/lib/page-content";
import { applyPageLayout, isBlankPage, type ApplyMode } from "@/lib/page-layout-apply";
import { hasMotion, type BackgroundMotion, type EnterMotion } from "@/lib/motion";
import { backgroundMoves, drawTarget, motionSignature, switchBackground, type MotionPart } from "@/lib/motion-edit";
import { PIECE_GROUPS, STORE_PART_KEYS, STORE_PARTS, piecesOf, shopPartCopy, type ShopPart } from "@/lib/store-parts";
import { partDrawsWhenOff, partFeature, partFeatureOn } from "@/lib/part-features";
import { requirementLabel } from "@/lib/store-features";
import {
  type ColumnSpot,
  copyBlock,
  copyColumn,
  copyRow,
  duplicateBlock,
  addColumn,
  duplicateColumn,
  duplicateRow,
  findBlock,
  findHolder,
  nestColumn,
  newColumnsBlock,
  htmlIds,
  insertBlock,
  insertColumn,
  insertColumnAt,
  insertRow,
  moveBlock,
  linesOf,
  locateColumn,
  moveColumnAt,
  moveRow,
  newBlock,
  newRow,
  removeBlock,
  removeColumn,
  removeRow,
  setLineLayout,
  setLineShares,
  clearLineShares,
  partOf,
  patchBlock,
  patchColumn,
  patchPart,
  patchRow,
  setSpacing,
  updateBlock,
  type BlockPatch,
  type ColumnPatch,
  type RowPatch,
  type Styled,
} from "@/lib/page-rows";
import { blockTextFields, setBlockText } from "@/lib/page-translation";
import { planCurrencies, type PlanChoice } from "@/lib/plan-offer";

import type { GridData } from "@/lib/content-grid";
import type { FieldEntity, FieldGroup } from "@/lib/custom-fields";
import { siteFontFamilies } from "@/lib/fonts";
import { type SiteFonts } from "@/lib/fonts-schema";
import { SAVED_NAME_MAX, globalOf, type SavedPart, type SavedPartKind } from "@/lib/saved-parts";
import { productLoopConfig, productLoopPatch } from "@/lib/field-loop";
import { tileEntity } from "@/lib/tile-fields";
import { typeAsGroup, type GridContentType } from "@/lib/content-types";
import { copiedItems, customGridData, sourceChoice } from "@/lib/custom-grid";
import { sourceTraits } from "@/lib/grid-source";
import { CopyCurrentItems, CustomItemsEditor } from "./custom-items-editor";
import { ThemeStoreFields, ThemeStoreIcon, ThemeStoreStandIn } from "./theme-store-fields";
import { THEME_STORE_PART_COPY, type ThemeStorePart } from "@/lib/theme-store-parts";
import { detachUse, globalContent, markUse, newUse, setLocal, usePlace, withoutUses } from "@/lib/global-parts";
import { ScopedCss } from "@/components/custom-css";
import {
  HiddenBadge,
  HiddenPartsToggle,
  ResponsiveBar,
  ResponsiveToggle,
  SizeEditContext,
  SizeMark,
  SizeSwitch,
  VisibilityFields,
  inheritedClass,
  useSizeEdit,
  isResponsiveShortcut,
  typingIn,
  useResponsiveMode,
  type CanvasView,
  type SizeEdit,
} from "./responsive-edit";
import type { PartSharing, TemplateActions, TemplateItem, TemplateSource } from "@/lib/templates";
import { templatePreviewPath } from "@/lib/template-paths";
import { byName, categoryTree, type Term } from "@/lib/taxonomy";
import type { GridStore } from "@/server/content-grid";
import type { MenuPreview } from "@/server/menus";

import {
  BindBadge,
  BindEntitiesContext,
  BindFields,
  ButtonLookFields,
  CarouselFields,
  Check,
  Choices,
  ColorField,
  editorFor,
  FieldGroupsContext,
  FieldsSettingsFields,
  FieldsStandIn,
  LoopSettingsFields,
  LoopStandIn,
  TileFieldsPicker,
  OptionalColor,
  TextAlignFields,
} from "./block-fields";
import { type InstallFont } from "./font-picker";
import { TypographyFields } from "./typography-fields";
import { ImageSizeFields } from "./image-size-fields";
import { ImageUploadButton, type Upload } from "./image-upload";
import { VideoUploadButton, type StartVideo } from "./video-upload";
import type { PageOwnerContext } from "./page-context";
import { FloatingPanel as SettingsPanel } from "./floating-panel";
import { Modal } from "./modal";
import { RichTextEditor } from "./rich-text-editor";
import { DisplayBadge, DisplayFields, DisplayLegend, showPatch, type DisplaySetup } from "./display-fields";
import { displayLocked, factsOffered, type Show } from "@/lib/visibility";

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

// A uuid, also where the browser has no `randomUUID` (an address without https): a global's uses (D98) work on ids of 128 bits.
export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

/** What is dragged, and what it is dropped on. */
type DragData =
  | { kind: "palette-row"; layout: RowLayout }
  | { kind: "palette-block"; type: BlockType; part?: ProductPart | SitePart | ShopPart | ThemeStorePart }
  | { kind: "row"; rowId: string }
  | { kind: "block"; blockId: string; columnId: string }
  | { kind: "palette-column" }
  | { kind: "column"; columnId: string; rowId: string; line: number; holdsColumns?: boolean }
  | { kind: "saved"; partId: string; part: SavedPartKind }
  /** The place for a column on a line of its own in a row (D187): above the first line, between two, or under the last (`at` counts the lines as they are). */
  | { kind: "line"; rowId: string; at: number }
  /** The place to nest columns in a column (D294): a new Columns component above its components or below them. */
  | { kind: "nest"; columnId: string; at: "start" | "end" }
  | { kind: "canvas-end" };

const dataOf = (item: Active | Over | null): DragData | null => (item?.data.current as DragData | undefined) ?? null;
const movesRows = (data: DragData | null) =>
  data?.kind === "palette-row" || data?.kind === "row" || (data?.kind === "saved" && data.part === "row");
/** A component: from the palette, on the page, or a saved one. */
const movesBlock = (data: DragData | null) =>
  data?.kind === "palette-block" || data?.kind === "block" || (data?.kind === "saved" && data.part === "block");
/** What can be nested in a column (D294): a column, a new one, a saved one, or a row's layout from the sidebar (its columns). */
const nestsColumns = (data: DragData | null) =>
  data?.kind === "palette-row" || (data?.kind === "column" && !data.holdsColumns) || data?.kind === "palette-column" || (data?.kind === "saved" && data.part === "column");
/** A column on the page, or a saved one on its way to the page. */
const movesColumn = (data: DragData | null) =>
  data?.kind === "column" || data?.kind === "palette-column" || (data?.kind === "saved" && data.part === "column");

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
    // A row's layout from the sidebar can also be nested in a column, as a Columns component (D294).
    if (movesRows(active)) return data.kind === "row" || data.kind === "canvas-end" || (active?.kind === "palette-row" && data.kind === "nest");
    // A column lands beside another, last in a row, on a line of its own (D187), or nested in a column (D294).
    if (active?.kind === "column") return data.kind === "column" || data.kind === "row" || data.kind === "line" || data.kind === "nest";
    // A new column (the sidebar's, or a saved one) can also start a row of its own, last.
    if (movesColumn(active)) return data.kind === "column" || data.kind === "row" || data.kind === "line" || data.kind === "nest" || data.kind === "canvas-end";
    // A component can also start a row of its own: on a row's edge, between rows, or after the last.
    return data.kind === "block" || data.kind === "column" || data.kind === "row" || data.kind === "canvas-end";
  });
  const within = pointerWithin({ ...args, droppableContainers: targets });
  if (within.length > 0) {
    // The innermost says where: a block rather than its column, a column rather than its row.
    const kindOf = (hit: (typeof within)[number]) => (hit.data?.droppableContainer.data.current as DragData | undefined)?.kind;
    // Of one kind, the smallest: a Columns component's column (D294) rather than the row's column holding it.
    const area = (hit: (typeof within)[number]) => {
      const rect = hit.data?.droppableContainer.rect.current;
      return rect ? rect.width * rect.height : Number.MAX_SAFE_INTEGER;
    };
    // A block lies in its column, so the smaller of the two says where; a Columns component's empty column is smaller than the component.
    for (const kinds of [["line", "nest"], ["block", "column"], ["row"]] as const) {
      const hits = within.filter((h) => (kinds as readonly string[]).includes(kindOf(h) ?? ""));
      if (hits.length > 0) return [hits.reduce((a, b) => (area(b) < area(a) ? b : a))];
    }
    return within;
  }
  // Away from every place, the nearest one counts, but never a thin strip: a new line, or nesting, is asked for by pointing at it.
  return closestCenter({
    ...args,
    droppableContainers: targets.filter((container) => {
      const kind = (container.data.current as DragData | undefined)?.kind;
      return kind !== "line" && kind !== "nest";
    }),
  });
};

type Move = { active: Active; over: Over | null; activatorEvent: Event; delta: { x: number; y: number } };

/**
 * Whether the pointer is below (or, for columns, right of) the middle of
 * what it is over. Dragged with the keyboard, there is no pointer: the
 * dragged item's middle counts instead.
 */
function below(move: Move, over: Over, axis: "y" | "x" = "y"): boolean {
  const point = pointerOf(move);
  if (!point) return false;
  return axis === "y" ? point.y > over.rect.top + over.rect.height / 2 : point.x > over.rect.left + over.rect.width / 2;
}

/** Where the pointer is (the dragged item's middle where it is dragged with the keyboard, which has none). */
function pointerOf({ active, activatorEvent, delta }: Move): { x: number; y: number } | null {
  if ("clientX" in activatorEvent && typeof activatorEvent.clientX === "number") {
    const start = activatorEvent as PointerEvent;
    return { x: start.clientX + delta.x, y: start.clientY + delta.y };
  }
  const rect = active.rect.current.translated;
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
}

/** A row's columns as they lie on the canvas now, line by line; null where one is not drawn. */
function measureLines(row: PageRow): SlotLine[] | null {
  // A row, or a Columns component's box (D294).
  const rowElement = document.querySelector(`[data-builder-holder="${globalThis.CSS.escape(row.id)}"]`);
  if (!rowElement) return null;
  const lines: SlotLine[] = [];
  for (const line of linesOf(row)) {
    const ids: string[] = [];
    const boxes: Box[] = [];
    for (const column of line.columns) {
      const element = rowElement.querySelector(`[data-builder-item="column"][data-builder-id="${globalThis.CSS.escape(column.id)}"]`);
      if (!element) return null;
      const { left, right, top, bottom } = element.getBoundingClientRect();
      ids.push(column.id);
      boxes.push({ left, right, top, bottom });
    }
    lines.push({ ids, boxes });
  }
  return lines;
}

/**
 * The place a column dropped on a row, outside any of its columns (in the gap between two, in the room around them or under a
 * short one), takes: where the pointer is among them (D189). Null where the row cannot be measured.
 */
function slotOnRow(row: PageRow, move: Move): { slot: ColumnSlot; anchor: { id: string; after: boolean } | null } | null {
  const point = pointerOf(move);
  const lines = measureLines(row);
  const slot = point && lines ? columnSlotAt(lines, point) : null;
  return slot && lines ? { slot, anchor: slotAnchor(lines[slot.line], slot.index, slot.reversed) } : null;
}

/** The palette's components, in order. */
const BLOCK_TYPES = ["richText", "heading", "image", "video", "button", "dualButton", "columns", "tabs", "accordion", "faq", "testimonials", "iconList", "table", "brands", "gallery", "socialLinks", "emailForm", "newsletter", "contentGrid", "menu", "separator", "html"] as const satisfies readonly BlockType[];

const rowHasText = (row: PageRow) => row.columns.some(columnHasText);
const columnHasText = (column: PageColumn) => column.blocks.some(blockHasText);
/** Worth asking before it is deleted: text written, or a picture chosen. */
const blockHasText = (block: PageBlock) => blockHasContent(block);

/** A saved part that is a row, column or component: the page builder edits those; a page layout (D127) is only used whole. */
type PlainPart = Exclude<SavedPart, { kind: "page" }>;

/** What a dialog is open for. */
type Dialog =
  | { kind: "edit-block"; blockId: string }
  | { kind: "edit-row"; rowId: string; columnId: string | null }
  | { kind: "delete"; what: string; run: () => void }
  | { kind: "save-as"; part: SavedPartDraft; back: Dialog | null }
  | { kind: "edit-saved"; partId: string };

/** A row, column or component about to be saved, or being changed. */
type SavedPartDraft = Pick<PlainPart, "kind" | "content">;

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
  /** The owner's pages, for a grid that shows the pages under one (D185). */
  pageChoices?: readonly { slug: string; title: string }[];
  /** The owner's article categories and tags (D57), for a grid of articles. */
  articleTerms: Term[];
  stores: GridStore[];
  /** The owner's menus (D85), for menu components, and where they are edited. */
  menus: MenuPreview[];
  menusHref: string;
  /** Kaizen's plans for the Plans component (D142); null on a store's pages. */
  plans: PlanChoice[] | null;
  /** The theme store's components the page may hold (D285); absent or null on a store's pages and Kaizena Flow's other kinds of page. */
  themeStore?: { parts: readonly ThemeStorePart[] } | null;
  /**
   * The store's features as kept (D178), so the palette offers only the parts of features that are on and the canvas marks a part of one
   * that is off; absent for Kaizen's pages and a design profile's workspace, which offer every part.
   */
  features?: readonly string[] | null;
  /** The kind of page the builder edits as (a version of a page is a page, D148): what a part's display may ask about (D179 phase 4). */
  shape?: PageType;
  /** The owner's content types (D326), for a grid of entries: none offers no such grid. */
  contentTypes?: readonly GridContentType[];
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
  /** The language the page is shown in, for words the site fills in (a form's usual labels, D93). */
  lang: string | undefined;
  /** A global saved part's name (D98), for the canvas's marks. */
  globalName: (id: string) => string;
  /** Whether the canvas plays the parts' motion (D128); off, it draws none of it. */
  motionPreview: boolean;
  /** Starts an A/B test of a row, column or component (D148); undefined where the page cannot be tested. */
  onTest?: (target: { kind: "row" | "column" | "block"; id: string }) => void;
  /** The heading or text being edited where it stands (D191), with where it was pressed. */
  inline: { blockId: string; point: { x: number; y: number } | null } | null;
  onInline: (blockId: string, point: { x: number; y: number } | null) => void;
  endInline: () => void;
};

/** The site's own fonts for the canvas, and installing a family a block chooses (D59). */
export type BuilderFonts = {
  site: SiteFonts;
  style: CSSProperties | undefined;
  install: InstallFont;
  /** A store's theme (D60), so the canvas shows its colours and shapes. */
  theme: { css: string; attributes: Record<string, string>; /** Where its screen sizes start (D179), for the canvas's part rules. */ breakpoints?: Breakpoints } | null;
};

/** What the Theme tab needs (D182): the store's theme, and how to save what the tab holds of it. */
export type ThemeTabContext = {
  settings: ThemeSettings;
  save: (payload: string) => Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }>;
};

export function PageBuilder({
  rows,
  onRows,
  saved: parts,
  onSaved: setParts,
  css = [],
  upload,
  startVideo = null,
  aside,
  grid,
  fonts,
  translate = null,
  viewNote = null,
  templates = null,
  themeSections = null,
  pageType,
  motionRequest = 0,
  pageCss = "",
  onPageCss = () => {},
  productParts = false,
  siteParts = null,
  shopParts = false,
  fieldGroups = null,
  lang,
  onTestPart,
  checks = null,
  themeTab = null,
  onThemeState,
}: {
  /** Told whenever the Theme tab holds changes not saved yet, with how to save them: the editor's Save and Publish keep them too (D195). */
  onThemeState?: (state: { dirty: boolean; save: () => Promise<string[] | null> }) => void;
  /** The Theme tab beside Building blocks (D182): a store's theme for rows, headings, text, lists and buttons; null on Kaizen's own pages. */
  themeTab?: ThemeTabContext | null;
  /** The page checker's tab (wave 1, 1e): how many problems it found and its panel; null where there is none (a translated view). */
  checks?: { count: number; panel: ReactNode } | null;
  /** Offers "A/B test this" on a row, column or component (D148); undefined where the page cannot be tested (not a published store page). */
  onTestPart?: (target: { kind: "row" | "column" | "block"; id: string }) => void;
  /** The language the page is shown in (its main one, or the one it is translated into). */
  lang?: string;
  rows: PageRow[];
  onRows: Rows;
  /** A product layout (D79): its palette offers the product's parts. */
  productParts?: boolean;
  /** A header or footer (D80): its palette offers the site's parts its owner has. */
  siteParts?: SitePart[] | null;
  /** A store's page (D113): its palette offers the working pages' components, the cart, checkout and so on. */
  shopParts?: boolean;
  /** The store's active custom field groups (D118), for the components that show them; null where the owner has none (Kaizen's). */
  fieldGroups?: FieldGroup[] | null;
  grid: GridContext;
  fonts: BuilderFonts;
  /** Templates shared between stores and the marketplace (D125), for the Templates tab and the sharing of saved parts; null on Kaizen's own pages. */
  templates?: TemplateActions | null;
  /** The live signature theme's own sections (D272), offered on the Rows tab; null where the page takes none. */
  themeSections?: ThemeSectionActions | null;
  /** The kind of page being edited: a page layout (D127) can only be used on its own kind. */
  pageType: PageType;
  /** The page's own CSS, which a page layout may bring along (D127), and how to change it. */
  /** Counts up each time the editor adds motion for the owner (D128): the canvas then plays it. */
  motionRequest?: number;
  pageCss?: string;
  onPageCss?: (css: string | undefined) => void;
  /** No longer used: Kaizen's saved parts reach a store through the Templates tab (D125). */
  library?: SavedPart[];
  /** Set while the page's texts are translated (D55). */
  translate?: Translating | null;
  /** Whose view the canvas draws (D338: a country and a language), shown over it. */
  viewNote?: ReactNode;
  /** Uploads a picture, shrunk in the browser first; null where uploads are not set up. */
  upload: Upload | null;
  /** Starts a row's background video upload; null where uploads are not set up. */
  startVideo?: StartVideo | null;
  /** The owner's saved rows, columns and components (D46), global ones too (D98). */
  saved: SavedPart[];
  /** The saved parts changed: one saved, changed or deleted here. */
  onSaved: (parts: SavedPart[]) => void;
  /** The site's and the page's own CSS (D100), drawn on the canvas and kept inside it. */
  css?: string[];
  aside: ReactNode;
}) {
  const w = useAdminText("builder");
  const fw = w.frame;
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
  // The heading or text edited where it stands (D191): one at a time; opening a component's settings ends it.
  const [inline, setInline] = useState<{ blockId: string; point: { x: number; y: number } | null } | null>(null);
  /** A saved part by id. */
  const findPart = (id: string) => parts.find((p) => p.id === id);
  const [tab, setTab] = useState<Tab>("components");
  // Templates (D125): the lists the tab and its modal share, where the tab looks, and whether the modal is open.
  const controller = useTemplateLists(templates);
  const [source, setSource] = useState<TemplateSource>("marketplace");
  // The Browse modal, open on a kind (D127), the template being previewed and the button that opened it (which gets the focus back).
  const [browsing, setBrowsing] = useState<{ kind: KindFilter } | null>(null);
  const [preview, setPreview] = useState<{ id: string; source: TemplateSource } | null>(null);
  const [previewOpener, setPreviewOpener] = useState<HTMLElement | null>(null);
  // A page layout (D127) waiting for the person to say whether it replaces the page's rows or is added to them.
  const [layoutUse, setLayoutUse] = useState<PendingLayout | null>(null);
  // The sidebars can be folded away; each is kept per browser.
  const [leftFolded, setLeftFolded] = useFolded("left");
  const [rightFolded, setRightFolded] = useFolded("right");
  // How wide each open sidebar was dragged to (D262); null is its usual share.
  const [leftWidth, setLeftWidth] = useRailWidth("left");
  const [rightWidth, setRightWidth] = useRailWidth("right");
  const panelId = useId();
  // The canvas plays the parts' motion only while asked to (D128); each switch on plays every entrance again.
  const [motionOn, setMotionOn] = useState(false);
  const [motionRun, setMotionRun] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  useStandaloneColumns(columnsRef);
  // The theme the Theme tab edits (D182): what it holds, what is saved, and the canvas drawn with it before it is saved.
  const [themeValue, setThemeValue] = useState<ThemeTabValue | null>(() => (themeTab ? themeTabValue(themeTab.settings) : null));
  const [themeSaved, setThemeSaved] = useState<ThemeTabValue | null>(themeValue);
  const themeNow = useMemo(() => (themeTab && themeValue ? withThemeTab(themeTab.settings, themeValue) : null), [themeTab, themeValue]);
  const shownRows = useMemo(() => themedRows(rows, themeValue?.elements, themeValue?.sections), [rows, themeValue]);
  const saveTheme = async (): Promise<string[] | null> => {
    if (!themeTab || !themeValue) return null;
    const result = await themeTab.save(JSON.stringify(themeValue));
    if (result.ok) setThemeSaved(themeValue);
    return result.ok ? null : result.problems;
  };
  const themeDirty = Boolean(themeValue && themeSaved && JSON.stringify(themeValue) !== JSON.stringify(themeSaved));
  const themeState = useEffectEvent(() => onThemeState?.({ dirty: themeDirty, save: saveTheme }));
  useEffect(() => {
    themeState();
  }, [themeDirty, themeValue, themeSaved]);
  // What the theme's Row says about widths, for the fields of a row (D190).
  const themeRow = themeValue?.elements.row;
  const themeRowWidths = useMemo(() => ({ width: themeRow?.width, contentWidth: themeRow?.contentWidth }), [themeRow?.width, themeRow?.contentWidth]);
  const canvasTheme = fonts.theme && themeNow ? { ...fonts.theme, css: themeCss(themeNow, "[data-theme-canvas]") } : fonts.theme;
  // Responsive editing (D179 phase 2): the size edited and the canvas at it; null is Extra large, the canvas as wide as it can be.
  const breakpoints = fonts.theme?.breakpoints ?? DEFAULT_BREAKPOINTS;
  const room = useCallback(() => canvasRef.current?.clientWidth ?? 0, []);
  const responsive = useResponsiveMode(breakpoints, room);
  const sizeEdit = useMemo<SizeEdit>(
    () => ({ size: responsive.view?.size ?? "xl", active: responsive.view !== null, choose: responsive.choose }),
    [responsive.view, responsive.choose],
  );
  /** Parts hidden at the size shown: faded with an eye, or left out as on the site. */
  const [hideHidden, setHideHidden] = useState(false);
  // The parts some visitors do not see (D179 phase 4), for the legend over the canvas.
  const displayed = useMemo(() => displayedParts(rows, w), [rows, w]);
  const toggleResponsive = responsive.toggle;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isResponsiveShortcut(event) || typingIn(event.target)) return;
      event.preventDefault();
      toggleResponsive();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleResponsive]);
  const motionSign = motionSignature(rows);
  useCanvasMotion(canvasRef, motionOn, motionSign, motionRun);
  // Motion the AI manager just added is shown at once (D128).
  const [seenRequest, setSeenRequest] = useState(motionRequest);
  if (motionRequest !== seenRequest) {
    setSeenRequest(motionRequest);
    setMotionOn(true);
    setMotionRun((n) => n + 1);
  }
  const blockCount = pageBlocks({ rows }).length;
  const blocksFull = blockCount >= BLOCKS_MAX;
  const rowsFull = rows.length >= ROWS_MAX;

  const addRow = (layout: RowLayout, index = rows.length) => {
    if (!rowsFull) onRows((current) => insertRow(current, newRow(layout, newId), index));
  };
  const addBlock = (type: BlockType, columnId: string | null, index = Number.MAX_SAFE_INTEGER, part?: ProductPart | SitePart | ShopPart | ThemeStorePart, rowIndex?: number) => {
    if (blocksFull) return;
    if (columnId === null && rowIndex !== undefined && rowsFull) return;
    const made = newBlock(type, newId, part);
    // A header or footer has no page of its own: its Custom fields component shows the store's (D120).
    const block: PageBlock = siteParts && made.type === "customField" ? { ...made, source: "store" } : made;
    onRows((current) => {
      if (columnId && current.some((r) => r.columns.some((c) => c.id === columnId))) {
        return insertBlock(current, columnId, block, index);
      }
      // No column chosen: a new one-column row to hold it, where it was dropped, else at the end.
      const row = newRow("1", newId);
      row.columns[0].blocks.push(block);
      return insertRow(current, row, rowIndex ?? current.length);
    });
    // A new text block opens for writing straight away.
    setDialog({ kind: "edit-block", blockId: block.id });
  };

  /**
   * Puts a saved part on the page: a row at `index`, a column into a row (or
   * a row of its own), a block into a column. A global one (D98) is a new
   * use of it; any other a copy, and a template's (`foreign`, D125, once made
   * ready by the server) is a copy without any global's marks, its grids
   * showing this store's products (D56).
   */
  const placeSaved = (
    saved: SavedPart,
    place: {
      index?: number;
      rowId?: string;
      columnIndex?: number;
      spot?: ColumnSpot;
      columnId?: string | null;
      blockIndex?: number;
      blockRow?: number;
      /** Nested in a column, in a Columns component of its own (D294). */
      nestIn?: { columnId: string; index: number };
    } = {},
    foreign = false,
  ) => {
    // A page layout (D127) is placed as a whole, by asking how (`applyLayout`), never as a row, column or component.
    if (saved.kind === "page") {
      setLayoutUse({ name: saved.name, layout: saved.content, foreign });
      return;
    }
    const part = foreign ? forStore(saved) : saved;
    const global = foreign ? null : globalOf(part);
    // A saved part's custom ids come along unless the page already uses them (D48).
    const copy = <T extends PageRow | PageColumn | PageBlock>(content: T, copier: (c: T) => T): T =>
      global ? (newUse(global, newId()) as T) : copier(foreign ? withoutUses(part.kind, content) : content);
    if (part.kind === "row") {
      const row = copy(part.content, (c) => copyRow(c, newId, htmlIds(rows)));
      if (!rowsFull) onRows((current) => insertRow(current, row, place.index ?? current.length));
    } else if (part.kind === "column") {
      const column = copy(part.content, (c) => copyColumn(c, newId, htmlIds(rows)));
      onRows((current) => {
        // Nested (D294): never a column that holds a Columns component of its own, which would nest two levels.
        if (place.nestIn) {
          if (column.blocks.some((b) => b.type === "columns")) return current;
          return insertBlock(current, place.nestIn.columnId, newColumnsBlock("1", newId, [column]), place.nestIn.index);
        }
        if (place.spot) return insertColumnAt(current, place.spot, column);
        if (place.rowId) return insertColumn(current, place.rowId, column, place.columnIndex ?? Number.MAX_SAFE_INTEGER);
        return insertRow(current, { id: newId(), type: "row", layout: "1", columns: [column] }, current.length);
      });
    } else if (!blocksFull) {
      const block = copy(part.content, (c) => copyBlock(c, newId, htmlIds(rows)));
      const columnId = place.columnId === undefined ? lastColumn : place.columnId;
      onRows((current) => {
        if (columnId && current.some((r) => r.columns.some((c) => c.id === columnId))) {
          return insertBlock(current, columnId, block, place.blockIndex ?? Number.MAX_SAFE_INTEGER);
        }
        const row = newRow("1", newId);
        row.columns[0].blocks.push(block);
        return insertRow(current, row, place.blockRow ?? current.length);
      });
    }
  };

  /** Puts a page layout on the page (D127) as the person chose; returns why it could not be. */
  const applyLayout = (pending: PendingLayout, mode: ApplyMode): string | null => {
    const result = applyPageLayout({ rows, css: pageCss }, pending.layout, mode, newId, pending.foreign);
    if (!result.ok) return result.problem;
    onRows(() => result.rows);
    if (result.css !== undefined) onPageCss(result.css);
    setLastColumn(null);
    setLayoutUse(null);
    setBrowsing(null);
    setPreview(null);
    return null;
  };
  // A template's copy from the server: a page layout asks how first, the rest goes on the page like a saved part (D125).
  const templateUse = useTemplateUse(templates, (part) => {
    setPreview(null);
    if (part.kind === "page") setLayoutUse({ name: part.name, layout: part.content, foreign: true });
    else placeSaved(part, {}, true);
  });
  const previewed = preview ? (controller.lists[preview.source].items.find((i) => i.id === preview.id) ?? null) : null;
  const openPreview = (item: { id: string }, from: TemplateSource, opener: HTMLElement) => {
    setPreviewOpener(opener);
    setPreview({ id: item.id, source: from });
  };
  const blankPage = isBlankPage(rows);

  const onDragMove = (move: DragMoveEvent) => {
    const { active, over } = move;
    const data = dataOf(over);
    const from = dataOf(active);
    // A column shows where it lands beside another line's columns; in its own line they make room.
    const next = !over
      ? null
      : movesColumn(from)
        ? data?.kind === "column" && (from?.kind !== "column" || data.rowId !== from.rowId || data.line !== from.line)
          ? { id: String(over.id), after: below(move, over, "x") }
          : data?.kind === "row"
            ? columnSlotTarget(data.rowId, move, from?.kind === "column" ? from : null)
            : null
        : data?.kind === "row" || data?.kind === "block"
          ? { id: String(over.id), after: below(move, over) }
          : null;
    setTarget((current) => (current?.id === next?.id && current?.after === next?.after ? current : next));
  };

  /**
   * The indicator for a column held over a row, outside its columns (D189): on the column the pointer's place is before, or after
   * the last of its line. Nothing where it is its own place (the column moved is already there).
   */
  const columnSlotTarget = (rowId: string, move: Move, own: { columnId: string; rowId: string; line: number } | null): { id: string; after: boolean } | null => {
    const row = findHolder(rows, rowId);
    const found = row ? slotOnRow(row, move) : null;
    if (!row || !found?.anchor) return null;
    if (own && own.rowId === row.id && own.line === found.slot.line) {
      const at = locateColumn(row, own.columnId)?.index ?? -1;
      // Before it or right after it is where it already is.
      if (found.slot.index === at || found.slot.index === at + 1) return null;
    }
    return { id: `column:${found.anchor.id}`, after: found.anchor.after };
  };

  /** Where a new row goes for a drop on a row (before it, or after when the pointer is in its lower half) or below the last. */
  const dropRow = (to: DragData, after: boolean): number => {
    if (to.kind !== "row") return rows.length;
    const index = rows.findIndex((r) => r.id === to.rowId);
    return index < 0 ? rows.length : index + (after ? 1 : 0);
  };

  /**
   * Where a column dropped on `to` goes (D187): on a line of its own where the drop was on a line's strip; beside the column it was
   * dropped on (before it, or after it where the pointer is in its right half), in that column's line; last in the row's last line
   * where the drop was on the row itself. `own` is the column being moved, which takes the place of the one it is over in its own line.
   */
  const columnSpotFor = (to: DragData, end: DragEndEvent, over: NonNullable<DragEndEvent["over"]>, own: { columnId: string; rowId: string; line: number } | null): ColumnSpot | null => {
    if (to.kind === "line") return { rowId: to.rowId, newLine: to.at };
    if (to.kind === "row") {
      const row = findHolder(rows, to.rowId);
      if (!row) return null;
      // Where the pointer is among the columns (D189): between two, before the first, after the last, in the line it is in.
      const found = slotOnRow(row, end);
      if (found) {
        let index = found.slot.index;
        // In its own line a column takes the place it is dropped at, the others closing up where it was: it is counted without it.
        if (own && own.rowId === row.id && own.line === found.slot.line) {
          const at = locateColumn(row, own.columnId)?.index ?? -1;
          if (at >= 0 && index > at) index -= 1;
        }
        return { rowId: row.id, line: found.slot.line, index };
      }
      const lines = linesOf(row);
      return { rowId: row.id, line: lines.length - 1, index: Number.MAX_SAFE_INTEGER };
    }
    if (to.kind !== "column") return null;
    const row = findHolder(rows, to.rowId);
    const place = row ? locateColumn(row, to.columnId) : null;
    if (!row || !place) return null;
    const sameLine = own !== null && own.rowId === row.id && own.line === place.line;
    return { rowId: row.id, line: place.line, index: sameLine ? place.index : place.index + (below(end, over, "x") ? 1 : 0) };
  };

  const onDragEnd = (end: DragEndEvent) => {
    const { active, over } = end;
    setDragging(null);
    setTarget(null);
    const from = dataOf(active);
    const to = dataOf(over);
    if (!from || !to || !over) return;
    const after = below(end, over);

    // Nested in a column (D294): a new Columns component there, holding the column moved, a new one or the layout's columns.
    if (to.kind === "nest") {
      const index = to.at === "start" ? 0 : Number.MAX_SAFE_INTEGER;
      if (from.kind === "column") onRows((current) => nestColumn(current, from.columnId, to.columnId, index, newId));
      else if (blocksFull) return;
      else if (from.kind === "palette-row") onRows((current) => insertBlock(current, to.columnId, newColumnsBlock(from.layout, newId), index));
      else if (from.kind === "palette-column") onRows((current) => insertBlock(current, to.columnId, newColumnsBlock("1", newId), index));
      else if (from.kind === "saved") {
        const part = findPart(from.partId);
        if (part?.kind === "column") placeSaved(part, { nestIn: { columnId: to.columnId, index } });
      }
      setLastColumn(to.columnId);
      return;
    }

    if (from.kind === "saved") {
      const part = findPart(from.partId);
      if (!part || part.kind === "page") return;
      if (part.kind === "row") {
        const index =
          to.kind === "canvas-end" ? rows.length : to.kind === "row" ? rows.findIndex((r) => r.id === to.rowId) : -1;
        if (index >= 0) placeSaved(part, { index: to.kind === "row" && after ? index + 1 : index });
      } else if (part.kind === "column") {
        if (to.kind === "canvas-end") placeSaved(part);
        else {
          const spot = columnSpotFor(to, end, over, null);
          if (spot) placeSaved(part, { spot });
        }
      } else if (to.kind === "column" || to.kind === "block") {
        const place = to.kind === "block" ? findBlock(rows, to.blockId) : null;
        placeSaved(part, { columnId: to.columnId, blockIndex: place ? place.index + (after ? 1 : 0) : undefined });
        setLastColumn(to.columnId);
      } else if (to.kind === "row" || to.kind === "canvas-end") {
        // Outside any column: a row of its own for it.
        placeSaved(part, { columnId: null, blockRow: dropRow(to, after) });
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

    // A new column from the sidebar goes where a moved one would (D187): beside the columns of a line, last in a row, or on a line of its own.
    if (from.kind === "palette-column") {
      if (to.kind === "canvas-end") {
        // At the end of the page: a row of its own, with the one column.
        if (!rowsFull) onRows((current) => insertRow(current, newRow("1", newId), current.length));
        return;
      }
      const spot = columnSpotFor(to, end, over, null);
      if (spot) onRows((current) => insertColumnAt(current, spot, { id: newId(), blocks: [] }));
      return;
    }

    if (from.kind === "column") {
      const spot = columnSpotFor(to, end, over, { columnId: from.columnId, rowId: from.rowId, line: from.line });
      if (spot) onRows((current) => moveColumnAt(current, from.columnId, spot));
      return;
    }

    // A component dropped outside every column, on a row's edge, between rows or below the last, gets a row of its own.
    if (to.kind === "row" || to.kind === "canvas-end") {
      const rowIndex = dropRow(to, after);
      if (from.kind === "palette-block") addBlock(from.type, null, Number.MAX_SAFE_INTEGER, from.part, rowIndex);
      else if (from.kind === "block" && !rowsFull) {
        onRows((current) => {
          const place = findBlock(current, from.blockId);
          if (!place) return current;
          const row = newRow("1", newId);
          row.columns[0].blocks.push(place.block);
          return insertRow(removeBlock(current, from.blockId), row, rowIndex);
        });
      }
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
    if (row >= 0) return fillWords(fw.announceRow, { n: row + 1 });
    if (key === "palette:column") return fw.announceNewColumn;
    if (key.startsWith("nest:")) return fw.announceNested;
    // A line's strip is named by its row: `line:{row}:{place}` (D187).
    const strip = /^line:(.+):(\d+)$/.exec(key);
    if (strip) {
      const at = rows.findIndex((r) => r.id === strip[1]);
      return at >= 0 ? fillWords(fw.announceNewLineIn, { n: at + 1 }) : fw.announceNewLine;
    }
    for (const [r, each] of rows.entries()) {
      const column = each.columns.findIndex((c) => `column:${c.id}` === key);
      if (column >= 0) return fillWords(fw.announceColumn, { row: r + 1, column: column + 1 });
    }
    const block = findBlock(rows, key);
    if (block) return fillWords(fw.announceBlock, { n: rows.findIndex((r) => r.id === block.rowId) + 1 });
    return fw.announcePage;
  };

  const actions: Actions = {
    translating: translate !== null,
    grid,
    onRows,
    open: (next) => {
      setInline(null);
      setDialog(next);
    },
    inline,
    onInline: (blockId, point) => setInline({ blockId, point }),
    endInline: () => setInline(null),
    onAddBlock: (type, columnId) => {
      addBlock(type, columnId);
      setLastColumn(columnId);
    },
    onColumn: setLastColumn,
    blocksFull,
    lang,
    globalName: (id) => parts.find((p) => p.id === id)?.name ?? fw.global,
    motionPreview: motionOn,
    onTest: translate === null ? onTestPart : undefined,
  };

  // What a block that takes its content from a custom field (D118) can take: the product's in a layout, the page's or article's
  // on a store's page; a header or footer has only the store's own (D120); none on Kaizen's own pages.
  const bindEntities: readonly FieldEntity[] | null =
    fieldGroups === null || grid.owner === null ? null : siteParts ? ["store"] : productParts ? ["product"] : ["page", "article"];

  return (
    <SizeEditContext value={sizeEdit}>
    <FieldGroupsContext value={fieldGroups}>
    <BindEntitiesContext value={bindEntities}>
    <ThemeRowWidths value={themeRowWidths}>
    <ThemeSections value={themeValue?.sections}>
      <DndContext
        id="page-builder"
        sensors={sensors}
        collisionDetection={collision}
        // Measured as the drag goes, not once at its start: the strips shown while dragging (a new line, nesting) move what is below them.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={({ active }) => setDragging(dataOf(active))}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragging(null);
          setTarget(null);
        }}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => fillWords(fw.pickedUp, { what: announce(active.id) }),
            onDragOver: ({ over }) => (over ? fillWords(fw.over, { what: announce(over.id) }) : undefined),
            onDragEnd: ({ over }) => (over ? fillWords(fw.droppedAt, { what: announce(over.id) }) : fw.dropped),
            onDragCancel: () => fw.cancelled,
          },
          screenReaderInstructions: {
            draggable: fw.instructions,
          },
        }}
      >
        {/* On a computer the three columns each scroll on their own, between the admin's header and the editor's bar (`useStandaloneColumns`). */}
        <div
          ref={columnsRef}
          className="grid items-start gap-6 lg:h-(--builder-h) lg:grid-cols-(--builder-cols) lg:items-stretch lg:gap-x-0"
          style={{ "--builder-cols": railTemplate({ folded: leftFolded, width: leftWidth }, { folded: rightFolded, width: rightWidth }) } as CSSProperties}
        >
          {leftFolded && <Rail side="left" label={fw.leftLabel} controls={`${panelId}-left`} onOpen={() => setLeftFolded(false)} />}
          {translate ? (
            <TranslateNote
              translate={translate}
              id={`${panelId}-left`}
              hidden={leftFolded}
              header={<FoldButton side="left" label={fw.leftLabel} controls={`${panelId}-left`} onFold={() => setLeftFolded(true)} />}
            />
          ) : (
          <Sidebar
            id={`${panelId}-left`}
            hidden={leftFolded}
            onFold={() => setLeftFolded(true)}
            tab={tab}
            onTab={setTab}
            onAddRow={(layout) => addRow(layout)}
            themeSections={themeSections && { actions: themeSections, onPlace: (part) => placeSaved(part, {}, true) }}
            onAddColumn={() => onRows((current) => addColumn(current, lastColumn, newId))}
            onAddBlock={(type, part) => addBlock(type, lastColumn, Number.MAX_SAFE_INTEGER, part)}
            productParts={productParts}
            siteParts={siteParts && siteParts.filter((part) => partFeatureOn({ type: "site", part }, grid.features))}
            features={grid.features ?? null}
            // A store's own pages can hold its search (D112); a header, footer or product layout has its own components.
            search={grid.owner !== null && !productParts && !siteParts}
            // Kaizen's plans (D142) are for Kaizen's own pages.
            plans={grid.plans !== null && !productParts && !siteParts}
            // The theme store's components (D285) are for Kaizena Flow's own pages, a theme's page holding the theme's parts too.
            themeStoreParts={productParts || siteParts ? [] : (grid.themeStore?.parts ?? [])}
            // Custom fields (D118) are the page's or article's own: a store's pages and articles, when it has any groups.
            customFields={fieldGroups !== null && grid.owner !== null && !productParts}
            shop={shopParts}
            parts={parts}
            pageType={pageType}
            onOpenSaved={(partId) => setDialog({ kind: "edit-saved", partId })}
            onUseLayout={(part) => placeSaved(part)}
            checks={checks}
            themePanel={
              themeTab && themeValue && themeSaved ? (
                <ThemePanel
                  value={themeValue}
                  saved={themeSaved}
                  settings={themeTab.settings}
                  onChange={setThemeValue}
                  onSave={saveTheme}
                  install={fonts.install}
                />
              ) : null
            }
            templates={templates && { actions: templates, controller, use: templateUse, source, onSource: setSource, onBrowse: () => setBrowsing({ kind: "all" }), onPreview: openPreview, own: templates.previewStore === null }}
            onShared={(id, sharing) => setParts(parts.map((p) => (p.id === id ? { ...p, sharing } : p)))}
            rowsFull={rowsFull}
            blocksFull={blocksFull}
          />
          )}
          <RailResizer
            side="left"
            label={fw.leftLabel}
            folded={leftFolded}
            width={leftWidth}
            onWidth={setLeftWidth}
            measure={() => measureRails(columnsRef.current, panelId, "left")}
          />

          {/* Its own scroll, with room at the sides for the rows' handles and tools, which reach past the canvas. */}
          <div className={`flex min-w-0 flex-col gap-3 lg:-mx-3 lg:px-3 lg:pb-6 ${STANDALONE}`}>
          {viewNote}
          {!translate && (
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <MotionPreviewToggle
                  on={motionOn}
                  onChange={(on) => {
                    setMotionOn(on);
                    if (on) setMotionRun((n) => n + 1);
                  }}
                  onReplay={() => setMotionRun((n) => n + 1)}
                />
              </div>
              <div role="toolbar" aria-label={fw.screenSizes} className="flex flex-wrap items-center gap-2">
                <DisplayLegend parts={displayed} onOpen={(id) => setDialog(displayDialog(rows, id))} />
                <HiddenPartsToggle hide={hideHidden} onChange={setHideHidden} />
                <ResponsiveToggle on={responsive.view !== null} onToggle={responsive.toggle} />
              </div>
            </div>
          )}
          {responsive.view && (
            <ResponsiveBar
              view={responsive.view}
              breakpoints={breakpoints}
              onSize={responsive.choose}
              onWidth={responsive.setWidth}
              onHeight={responsive.setHeight}
              onZoom={responsive.setZoom}
              onExit={responsive.exit}
            />
          )}
          {/* The canvas draws with the site's own fonts (D59) and a store's theme (D60), as the site does. */}
          <div
            ref={canvasRef}
            style={fonts.style}
            // With owners' CSS (D100), whatever it draws stays inside the canvas, even `position: fixed`.
            className={`min-w-0 ${fonts.theme ? "rounded-md bg-background text-foreground" : ""} ${css.some((c) => c.trim()) ? "[contain:paint]" : ""}`}
            {...(fonts.theme && { ...fonts.theme.attributes, ...(themeNow && themeAttributes(themeNow)), "data-theme-canvas": "" })}
            data-custom-css=""
          >
            <FontLinks families={siteFontFamilies(fonts.site)} />
            {/* The families the rows' and columns' typography uses (D179); the blocks' come with each block. */}
            <FontLinks families={pageFonts({ rows: shownRows })} />
            {canvasTheme && <style>{canvasTheme.css}</style>}
            {/* What the parts' settings say at each screen size (D179), measured against the canvas (`kz-page`), not the window. */}
            <CanvasPartStyles rows={shownRows} source={rows} breakpoints={breakpoints} hideHidden={hideHidden} />
            {/* Owners' own CSS (D100), kept inside the canvas so it never reaches the admin; its width queries follow the canvas (D179). */}
            <ScopedCss css={css} root="[data-custom-css]" container={PAGE_CONTAINER} />
            <Canvas
              view={responsive.view}
              // Switching the preview on starts every entrance again; off, the canvas is drawn plain.
              key={motionOn ? `motion-${motionRun}` : "plain"}
              rows={shownRows}
              dragging={dragging}
              target={target}
              actions={actions}
              // Where a store can browse templates, an empty page starts from a page layout (D127).
              onStartFromLayout={
                templates && !translate ? () => setBrowsing({ kind: "page" }) : null
              }
              blank={blankPage}
            />
          </div>
          </div>

          <RailResizer
            side="right"
            label={fw.rightLabel}
            folded={rightFolded}
            width={rightWidth}
            onWidth={setRightWidth}
            measure={() => measureRails(columnsRef.current, panelId, "right")}
          />
          {rightFolded && (
            <Rail side="right" label={fw.rightLabel} controls={`${panelId}-right`} onOpen={() => setRightFolded(false)} className="order-first lg:order-none" />
          )}
          {/* On phones the title and settings come first. */}
          <div id={`${panelId}-right`} hidden={rightFolded} className={`order-first flex min-w-0 flex-col gap-6 lg:order-none lg:pb-6 ${STANDALONE}`}>
            <RailHeader side="right" label={fw.rightLabel} controls={`${panelId}-right`} onFold={() => setRightFolded(true)} />
            {aside}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging?.kind === "palette-row" ? (
            <Tile label={w.layouts[dragging.layout]} preview={<LayoutPreview layout={dragging.layout} />} lifted />
          ) : dragging?.kind === "palette-column" ? (
            <Tile label={w.sidebar.column} preview={<LayoutPreview layout="1" />} lifted />
          ) : dragging?.kind === "palette-block" ? (
            <Tile
              label={
                dragging.part
                  ? dragging.type === "site"
                    ? w.siteParts[dragging.part as SitePart]
                    : dragging.type === "storePart"
                      ? shopPartCopy(dragging.part as ShopPart).name
                      : w.productParts[dragging.part as ProductPart]
                  : w.blockNames[dragging.type]
              }
              preview={dragging.type === "storePart" && dragging.part ? <ShopPartIcon part={dragging.part as ShopPart} /> : <BlockIcon type={dragging.type} />}
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
          sharing={templates !== null && templates.previewStore !== null}
          pageType={pageType}
        />
        {templates && (
          <>
            <TemplatesModal
              controller={controller}
              use={templateUse}
              source={source}
              onSource={setSource}
              own={templates.previewStore === null}
              open={browsing !== null}
              kind={browsing?.kind}
              onClose={() => setBrowsing(null)}
              onPreview={openPreview}
              pageType={pageType}
              rowsFull={rowsFull}
              blocksFull={blocksFull}
            />
            <TemplatePreviewDialog
              item={previewed}
              href={previewed ? templatePreviewPath(templates.previewStore, previewed.id) : null}
              returnFocus={previewOpener}
              reason={previewed ? blockedReason(previewed, { pageType, rowsFull, blocksFull }) : null}
              switching={previewed ? controller.busy.has(previewed.id) : false}
              using={previewed ? templateUse.using === previewed.id : false}
              usingAny={templateUse.using !== null}
              problems={previewed ? [...(controller.problems[previewed.id] ?? []), ...(templateUse.issues[previewed.id] ?? [])] : []}
              onToggleActive={() => preview && previewed && controller.setActive(preview.source, previewed.id, !previewed.active)}
              own={templates.previewStore === null}
              onUse={() => previewed && templateUse.run(previewed)}
              onClose={() => setPreview(null)}
            />
          </>
        )}
        <ApplyLayoutDialog
          pending={layoutUse}
          rows={rows}
          pageCss={pageCss}
          pageType={pageType}
          pageSaved={grid.pageId !== null}
          onApply={applyLayout}
          onClose={() => setLayoutUse(null)}
        />
      </DndContext>
    </ThemeSections>
    </ThemeRowWidths>
    </BindEntitiesContext>
    </FieldGroupsContext>
    </SizeEditContext>
  );
}

// ---------------------------------------------------------------------------
// The left sidebar
// ---------------------------------------------------------------------------

const TABS = [{ key: "components" }, { key: "rows" }, { key: "saved" }] as const;
/** Only where a store can share and use templates (D125). */
const TEMPLATES_TAB = { key: "templates" } as const;
/** Where the page checker's findings are (wave 1, 1e): a tab of its own, with how many there are in its label. */
const CHECKS_TAB = { key: "checks" } as const;
type Tab = (typeof TABS)[number]["key"] | typeof TEMPLATES_TAB.key | typeof CHECKS_TAB.key;

/** What the Templates tab needs (D125); on Kaizen's own pages, Kaizen's own templates only (D236, `own`). */
type TemplatesInSidebar = {
  actions: TemplateActions;
  controller: TemplateController;
  /** Using a template: fetching its copy and what it said (D127). */
  use: TemplateUse;
  source: TemplateSource;
  onSource: (source: TemplateSource) => void;
  onBrowse: () => void;
  /** Opens a template's preview; `opener` gets the focus back when it closes. */
  onPreview: (item: TemplateItem, source: TemplateSource, opener: HTMLElement) => void;
  /** Kaizen's own builder (D236): one source, its own templates, always on. */
  own: boolean;
};

function Sidebar({
  id: panelId,
  hidden,
  onFold,
  tab,
  onTab: setTab,
  onAddRow,
  themeSections,
  onAddColumn,
  onAddBlock,
  productParts,
  siteParts,
  search,
  plans,
  themeStoreParts,
  customFields,
  shop,
  features,
  parts,
  pageType,
  onOpenSaved,
  onUseLayout,
  templates,
  checks,
  themePanel,
  onShared,
  rowsFull,
  blocksFull,
}: {
  id: string;
  /** The Checks tab (wave 1, 1e), or null. */
  checks: { count: number; panel: ReactNode } | null;
  /** The Theme tab beside Building blocks (D182): the store's theme settings for rows, text and buttons; null where there is none (Kaizen's own pages). */
  themePanel: ReactNode | null;
  /** Folded away, leaving a rail (D125). */
  hidden: boolean;
  onFold: () => void;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onAddRow: (layout: RowLayout) => void;
  /** The live theme's sections for the Rows tab (D272) and how a section made ready is placed; null where the page takes none. */
  themeSections: { actions: ThemeSectionActions; onPlace: (part: SavedPart) => void } | null;
  /** Adds an empty column beside the one last pointed at, or last in the page (D187). */
  onAddColumn: () => void;
  onAddBlock: (type: BlockType, part?: ProductPart | SitePart | ShopPart | ThemeStorePart) => void;
  productParts: boolean;
  /** A header or footer (D80): the site parts its owner has. */
  siteParts: SitePart[] | null;
  /** The store's search can be added (D112). */
  search: boolean;
  /** Kaizen's plans can be added (D142). */
  plans: boolean;
  /** The theme store's components that can be added (D285); none on a store's pages and Kaizena Flow's articles, header and footer. */
  themeStoreParts: readonly ThemeStorePart[];
  /** The page's own custom fields can be added (D118). */
  customFields: boolean;
  /** The store's working pages' components can be added (D113). */
  shop: boolean;
  /** The store's features as kept (D178): parts of a feature that is off are not offered. Null offers every part. */
  features: readonly string[] | null;
  parts: SavedPart[];
  /** The kind of page being edited (D127). */
  pageType: PageType;
  onOpenSaved: (partId: string) => void;
  /** Uses a saved page layout on the page. */
  onUseLayout: (part: Extract<SavedPart, { kind: "page" }>) => void;
  /** Where a store's parts can be shared and its templates used (D125); null on Kaizen's own pages. */
  templates: TemplatesInSidebar | null;
  /** One of the saved parts was shared differently. */
  onShared: (id: string, sharing: PartSharing) => void;
  rowsFull: boolean;
  blocksFull: boolean;
}) {
  const w = useAdminText("builder");
  const fw = w.frame;
  const sw = w.sidebar;
  const id = useId();
  // The shop's components the store's features let it use (D178): a section with none is not drawn, and a component behind no feature
  // (the Cookies page) is in More, as a website needs it as much as a shop.
  const offered = (part: ShopPart) => partFeatureOn({ type: "storePart", part }, features);
  const shopPages = STORE_PART_KEYS.filter((part) => "feature" in STORE_PARTS[part] && offered(part));
  const siteWideParts = STORE_PART_KEYS.filter((part) => !("feature" in STORE_PARTS[part]) && offered(part));
  const pieceGroups = PIECE_GROUPS.map((group) => ({ ...group, pieces: piecesOf(group.route).filter(offered) })).filter((group) => group.pieces.length > 0);
  // The sidebar shows the building blocks or, where the store has a theme to edit here, the theme (D182).
  const [mode, setMode] = useState<"blocks" | "theme">("blocks");
  const showing = themePanel ? mode : "blocks";
  const tabs = [...TABS, ...(templates ? [TEMPLATES_TAB] : []), ...(checks ? [CHECKS_TAB] : [])];
  const select = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length].key;
    setTab(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <aside
      id={panelId}
      hidden={hidden}
      aria-label={sw.buildingBlocks}
      className={`flex min-w-0 flex-col rounded-lg border border-border bg-background ${STANDALONE}`}
    >
      <div className="border-b border-border px-4 py-1.5">
        {themePanel ? (
          <RailTabsHeader
            side="left"
            label={fw.leftLabel}
            controls={panelId}
            onFold={onFold}
            tabs={[
              { key: "blocks", label: sw.buildingBlocks, panel: `${id}-blocks` },
              { key: "theme", label: sw.theme, panel: `${id}-theme` },
            ]}
            value={showing}
            onChange={setMode}
          />
        ) : (
          <RailHeader side="left" label={fw.leftLabel} controls={panelId} onFold={onFold} />
        )}
      </div>
      {themePanel && (
        <div id={`${id}-theme`} role="tabpanel" hidden={showing !== "theme"} className="flex flex-col gap-4 p-4">
          {themePanel}
        </div>
      )}
      <div id={`${id}-blocks`} role={themePanel ? "tabpanel" : undefined} hidden={showing !== "blocks"} className="flex flex-col">
      <div role="tablist" aria-label={sw.buildingBlocks} className={`grid border-b border-border ${tabs.length >= 5 ? "grid-cols-5" : tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        {tabs.map((t, index) => (
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
            {t.key === "checks" && checks && checks.count > 0 ? `${sw.tabs[t.key]} (${checks.count})` : sw.tabs[t.key]}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
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
                {sw.componentsHint}
              </p>
              {productParts && (
                <>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{sw.theProduct}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {PRODUCT_PART_KEYS.filter((part) => partFeatureOn({ type: "product", part }, features)).map((part) => (
                      <PaletteTile
                        key={part}
                        id={`palette:product:${part}`}
                        data={{ kind: "palette-block", type: "product", part }}
                        label={w.productParts[part]}
                        preview={<BlockIcon type="product" />}
                        onAdd={() => onAddBlock("product", part)}
                        disabled={blocksFull}
                      />
                    ))}
                  </div>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{sw.aroundIt}</h3>
                </>
              )}
              {siteParts && (
                <>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{sw.theSite}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {siteParts.map((part) => (
                      <PaletteTile
                        key={part}
                        id={`palette:site:${part}`}
                        data={{ kind: "palette-block", type: "site", part }}
                        label={w.siteParts[part]}
                        preview={<BlockIcon type="site" />}
                        onAdd={() => onAddBlock("site", part)}
                        disabled={blocksFull}
                      />
                    ))}
                  </div>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{sw.more}</h3>
                </>
              )}
              {shop && shopPages.length > 0 && (
                <>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{sw.shopPages}</h3>
                  <p className="text-xs text-muted">{sw.shopPagesHint}</p>
                  <div className="grid grid-cols-2 gap-3">
                    {shopPages.map((part) => (
                      <PaletteTile
                        key={part}
                        id={`palette:shop:${part}`}
                        data={{ kind: "palette-block", type: "storePart", part }}
                        label={STORE_PARTS[part].name}
                        preview={<ShopPartIcon part={part} />}
                        onAdd={() => onAddBlock("storePart", part)}
                        disabled={blocksFull}
                      />
                    ))}
                  </div>
                </>
              )}
              {shop &&
                pieceGroups.map((group) => (
                  <div key={group.route} className="flex flex-col gap-3">
                    <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{group.name}</h3>
                    <p className="text-xs text-muted">{group.hint}</p>
                    <div className="grid grid-cols-2 gap-3">
                      {group.pieces.map((part) => (
                        <PaletteTile
                          key={part}
                          id={`palette:shop:${part}`}
                          data={{ kind: "palette-block", type: "storePart", part }}
                          label={shopPartCopy(part).name}
                          preview={<ShopPartIcon part={part} />}
                          onAdd={() => onAddBlock("storePart", part)}
                          disabled={blocksFull}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              {themeStoreParts.length > 0 && (
                <>
                  <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{sw.themeStore}</h3>
                  <p className="text-xs text-muted">
                    {themeStoreParts.length > 1
                      ? sw.themeStoreParts
                      : sw.themeStoreList}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {themeStoreParts.map((part) => (
                      <PaletteTile
                        key={part}
                        id={`palette:theme-store:${part}`}
                        data={{ kind: "palette-block", type: "themeStore", part }}
                        label={THEME_STORE_PART_COPY[part].name}
                        preview={<BlockIcon type="themeStore" />}
                        onAdd={() => onAddBlock("themeStore", part)}
                        disabled={blocksFull}
                      />
                    ))}
                  </div>
                </>
              )}
              {((shop && (shopPages.length > 0 || pieceGroups.length > 0)) || themeStoreParts.length > 0) && (
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{sw.more}</h3>
              )}
              <div className="grid grid-cols-2 gap-3">
                {[...BLOCK_TYPES, ...(search && partFeatureOn({ type: "search" }, features) ? (["search"] as const) : []), ...(plans ? (["plans", "domainSearch"] as const) : []), ...(customFields ? (["customField", "fieldLoop"] as const) : [])].map((type) => (
                  <PaletteTile
                    key={type}
                    id={`palette:block:${type}`}
                    data={{ kind: "palette-block", type }}
                    label={w.blockNames[type]}
                    preview={<BlockIcon type={type} />}
                    onAdd={() => onAddBlock(type)}
                    disabled={blocksFull}
                  />
                ))}
                {/* A shop component behind no feature (the Cookies page) belongs to a website as much as to a shop. */}
                {shop &&
                  siteWideParts.map((part) => (
                    <PaletteTile
                      key={part}
                      id={`palette:shop:${part}`}
                      data={{ kind: "palette-block", type: "storePart", part }}
                      label={STORE_PARTS[part].name}
                      preview={<ShopPartIcon part={part} />}
                      onAdd={() => onAddBlock("storePart", part)}
                      disabled={blocksFull}
                    />
                  ))}
              </div>
            </>
          )}
          {t.key === "rows" && (
            <>
              <p className="text-xs text-muted">
                {sw.rowsHint}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {ROW_LAYOUT_KEYS.map((layout) => (
                  <PaletteTile
                    key={layout}
                    id={`palette:row:${layout}`}
                    data={{ kind: "palette-row", layout }}
                    label={w.layouts[layout]}
                    preview={<LayoutPreview layout={layout} />}
                    onAdd={() => onAddRow(layout)}
                    disabled={rowsFull}
                  />
                ))}
              </div>
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{sw.column}</h3>
              <p className="text-xs text-muted">{sw.columnHint}</p>
              <div className="grid grid-cols-2 gap-3">
                <PaletteTile id="palette:column" data={{ kind: "palette-column" }} label={sw.column} preview={<LayoutPreview layout="1" />} onAdd={onAddColumn} disabled={false} />
              </div>
              {themeSections && (
                <ThemeSectionsList actions={themeSections.actions} shown={tab === "rows" && !hidden} onPlace={themeSections.onPlace} disabled={rowsFull} />
              )}
            </>
          )}
          {t.key === "saved" && (
            <SavedList
              parts={parts}
              pageType={pageType}
              onOpen={onOpenSaved}
              onUseLayout={onUseLayout}
              sharing={templates && { setSharing: templates.actions.setSharing, onChanged: onShared }}
            />
          )}
          {t.key === "checks" && checks && checks.panel}
          {t.key === "templates" && templates && (
            <TemplatesTab
              controller={templates.controller}
              use={templates.use}
              source={templates.source}
              onSource={templates.onSource}
              shown={tab === "templates" && !hidden}
              onBrowse={templates.onBrowse}
              onPreview={templates.onPreview}
              own={templates.own}
              pageType={pageType}
              rowsFull={rowsFull}
              blocksFull={blocksFull}
            />
          )}
        </div>
      ))}
      </div>
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
  const sw = useAdminText("builder").saved;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLButtonElement> | undefined}
      // Only a drag puts it on the page for a pointer: a click on the sidebar adds nothing. Enter or Space (a click with no
      // pointer, `detail` 0) still adds it where the selection is, so the palette works without a mouse.
      onClick={(event) => {
        if (event.detail === 0) onAdd();
      }}
      disabled={disabled}
      aria-label={fillWords(sw.add, { label: label.toLowerCase() })}
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
 * Saved page layouts (D127), rows, columns and components (D46), by kind. Drag a row, column or component onto the page
 * to use a copy; press one to change it (or add it from there). A page layout is used whole, by asking how.
 */
function SavedList({
  parts,
  pageType,
  onOpen,
  onUseLayout,
  sharing,
}: {
  parts: SavedPart[];
  pageType: PageType;
  onOpen: (partId: string) => void;
  onUseLayout: (part: Extract<SavedPart, { kind: "page" }>) => void;
  /** Where parts can be shared (D125): each shows who can use it and lets the store change that. */
  sharing: { setSharing: TemplateActions["setSharing"]; onChanged: (id: string, sharing: PartSharing) => void } | null;
}) {
  const w = useAdminText("builder");
  if (parts.length === 0) {
    return <p className="text-xs text-muted">{w.saved.none}</p>;
  }
  return (
    <>
      <p className="text-xs text-muted">{w.saved.hint}</p>
      {(["page", "row", "column", "block"] as const).map((kind) => {
        const own = parts.filter((p) => p.kind === kind);
        if (own.length === 0) return null;
        return (
          <section key={kind} aria-label={w.savedKinds[kind].many} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{w.savedKinds[kind].many}</h3>
            <ul className="flex flex-col gap-1">
              {own.map((part) => (
                <li key={part.id} className="flex flex-col gap-1">
                  {part.kind === "page" ? (
                    <SavedLayoutItem
                      part={part}
                      reason={blockedReason({ kind: "page", pageType: part.content.pageType }, { pageType, rowsFull: false, blocksFull: false })}
                      onManage={() => onOpen(part.id)}
                      onUse={() => onUseLayout(part)}
                      showSharing={sharing !== null}
                    />
                  ) : (
                    <SavedItem part={part} onOpen={() => onOpen(part.id)} showSharing={sharing !== null} />
                  )}
                  {sharing && <SharingSelect part={part} setSharing={sharing.setSharing} onChanged={sharing.onChanged} />}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** A saved page layout (D127): not dragged, but used whole with a button; pressing its name manages it. */
function SavedLayoutItem({
  part,
  reason,
  onManage,
  onUse,
  showSharing,
}: {
  part: Extract<SavedPart, { kind: "page" }>;
  reason: string | null;
  onManage: () => void;
  onUse: () => void;
  showSharing: boolean;
}) {
  const reasonId = useId();
  const sw = useAdminText("builder").saved;
  const rows = part.content.rows.length;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-9 w-12 shrink-0 flex-col gap-0.5">
          <span className="h-2 rounded-sm bg-foreground/75" />
          <span className="flex-1 rounded-sm bg-foreground/40" />
          <span className="h-2 rounded-sm bg-foreground/75" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm">{part.name}</span>
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {countWords(rows, sw.rows)}
            <PageTypeBadge item={{ kind: "page", pageType: part.content.pageType }} warn={reason !== null} />
            {showSharing && part.sharing !== "private" && <SharingBadge sharing={part.sharing} />}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={onUse}
          disabled={reason !== null}
          aria-label={fillWords(sw.useLayout, { name: part.name })}
          aria-describedby={reason ? reasonId : undefined}
          title={reason ?? undefined}
          className="min-h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-surface disabled:opacity-50"
        >
          {sw.use}
        </button>
        <button
          type="button"
          onClick={onManage}
          aria-label={fillWords(sw.manageLayout, { name: part.name })}
          className="min-h-9 rounded-md border border-border px-3 text-xs hover:bg-surface"
        >
          {sw.manage}
        </button>
      </div>
      {reason && (
        <p id={reasonId} className="text-xs text-muted">
          {reason}
        </p>
      )}
    </div>
  );
}

/**
 * A template's copy made fit for a store's page (D56, D125): its content
 * grids show the store's own products and drop the categories and tags of
 * whoever it came from, which are not the store's.
 */
function forStore(part: PlainPart): PlainPart {
  const block = (b: PageBlock): PageBlock =>
    b.type === "contentGrid"
      ? { ...b, source: ownProducts(b.source), categories: [], tags: [] }
      : b;
  const column = (c: PageColumn): PageColumn => ({ ...c, blocks: c.blocks.map(block) });
  if (part.kind === "block") return { ...part, content: block(part.content) };
  if (part.kind === "column") return { ...part, content: column(part.content) };
  return { ...part, content: { ...part.content, columns: part.content.columns.map(column) } };
}

/** A saved row, column or component: the pointer drags it onto the page; pressing it (mouse or keyboard) opens it. */
function SavedItem({ part, onOpen, showSharing = false }: { part: PlainPart; onOpen: () => void; showSharing?: boolean }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `saved:${part.id}`,
    data: { kind: "saved", partId: part.id, part: part.kind } satisfies DragData,
  });
  const w = useAdminText("builder");
  return (
    <button
      ref={setNodeRef}
      type="button"
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLButtonElement> | undefined}
      onClick={onOpen}
      aria-label={fillWords(part.global ? w.saved.openGlobal : w.saved.open, { name: part.name, kind: w.savedKinds[part.kind].one.toLowerCase() })}
      className={`w-full touch-none text-left ${isDragging ? "opacity-40" : ""}`}
    >
      <SavedTile part={part} showSharing={showSharing} />
    </button>
  );
}

function SavedTile({ part, lifted = false, showSharing = false }: { part: SavedPart | null; lifted?: boolean; showSharing?: boolean }) {
  const w = useAdminText("builder");
  if (!part || part.kind === "page") return null;
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
        <span className="text-xs text-muted">
          {w.savedKinds[part.kind].one}
          {part.global && <span className="font-medium text-violet-700 dark:text-violet-300"> · {w.frame.global}</span>}
          {showSharing && part.sharing !== "private" && (
            <>
              {" "}
              <SharingBadge sharing={part.sharing} />
            </>
          )}
        </span>
      </span>
    </span>
  );
}

/** A block on its way to another place: its kind and the start of its text. */
function BlockPreview({ block }: { block: PageBlock | null }) {
  const w = useAdminText("builder");
  if (!block) return null;
  const text = (blockText(block) || (block.type === "button" ? inlinePlain(block.label) : "")).replace(/\s+/g, " ").trim();
  return (
    <div className="w-64 rounded-md border border-foreground bg-background p-3 shadow-xl">
      <p className="text-xs text-muted">{w.blockNames[block.type]}</p>
      <p className="truncate text-sm">{text || w.saved.empty}</p>
    </div>
  );
}

/** A column on its way to another place: how many blocks it takes, and the start of its text. */
function ColumnPreview({ column }: { column: PageColumn | null }) {
  const w = useAdminText("builder");
  if (!column) return null;
  const text = column.blocks.map(blockText).join(" ").replace(/\s+/g, " ").trim();
  const count = column.blocks.length;
  return (
    <div className="w-64 rounded-md border-2 border-dashed border-blue-600 bg-background p-3 shadow-xl">
      <p className="text-xs text-muted">
        {w.sidebar.column} · {countWords(count, w.saved.components)}
      </p>
      <p className="truncate text-sm">{text || w.saved.empty}</p>
    </div>
  );
}

function BlockIcon({ type }: { type: BlockType }) {
  switch (type) {
    case "columns":
      return <LayoutPreview layout="2" />;
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
    case "search":
      return <SearchIcon />;
    case "plans":
      return <PlansIcon />;
    case "domainSearch":
      return <DomainSearchIcon />;
    case "themeStore":
      return <ThemeStoreIcon />;
    case "customField":
      return <FieldsIcon />;
    case "fieldLoop":
      return <LoopIcon />;
    case "storePart":
      return <ShopIcon />;
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
    case "testimonials":
      return <TestimonialsIcon />;
    case "socialLinks":
      return <SocialIcon />;
    case "iconList":
      return <IconListIcon />;
    case "table":
      return <TableIcon />;
    case "brands":
      return <BrandsIcon />;
    case "gallery":
      return <GalleryIcon />;
    case "emailForm":
      return <FormIcon />;
    case "newsletter":
      return <NewsletterIcon />;
    default:
      return <LetterIcon letter="T" />;
  }
}

function FormIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col justify-center gap-1 rounded-sm bg-foreground/75 px-2 text-background">
      <span className="h-1.5 w-full rounded-[2px] border border-current" />
      <span className="h-2.5 w-full rounded-[2px] border border-current" />
      <span className="h-1.5 w-3 rounded-[2px] bg-current" />
    </span>
  );
}

function NewsletterIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    </span>
  );
}

function TableIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <span className="grid h-6 w-10 grid-cols-3 grid-rows-3 gap-0.5">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={`rounded-[1px] bg-current ${i < 3 ? "" : "opacity-50"}`} />
        ))}
      </span>
    </span>
  );
}

function IconListIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col justify-center gap-1 rounded-sm bg-foreground/75 px-2 text-background">
      {[0, 1, 2].map((line) => (
        <span key={line} className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-current" />
          <span className="h-0.5 w-5 bg-current opacity-60" />
        </span>
      ))}
    </span>
  );
}

function SocialIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center gap-1 rounded-sm bg-foreground/75 text-background">
      <span className="size-2.5 rounded-full bg-current" />
      <span className="size-2.5 rounded-full bg-current" />
      <span className="size-2.5 rounded-full bg-current" />
    </span>
  );
}

function GalleryIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <rect x="3" y="4" width="8" height="7" rx="1" />
        <rect x="13" y="4" width="8" height="7" rx="1" />
        <rect x="3" y="13" width="8" height="7" rx="1" />
        <path d="M15 14.5v4l3.5-2z" fill="currentColor" />
      </svg>
    </span>
  );
}

function BrandsIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <rect x="3" y="5" width="7" height="6" rx="1" />
        <rect x="14" y="5" width="7" height="6" rx="1" />
        <path d="M4.5 16h4M15.5 16h4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function TestimonialsIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M4 5h16v11H9l-5 4z" />
        <path d="M8 9.5h2M8 12h6" strokeLinecap="round" />
      </svg>
    </span>
  );
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
      <span className="rounded-full border-2 border-current px-2 text-[10px] leading-4 font-medium">OK</span>
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
  view = null,
  rows,
  dragging,
  target,
  actions,
  onStartFromLayout,
  blank,
}: {
  /** Responsive mode (D179): the page at this width and height, zoomed; null is as wide as the canvas is. */
  view?: CanvasView | null;
  rows: PageRow[];
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  actions: Actions;
  /** Opens the page layouts to start from (D127), where a store has templates; null elsewhere. */
  onStartFromLayout: (() => void) | null;
  /** Nothing is written on the page yet. */
  blank: boolean;
}) {
  const w = useAdminText("builder");
  const section = (
    <section
      aria-labelledby="content-heading"
      data-builder-dragging={dragging ? "" : undefined}
      data-builder-size={view?.size}
      // Links in the text are for visitors; in the editor they do nothing.
      onClickCapture={(event) => {
        if ((event.target as Element).closest("a")) event.preventDefault();
      }}
      className={`rounded-lg border border-border bg-background px-6 pt-10 pb-8 ${view ? "mx-auto w-max" : "min-w-0"}`}
      // At a size the page is that wide and the section that much zoomed, so the part rules' container queries see that width.
      style={view ? { zoom: view.zoom / 100, minHeight: view.height } : undefined}
    >
      <h2 id="content-heading" className="sr-only">
        {w.canvas.content}
      </h2>
      {/* The page's container (D179): the part rules' sizes are its width. */}
      <div
        className={`${PAGE_CONTAINER} flex flex-col gap-8`}
        style={{ containerType: "inline-size", containerName: PAGE_CONTAINER, ...(view && { width: view.width }) }}
      >
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-8">
            {rows.map((row, index) => (
              <RowItem
                key={row.id}
                row={row}
                name={fillWords(w.tools.row, { n: index + 1 })}
                first={index === 0}
                meets={meetsAbove(rows[index - 1], row)}
                line={target?.id === row.id && dragging?.kind !== "row" ? (target.after ? "after" : "before") : null}
                dragging={dragging}
                target={target}
                actions={actions}
              />
            ))}
          </ol>
        </SortableContext>
        <CanvasEnd empty={rows.length === 0} active={movesRows(dragging) || movesBlock(dragging)} onStartFromLayout={onStartFromLayout} />
        {blank && rows.length > 0 && onStartFromLayout && <StartFromLayout onStart={onStartFromLayout} />}
      </div>
    </section>
  );
  if (!view) return section;
  // A device's screen: the page scrolls inside it, as on the device, and the frame scrolls sideways when the size is wider than the room.
  return (
    <div
      data-builder-frame=""
      className="overflow-auto rounded-lg border border-border bg-surface p-3"
      style={{ height: Math.round((view.height * view.zoom) / 100) + 26 }}
    >
      {section}
    </div>
  );
}

/** Below the last row: where a row dropped goes last, and what an empty page says. */
/** The canvas's part stylesheet (D179): container queries against the canvas, worked out again only when the rows change. */
/**
 * A column of the builder that scrolls on its own on a computer, never handing its scroll on to the page. Positioned, so what lies
 * absolutely inside it (a field's label for screen readers) is held by its scroll too and never makes the page itself scroll.
 */
const STANDALONE = "lg:relative lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain";

/**
 * What dragging a sidebar's edge needs to know (D262): its width now, the other side's (folded or open), and the room the three
 * columns share (the builder's width less the two gaps between them). Null where the columns are not side by side.
 */
function measureRails(columns: HTMLElement | null, panelId: string, side: RailSide): { own: number; other: number; total: number } | null {
  if (!columns) return null;
  const widthOf = (which: RailSide) => {
    const open = document.getElementById(`${panelId}-${which}`);
    if (open && !open.hidden) return open.getBoundingClientRect().width;
    // Folded: its narrow rail, the column before or after the canvas.
    return 44;
  };
  const gap = parseFloat(getComputedStyle(columns).fontSize) * 1.5;
  return { own: widthOf(side), other: widthOf(side === "left" ? "right" : "left"), total: columns.getBoundingClientRect().width - 2 * gap };
}

/**
 * Fits the builder's columns between where they start and the editor's bar at the foot of the screen (`data-editor-bar`), as
 * `--builder-h`, so each column scrolls on its own and nothing lies behind the header or the bar. Measured from the top of the
 * document, again when the window or the bar changes size.
 */
function useStandaloneColumns(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const fit = () => {
      const top = grid.getBoundingClientRect().top + window.scrollY;
      const bar = document.querySelector<HTMLElement>("[data-editor-bar]")?.offsetHeight ?? 0;
      grid.style.setProperty("--builder-h", `${Math.max(MIN_COLUMNS_HEIGHT, Math.floor(window.innerHeight - top - bar - COLUMNS_GAP))}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    const bar = document.querySelector("[data-editor-bar]");
    if (bar) observer.observe(bar);
    if (grid.parentElement) observer.observe(grid.parentElement);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [ref]);
}
/** Room between the columns' foot and the editor's bar, and the least the columns are given on a very low window. */
const COLUMNS_GAP = 16;
const MIN_COLUMNS_HEIGHT = 420;

function CanvasPartStyles({ rows, source, breakpoints, hideHidden }: { rows: PageRow[]; /** The page's own rows, which the parts hidden at a size are read from. */ source: PageRow[]; breakpoints: Breakpoints; hideHidden: boolean }) {
  // With the parts hidden at a size: faded with their eye there, or left out (D179).
  const css = useMemo(
    () =>
      [breakpointClassCss(breakpoints, "container"), partCss(rows, "canvas", breakpoints), canvasHiddenCss(source, breakpoints, hideHidden)].filter(Boolean).join("\n"),
    [rows, source, breakpoints, hideHidden],
  );
  return css ? <style>{css}</style> : null;
}

function CanvasEnd({
  empty,
  active,
  onStartFromLayout,
}: {
  empty: boolean;
  active: boolean;
  onStartFromLayout: (() => void) | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas-end", data: { kind: "canvas-end" } satisfies DragData });
  const cw = useAdminText("builder").canvas;
  if (!empty && !active) return <div ref={setNodeRef} className="-mt-8" />;
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-28 items-center justify-center rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted ${
        isOver ? "border-blue-600 bg-surface" : "border-border"
      }`}
    >
      {empty ? (
        <div className="flex flex-col items-center gap-3">
          <p>{cw.empty}</p>
          {onStartFromLayout && <StartFromLayout onStart={onStartFromLayout} />}
        </div>
      ) : (
        cw.dropLast
      )}
    </div>
  );
}

/** For a page with nothing on it (D127): begin with a whole page layout from the templates instead. */
function StartFromLayout({ onStart }: { onStart: () => void }) {
  const cw = useAdminText("builder").canvas;
  return (
    <button
      type="button"
      onClick={onStart}
      className="min-h-10 rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-surface"
    >
      {cw.startFromLayout}
    </button>
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
  onTest,
  mark,
  tag,
  motion = false,
  side = "left",
}: {
  label: string;
  /** Which top corner it sits at: a column's at the right, clear of its first component's at the left. */
  side?: "left" | "right";
  /** A short word after the label: a modal row's "Modal" (D121). */
  tag?: string;
  /** The part has motion effects of its own (D128): a small wave says so. */
  motion?: boolean;
  /** A global's use, or the page's own part inside one (D98): said after the label, in its colour. */
  mark?: PartMark | null;
  /** The drag handle, made where `useSortable` is (see `handleClass`); none while translating. */
  handle?: ReactNode;
  onEdit: () => void;
  editLabel: string;
  onDuplicate?: () => void;
  duplicateDisabled?: boolean;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  /** Starts an A/B test of this part (D148). */
  onTest?: () => void;
}) {
  const tool = toolClass;
  const tw = useAdminText("builder").tools;
  const lower = label.toLowerCase();
  return (
    <div
      data-builder-tools
      className={`absolute top-0 ${side === "right" ? "right-0" : "left-0"} z-20 flex -translate-y-full items-center gap-0.5 rounded-t-md px-1 text-white shadow ${
        mark?.kind === "global" ? "bg-violet-600" : mark?.kind === "local" ? "bg-teal-700" : "bg-blue-600"
      }`}
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
          aria-label={fillWords(tw.duplicateThis, { what: lower })}
          title={tw.duplicate}
          className={tool}
        >
          <Icon name="copy" />
        </button>
      )}
      {onTest && (
        <button type="button" onClick={onTest} aria-label={fillWords(tw.testThis, { what: lower })} title={tw.test} className={tool}>
          <Icon name="flask" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled}
          aria-label={fillWords(tw.deleteThis, { what: lower })}
          title={tw.delete}
          className={tool}
        >
          <Icon name="trash" />
        </button>
      )}
      <span className="px-1 text-xs whitespace-nowrap">
        {label}
        {motion && <MotionMark />}
        {tag && <span className="ml-1 rounded bg-white/25 px-1 text-[10px] font-medium uppercase">{tag}</span>}
        {mark && <span className="font-medium"> · {mark.text}</span>}
      </span>
    </div>
  );
}

/** How the canvas marks a part among globals' uses (D98). */
type PartMark = { kind: "global" | "local"; text: string };

function markOf(part: PageRow | PageColumn | PageBlock, actions: Actions, w: BuilderMessages): PartMark | null {
  if (part.global) return { kind: "global", text: fillWords(w.tools.globalMark, { name: actions.globalName(part.global) }) };
  if (part.local) return { kind: "local", text: w.tools.onlyThisPage };
  return null;
}

/** The canvas's attributes for a part's marks (the outline colours are in globals.css). */
const markAttributes = (part: PageRow | PageColumn | PageBlock) => ({
  ...(part.global && { "data-builder-global": "" }),
  ...(part.local && { "data-builder-local": "" }),
});

/** What a row's layout is called where it is named for a screen reader: its one layout, or how many lines of columns it has (D187). */
const rowLayoutLabel = (row: PageRow, w: BuilderMessages): string =>
  row.moreLines ? fillWords(w.tools.lines, { n: row.moreLines.length + 1 }) : w.layouts[row.layout].toLowerCase();

/** A column's name in its own tools: without the row it is in ("Row 1, column 2" is "Column 2"). */
function withoutRow(name: string, w: BuilderMessages): string {
  const pattern = new RegExp(`^${w.tools.row.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{n\\}", "\\d+")}, `);
  const rest = name.replace(pattern, "");
  return rest === name ? name : rest.charAt(0).toUpperCase() + rest.slice(1);
}

function RowItem({
  row,
  name,
  first,
  meets,
  line,
  dragging,
  target,
  actions,
}: {
  row: PageRow;
  name: string;
  /** The page's first row, which motion treats gently (D128). */
  first: boolean;
  /** It meets the row above it, as on the site (D262): both draw a box, so the room between them is taken back. */
  meets: boolean;
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
  const fx = canvasFx(actions.motionPreview, row.motion, "row", { firstRow: first });
  const frame = rowFrame(row);
  // Resizing (D182): dragging the row's side edges sets how wide its content may be, the edges between its columns how it is shared.
  const { size } = useSizeEdit();
  const resizable = !row.modal && !actions.translating;
  const widthLimited = row.width !== "full" || row.contentWidth !== "full";
  const contentMax = valueAt(row, "contentMax", size) ?? null;
  // The page's own row (the canvas draws it with the theme under it), so only what the person set is written.
  const ownRow = (rows: PageRow[]) => rows.find((r) => r.id === row.id);
  const setWidth = (px: number) =>
    actions.onRows((rows) => {
      const own = ownRow(rows);
      return own ? patchRow(rows, row.id, setAt(own, size, { contentMax: px })) : rows;
    });
  const resetWidth = () =>
    actions.onRows((rows) => {
      const own = ownRow(rows);
      return own ? patchRow(rows, row.id, size === "xl" ? { contentMax: undefined } : clearAt(own, size, "contentMax")) : rows;
    });
  const w = useAdminText("builder");
  const tw = w.tools;

  return (
    <li
      ref={setNodeRef}
      data-builder-item="row"
      data-builder-id={row.id}
      data-builder-holder={row.id}
      data-builder-modal={row.modal ? "" : undefined}
      {...markAttributes(row)}
      tabIndex={0}
      aria-label={`${name}, ${rowLayoutLabel(row, w)}`}
      // Meeting the row above (D262): its band's own -1rem and the list's room between rows taken back.
      style={{ ...frame.style, ...(meets && { marginTop: `calc(-1rem - ${ROW_GAP})` }), transform: CSS.Translate.toString(transform), transition }}
      // A full-width row reaches the canvas's edges; its band for pointing is then above and below only.
      className={`${frame.className} ${isDragging ? "z-30 bg-background opacity-80 shadow-xl" : ""}`}
    >
      {!actions.translating && (
      <Tools
        label={name}
        tag={row.modal ? tw.modal : undefined}
        motion={hasMotion(row)}
        mark={markOf(row, actions, w)}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={fillWords(tw.drag, { what: name.toLowerCase() })}
            className={handleClass}
          >
            <Icon name="grip" />
          </button>
        }
        onEdit={() => actions.open({ kind: "edit-row", rowId: row.id, columnId: null })}
        editLabel={tw.settings}
        onDuplicate={() => actions.onRows((rows) => duplicateRow(rows, row.id, newId))}
        onTest={actions.onTest ? () => actions.onTest!({ kind: "row", id: row.id }) : undefined}
        onDelete={() => (rowHasText(row) ? actions.open({ kind: "delete", what: fillWords(tw.rowAndAll, { what: name.toLowerCase() }), run: remove }) : remove())}
      />
      )}
      <Line at={line} />
      {resizable && widthLimited && row.width !== "full" && (
        <RowWidthHandles inset={16} value={contentMax} label={name} onWidth={setWidth} onReset={resetWidth} />
      )}
      <HiddenBadge hideAt={row.visibility?.hideAt} />
      <DisplayBadge show={row.visibility?.show} />
      {/* A modal's row stays in the page here (D121): badged, with a preview of the real modal. */}
      {row.modal && <ModalBar row={row} lang={actions.lang} />}
      <div className={box.className} style={{ ...box.style, ...fx.style }} {...fx.attrs}>
        {/*
          A background that stays in place while the page scrolls (D184) is pinned to the browser's window on the site. The canvas's page
          is a container (its screen sizes are container queries), which a pinned layer takes as its window, so it would lie at the top of
          the whole canvas and the row's frame would cut it away: here it fills its row as any background does.
        */}
        <PartBackground background={row.background} align={row.backgroundAlign} {...canvasBackground(actions.motionPreview, row.backgroundMotion, first)} />
        <div className={rowInnerClass(row, "canvas")} style={rowInnerStyle(row, "canvas")}>
          {resizable && widthLimited && row.width === "full" && (
            <RowWidthHandles inset={24} value={contentMax} label={name} onWidth={setWidth} onReset={resetWidth} />
          )}
          <ColumnLinesView holder={row} name={name} dragging={dragging} target={target} actions={actions} />
        </div>
      </div>
    </li>
  );
}

/**
 * A row's columns on the canvas, line by line (D187), with their dividers and, while a column is dragged, the strips for a new line;
 * a Columns component's (D294) the same, its `holder` being the component drawn as a row (`columnsAsRow()`), so a column moves into,
 * out of and within it, takes a new line there and shares its width by the same edits as a row's.
 */
function ColumnLinesView({
  holder,
  nested = false,
  name,
  dragging,
  target,
  actions,
}: {
  holder: PageRow;
  /** A Columns component's columns (D294), in which nothing more is nested. */
  nested?: boolean;
  name: string;
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  actions: Actions;
}) {
  const { size } = useSizeEdit();
  const grid = rowGrid(holder);
  const resizable = !holder.modal && !actions.translating;
  const sideBySide = !stackAt(holder, size);
  const lines = linesOf(holder);
  const dragColumn = movesColumn(dragging);
  const gapPx = valueAt(holder, "gap", size) ?? 32;
  const tw = useAdminText("builder").tools;
  return (
    <div className={`relative ${grid.className}`} style={grid.style}>
      {lines.map((line, l) => {
        const offset = lines.slice(0, l).reduce((n, earlier) => n + earlier.columns.length, 0);
        const content = (
          <SortableContext items={line.columns.map((c) => `column:${c.id}`)} strategy={horizontalListSortingStrategy}>
            {line.columns.map((column, i) => (
              <ColumnItem
                key={column.id}
                column={column}
                row={holder}
                index={offset + i}
                lineIndex={l}
                lineCount={line.columns.length}
                nested={nested}
                name={fillWords(tw.columnIn, { name, n: offset + i + 1 })}
                dragging={dragging}
                target={target}
                actions={actions}
              />
            ))}
            {/* After the columns, so their places (`:nth-child`) are what they were. */}
            {resizable && sideBySide && line.columns.length > 1 && (
              <ColumnDividers
                count={line.columns.length}
                signature={line.columns.map((c) => valueAt(c, "width", size) ?? "").join(",") + `|${size}|${valueAt(holder, "gap", size) ?? ""}`}
                label={lines.length > 1 ? fillWords(tw.lineIn, { name, n: l + 1 }) : name}
                onShares={(shares) => actions.onRows((rows) => setLineShares(rows, holder.id, l, size, shares))}
                onReset={() => actions.onRows((rows) => clearLineShares(rows, holder.id, l, size))}
              />
            )}
            {/* While a column is dragged: where it can go on a line of its own, above the first line, between two, or under the last. */}
            {dragColumn && l === 0 && <NewLineZone rowId={holder.id} at={0} place="before" height={20} />}
            {dragColumn && <NewLineZone rowId={holder.id} at={l + 1} place="after" height={l === lines.length - 1 ? 20 : Math.min(Math.max(gapPx, 16), 48)} />}
          </SortableContext>
        );
        return lines.length === 1 ? (
          <Fragment key={l}>{content}</Fragment>
        ) : (
          <div key={line.columns[0]?.id ?? l} className="relative" data-builder-line={l}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Where a column dropped on it goes on a line of its own (D187): above the first line, between two, or under the last. It is drawn
 * only while a column is dragged, over the room around the lines (never taking any), and shows where it would put the column.
 */
function NewLineZone({ rowId, at, place, height }: { rowId: string; at: number; place: "before" | "after"; height: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `line:${rowId}:${at}`, data: { kind: "line", rowId, at } satisfies DragData });
  const cw = useAdminText("builder").canvas;
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      data-builder-newline={at}
      style={{ height }}
      className={`absolute inset-x-0 z-20 flex items-center ${place === "before" ? "bottom-full" : "top-full"}`}
    >
      <span className={`block w-full ${isOver ? "h-1 rounded bg-blue-600" : "border-t-2 border-dashed border-blue-400/70"}`} />
      {isOver && (
        <span className="absolute left-1/2 -translate-x-1/2 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow">
          {cw.newLine}
        </span>
      )}
    </div>
  );
}

function ColumnItem({
  column,
  row,
  index,
  lineIndex,
  lineCount,
  nested,
  name,
  dragging,
  target,
  actions,
}: {
  column: PageColumn;
  row: PageRow;
  /** One of a Columns component's columns (D294): nothing is nested in it. */
  nested: boolean;
  /** Its place in the row, for a row's stagger (D128). */
  index: number;
  /** Its line in the row (D187), and how many columns that line holds. */
  lineIndex: number;
  lineCount: number;
  name: string;
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  actions: Actions;
}) {
  const rowId = row.id;
  const count = row.columns.length;
  const box = columnBox(column, row, "canvas");
  const fx = canvasFx(actions.motionPreview, column.motion, "column", { index, parentStagger: row.motion?.enter?.stagger, parentEnter: row.motion?.enter });
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: `column:${column.id}`,
    data: { kind: "column", columnId: column.id, rowId, line: lineIndex, holdsColumns: column.blocks.some((b) => b.type === "columns") } satisfies DragData,
    disabled: actions.translating,
  });
  const droppingBlock = dragging?.kind === "palette-block" || dragging?.kind === "block";
  // While columns or a row's layout are dragged, a column of the page (never a nested one, nor the one dragged) takes them nested (D294).
  const nestHere = !nested && !actions.translating && nestsColumns(dragging) && !(dragging?.kind === "column" && dragging.columnId === column.id);
  const remove = () => actions.onRows((rows) => removeColumn(rows, column.id));
  const w = useAdminText("builder");
  const tw = w.tools;
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
      data-builder-id={column.id}
      {...markAttributes(column)}
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
            side="right"
            label={withoutRow(name, w)}
            onEdit={() => actions.open({ kind: "edit-row", rowId, columnId: column.id })}
            editLabel={tw.translate}
          />
        )
      ) : (
      <Tools
        side="right"
        label={withoutRow(name, w)}
        motion={hasMotion(column)}
        mark={markOf(column, actions, w)}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={fillWords(tw.drag, { what: name.toLowerCase() })}
            className={handleClass}
          >
            <Icon name="grip" />
          </button>
        }
        onEdit={() => actions.open({ kind: "edit-row", rowId, columnId: column.id })}
        editLabel={tw.settings}
        onDuplicate={() => actions.onRows((rows) => duplicateColumn(rows, column.id, newId))}
        duplicateDisabled={lineCount >= LINE_COLUMNS_MAX}
        onTest={actions.onTest ? () => actions.onTest!({ kind: "column", id: column.id }) : undefined}
        onDelete={() =>
          columnHasText(column) ? actions.open({ kind: "delete", what: fillWords(tw.columnAndText, { what: name.toLowerCase() }), run: remove }) : remove()
        }
        deleteDisabled={count <= 1}
      />
      )}
      <Line at={columnLine} vertical />
      <HiddenBadge hideAt={column.visibility?.hideAt} />
      <DisplayBadge show={column.visibility?.show} />
      {/* The column itself, as the site draws it, inside its band for pointing. */}
      <div className={box.className} style={{ ...box.style, ...fx.style }} {...fx.attrs}>
      <PartBackground background={column.background} {...canvasBackground(actions.motionPreview, column.backgroundMotion)} />
      {column.link && (
        <span className="pointer-events-none absolute top-0 right-0 z-10 max-w-[80%] -translate-y-full truncate rounded-t bg-foreground/80 px-1.5 py-0.5 text-[11px] text-background">
          {fillWords(tw.linksTo, { href: column.link.href || "…" })}
        </span>
      )}
      {nestHere && column.blocks.length > 0 && <NestZone columnId={column.id} at="start" />}
      <SortableContext items={column.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        {column.blocks.map((block, index) => (
          <BlockItem
            key={block.id}
            block={block}
            columnId={column.id}
            index={index}
            parentStagger={column.motion?.enter?.stagger}
            parentEnter={column.motion?.enter}
            name={fillWords(tw.blockIn, { name, block: w.blockNames[block.type].toLowerCase(), n: index + 1 })}
            line={line(block.id)}
            dragging={dragging}
            target={target}
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
          {tw.dragHere}
          <button
            type="button"
            onClick={() => actions.onAddBlock("richText", column.id)}
            disabled={actions.blocksFull}
            aria-label={fillWords(tw.addTextTo, { what: name.toLowerCase() })}
            className="underline hover:text-foreground disabled:opacity-40"
          >
            {tw.orAddText}
          </button>
        </div>
      )}
      {nestHere && <NestZone columnId={column.id} at="end" />}
      </div>
    </div>
  );
}

/**
 * Where columns dragged onto a column are nested (D294): above its components or below them, a strip shown while columns, a new
 * column or a row's layout are dragged. Dropped there, they go into a new Columns component at that place.
 */
function NestZone({ columnId, at }: { columnId: string; at: "start" | "end" }) {
  const { setNodeRef, isOver } = useDroppable({ id: `nest:${columnId}:${at}`, data: { kind: "nest", columnId, at } satisfies DragData });
  const cw = useAdminText("builder").canvas;
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      data-builder-nest={at}
      className={`flex min-h-10 items-center justify-center rounded-md border-2 border-dashed px-2 text-xs ${
        isOver ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200" : "border-blue-400/70 text-muted"
      }`}
    >
      {cw.nestHere}
    </div>
  );
}

function BlockItem({
  block,
  columnId,
  index,
  parentStagger,
  parentEnter,
  name,
  line,
  dragging,
  target,
  actions,
}: {
  block: PageBlock;
  columnId: string;
  /** Its place in the column, and the column's stagger, for its entrance (D128). */
  index: number;
  parentStagger: number | undefined;
  parentEnter: EnterMotion | undefined;
  name: string;
  line: "before" | "after" | null;
  /** What is dragged and where it would land: a Columns component's columns (D294) show it as a row's do. */
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  actions: Actions;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    data: { kind: "block", blockId: block.id, columnId } satisfies DragData,
    disabled: actions.translating,
  });
  const remove = () => actions.onRows((rows) => removeBlock(rows, block.id));
  const edit = () => actions.open({ kind: "edit-block", blockId: block.id });
  const box = blockBox(block, "canvas");
  const fx = canvasFx(actions.motionPreview, block.motion, drawTarget({ kind: "block", blockType: block.type }), {
    index,
    parentStagger,
    parentEnter,
    image: block.type === "image",
  });
  // A heading or text is edited where it stands by pressing it once (D191); its settings open by pressing it twice or with the wrench.
  const inlineKind = actions.translating ? null : inlineKindOf(block);
  const editingInline = inlineKind !== null && actions.inline?.blockId === block.id;
  const blockElement = useRef<HTMLDivElement | null>(null);
  const endInline = () => {
    actions.endInline();
    // The keyboard goes on from the block.
    window.requestAnimationFrame(() => blockElement.current?.focus({ preventScroll: true }));
  };
  const w = useAdminText("builder");
  const tw = w.tools;

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        blockElement.current = node;
      }}
      data-builder-item="block"
      data-builder-id={block.id}
      {...markAttributes(block)}
      tabIndex={0}
      role="group"
      aria-label={name}
      // A double press on a part inside a Columns component (D294) is that part's.
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-builder-item]") !== event.currentTarget) return;
        edit();
      }}
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
        <Tools label={w.blockNames[block.type]} onEdit={edit} editLabel={tw.translate} />
      ) : (
      <Tools
        label={w.blockNames[block.type]}
        motion={hasMotion(block)}
        mark={markOf(block, actions, w)}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={fillWords(tw.drag, { what: name.toLowerCase() })}
            className={handleClass}
          >
            <Icon name="grip" />
          </button>
        }
        onEdit={edit}
        editLabel={tw.edit}
        onDuplicate={() => actions.onRows((rows) => duplicateBlock(rows, block.id, newId))}
        onTest={actions.onTest ? () => actions.onTest!({ kind: "block", id: block.id }) : undefined}
        onDelete={() =>
          blockHasText(block)
            ? actions.open({ kind: "delete", what: w.blockThis[block.type], run: remove })
            : remove()
        }
      />
      )}
      <Line at={line} />
      <HiddenBadge hideAt={block.visibility?.hideAt} />
      <DisplayBadge show={block.visibility?.show} />
      <div
        className={box.className || undefined}
        style={{ ...box.style, ...fx.style }}
        {...fx.attrs}
        onClick={
          inlineKind !== null && !editingInline
            ? (event) => {
                // A link in the text must not take the builder away; a press on it is a press on the text.
                event.preventDefault();
                actions.onInline(block.id, { x: event.clientX, y: event.clientY });
              }
            : undefined
        }
      >
        <FontLinks families={blockFonts(block)} />
        {/* A block that takes its content from a custom field (D118): the canvas has no values, so it shows its own and says so. */}
        {bindingOf(block) && <BindBadge bind={bindingOf(block)!} />}
        {editingInline && block.type === "heading" ? (
          // Its words as they look, text styles and all (D393), written back as the same inline markup.
          <InlineMarkupEditor
            level={block.level}
            className="leading-tight text-balance font-heading"
            text={block.text}
            point={actions.inline?.point ?? null}
            onChange={(text) => actions.onRows((rows) => patchBlock<HeadingBlock>(rows, block.id, { text }))}
            onDone={endInline}
          />
        ) : editingInline && block.type === "richText" ? (
          <InlineRichEditor
            doc={block.doc}
            point={actions.inline?.point ?? null}
            label={fillWords(tw.textIn, { name })}
            onChange={(doc) => actions.onRows((rows) => patchBlock<RichTextBlock>(rows, block.id, { doc }))}
            onDone={endInline}
          />
        ) : block.type === "columns" ? (
          <div data-builder-holder={block.id}>
            <ColumnLinesView holder={columnsAsRow(block)} nested name={name} dragging={dragging} target={target} actions={actions} />
          </div>
        ) : !partFeatureOn(block, actions.grid.features) && !partDrawsWhenOff(block) ? (
          <SwitchedOffStandIn block={block} />
        ) : block.type === "contentGrid" ? (
          <GridPreview block={block} grid={actions.grid} lang={actions.lang} />
        ) : block.type === "product" ? (
          <ProductStandIn block={block} />
        ) : block.type === "site" ? (
          <SiteStandIn block={block} />
        ) : block.type === "menu" && blockHasContent(block) ? (
          <MenuStandIn block={block} menus={actions.grid.menus} />
        ) : block.type === "search" ? (
          <SearchStandIn block={block} />
        ) : block.type === "plans" ? (
          <PlansStandIn block={block} />
        ) : block.type === "domainSearch" ? (
          <DomainSearchStandIn block={block} />
        ) : block.type === "themeStore" ? (
          <ThemeStoreStandIn block={block} />
        ) : block.type === "customField" ? (
          <CustomFieldStandIn block={block} />
        ) : block.type === "fieldLoop" ? (
          <FieldLoopStandIn block={block} />
        ) : block.type === "storePart" ? (
          <StorePartStandIn block={block} />
        ) : block.type === "emailForm" || block.type === "newsletter" ? (
          <div className="flex flex-col gap-2">
            {block.recipients.length === 0 && (
              <p className="rounded-md bg-surface p-3 text-sm text-muted">
                {w.canvas.formNoRecipients}
              </p>
            )}
            <SiteForm form={publicForm(block)} store={null} lang={actions.lang} preview />
          </div>
        ) : block.type === "testimonials" && block.source === "google" ? (
          <p className="rounded-md bg-surface p-3 text-sm text-muted">
            {w.canvas.googleReviews}
          </p>
        ) : blockHasContent(block) && (!bindingOf(block) || blockOwnContent(block)) ? (
          <PageBlockView block={block} renderChildren={(children) => <AnswerParts blocks={children} actions={actions} />} />
        ) : bindingOf(block) ? (
          <p className="rounded-md bg-surface p-3 text-sm text-muted">{w.canvas.bound}</p>
        ) : (
          <p className="rounded-md bg-surface p-3 text-sm text-muted">{w.emptyBlock[block.type]}</p>
        )}
      </div>
    </div>
  );
}

/**
 * An FAQ's answers' components on the canvas (D208): drawn as the site draws them, each opening its own settings when pressed
 * (the FAQ's open with a double press outside them). They are added, ordered and taken out in the FAQ's General tab.
 */
function AnswerParts({ blocks, actions }: { blocks: PageBlock[]; actions: Actions }) {
  const w = useAdminText("builder");
  return blocks.map((child) => {
    const box = blockBox(child, "canvas");
    const open = () => actions.open({ kind: "edit-block", blockId: child.id });
    return (
      <div
        key={child.id}
        data-builder-id={child.id}
        data-answer-part=""
        role="button"
        tabIndex={0}
        aria-label={fillWords(w.tools.inAnswer, { block: w.blockNames[child.type] })}
        title={fillWords(w.tools.pressToEdit, { block: w.blockNames[child.type] })}
        onClickCapture={(event) => {
          // A link or button in it must not take the builder away; a press opens its settings.
          event.preventDefault();
          event.stopPropagation();
          open();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            open();
          }
        }}
        className="cursor-pointer rounded-sm outline-offset-2 hover:outline hover:outline-1 hover:outline-dashed hover:outline-current/40 focus-visible:outline focus-visible:outline-2"
      >
        <div className={box.className || undefined} style={box.style}>
          <FontLinks families={blockFonts(child)} />
          {blockHasContent(child) ? <PageBlockView block={child} /> : <p className="rounded-md bg-surface p-3 text-sm text-muted">{w.emptyBlock[child.type]}</p>}
        </div>
      </div>
    );
  });
}


export { ColorField };

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** The parts with a display other than Always, named as the canvas names them (D179 phase 4). */
function displayedParts(rows: PageRow[], w: BuilderMessages): { id: string; name: string; show: Show }[] {
  const found: { id: string; name: string; show: Show }[] = [];
  rows.forEach((row, r) => {
    const rowName = fillWords(w.tools.row, { n: r + 1 });
    if (row.visibility?.show) found.push({ id: row.id, name: rowName, show: row.visibility.show });
    row.columns.forEach((column, c) => {
      const columnName = fillWords(w.tools.columnIn, { name: rowName, n: c + 1 });
      if (column.visibility?.show) found.push({ id: column.id, name: columnName, show: column.visibility.show });
      column.blocks.forEach((block, b) => {
        if (block.visibility?.show) found.push({ id: block.id, name: fillWords(w.tools.blockIn, { name: columnName, block: w.blockNames[block.type].toLowerCase(), n: b + 1 }), show: block.visibility.show });
      });
    });
  });
  return found;
}

/** The settings dialog of the row, column or block with this id. */
function displayDialog(rows: PageRow[], id: string): Dialog {
  for (const row of rows) {
    if (row.id === id) return { kind: "edit-row", rowId: row.id, columnId: null };
    for (const column of row.columns) {
      if (column.id === id) return { kind: "edit-row", rowId: row.id, columnId: column.id };
      if (column.blocks.some((block) => block.id === id)) return { kind: "edit-block", blockId: id };
      // A Columns component's column (D294).
      for (const block of column.blocks) {
        if (block.type === "columns" && block.columns.some((c) => c.id === id)) return { kind: "edit-row", rowId: block.id, columnId: id };
      }
    }
  }
  return { kind: "edit-block", blockId: id };
}

/** What a part's Display offers on this page (D179 phase 4): its facts by owner and kind of page, and the store's choices. */
function useDisplaySetup(grid: GridContext, pageType: PageType): DisplaySetup {
  const kaizen = grid.owner === null;
  const shape = grid.shape ?? pageType;
  const choices = grid.actions.visibilityChoices;
  return useMemo(() => ({ kaizen, facts: factsOffered(kaizen ? "kaizen" : "store", shape), choices }), [kaizen, shape, choices]);
}

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
  sharing,
  pageType,
}: {
  grid: GridContext;
  fonts: BuilderFonts;
  translate: Translating | null;
  /** The kind of page being edited, for using a saved page layout (D127). */
  pageType: PageType;
  /** Saved parts can be shared (D125): the dialog that saves one offers the choice. */
  sharing: boolean;
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
  // The screen size the fields edit (D179 phase 2): Extra large is the parts' own settings, a smaller size its overrides.
  const { size } = useSizeEdit();
  const w = useAdminText("builder");
  const dw = w.dialogs;
  const blockWords = useAdminText("blocks");
  // Who sees a part (D179 phase 4): the facts the page offers and the store's choices.
  const displaySetup = useDisplaySetup(grid, pageType);
  if (translate) return <TranslateDialogs dialog={dialog} rows={rows} onRows={onRows} onClose={onClose} translate={translate} />;
  /** A change made in a field at the size edited (`setAt()`), to the part as it is when it lands. */
  const sizedPatch = (target: Styled, patch: Partial<PartBase>) =>
    onRows((current) => {
      const part = partOf(current, target);
      return part ? patchPart(current, target, setAt(part as PartBase, size, patch)) : current;
    });
  /** A change that is already the part's (an override given back). */
  const plainPatch = (target: Styled) => (patch: Partial<PartBase>) => onRows((current) => patchPart(current, target, patch));
  const done = (
    <button type="button" onClick={onClose} className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
      {dw.done}
    </button>
  );
  const saveAs = (part: SavedPartDraft) =>
    // A component in an FAQ's answer (D208) is the FAQ's own: it is saved, and made global, with the FAQ.
    part.kind === "block" && findBlock(rows, part.content.id)?.parent ? (
      <span className="mr-auto" />
    ) : (
    <div className="mr-auto flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => open({ kind: "save-as", part, back: dialog })}
        className="min-h-10 rounded-md border border-border px-4 text-sm"
      >
        {dw.saveAs}
      </button>
      <GlobalControls id={part.content.id} rows={rows} onRows={onRows} nameOf={(id) => parts.find((p) => p.id === id)?.name ?? w.frame.global} />
    </div>
    );
  const block = dialog?.kind === "edit-block" ? findBlock(rows, dialog.blockId)?.block : null;
  const editor = block ? editorFor(block, blockWords) : undefined;
  /** Opens a component in an FAQ's answer in its own settings (D208). */
  const editPart = (blockId: string) => open({ kind: "edit-block", blockId });
  // A Columns component's column (D294) is set in the row its columns are laid out in.
  const row = dialog?.kind === "edit-row" ? findHolder(rows, dialog.rowId) : null;
  const column = dialog?.kind === "edit-row" && dialog.columnId ? row?.columns.find((c) => c.id === dialog.columnId) : null;
  const savedPart = dialog?.kind === "edit-saved" ? parts.find((p) => p.id === dialog.partId) : null;
  const layoutChoice = (row: PageRow) => (
    <RowLayoutChoice row={row} onLayout={(line, layout) => onRows((current) => setLineLayout(current, row.id, line, layout, newId))} />
  );
  /** The id and classes of the row, column or block a dialog is for (D48). */
  const advancedFields = (target: Styled) => {
    const part = partOf(rows, target);
    if (!part) return null;
    const others = new Set(
      pageParts(rows).flatMap((p) => (p !== part && p.htmlId ? [p.htmlId.trim()] : [])),
    );
    const block = target.kind === "block" ? (part as PageBlock) : null;
    const row = target.kind === "row" ? (part as PageRow) : null;
    // A component in an FAQ's answer (D208) does not move and shows to everyone: no Animation, no Display.
    const inAnswer = target.kind === "block" && Boolean(findBlock(rows, target.id)?.parent);
    return (
      <>
        <AdvancedFields part={part} taken={others} onChange={(patch) => onRows((current) => patchPart(current, target, patch))} />
        {/* Beaver's Animation (D179 phase 3): the entrance's delay and duration, in seconds. */}
        {!inAnswer && <AnimationFields
          part={target.kind === "block" ? { kind: "block", blockType: (part as PageBlock).type } : { kind: target.kind }}
          motion={part.motion}
          onChange={(motion) => onRows((current) => patchPart(current, target, { motion }))}
        />}
        {/* Beaver's Visibility (D179): by screen size, and who sees it (phase 4). A modal opens over any size, so it has Display only. */}
        {row?.modal ? (
          <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
            <legend className="float-left mb-1 w-full font-medium">{dw.visibility}</legend>
            <DisplayFields
              show={part.visibility?.show}
              setup={displaySetup}
              locked={displayLocked(part) ?? undefined}
              onChange={(show) => plainPatch(target)(showPatch(part.visibility, show))}
            />
          </fieldset>
        ) : (
          <VisibilityFields
            part={part}
            onChange={plainPatch(target)}
            display={inAnswer ? undefined : { setup: displaySetup, locked: displayLocked(part) ?? undefined }}
            locked={
              block?.type === "site" && block.part === "withdrawal"
                ? dw.withdrawalEverySize
                : block?.type === "site" && block.part === "menuButton"
                  ? dw.menuButtonSmall
                  : undefined
            }
          />
        )}
      </>
    );
  };
  /** The entrance, hover and scroll effects of the row, column or block a dialog is for (D128). */
  const motionFields = (target: Styled) => {
    const part = partOf(rows, target);
    if (!part) return null;
    if (target.kind === "block" && findBlock(rows, target.id)?.parent) {
      return <p className="text-sm text-muted">{dw.answerNoMotion}</p>;
    }
    const kind: MotionPart =
      target.kind === "block" ? { kind: "block", blockType: (part as PageBlock).type } : { kind: target.kind };
    return (
      <MotionFields
        part={kind}
        motion={part.motion}
        onChange={(motion) => onRows((current) => patchPart(current, target, { motion }))}
      />
    );
  };
  /** The border, rounded corners and shadow of the row, column or block a dialog is for (D49). */
  const frameFields = (target: Styled) => {
    const part = partOf(rows, target);
    if (!part) return null;
    return <FrameFields value={viewAt(part, size)} sized={{ part, onPatch: plainPatch(target) }} onChange={(patch) => sizedPatch(target, patch)} />;
  };
  /**
   * The Typography panel (D179 phase 3) of the row, column or block a dialog is for: a group per kind of text it has, at the
   * size the builder edits; families are installed as they are chosen (D59). `familyDefault` says what no family means.
   */
  const typographyFields = (target: Styled, familyDefault: string = dw.fonts.inherited) => {
    const part = partOf(rows, target);
    if (!part) return null;
    return (
      <TypographyFields
        part={part}
        familyDefault={familyDefault}
        install={fonts.install}
        onChange={(patch) => onRows((current) => patchPart(current, target, patch as Partial<PartBase>))}
      />
    );
  };
  /** Margin and padding of the row, column or block a dialog is for (D47). */
  const spacingFields = (target: Styled) => {
    const part = partOf(rows, target);
    if (!part) return null;
    return (
      <SpacingFields
        value={spacingAt(part, size)}
        defaults={target.kind === "row" ? { padding: ROW_PADDING } : undefined}
        sized={{ part, onPatch: plainPatch(target) }}
        onChange={(style) => (size === "xl" ? onRows((current) => setSpacing(current, target, style)) : sizedPatch(target, { style }))}
      />
    );
  };
  /** A row's or column's background: its own at Extra large (any kind), a colour or none at a smaller size (D179). */
  const backgroundFields = (target: Styled, own: ReactNode) => {
    const part = partOf(rows, target) as PageRow | PageColumn | undefined;
    if (!part) return null;
    if (size === "xl") return own;
    return <BackgroundAtSize key={size} part={part} size={size} onChange={(patch) => sizedPatch(target, patch)} onPatch={plainPatch(target)} />;
  };

  return (
    <>
      <SettingsPanel
        open={block?.type === "richText"}
        onClose={onClose}
        title={dw.editRichText}
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
              <div className="flex flex-col gap-5">
                <BindFields
                  blockType="richText"
                  bind={block.bind}
                  onChange={(bind) => onRows((current) => patchBlock<RichTextBlock>(current, block.id, { bind }))}
                />
                <RichTextEditor
                  // A new block opens with nothing written; the editor starts from what is stored.
                  key={block.id}
                  value={block.doc}
                  onChange={(doc) =>
                    onRows((current) => updateBlock(current, block.id, (b) => (b.type === "richText" ? { ...b, doc } : b)))
                  }
                  label={dw.text}
                />
              </div>
            }
            style={
              <>
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.body)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "image"}
        onClose={onClose}
        title={w.blockNames.image}
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
              <div className="flex flex-col gap-5">
                <BindFields
                  blockType="image"
                  bind={block.bind}
                  onChange={(bind) => onRows((current) => patchBlock<ImageBlock>(current, block.id, { bind }))}
                />
                <ImageFields
                  block={block}
                  upload={upload}
                  onChange={(next) => onRows((current) => updateBlock(current, block.id, () => next))}
                />
              </div>
            }
            style={
              <>
                <ShapeChoice
                  value={block.shape}
                  onChange={(shape) => onRows((current) => patchBlock<ImageBlock>(current, block.id, { shape }))}
                />
                <ImageSizeFields block={block} onChange={(patch) => onRows((current) => patchBlock<ImageBlock>(current, block.id, patch))} />
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.body)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "heading"}
        onClose={onClose}
        title={w.blockNames.heading}
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
              <div className="flex flex-col gap-5">
                <BindFields
                  blockType="heading"
                  bind={block.bind}
                  onChange={(bind) => onRows((current) => patchBlock<HeadingBlock>(current, block.id, { bind }))}
                />
                <HeadingFields
                  block={block}
                  otherMainHeading={pageBlocks({ rows }).some((b) => b.id !== block.id && b.type === "heading" && b.level === 1)}
                  onChange={(next) => onRows((current) => updateBlock(current, block.id, () => next))}
                />
              </div>
            }
            style={
              <>
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.heading)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "button"}
        onClose={onClose}
        title={w.blockNames.button}
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
              <div className="flex flex-col gap-5">
                <BindFields
                  blockType="button"
                  bind={block.bind}
                  onChange={(bind) => onRows((current) => patchBlock<ButtonBlock>(current, block.id, { bind }))}
                />
                <ButtonFields block={block} onChange={(next) => onRows((current) => updateBlock(current, block.id, () => next))} />
                <ModalPicker rows={rows} href={block.href} onPick={(href) => onRows((current) => patchBlock<ButtonBlock>(current, block.id, { href }))} />
              </div>
            }
            style={
              <>
                <ButtonStyleFields
                  block={block}
                  onChange={(patch) => onRows((current) => patchBlock<ButtonBlock>(current, block.id, patch))}
                />
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.body)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      {/* The newer components, each described in `BLOCK_EDITORS`. */}
      <SettingsPanel
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
            general={<editor.General block={block} context={{ upload, startVideo, editPart }} onChange={(patch) => onRows((current) => patchBlock(current, block.id, patch))} />}
            style={
              <>
                {editor.Style && (
                  <editor.Style block={block} context={{ upload, startVideo, editPart }} onChange={(patch) => onRows((current) => patchBlock(current, block.id, patch))} />
                )}
                {typographyFields({ kind: "block", id: block.id }, editor.font?.fallback)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "product"}
        onClose={onClose}
        title={block?.type === "product" ? w.productParts[block.part] : w.blockNames.product}
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
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.site)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "site"}
        onClose={onClose}
        title={block?.type === "site" ? w.siteParts[block.part] : w.blockNames.site}
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
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.site)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "menu"}
        onClose={onClose}
        title={w.blockNames.menu}
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
                  what={dw.position}
                  value={block}
                  onChange={(patch) => onRows((current) => patchBlock<MenuBlock>(current, block.id, patch))}
                />
                <MenuHoverFields
                  value={block.itemHover}
                  onChange={(itemHover) => onRows((current) => patchBlock<MenuBlock>(current, block.id, { itemHover }))}
                />
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.site)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "themeStore"}
        onClose={onClose}
        title={block?.type === "themeStore" ? THEME_STORE_PART_COPY[block.part].name : w.blockNames.themeStore}
        footer={block && done}
      >
        {block?.type === "themeStore" && (
          <SettingsTabs
            key={block.id}
            general={<ThemeStoreFields block={block} onChange={(patch) => onRows((current) => patchBlock<ThemeStoreBlock>(current, block.id, patch))} />}
            style={
              <>
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.site)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "domainSearch"}
        onClose={onClose}
        title={w.blockNames.domainSearch}
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
        {block?.type === "domainSearch" && (
          <SettingsTabs
            key={block.id}
            general={<DomainSearchFields block={block} onChange={(patch) => onRows((current) => { return patchBlock<DomainSearchBlock>(current, block.id, patch); })} />}
            style={
              <>
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.site)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "plans"}
        onClose={onClose}
        title={w.blockNames.plans}
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
        {block?.type === "plans" && (
          <SettingsTabs
            key={block.id}
            general={
              <PlansFields
                block={block}
                plans={grid.plans ?? []}
                onChange={(patch) => onRows((current) => patchBlock<PlansBlock>(current, block.id, patch))}
              />
            }
            style={
              <>
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.site)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "search"}
        onClose={onClose}
        title={w.blockNames.search}
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
        {block?.type === "search" && (
          <SettingsTabs
            key={block.id}
            general={
              <Check
                label={dw.searchResults}
                hint={dw.searchResultsHint}
                checked={block.results !== false}
                onChange={(results) => onRows((current) => patchBlock<SearchBlock>(current, block.id, { results: results ? undefined : false }))}
              />
            }
            style={
              <>
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.site)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "storePart"}
        onClose={onClose}
        title={w.blockNames.storePart}
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
        {block?.type === "storePart" && (
          <SettingsTabs
            key={block.id}
            general={
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {dw.shows}
                  <select
                    value={block.part}
                    onChange={(event) => onRows((current) => patchBlock<StorePartBlock>(current, block.id, { part: event.target.value as ShopPart }))}
                    className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal"
                  >
                    <optgroup label={dw.wholePages}>
                      {STORE_PART_KEYS.map((part) => (
                        <option key={part} value={part}>
                          {STORE_PARTS[part].name}
                        </option>
                      ))}
                    </optgroup>
                    {PIECE_GROUPS.map((group) => (
                      <optgroup key={group.route} label={group.name}>
                        {piecesOf(group.route).map((part) => (
                          <option key={part} value={part}>
                            {shopPartCopy(part).name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <p className="text-sm text-muted">{shopPartCopy(block.part).hint}</p>
                <p className="text-sm text-muted">
                  {dw.shopPartWhere}
                </p>
              </div>
            }
            style={
              <>
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.site)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={block?.type === "contentGrid"}
        onClose={onClose}
        title={w.blockNames.contentGrid}
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
                upload={upload}
                onChange={(patch) => onRows((current) => patchBlock<ContentGridBlock>(current, block.id, patch))}
              />
            }
            style={
              <>
                <GridStyleFields
                  block={block}
                  onChange={(patch) => onRows((current) => patchBlock<ContentGridBlock>(current, block.id, patch))}
                />
                {typographyFields({ kind: "block", id: block.id }, dw.fonts.body)}
                {spacingFields({ kind: "block", id: block.id })}
                {frameFields({ kind: "block", id: block.id })}
              </>
            }
            motion={motionFields({ kind: "block", id: block.id })}
            advanced={advancedFields({ kind: "block", id: block.id })}
          />
        )}
      </SettingsPanel>

      <SettingsPanel
        open={Boolean(row)}
        onClose={onClose}
        title={column ? w.savedKinds.column.one : w.savedKinds.row.one}
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
                    label={dw.inline}
                    hint={dw.inlineHint}
                    checked={Boolean(column.inline)}
                    onChange={(inline) =>
                      onRows((current) => patchColumn(current, column.id, inline ? { inline } : { inline: undefined, justify: undefined }))
                    }
                  />
                  {column.inline && (
                    <Choices
                      legend={dw.whereTheySit}
                      options={(Object.keys(COLUMN_JUSTIFY) as ColumnJustify[]).map((value) => ({ value, label: dw.justify[value] }))}
                      value={column.justify ?? "start"}
                      onChange={(justify) => onRows((current) => patchColumn(current, column.id, { justify: justify === "start" ? undefined : justify }))}
                    />
                  )}
                </div>
                <ColumnSizeFields column={column} row={row} onChange={(patch) => onRows((current) => patchColumn(current, column.id, patch))} />
                <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
                  <legend className="float-left mb-2 w-full text-sm font-medium">{dw.rowLayout}</legend>
                  <p className="text-sm text-muted">{dw.columnWidthFromRow}</p>
                  {layoutChoice(row)}
                </fieldset>
              </>
            }
            style={
              <>
                {backgroundFields(
                  { kind: "column", id: column.id },
                  <BackgroundFields
                    value={column.background}
                    upload={upload}
                    // Columns are offered no video (only rows take one).
                    onChange={(background) =>
                      onRows((current) => patchColumn(current, column.id, { background: background?.type === "video" ? undefined : background }))
                    }
                    backdropBlur={column.backdropBlur}
                    onBackdropBlur={(backdropBlur) => onRows((current) => patchColumn(current, column.id, { backdropBlur }))}
                    target="column"
                    motion={column.backgroundMotion}
                    onMotion={(backgroundMotion) => onRows((current) => patchColumn(current, column.id, { backgroundMotion }))}
                    mark={<SizeMark part={column} field="background" label={dw.background} onPatch={plainPatch({ kind: "column", id: column.id })} />}
                  />,
                )}
                {typographyFields({ kind: "column", id: column.id })}
                {spacingFields({ kind: "column", id: column.id })}
                {frameFields({ kind: "column", id: column.id })}
              </>
            }
            motion={motionFields({ kind: "column", id: column.id })}
            advanced={advancedFields({ kind: "column", id: column.id })}
          />
        )}
        {row && !column && (
          <SettingsTabs
            key={row.id}
            general={
              <>
                <p className="text-sm text-muted">{dw.fewerColumns}</p>
                {layoutChoice(row)}
                <RowFields row={row} onChange={(patch) => onRows((current) => patchRow(current, row.id, patch))} />
                <ModalFields row={row} rows={rows} onChange={(patch) => onRows((current) => patchRow(current, row.id, patch))} />
              </>
            }
            style={
              <>
                {backgroundFields(
                  { kind: "row", id: row.id },
                  <BackgroundFields
                    value={row.background}
                    upload={upload}
                    startVideo={startVideo}
                    onChange={(background) => onRows((current) => patchRow(current, row.id, { background }))}
                    backdropBlur={row.backdropBlur}
                    onBackdropBlur={(backdropBlur) => onRows((current) => patchRow(current, row.id, { backdropBlur }))}
                    fixed={row.backgroundFixed}
                    onFixed={(backgroundFixed) => onRows((current) => patchRow(current, row.id, { backgroundFixed: backgroundFixed || undefined }))}
                    align={row.backgroundAlign}
                    onAlign={(backgroundAlign) => onRows((current) => patchRow(current, row.id, { backgroundAlign }))}
                    target="row"
                    motion={row.backgroundMotion}
                    onMotion={(backgroundMotion) => onRows((current) => patchRow(current, row.id, { backgroundMotion }))}
                    mark={<SizeMark part={row} field="background" label={dw.background} onPatch={plainPatch({ kind: "row", id: row.id })} />}
                  />,
                )}
                {typographyFields({ kind: "row", id: row.id })}
                {spacingFields({ kind: "row", id: row.id })}
                {frameFields({ kind: "row", id: row.id })}
              </>
            }
            motion={motionFields({ kind: "row", id: row.id })}
            advanced={advancedFields({ kind: "row", id: row.id })}
          />
        )}
      </SettingsPanel>

      <Modal
        open={dialog?.kind === "delete"}
        onClose={onClose}
        title={dw.deleteTitle}
        footer={
          <>
            <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-border px-4 text-sm">
              {dw.keepIt}
            </button>
            <button
              type="button"
              onClick={() => {
                if (dialog?.kind === "delete") dialog.run();
                onClose();
              }}
              className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-medium text-white"
            >
              {w.tools.delete}
            </button>
          </>
        }
      >
        <p className="text-sm">{fillWords(dw.deleteText, { what: dialog?.kind === "delete" ? dialog.what : "" })}</p>
      </Modal>

      {dialog?.kind === "save-as" && (
        <SaveAsDialog
          create={grid.actions.createPart}
          sharing={sharing}
          part={dialog.part}
          onCancel={() => (dialog.back ? open(dialog.back) : onClose())}
          onSaved={(next, id, global) => {
            onParts(next, id);
            // Saved as global (D98): the part on the page is its first use.
            if (global) onRows((current) => markUse(current, dialog.part.content.id, id));
            onClose();
          }}
        />
      )}

      {savedPart?.kind === "page" && (
        <SavedLayoutDialog
          key={savedPart.id + savedPart.updatedAt}
          actions={grid.actions}
          part={savedPart}
          fits={fitsPage({ kind: "page", pageType: savedPart.content.pageType }, pageType)}
          onClose={onClose}
          onParts={onParts}
          onUse={() => {
            onUse(savedPart);
            onClose();
          }}
        />
      )}

      {savedPart && savedPart.kind !== "page" && (
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
function TranslateNote({ translate, id, hidden, header }: { translate: Translating; id: string; hidden: boolean; header: ReactNode }) {
  const tw = useAdminText("builder").translate;
  return (
    <section id={id} hidden={hidden} aria-labelledby="translate-heading" className={`flex flex-col gap-3 rounded-lg border border-border bg-background p-5 text-sm ${STANDALONE}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 id="translate-heading" className="font-medium">
          {fillWords(tw.into, { lang: translate.name })}
        </h2>
        {header}
      </div>
      <p>
        {tw.pointBefore} <strong>{tw.press}</strong> {fillWords(tw.pointAfter, { lang: translate.name })}
      </p>
      <p className="text-muted">{fillWords(tw.leftAsIs, { main: translate.mainName })}</p>
    </section>
  );
}

const translateField = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

/** The main language's text beside the one being written. */
function Original({ mainName, text }: { mainName: string; text: string }) {
  const tw = useAdminText("builder").translate;
  if (!text.trim()) return null;
  return (
    <div className="rounded-md bg-surface p-3 text-sm">
      <span className="block text-xs text-muted">{fillWords(tw.inMain, { main: mainName })}</span>
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
  const editor = editorFor(block, useAdminText("blocks"));
  const w = useAdminText("builder");
  if (!editor) return <p className="text-sm text-muted">{fillWords(w.savedPart.whereUsed, { block: w.blockNames[block.type] })}</p>;
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
  const tw = useAdminText("builder").translate;
  const was = new Map(original ? blockTextFields(original).map((field) => [field.key, field.value]) : []);
  if (fields.length === 0) return <p className="text-sm text-muted">{tw.noText}</p>;
  return (
    <div className="flex flex-col gap-5">
      {fields.map((field) => {
        const before = was.get(field.key);
        return typeof field.value === "string" ? (
          <TranslateText
            key={field.key}
            label={fillWords(tw.fieldIn, { label: field.label, lang: name })}
            value={field.value}
            max={field.max}
            original={typeof before === "string" ? before : ""}
            mainName={mainName}
            multiline={field.max > 120}
            onChange={(value) => onChange(setBlockText(block, field.key, value))}
          />
        ) : (
          <div key={field.key} className="flex flex-col gap-3">
            <RichTextEditor value={field.value} onChange={(doc) => onChange(setBlockText(block, field.key, doc))} label={fillWords(tw.fieldIn, { label: field.label, lang: name })} />
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
  const w = useAdminText("builder");
  const tw = w.translate;
  const block = dialog?.kind === "edit-block" ? findBlock(rows, dialog.blockId)?.block : null;
  const original = block ? findBlock(source, block.id)?.block : null;
  // A Columns component's column (D294) is set in the row its columns are laid out in.
  const row = dialog?.kind === "edit-row" ? findHolder(rows, dialog.rowId) : null;
  const column = dialog?.kind === "edit-row" && dialog.columnId ? row?.columns.find((c) => c.id === dialog.columnId) : null;
  const originalColumn = column ? [...source.flatMap((r) => r.columns), ...nestedColumns(source)].find((c) => c.id === column.id) : null;
  const set = <T extends PageBlock>(patch: Partial<T>) => {
    if (block) onRows((current) => updateBlock(current, block.id, (b) => ({ ...b, ...patch }) as PageBlock));
  };
  const texts = (b: PageBlock, o: PageBlock | null | undefined) => {
    const was = <K extends string>(key: K) => ((o as Record<K, unknown> | null | undefined)?.[key] as string | undefined) ?? "";
    switch (b.type) {
      case "richText":
        return (
          <div className="flex flex-col gap-3">
            <RichTextEditor key={b.id} value={b.doc} onChange={(doc) => set<RichTextBlock>({ doc })} label={fillWords(tw.textIn, { lang: name })} />
            <Original mainName={mainName} text={o?.type === "richText" ? richTextPlain(o.doc) : ""} />
          </div>
        );
      case "heading":
        return (
          <TranslateText label={fillWords(tw.headingIn, { lang: name })} value={b.text} max={HEADING_MAX} original={was("text")} mainName={mainName} onChange={(text) => set<HeadingBlock>({ text })} />
        );
      case "button":
        return (
          <TranslateText label={fillWords(tw.buttonIn, { lang: name })} value={b.label} max={BUTTON_LABEL_MAX} original={was("label")} mainName={mainName} onChange={(label) => set<ButtonBlock>({ label })} />
        );
      case "image":
        return (
          <div className="flex flex-col gap-5">
            {b.image && (
              <TranslateText
                label={fillWords(tw.altIn, { lang: name })}
                value={b.image.alt}
                max={ALT_MAX}
                original={o?.type === "image" ? (o.image?.alt ?? "") : ""}
                mainName={mainName}
                multiline
                onChange={(alt) => set<ImageBlock>({ image: b.image && { ...b.image, alt } })}
              />
            )}
            <TranslateText label={fillWords(tw.captionIn, { lang: name })} value={b.caption} max={ALT_MAX} original={was("caption")} mainName={mainName} onChange={(caption) => set<ImageBlock>({ caption })} />
          </div>
        );
      case "product":
        return (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted">
              {fillWords(tw.productTexts, { lang: name })} {b.heading ? tw.productHeading : tw.noText}
            </p>
            {b.heading && (
              <TranslateText label={fillWords(tw.headingIn, { lang: name })} value={b.heading} max={HEADING_MAX} original={was("heading")} mainName={mainName} onChange={(heading) => set<ProductBlock>({ heading })} />
            )}
          </div>
        );
      case "contentGrid":
        // A grid of custom items (D155) has its items' words to translate: the generic list has them all, with the grid's own.
        if (!sourceTraits(b.source).lookedUp) {
          return <TranslateBlockTexts block={b} original={o ?? null} name={name} mainName={mainName} onChange={(next) => onRows((current) => updateBlock(current, b.id, () => next))} />;
        }
        return (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted">
              {fillWords(tw.gridTexts, { lang: name })}
            </p>
            <TranslateText label={fillWords(tw.buttonIn, { lang: name })} value={b.buttonLabel} max={BUTTON_LABEL_MAX} original={was("buttonLabel")} mainName={mainName} onChange={(buttonLabel) => set<ContentGridBlock>({ buttonLabel })} />
            <TranslateText label={fillWords(tw.emptyIn, { lang: name })} value={b.emptyText} max={300} original={was("emptyText")} mainName={mainName} onChange={(emptyText) => set<ContentGridBlock>({ emptyText })} />
          </div>
        );
      default:
        // The newer components: every text they list in `mapBlockTexts()`, each beside the main language's.
        return <TranslateBlockTexts block={b} original={o ?? null} name={name} mainName={mainName} onChange={(next) => onRows((current) => updateBlock(current, b.id, () => next))} />;
    }
  };
  const done = (
    <button type="button" onClick={onClose} className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
      {w.dialogs.done}
    </button>
  );
  return (
    <>
      <Modal open={Boolean(block)} onClose={onClose} title={block ? fillWords(tw.translateThis, { block: w.blockNames[block.type].toLowerCase() }) : w.tools.translate} footer={done} wide>
        {block && texts(block, original)}
      </Modal>
      <Modal open={Boolean(column?.link)} onClose={onClose} title={tw.columnLink} footer={done}>
        {column?.link && (
          <TranslateText
            label={fillWords(tw.linkIn, { lang: name })}
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
  sized,
}: {
  value: Spacing | undefined;
  defaults?: Spacing;
  onChange: (value: Spacing) => void;
  /** Margin and padding differ by screen size (D179): the part, for where each value comes from, and how to give one back. */
  sized?: { part: PartBase; onPatch: (patch: Partial<PartBase>) => void };
}) {
  const id = useId();
  const { size } = useSizeEdit();
  const fw = useAdminText("builder").fields;
  const set = (kind: "margin" | "padding", side: (typeof SIDES)[number], text: string) => {
    const number = Math.max(kind === "margin" ? -SPACING_MAX : 0, Math.min(SPACING_MAX, Math.round(Number(text) || 0)));
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
        <fieldset key={kind} className={`flex flex-col gap-2 ${sized ? inheritedClass(sizeSource(sized.part, size, kind), size) : ""}`}>
          <legend className="text-sm font-medium">
            {fw[kind]}{" "}
            <span className="font-normal text-muted">({kind === "margin" ? fw.marginHint : fw.paddingHint})</span>
            {sized && <SizeMark part={sized.part} field={kind} label={fw[kind]} onPatch={sized.onPatch} />}
          </legend>
          <div className="grid grid-cols-4 gap-2">
            {SIDES.map((side) => (
              <label key={side} htmlFor={`${id}-${kind}-${side}`} className="flex flex-col gap-1 text-xs text-muted">
                {fw.sides[side]}
                <input
                  id={`${id}-${kind}-${side}`}
                  type="number"
                  inputMode="numeric"
                  min={kind === "margin" ? -SPACING_MAX : 0}
                  max={SPACING_MAX}
                  step={4}
                  value={value?.[kind]?.[side] ?? defaults?.[kind]?.[side] ?? 0}
                  onChange={(event) => set(kind, side, event.target.value)}
                  className="min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                />
                <PixelRange
                  value={value?.[kind]?.[side] ?? defaults?.[kind]?.[side] ?? 0}
                  min={kind === "margin" ? -SPACING_MAX : 0}
                  max={SPACING_MAX}
                  step={2}
                  label={fillWords(fw.sideSlider, { what: fw[kind], side: fw.sides[side].toLowerCase() })}
                  onChange={(next) => set(kind, side, String(next))}
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
  const iw = useAdminText("builder").image;
  return (
    <div className="flex flex-col gap-4">
      {block.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded picture
        <img src={block.image.url} alt="" className="max-h-72 w-full rounded-md border border-border bg-surface object-contain" />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border bg-surface text-sm text-muted">
          {iw.none}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ImageUploadButton
          upload={upload}
          label={block.image ? iw.replace : iw.upload}
          current={block.image}
          // A picture made by prompt (D283) comes described by what it was asked for.
          onUploaded={(image, made) => onChange({ ...block, image: { ...image, alt: made?.alt ?? block.image?.alt ?? "" } })}
        />
        {block.image && (
          <button type="button" onClick={() => onChange({ ...block, image: null })} className="px-2 py-2 text-sm underline">
            {iw.remove}
          </button>
        )}
      </div>
      {block.image && (
        <p className="text-xs text-muted">{fillWords(iw.ownSize, { width: block.image.width, height: block.image.height })}</p>
      )}
      {block.image && (
        <label htmlFor={`${id}-alt`} className="flex flex-col gap-1 text-sm font-medium">
          {iw.description}
          <textarea
            id={`${id}-alt`}
            rows={2}
            maxLength={300}
            value={block.image.alt}
            onChange={(event) => block.image && onChange({ ...block, image: { ...block.image, alt: event.target.value } })}
            placeholder={iw.descriptionPlaceholder}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
          <span className="text-xs font-normal text-muted">{iw.decoration}</span>
        </label>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-href`} className="text-sm font-medium">
          {iw.link} <span className="font-normal text-muted">({iw.optional})</span>
        </label>
        <input
          id={`${id}-href`}
          value={block.href ?? ""}
          maxLength={2000}
          spellCheck={false}
          placeholder={iw.addressPlaceholder}
          aria-invalid={Boolean(block.href?.trim() && !isLinkAddress(block.href.trim()))}
          aria-describedby={`${id}-href-hint`}
          onChange={(event) => onChange({ ...block, href: event.target.value || undefined })}
          className="min-h-10 rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-red-700"
        />
        <span
          id={`${id}-href-hint`}
          className={`text-xs ${block.href?.trim() && !isLinkAddress(block.href.trim()) ? "text-red-700 dark:text-red-400" : "text-muted"}`}
        >
          {block.href?.trim() && !isLinkAddress(block.href.trim()) ? iw.badAddress : iw.linkHint}
        </span>
      </div>
      {block.href?.trim() && (
        <Check
          label={iw.newTab}
          hint={iw.newTabHint}
          checked={Boolean(block.newTab)}
          onChange={(newTab) => onChange({ ...block, newTab: newTab || undefined })}
        />
      )}
      <label htmlFor={`${id}-caption`} className="flex flex-col gap-1 text-sm font-medium">
        <span>
          {iw.caption} <span className="font-normal text-muted">({iw.captionHint})</span>
        </span>
        <MarkupInput id={`${id}-caption`} label={iw.caption} value={block.caption} max={300} className="font-normal" onChange={(caption) => onChange({ ...block, caption })} />
      </label>
    </div>
  );
}

const SETTINGS_TABS = [{ key: "general" }, { key: "style" }, { key: "motion" }, { key: "advanced" }] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** A settings dialog's four tabs (D48, D128): what it holds, how it looks, how it moves, and its id and classes. */
function SettingsTabs(panels: Record<SettingsTab, ReactNode>) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const id = useId();
  const fw = useAdminText("builder").fields;
  const select = (index: number) => {
    const next = SETTINGS_TABS[(index + SETTINGS_TABS.length) % SETTINGS_TABS.length].key;
    setTab(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label={fw.settings} className="sticky -top-5 z-10 -mx-5 -mt-5 flex border-b border-border bg-background px-3">
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
            {fw.tabs[t.key]}
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
  target,
  motion,
  onMotion,
  mark,
  fixed,
  onFixed,
  align,
  onAlign,
}: {
  /** Which part of a picture or video shows where it is cut to fit, for a fixed background (D184). */
  align?: "top" | "middle" | "bottom";
  onAlign?: (align: "top" | "middle" | "bottom" | undefined) => void;
  /** Rows alone can fix a picture, video or gradient to the screen (D184); given, the choice is offered. */
  fixed?: boolean;
  onFixed?: (fixed: boolean) => void;
  value: RowBackground | undefined;
  upload: Upload | null;
  /** Given for rows, which alone take a video; null where uploads are not set up. */
  startVideo?: StartVideo | null;
  onChange: (background: RowBackground | undefined) => void;
  backdropBlur: number | undefined;
  onBackdropBlur: (blur: number | undefined) => void;
  /** Whether this is a row's or a column's, for the effects offered a background (D128). */
  target: "row" | "column";
  /** How the picture, video or gradient moves; only they can. */
  motion: BackgroundMotion | undefined;
  onMotion: (motion: BackgroundMotion | undefined) => void;
  /** After the legend: its device icon (D179; a colour can differ by screen size). */
  mark?: ReactNode;
}) {
  // A picture or video chosen as the kind waits for its upload before it is kept.
  const [kind, setKind] = useState<"none" | RowBackground["type"]>(value?.type ?? "none");
  const choose = (next: typeof kind) => {
    setKind(next);
    // The new kind is made from its own settings only, so nothing of the old one stays on it (D128).
    const switched = switchBackground(value, next);
    // A picture, video or gradient is drawn over what is behind, so blurring that would show nothing.
    if (switched.clearBackdropBlur && backdropBlur) onBackdropBlur(undefined);
    onChange(switched.background);
    // A colour does not move.
    if (switched.clearMotion && motion) onMotion(undefined);
  };
  const media = value?.type === "image" || value?.type === "video" ? value : null;
  const kept = { overlay: media?.overlay ?? null, ...(media?.blur ? { blur: media.blur } : {}) };
  const bw = useAdminText("builder").background;
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend={bw.legend}
        mark={mark}
        options={[
          { value: "none", label: bw.kinds.none },
          { value: "color", label: bw.kinds.color },
          { value: "image", label: bw.kinds.image },
          { value: "gradient", label: bw.kinds.gradient },
          ...(startVideo !== undefined ? [{ value: "video" as const, label: bw.kinds.video }] : []),
        ]}
        value={kind}
        onChange={choose}
      />
      {kind === "color" && value?.type === "color" && (
        <ColorField
          label={bw.colour}
          value={value.color}
          onChange={(color) => onChange({ ...value, color })}
          opacity={{
            value: value.opacity,
            onChange: (opacity) => {
              const next: RowBackground = { type: "color", color: value.color };
              onChange(opacity === undefined ? next : { ...next, opacity });
            },
          }}
        />
      )}
      {(kind === "none" || kind === "color") && (
        <>
          <Check
            label={bw.blurBehind}
            hint={kind === "none" ? bw.blurBehindNone : bw.blurBehindColour}
            checked={Boolean(backdropBlur)}
            onChange={(on) => onBackdropBlur(on ? 12 : undefined)}
          />
          {backdropBlur ? (
            <div className="pl-7">
              <RangeField
                label={bw.blur}
                min={1}
                max={BACKDROP_BLUR_MAX}
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
              <PartBackground background={media} motion={motion} preview />
            </div>
          ) : (
            <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-border bg-surface text-sm text-muted">
              {kind === "video" ? bw.noVideo : bw.noPicture}
            </div>
          )}
          {kind === "image" ? (
            <ImageUploadButton
              upload={upload}
              label={media?.type === "image" ? bw.replacePicture : bw.uploadPicture}
              current={media?.type === "image" ? media.image : null}
              onUploaded={(uploaded) => onChange({ type: "image", image: uploaded, ...kept })}
            />
          ) : (
            <VideoUploadButton
              startVideo={startVideo ?? null}
              upload={upload}
              label={media?.type === "video" ? bw.replaceVideo : bw.uploadVideo}
              onUploaded={(uploaded) => onChange({ type: "video", ...uploaded, ...kept })}
            />
          )}
          {media?.type === kind && (
            <>
              <Check
                label={kind === "video" ? bw.overVideo : bw.overPicture}
                hint={bw.overHint}
                checked={Boolean(media.overlay)}
                onChange={(on) => onChange({ ...media, overlay: on ? { color: "#000000", opacity: 40 } : null })}
              />
              {media.overlay && (
                <OverlayFields overlay={media.overlay} onChange={(overlay) => onChange({ ...media, overlay })} />
              )}
              <Check
                label={kind === "video" ? bw.blurVideo : bw.blurPicture}
                hint={bw.blurHint}
                checked={Boolean(media.blur)}
                onChange={(on) => onChange(withBlur(media, on ? 6 : 0))}
              />
              {media.blur ? (
                <div className="pl-7">
                  <RangeField
                    label={bw.blur}
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
      {kind === "gradient" && value?.type === "gradient" && (
        <div className="flex flex-col gap-4">
          {/* The gradient as the page draws it, moving as it will. */}
          <div className="relative isolate h-40 w-full overflow-hidden rounded-md border border-border">
            <PartBackground background={value} motion={motion} preview />
          </div>
          <GradientFields value={value} onChange={onChange} />
        </div>
      )}
      {onFixed && backgroundMoves(value) && (
        <Check
          label={bw.fixed}
          hint={bw.fixedHint}
          checked={Boolean(fixed)}
          onChange={onFixed}
        />
      )}
      {onAlign && fixed && (value?.type === "image" || value?.type === "video") && (
        <Choices
          legend={bw.position}
          hint={bw.positionHint}
          options={[
            { value: "top", label: bw.top },
            { value: "middle", label: bw.middle },
            { value: "bottom", label: bw.bottom },
          ]}
          value={align ?? "middle"}
          onChange={(next) => onAlign(next === "middle" ? undefined : next)}
        />
      )}
      {/* A picture, video or gradient can move; a colour cannot. */}
      {backgroundMoves(value) && !fixed && <BackgroundMotionFields target={target} value={motion} onChange={onMotion} />}
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
  const bw = useAdminText("builder").background;
  return (
    <div className="flex flex-wrap items-end gap-6 pl-7">
      <ColorField label={bw.overlayColour} value={overlay.color} onChange={(color) => onChange({ ...overlay, color })} />
      <RangeField
        label={bw.opacity}
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

/**
 * What the theme's Row says about every row's width (D190): a row's own choice wins, so its fields show what it comes to (its own, else
 * the theme's) and write its own only where that is not what it would be without it.
 */
const ThemeRowWidths = createContext<{ width?: "content" | "full"; contentWidth?: "content" | "full" }>({});
/** The live theme's section styles (D242), for a row's choice; undefined where the builder has no Theme tab. */
const ThemeSections = createContext<ThemeTabValue["sections"]>(undefined);

/**
 * The theme's section style a row is drawn in (D242): None keeps the row on the site's elements; a style the theme does not have
 * draws as its Plain. The name is all the row keeps, so switching themes restyles it.
 */
function SectionStyleField({ row, onChange }: { row: PageRow; onChange: (patch: RowPatch) => void }) {
  const sections = useContext(ThemeSections);
  const id = useId();
  const choices = sectionStyleChoices(sections);
  const current = row.sectionStyle;
  const known = current === undefined || choices.includes(current);
  const rw = useAdminText("builder").row;
  const styleName = useStyleName();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {rw.sectionStyle}
      </label>
      <select
        id={id}
        value={current ?? ""}
        onChange={(event) => onChange({ sectionStyle: event.target.value || undefined })}
        className="min-h-10 rounded-md border border-border bg-background px-2 text-sm"
      >
        <option value="">{rw.sectionNone}</option>
        {choices.map((name) => (
          <option key={name} value={name}>
            {styleName(name)}
          </option>
        ))}
        {!known && current && <option value={current}>{fillWords(rw.sectionMissing, { name: styleName(current) })}</option>}
      </select>
      <p className="text-xs text-muted">{rw.sectionHint}</p>
    </div>
  );
}

/** A section style's name in the account's language: the core styles' from the design words (D312 A7), a theme's own as it is written. */
function useStyleName(): (name: string) => string {
  const names = useAdminText("design").changes.styles;
  return (name) => names[name] ?? sectionStyleLabel(name);
}

/** A row's width and what it holds, the same two choices on a row and on the theme's Row (D48, D190). */
function RowWidthChoices({
  width,
  contentWidth,
  onWidth,
  onContentWidth,
}: {
  width: "content" | "full";
  contentWidth: "content" | "full";
  onWidth: (width: "content" | "full") => void;
  onContentWidth: (contentWidth: "content" | "full") => void;
}) {
  const full = width === "full";
  const rw = useAdminText("builder").row;
  return (
    <>
      <Choices
        legend={rw.rowWidth}
        options={[
          { value: "content", label: rw.contentWidth },
          { value: "full", label: rw.fullWidth },
        ]}
        value={width}
        onChange={onWidth}
      />
      <Choices
        legend={rw.contentWidth}
        hint={full ? rw.whatItHolds : rw.forFullWidth}
        disabled={!full}
        options={[
          { value: "content", label: rw.contentWidth },
          { value: "full", label: rw.fullWidth },
        ]}
        value={contentWidth}
        onChange={onContentWidth}
      />
    </>
  );
}

/** A row's width and height, its columns at each screen size, and how they line up (D48, D179). */
function RowFields({ row, onChange }: { row: PageRow; onChange: (patch: RowPatch) => void }) {
  // What the row comes to: its own choice, else the theme's Row, else the content's width (D190).
  const theme = useContext(ThemeRowWidths);
  const width = row.width ?? theme.width ?? "content";
  const contentWidth = row.contentWidth ?? theme.contentWidth ?? "content";
  const rw = useAdminText("builder").row;
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <SectionStyleField row={row} onChange={onChange} />
      <RowWidthChoices
        width={width}
        contentWidth={contentWidth}
        onWidth={(next) => onChange(rowWidthPatch(theme, { width: next }))}
        onContentWidth={(next) => onChange(rowWidthPatch(theme, { contentWidth: next }))}
      />
      <ContentMaxField row={row} limited={width !== "full" || contentWidth !== "full"} onChange={onChange} />
      <RowHeightField row={row} onChange={onChange} />
      <Check
        label={rw.fullHeight}
        hint={rw.fullHeightHint}
        checked={Boolean(row.fullHeight)}
        onChange={(fullHeight) => onChange({ fullHeight })}
      />
      <RowSizeFields row={row} onChange={onChange} />
      <Check
        label={rw.equalHeight}
        hint={rw.equalHeightHint}
        checked={Boolean(row.equalHeight)}
        onChange={(equalHeight) => onChange({ equalHeight })}
      />
      <Choices
        legend={rw.columnContent}
        options={[
          { value: "top", label: rw.top },
          { value: "middle", label: rw.middle },
          { value: "bottom", label: rw.bottom },
        ]}
        value={row.align ?? "top"}
        onChange={(align) => onChange({ align: align === "top" ? undefined : align })}
      />
    </div>
  );
}

/**
 * A row's height as a share of the screen's, at the size edited (D184): at least that tall. With a fixed background (and a
 * background of full screen height) it is the window that shows part of the background as the page scrolls.
 */
function RowHeightField({ row, onChange }: { row: PageRow; onChange: (patch: RowPatch) => void }) {
  const { size } = useSizeEdit();
  const id = useId();
  const value = valueAt(row, "height", size) ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const back = (patch: { at: PageRow["at"] }) => onChange(patch);
  const rw = useAdminText("builder").row;
  return (
    <div className={`flex flex-col gap-1 ${inheritedClass(sizeSource(row, size, "height"), size)}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {rw.height} <span className="font-normal text-muted">({fillWords(rw.heightHint, { min: ROW_HEIGHT_VH.min, max: ROW_HEIGHT_VH.max })})</span>
        </label>
        <SizeMark part={row} field="height" label={rw.height} onPatch={back} />
      </div>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={ROW_HEIGHT_VH.min}
        max={ROW_HEIGHT_VH.max}
        placeholder={rw.heightPlaceholder}
        value={draft ?? value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const number = Math.round(Number(next));
          if (next === "") onChange(setAt(row, size, { height: undefined }));
          else if (number >= ROW_HEIGHT_VH.min && number <= ROW_HEIGHT_VH.max) onChange(setAt(row, size, { height: number }));
        }}
        onBlur={() => setDraft(null)}
        className="min-h-10 w-40 rounded-md border border-border bg-background px-2 text-sm"
      />
      <PixelRange
        value={value ?? 100}
        min={ROW_HEIGHT_VH.min}
        max={100}
        step={5}
        unit="vh"
        label={fillWords(rw.slider, { what: rw.height })}
        onChange={(next) => {
          setDraft(null);
          onChange(setAt(row, size, { height: next }));
        }}
        className="max-w-64"
      />
      <p className="text-xs text-muted">{rw.heightNote}</p>
    </div>
  );
}

/**
 * How wide a row's content may be, in pixels, at the size edited (D182): over the theme's content width, which a row takes where it sets
 * none. Dragging the row's side edges on the canvas sets it too. Where the row spreads, there is no limit to set.
 */
function ContentMaxField({ row, limited, onChange }: { row: PageRow; /** Whether the row keeps to a content width (D190: the theme's Row may spread every row). */ limited: boolean; onChange: (patch: RowPatch) => void }) {
  const { size } = useSizeEdit();
  const id = useId();
  const value = valueAt(row, "contentMax", size) ?? null;
  // What is typed until it is a width the row can have.
  const [draft, setDraft] = useState<string | null>(null);
  const back = (patch: { at: PageRow["at"] }) => onChange(patch);
  const rw = useAdminText("builder").row;
  return (
    <div className={`flex flex-col gap-1 ${inheritedClass(sizeSource(row, size, "contentMax"), size)}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {rw.maxWidth} <span className="font-normal text-muted">({fillWords(rw.pixelsRange, { min: CONTENT_MAX_MIN, max: CONTENT_MAX_MAX })})</span>
        </label>
        <SizeMark part={row} field="contentMax" label={rw.maxWidth} onPatch={back} />
      </div>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={CONTENT_MAX_MIN}
        max={CONTENT_MAX_MAX}
        disabled={!limited}
        placeholder={rw.themes}
        aria-describedby={`${id}-hint`}
        value={draft ?? value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const number = Math.round(Number(next));
          if (next === "") onChange(setAt(row, size, { contentMax: undefined }));
          else if (number >= CONTENT_MAX_MIN && number <= CONTENT_MAX_MAX) onChange(setAt(row, size, { contentMax: number }));
        }}
        onBlur={() => setDraft(null)}
        className="min-h-10 w-32 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
      />
      <PixelRange
        value={value ?? 1024}
        min={CONTENT_MAX_MIN}
        max={CONTENT_MAX_MAX}
        step={8}
        disabled={!limited}
        label={fillWords(rw.slider, { what: rw.maxWidth })}
        onChange={(next) => {
          setDraft(null);
          onChange(setAt(row, size, { contentMax: next }));
        }}
        className="max-w-64"
      />
      <p id={`${id}-hint`} className="text-xs text-muted">
        {limited ? rw.maxWidthHint : rw.spreadsHint}
      </p>
    </div>
  );
}

/**
 * A row's columns at the size edited (D179): side by side or one under another (on Small unless set), the last first where
 * reversed (either way), and the space between them. Each with its device icon; below Extra large an override of the size.
 */
function RowSizeFields({ row, onChange }: { row: PageRow; onChange: (patch: RowPatch) => void }) {
  const { size } = useSizeEdit();
  const stacked = stackAt(row, size);
  const reverse = valueAt(row, "reverse", size) === true;
  const back = (patch: { at: PageRow["at"] }) => onChange(patch);
  const rw = useAdminText("builder").row;
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend={rw.columns}
        mark={<SizeMark part={row} field="stack" label={rw.columns} onPatch={back} />}
        muted={inheritedClass(sizeSource(row, size, "stack"), size)}
        options={[
          { value: "side", label: rw.side },
          { value: "stack", label: rw.stack },
        ]}
        value={stacked ? "stack" : "side"}
        onChange={(choice) => onChange(stackPatchAt(row, size, choice === "stack"))}
      />
      <div className={`flex flex-wrap items-start gap-1 ${inheritedClass(sizeSource(row, size, "reverse"), size)}`}>
        <Check
          label={rw.reverse}
          hint={stacked ? rw.reverseStacked : rw.reverseSide}
          checked={reverse}
          onChange={(on) => onChange(setAt(row, size, { reverse: size === "xl" ? on || undefined : on }))}
        />
        <SizeMark part={row} field="reverse" label={rw.reverse} onPatch={back} />
      </div>
      <NumberField
        label={rw.gap}
        hint={fillWords(rw.upTo, { max: GRID_GAP_MAX })}
        value={valueAt(row, "gap", size) ?? 32}
        max={GRID_GAP_MAX}
        mark={<SizeMark part={row} field="gap" label={rw.gap} onPatch={back} />}
        muted={inheritedClass(sizeSource(row, size, "gap"), size)}
        onChange={(gap) => onChange(setAt(row, size, { gap }))}
      />
    </div>
  );
}

/** A column's share of its row and its place among the others, at the size edited (D179); the layout's until set. */
function ColumnSizeFields({ column, row, onChange }: { column: PageColumn; row: PageRow; onChange: (patch: ColumnPatch) => void }) {
  const { size } = useSizeEdit();
  // Its share in its own line's layout (D187): a row of one line has the one.
  const place = locateColumn(row, column.id);
  const layoutWidth: number = place ? (ROW_LAYOUTS[linesOf(row)[place.line].layout].widths[place.index] ?? 1) : 1;
  const rw = useAdminText("builder").row;
  const shareOf = row.moreLines ? rw.shareOfLine : rw.shareOfRow;
  const back = (patch: { at: PageColumn["at"] }) => onChange(patch);
  const width = valueAt(column, "width", size);
  const order = valueAt(column, "order", size);
  // The layout's share and the first place are no setting: chosen where nothing larger says otherwise, the setting goes.
  const sizedOrDefault = (key: "width" | "order", value: number, fallback: number): ColumnPatch =>
    size !== "xl" && value === (inheritedAt(column, key, size) ?? fallback)
      ? clearAt(column, size, key)
      : setAt(column, size, { [key]: size === "xl" && value === fallback ? undefined : value });
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <NumberField
        label={shareOf}
        hint={fillWords(rw.shareHint, { n: layoutWidth })}
        value={width ?? layoutWidth}
        max={COLUMN_SHARE_MAX}
        mark={<SizeMark part={column} field="width" label={shareOf} onPatch={back} />}
        muted={inheritedClass(sizeSource(column, size, "width"), size)}
        onChange={(share) => onChange(sizedOrDefault("width", share, layoutWidth))}
      />
      <NumberField
        label={rw.place}
        hint={rw.placeHint}
        value={order ?? 0}
        min={-12}
        max={12}
        mark={<SizeMark part={column} field="order" label={rw.place} onPatch={back} />}
        muted={inheritedClass(sizeSource(column, size, "order"), size)}
        onChange={(place) => onChange(sizedOrDefault("order", place, 0))}
      />
    </div>
  );
}

/**
 * A row's or column's background below Extra large (D179): a colour (see-through if wanted) or none, and the blur of what
 * is behind. A picture, video or gradient is the part's own at every size.
 */
function BackgroundAtSize({
  part,
  size,
  onChange,
  onPatch,
}: {
  part: PageRow | PageColumn;
  size: Size;
  onChange: (patch: Partial<PartBase>) => void;
  onPatch: (patch: Partial<PartBase>) => void;
}) {
  const own = part.background;
  const bw = useAdminText("builder").background;
  if (own && own.type !== "color") {
    return <p className="text-sm text-muted">{bw.sameEverySize[own.type]}</p>;
  }
  const value = valueAt(part, "background", size) ?? undefined;
  const blur = valueAt(part, "backdropBlur", size) ?? undefined;
  const color = value?.type === "color" ? value : null;
  const back = (patch: { at: PartBase["at"] }) => onPatch(patch);
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend={bw.legend}
        mark={<SizeMark part={part} field="background" label={bw.legend} onPatch={back} />}
        muted={inheritedClass(sizeSource(part, size, "background"), size)}
        options={[
          { value: "none", label: bw.kinds.none },
          { value: "color", label: bw.kinds.color },
        ]}
        value={color ? "color" : "none"}
        onChange={(kind) => onChange({ background: kind === "color" ? { type: "color", color: own?.type === "color" ? own.color : "#ffffff" } : undefined } as Partial<PartBase>)}
      />
      {color && (
        <ColorField
          label={bw.colour}
          value={color.color}
          onChange={(next) => onChange({ background: { ...color, color: next } } as Partial<PartBase>)}
          opacity={{
            value: color.opacity,
            onChange: (opacity) => {
              const next = { type: "color" as const, color: color.color };
              onChange({ background: opacity === undefined ? next : { ...next, opacity } } as Partial<PartBase>);
            },
          }}
        />
      )}
      <div className={`flex flex-col gap-3 ${inheritedClass(sizeSource(part, size, "backdropBlur"), size)}`}>
        <div className="flex flex-wrap items-start gap-1">
          <Check
            label={bw.blurBehind}
            hint={bw.blurBehindShort}
            checked={Boolean(blur)}
            onChange={(on) => onChange({ backdropBlur: on ? (blur ?? 12) : undefined } as Partial<PartBase>)}
          />
          <SizeMark part={part} field="backdropBlur" label={bw.blurBehind} onPatch={back} />
        </div>
        {blur ? (
          <div className="pl-7">
            <RangeField
              label={bw.blur}
              min={1}
              max={BACKDROP_BLUR_MAX}
              step={1}
              value={blur}
              shown={`${blur} px`}
              onChange={(next) => onChange({ backdropBlur: next } as Partial<PartBase>)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Whether the whole column is a link, where to, and its name for screen readers (D48). */
function ColumnLinkFields({ link, onChange }: { link: ColumnLink | undefined; onChange: (link: ColumnLink | undefined) => void }) {
  const id = useId();
  const lw = useAdminText("builder").link;
  const href = link?.href.trim() ?? "";
  const problem = link && href === "" ? lw.giveAddress : link && !isLinkAddress(href) ? lw.badAddress : null;
  return (
    <div className="flex flex-col gap-3">
      <Check
        label={lw.columnLink}
        hint={lw.columnLinkHint}
        checked={Boolean(link)}
        onChange={(on) => onChange(on ? { href: "", label: "" } : undefined)}
      />
      {link && (
        <div className="flex flex-col gap-3 pl-7">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-href`} className="text-sm font-medium">
              {lw.address}
            </label>
            <input
              id={`${id}-href`}
              value={link.href}
              maxLength={2000}
              spellCheck={false}
              placeholder={lw.placeholder}
              aria-invalid={Boolean(problem)}
              aria-describedby={`${id}-href-hint`}
              onChange={(event) => onChange({ ...link, href: event.target.value })}
              className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal aria-invalid:border-red-700"
            />
            <span
              id={`${id}-href-hint`}
              className={`text-xs font-normal ${problem ? "text-red-700 dark:text-red-400" : "text-muted"}`}
            >
              {problem ?? lw.addressHint}
            </span>
          </div>
          <label htmlFor={`${id}-label`} className="flex flex-col gap-1 text-sm font-medium">
            <span>
              {lw.description} <span className="font-normal text-muted">({lw.descriptionHint})</span>
            </span>
            <input
              id={`${id}-label`}
              value={link.label}
              maxLength={200}
              placeholder={lw.descriptionPlaceholder}
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
  const fw = useAdminText("builder").fields;
  const options = (["original", ...(Object.keys(IMAGE_SHAPES) as ImageShape[])] as const).map((shape) => ({
    value: shape,
    label: fw.shapes[shape],
    picture: <span aria-hidden className={`inline-block border-2 border-current ${SHAPE_PICTURES[shape]}`} />,
  }));
  return (
    <Choices
      legend={fw.shape}
      hint={fw.shapeHint}
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
  const aw = useAdminText("builder").advanced;
  const htmlId = part.htmlId?.trim() ?? "";
  const idProblem = htmlId
    ? (htmlIdProblem(htmlId) ?? (taken.has(htmlId) ? aw.idTaken : null))
    : null;
  const classProblem = classNameProblem(part.className ?? "");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{aw.siteOnly}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-id`} className="text-sm font-medium">
          {aw.id}
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
            (htmlId ? fillWords(aw.idLink, { id: htmlId }) : aw.idHint)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-classes`} className="text-sm font-medium">
          {aw.classes}
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
          {classProblem ?? aw.classesHint}
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
  const fw = useAdminText("builder").fields;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">
        {legend} <span className="font-normal text-muted">({hint})</span>
      </legend>
      <div className="grid grid-cols-4 gap-2">
        {SIDES.map((side) => (
          <label key={side} htmlFor={`${id}-${side}`} className="flex flex-col gap-1 text-xs text-muted">
            {fw.sides[side]}
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
            <PixelRange value={value[side]} min={0} max={max} label={fillWords(fw.sideSlider, { what: legend, side: fw.sides[side].toLowerCase() })} onChange={(next) => onChange({ ...value, [side]: next })} />
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
  min = 0,
  onChange,
  mark,
  muted = "",
}: {
  label: string;
  hint: string;
  value: number;
  max: number;
  min?: number;
  onChange: (value: number) => void;
  /** Beside the label: a setting that can differ by screen size has its device icon and where its value comes from (D179). */
  mark?: ReactNode;
  muted?: string;
}) {
  const id = useId();
  const rw = useAdminText("builder").row;
  return (
    <div className={`flex flex-col gap-1 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label} <span className="font-normal text-muted">({hint})</span>
        </label>
        {mark}
      </div>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Math.round(Number(event.target.value) || 0))))}
        className="min-h-10 w-28 rounded-md border border-border bg-background px-2 text-sm"
      />
      {/pixel|piksel/i.test(hint) && max > min && (
        <PixelRange value={value} min={min} max={max} step={max - min > 400 ? 4 : 1} label={fillWords(rw.slider, { what: label })} onChange={onChange} className="max-w-64" />
      )}
    </div>
  );
}

/** A border (its line, width on each side and colour), rounded corners and a shadow (D49). */
function FrameFields({
  value,
  onChange,
  what,
  sized,
}: {
  /** Whose, when a dialog has two sets, such as a content grid's tiles. */
  what?: string;
  /** What is shown: the part's own, or at a size its values there (`viewAt()`). */
  value: Pick<PartBase, "border" | "radius" | "shadow" | "shadowOpacity">;
  onChange: (patch: Partial<PartBase>) => void;
  /** A part's frame differs by screen size (D179): the part, for where each value comes from, and how to give one back. */
  sized?: { part: PartBase; onPatch: (patch: Partial<PartBase>) => void };
}) {
  const { size } = useSizeEdit();
  const fw = useAdminText("builder").frameFields;
  const border = value.border;
  const name = (label: string) => (what ? `${what} ${label.toLowerCase()}` : label);
  const mark = (field: "border" | "radius" | "shadow" | "shadowOpacity", label: string) =>
    sized ? { mark: <SizeMark part={sized.part} field={field} label={label} onPatch={sized.onPatch} />, muted: inheritedClass(sizeSource(sized.part, size, field), size) } : {};
  const atSize = Boolean(sized) && size !== "xl";
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <Choices
        {...mark("border", fw.border)}
        legend={name(fw.border)}
        options={[
          { value: "none", label: fw.none },
          ...(Object.keys(BORDER_STYLES) as BorderStyle[]).map((style) => ({ value: style, label: fw.borderStyles[style] })),
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
            legend={name(fw.borderWidth)}
            hint={fw.inPixels}
            value={border.width}
            max={BORDER_MAX}
            onChange={(width) => onChange({ border: { ...border, width } })}
          />
          <ColorField key={size} label={name(fw.borderColour)} value={border.color} onChange={(color) => onChange({ border: { ...border, color } })} />
        </>
      )}
      <NumberField
        {...mark("radius", fw.radius)}
        label={name(fw.radius)}
        hint={fw.radiusHint}
        value={value.radius ?? 0}
        max={RADIUS_MAX}
        // Square at a smaller size, under a rounded larger one, is kept as 0 there.
        onChange={(radius) => onChange({ radius: atSize ? radius : radius || undefined })}
      />
      <Choices
        {...mark("shadow", fw.shadow)}
        legend={name(fw.shadow)}
        options={[
          { value: "none", label: fw.none },
          ...(Object.keys(SHADOWS) as Shadow[]).map((shadow) => ({ value: shadow, label: fw.shadows[shadow] })),
        ]}
        value={value.shadow ?? "none"}
        // A shadow's opacity is of that shadow (D262): another shadow, or none, starts from its own again.
        onChange={(shadow) => onChange({ shadow: shadow === "none" ? undefined : shadow, shadowOpacity: undefined })}
      />
      {value.shadow && <ShadowOpacityField shadow={value.shadow} value={value.shadowOpacity} label={name(fw.shadowOpacity)} {...mark("shadowOpacity", fw.shadowOpacity)} onChange={(shadowOpacity) => onChange({ shadowOpacity })} />}
    </div>
  );
}

/** How dark a shadow is (D262): a slider from none to solid, at the shadow's own opacity until it is moved, with a way back to it. */
function ShadowOpacityField({
  shadow,
  value,
  label,
  mark,
  muted = "",
  onChange,
}: {
  shadow: Shadow;
  value: number | undefined;
  label: string;
  mark?: ReactNode;
  muted?: string;
  onChange: (value: number | undefined) => void;
}) {
  const own = shadowOpacityOf(shadow);
  const shown = value ?? own;
  const fw = useAdminText("builder").frameFields;
  return (
    <div className={`flex flex-col gap-1 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-sm font-medium">
          {label} <span className="font-normal text-muted">({shown}%)</span>
        </span>
        {mark}
      </div>
      <PixelRange value={shown} min={0} max={100} unit="%" label={label} onChange={onChange} className="max-w-64" />
      {value !== undefined && value !== own && (
        <button type="button" onClick={() => onChange(undefined)} className="self-start text-xs text-muted underline underline-offset-2">
          {fillWords(fw.shadowBack, { n: own })}
        </button>
      )}
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
  const words = useAdminText("builder");
  const hw = words.heading;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          {hw.heading}
        </label>
        {/* Its words as they look, text styles and all (D393); no tag to type. */}
        <MarkupInput id={`${id}-text`} label={hw.heading} value={block.text} max={HEADING_MAX} className="text-base font-medium" onChange={(text) => onChange({ ...block, text })} />
      </div>
      <div className="flex flex-col gap-1">
        <Choices
          legend={hw.level}
          hint={hw.levelHint}
          options={LEVELS.map((level) => ({ value: String(level), label: `H${level}` }))}
          value={String(block.level)}
          onChange={(level) => onChange({ ...block, level: Number(level) as HeadingLevel })}
        />
        <p className={`text-xs ${block.level === 1 && otherMainHeading ? "text-red-700 dark:text-red-400" : "text-muted"}`}>
          {block.level === 1 ? (otherMainHeading ? hw.twoMain : hw.main) : hw.levels}
        </p>
      </div>
    </div>
  );
}

/** A button's text, address and whether it opens a new tab (D49). */
function ButtonFields({ block, onChange }: { block: ButtonBlock; onChange: (block: ButtonBlock) => void }) {
  const id = useId();
  const w = useAdminText("builder");
  const bw = w.button;
  const href = block.href.trim();
  const problem = href === "" ? bw.needsAddress : isLinkAddress(href) ? null : w.link.badAddress;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-label`} className="text-sm font-medium">
          {bw.text}
        </label>
        <MarkupInput id={`${id}-label`} label={bw.text} value={block.label} max={BUTTON_LABEL_MAX} placeholder={bw.placeholder} onChange={(label) => onChange({ ...block, label })} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-href`} className="text-sm font-medium">
          {w.link.address}
        </label>
        <input
          id={`${id}-href`}
          value={block.href}
          maxLength={2000}
          spellCheck={false}
          placeholder={w.link.placeholder}
          aria-invalid={Boolean(problem && href)}
          aria-describedby={`${id}-href-hint`}
          onChange={(event) => onChange({ ...block, href: event.target.value })}
          className="min-h-10 rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-red-700"
        />
        <span
          id={`${id}-href-hint`}
          className={`text-xs ${problem && href ? "text-red-700 dark:text-red-400" : "text-muted"}`}
        >
          {problem ?? w.link.addressHint}
        </span>
      </div>
      <Check
        label={w.image.newTab}
        hint={w.image.newTabHint}
        checked={Boolean(block.newTab)}
        onChange={(newTab) => onChange({ ...block, newTab: newTab || undefined })}
      />
    </div>
  );
}

/** A button's look: kind, size, corners, width, place and colours (D49); its weight and font are its typography (D179). */
function ButtonStyleFields({ block, onChange }: { block: ButtonBlock; onChange: (patch: BlockPatch<ButtonBlock>) => void }) {
  const w = useAdminText("builder");
  return (
    <div className="flex flex-col gap-4">
      <ButtonLookFields look={block} onChange={onChange} />
      <ButtonHoverField value={block.hover} onChange={(hover) => onChange({ hover })} />
      <Check
        label={w.button.fullWidth}
        hint={w.button.fullWidthHint}
        checked={Boolean(block.fullWidth)}
        onChange={(fullWidth) => onChange({ fullWidth })}
      />
      <TextAlignFields what={w.dialogs.position} value={block} onChange={onChange} />
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
function GridPreview({ block, grid, lang }: { block: ContentGridBlock; grid: GridContext; lang: string | undefined }) {
  const pageId = grid.pageId;
  const custom = !sourceTraits(block.source).lookedUp;
  // A grid of custom items (D155) is its block's own items: drawn here as they are typed, with no trip to the server.
  const key = JSON.stringify(custom ? [block.source, block.items, block.limit] : [block.source, block.categories, block.tags, block.sort, block.limit]);
  const [result, setResult] = useState<{ key: string; data: GridData | { problem: string } } | null>(null);
  const load = useEffectEvent((forKey: string) => {
    if (custom) return;
    void grid.actions.gridPreview(block, pageId).then((data) => setResult({ key: forKey, data }));
  });
  useEffect(() => load(key), [key]);
  const own = custom ? { key, data: customGridData(block, { base: grid.owner ? "" : null, lang: lang ?? "en", locale: lang ?? "en-GB" }) } : null;

  const gw = useAdminText("builder").grid;
  const note = (text: string) => <p className="rounded-md bg-surface p-3 text-sm text-muted">{text}</p>;
  const shown = own ?? result;
  if (!shown) return note(gw.finding);
  const data = shown.data;
  if ("problem" in data) return note(fillWords(gw.problem, { problem: data.problem }));
  const stale = shown.key !== key;
  if (data.items.length === 0) {
    return note(custom ? gw.noItems : block.emptyText ? fillWords(gw.nothingShows, { text: block.emptyText }) : gw.nothing);
  }
  const m = t(data.lang);
  return (
    <div className={stale ? "opacity-60 transition-opacity" : undefined}>
      {/* The site's controls over a grid shoppers filter (D83), as they will look; they work on the site. */}
      {block.filters && sourceTraits(block.source).products && (
        <div aria-hidden className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{m.listing.count(data.items.length)}</p>
          <span className="inline-flex min-h-11 items-center gap-2 rounded-button border border-border px-4 text-sm font-medium">
            {m.listing.open}
          </span>
        </div>
      )}
      <ContentGridView block={block} data={data} />
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
  const gw = useAdminText("builder").grid;
  const tags = terms.filter((t) => t.kind === "tag").sort(byName);
  const toggle = (key: "categories" | "tags", id: string, on: boolean) => {
    const ids = value[key].filter((x) => x !== id);
    onChange({ ...value, [key]: on ? [...ids, id] : ids });
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(
        [
          ["categories", gw.categories, tree],
          ["tags", gw.tags, tags.map((t) => ({ ...t, depth: 0 }))],
        ] as const
      ).map(([key, legend, list]) => (
        <fieldset key={key} className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{legend}</legend>
          {list.length === 0 ? (
            <p className="text-sm text-muted">{gw.noneYet}</p>
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

/**
 * How many tiles side by side at the size edited (D179): a grid's, related products' (two on Small and four above until
 * set); at Extra large the part's own, below it an override of the size.
 */
function ColumnsFields<T extends { columns?: number; at?: PageBlock["at"] }>({
  part,
  fallback,
  onChange,
}: {
  part: T;
  /** What the size shows with nothing set. */
  fallback: (size: Size) => number;
  onChange: (patch: Partial<T>) => void;
}) {
  const { size } = useSizeEdit();
  const value = valueAt(part, "columns", size) ?? fallback(size);
  const gw = useAdminText("builder").grid;
  return (
    <Choices
      legend={gw.columns}
      hint={gw.columnsHint}
      mark={<SizeMark part={part} field="columns" label={gw.columns} onPatch={(patch) => onChange(patch as Partial<T>)} />}
      muted={inheritedClass(sizeSource(part, size, "columns"), size)}
      options={Array.from({ length: GRID_COLUMNS_MAX.desktop }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
      value={String(value)}
      onChange={(n) => onChange(setAt(part, size, { columns: Number(n) } as Partial<T>))}
    />
  );
}

/**
 * A content grid shown as a grid or a carousel at the size edited (D155, D179: a carousel on Small only is a carousel
 * there and a grid above), and its columns.
 */
function GridDisplayFields({ block, onChange }: { block: ContentGridBlock; onChange: (patch: BlockPatch<ContentGridBlock>) => void }) {
  const { size } = useSizeEdit();
  const carousel = carouselAt(block, size);
  const gw = useAdminText("builder").grid;
  return (
    <>
      <Choices
        legend={gw.showAs}
        mark={<SizeMark part={block} field="display" label={gw.showAs} onPatch={onChange} />}
        muted={inheritedClass(sizeSource(block, size, "display"), size)}
        options={[
          { value: "grid", label: gw.grid },
          { value: "carousel", label: gw.carousel },
        ]}
        value={carousel ? "carousel" : "grid"}
        onChange={(display) => {
          const patch = setAt(block, size, { display: display === "carousel" ? "carousel" : size === "xl" ? undefined : "grid" } as Partial<ContentGridBlock>);
          // A grid at every size keeps no carousel setting of its own.
          const after = { ...block, ...patch } as ContentGridBlock;
          onChange(carouselAnywhere(after) ? patch : { ...patch, peek: undefined });
        }}
      />
      {carouselAnywhere(block) && (
        <>
          <p className="text-xs text-muted">
            {carousel ? gw.carouselHint : gw.carouselElsewhere}
          </p>
          <Check label={gw.peek} checked={block.peek === true} onChange={(peek) => onChange({ peek: peek || undefined })} />
          <CarouselFields value={block.carousel} onChange={(carousel) => onChange({ carousel })} />
        </>
      )}
      <ColumnsFields part={block} fallback={() => block.columns} onChange={onChange} />
    </>
  );
}

const gridField = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";

/** What a content grid shows and how many to a row (D51). */
function ContentGridFields({
  block,
  grid,
  upload,
  onChange,
}: {
  block: ContentGridBlock;
  grid: GridContext;
  /** Uploads a custom item's picture into the media library (D155); null where uploads are not set up. */
  upload: Upload | null;
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
  const traits = sourceTraits(source);
  const custom = !traits.lookedUp;
  const terms =
    source.type === "pages"
      ? grid.pageTerms
      : source.type === "articles"
        ? grid.articleTerms
        : storeId && storeTerms?.storeId === storeId
          ? storeTerms.terms
          : [];
  const store = source.type === "products" ? grid.stores.find((s) => s.id === source.storeId) : undefined;
  const products = traits.products;
  const recommend = source.type === "products" ? source.recommend : undefined;
  const entries = source.type === "entries";
  const contentTypes = grid.contentTypes ?? [];
  const entryType = source.type === "entries" ? contentTypes.find((type) => type.key === source.contentType) : undefined;
  // Entries sort by date, title or the owner's own order of the type (D326); prices are products' alone.
  const sorts = (Object.keys(GRID_SORTS) as GridSort[]).filter((sort) =>
    products ? true : entries ? !PRICE_SORTS.includes(sort) : !PRODUCT_SORTS.includes(sort),
  );
  const productsOf = (s: GridStore | undefined): GridSource => ({
    type: "products",
    storeId: s?.id ?? "",
    market: s?.markets[0]?.code ?? "",
  });
  const gw = useAdminText("builder").grid;

  return (
    <div className="flex flex-col gap-5">
      <Choices
        legend={gw.show}
        // A website's grids (D178 step 5: the online shop off) show pages, articles or the owner's own items; one of products keeps its choice.
        options={(Object.keys(GRID_CONTENT) as GridContent[])
          .filter((type) => type !== "products" || source.type === "products" || partFeatureOn({ type: "contentGrid", source: { type: "products" } }, grid.features))
          .filter((type) => type !== "entries" || entries || contentTypes.length > 0)
          .map((type) => ({ value: type, label: gw.content[type] }))}
        value={source.type}
        onChange={(type) => onChange(sourceChoice(block, type, own ? { type: "products" } : productsOf(grid.stores[0]), contentTypes[0]?.key))}
      />
      {source.type === "entries" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-type`} className="text-sm font-medium">
            {gw.contentType}
          </label>
          <select
            id={`${id}-type`}
            aria-describedby={`${id}-type-hint`}
            value={entryType?.key ?? ""}
            onChange={(event) => onChange({ source: { type: "entries", contentType: event.target.value }, tileFields: undefined })}
            className={gridField}
          >
            {!entryType && <option value="">{gw.chooseContentType}</option>}
            {contentTypes.map((type) => (
              <option key={type.key} value={type.key}>
                {type.name}
              </option>
            ))}
          </select>
          <p id={`${id}-type-hint`} className="text-xs text-muted">
            {gw.contentTypeHint}
          </p>
        </div>
      )}
      {custom && (
        <CustomItemsEditor
          items={block.items ?? []}
          onChange={(items) => onChange({ items })}
          upload={upload}
          linkTargets={grid.actions.linkTargets}
        />
      )}
      {!custom && (
        <CopyCurrentItems
          block={block}
          platform={!own}
          load={() => grid.actions.gridPreview(block, grid.pageId)}
          onCopied={(items) => onChange(copiedItems(items))}
        />
      )}
      {products && own && (
        <p className="text-sm text-muted">
          {gw.ownProducts}
        </p>
      )}
      {products &&
        !own &&
        (grid.stores.length === 0 ? (
          <p className="text-sm text-muted">{gw.noStore}</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-store`} className="text-sm font-medium">
                {gw.store}
              </label>
              <select
                id={`${id}-store`}
                value={store?.id ?? ""}
                onChange={(event) => onChange({ source: productsOf(grid.stores.find((s) => s.id === event.target.value)), categories: [], tags: [] })}
                className={gridField}
              >
                {!store && <option value="">{gw.chooseStore}</option>}
                {grid.stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-market`} className="text-sm font-medium">
                {gw.market} <span className="font-normal text-muted">({gw.marketHint})</span>
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
      {source.type === "pages" && (
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <label htmlFor={`${id}-parent`} className="text-sm font-medium">
            {gw.under}
          </label>
          <select
            id={`${id}-parent`}
            value={source.parent ?? ""}
            onChange={(event) => onChange({ source: event.target.value ? { type: "pages", parent: event.target.value } : { type: "pages" } })}
            className={gridField}
          >
            <option value="">{gw.anyPage}</option>
            <option value="@this">{gw.thisPage}</option>
            {source.parent && source.parent !== "@this" && !(grid.pageChoices ?? []).some((p) => p.slug === source.parent) && (
              <option value={source.parent}>/{source.parent}</option>
            )}
            {(grid.pageChoices ?? []).map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title} (/{p.slug})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">{gw.underHint}</p>
        </div>
      )}
      {traits.terms && (
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-medium">{gw.onlyThese}</p>
        <p className="text-xs text-muted">{gw.onlyTheseHint}</p>
        <TermChecks terms={terms} value={{ categories: block.categories, tags: block.tags }} onChange={(ids) => onChange(ids)} />
      </div>
      )}
      {!custom && (
      <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
        {!recommend && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-sort`} className="text-sm font-medium">
            {gw.order}
          </label>
          <select
            id={`${id}-sort`}
            value={block.sort}
            onChange={(event) => onChange({ sort: event.target.value as GridSort })}
            className={gridField}
          >
            {sorts.map((sort) => (
              <option key={sort} value={sort}>
                {entries && sort === "manual" ? gw.typeOrder : gw.sorts[sort]}
              </option>
            ))}
          </select>
        </div>
        )}
        <NumberField
          label={gw.howMany}
          hint={fillWords(gw.atMost, { max: GRID_LIMIT_MAX })}
          value={block.limit}
          max={GRID_LIMIT_MAX}
          onChange={(limit) => onChange({ limit: Math.max(1, limit) })}
        />
      </div>
      )}
      {products && own && source.type === "products" && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Check
            label={gw.recommend}
            checked={Boolean(recommend)}
            onChange={(on) =>
              onChange(
                on
                  ? { source: { ...source, recommend: DEFAULT_GRID_RECOMMEND }, filters: undefined }
                  : { source: { type: "products", ...(source.storeId && { storeId: source.storeId }), ...(source.market && { market: source.market }) } },
              )
            }
          />
          <p className="text-xs text-muted">{gw.recommendHint}</p>
          {recommend && (
            <>
              <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
                <legend className="mb-1 w-full text-sm font-medium">{gw.mix}</legend>
                <Check label={gw.upsell} checked={recommend.mix.upsell} onChange={(upsell) => onChange({ source: { ...source, recommend: { ...recommend, mix: { ...recommend.mix, upsell } } } })} />
                <Check label={gw.crossSell} checked={recommend.mix.crossSell} onChange={(crossSell) => onChange({ source: { ...source, recommend: { ...recommend, mix: { ...recommend.mix, crossSell } } } })} />
                <Check label={gw.complement} checked={recommend.mix.complement} onChange={(complement) => onChange({ source: { ...source, recommend: { ...recommend, mix: { ...recommend.mix, complement } } } })} />
              </fieldset>
              <Check
                label={gw.explain}
                checked={recommend.explain}
                onChange={(explain) => onChange({ source: { ...source, recommend: { ...recommend, explain } } })}
              />
            </>
          )}
        </div>
      )}
      {products && own && !recommend && (
        <label className="flex items-start gap-2 border-t border-border pt-4 text-sm">
          <input
            type="checkbox"
            checked={block.filters === true}
            onChange={(event) => onChange({ filters: event.target.checked || undefined })}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">{gw.filters}</span>
            <span className="block text-xs text-muted">{gw.filtersHint}</span>
          </span>
        </label>
      )}
      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <GridDisplayFields block={block} onChange={onChange} />
      </div>
      <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
        <legend className="float-left mb-2 w-full text-sm font-medium">{gw.inEachTile}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(Object.keys(GRID_ELEMENTS) as GridElement[])
            .filter((element) => element !== "price" || products || custom)
            .map((element) => (
              <label key={element} className="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={block.show[element]}
                  onChange={(event) => onChange({ show: { ...block.show, [element]: event.target.checked } })}
                  className="size-4"
                />
                {custom && element === "price" ? gw.priceText : gw.elements[element]}
              </label>
            ))}
        </div>
      </fieldset>
      {tileEntity(block.source) && (
        <TileFieldsPicker
          entity={tileEntity(block.source)!}
          value={block.tileFields ?? []}
          onChange={(tileFields) => onChange({ tileFields })}
        />
      )}
      {entryType && (
        <TileFieldsPicker
          entity={null}
          groups={[typeAsGroup({ id: entryType.key, name: entryType.name, slug: entryType.key, fields: entryType.fields })]}
          value={block.tileFields ?? []}
          onChange={(tileFields) => onChange({ tileFields })}
        />
      )}
      {block.show.button && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-button`} className="text-sm font-medium">
            {gw.buttonText}
          </label>
          <input
            id={`${id}-button`}
            value={block.buttonLabel}
            maxLength={BUTTON_LABEL_MAX}
            placeholder={products ? gw.viewProduct : gw.readMore}
            // Custom items can also have a button text each (D155): this one is for those that do not.
            onChange={(event) => onChange({ buttonLabel: event.target.value })}
            className={gridField}
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-empty`} className="text-sm font-medium">
          {gw.whenNothing}
        </label>
        <MarkupInput id={`${id}-empty`} label={gw.whenNothing} value={block.emptyText} max={300} placeholder={gw.showNothing} onChange={(emptyText) => onChange({ emptyText })} />
      </div>
    </div>
  );
}

const GRID_LEVELS = [2, 3, 4, 5, 6] as const;

/** How a content grid's tiles look (D51): picture, heading, excerpt, button and the tile itself. */
function GridStyleFields({ block, onChange }: { block: ContentGridBlock; onChange: (patch: BlockPatch<ContentGridBlock>) => void }) {
  const tile = block.tile;
  const { size } = useSizeEdit();
  const w = useAdminText("builder");
  const gw = w.grid;
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend={gw.pictures}
        hint={gw.picturesHint}
        options={[
          // Products can follow the store theme's product cards (D60), their default.
          ...(sourceTraits(block.source).products ? [{ value: "theme" as const, label: gw.themeCards }] : []),
          ...(["original", ...(Object.keys(IMAGE_SHAPES) as ImageShape[])] as const).map((shape) => ({
            value: shape,
            label: w.fields.shapes[shape],
            picture: <span aria-hidden className={`inline-block border-2 border-current ${SHAPE_PICTURES[shape]}`} />,
          })),
        ]}
        value={gridImageShape(block) === "theme" && !sourceTraits(block.source).products ? "landscape" : gridImageShape(block)}
        onChange={(shape) => onChange({ imageShape: shape === gridImageShape({ source: block.source }) ? undefined : shape })}
      />
      <Choices
        legend={gw.headingLevel}
        hint={gw.headingLevelHint}
        options={GRID_LEVELS.map((level) => ({ value: String(level), label: `H${level}` }))}
        value={String(block.headingLevel)}
        onChange={(level) => onChange({ headingLevel: Number(level) as ContentGridBlock["headingLevel"] })}
      />
      <NumberField
        label={gw.excerpt}
        hint={gw.excerptHint}
        value={block.excerptLines}
        max={6}
        onChange={(lines) => onChange({ excerptLines: Math.max(1, lines) })}
      />
      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <p className="text-sm font-medium">{gw.buttons}</p>
        <ButtonLookFields look={block.button ?? {}} onChange={(patch) => onChange({ button: mergeOptional(block.button, patch) })} />
      </div>
      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <p className="text-sm font-medium">{gw.cards}</p>
        <NumberField
          label={gw.cardGap}
          hint={fillWords(w.row.upTo, { max: GRID_GAP_MAX })}
          value={valueAt(block, "gap", size) ?? block.gap}
          max={GRID_GAP_MAX}
          mark={<SizeMark part={block} field="gap" label={gw.tileGap} onPatch={onChange} />}
          muted={inheritedClass(sizeSource(block, size, "gap"), size)}
          onChange={(gap) => onChange(setAt(block, size, { gap }))}
        />
        <OptionalColor
          label={gw.cardBackground}
          hint={gw.cardBackgroundHint}
          value={tile?.background}
          fallback="#f5f5f4"
          onChange={(background) => onChange({ tile: mergeOptional(tile, { background }) })}
        />
        <OptionalColor
          label={gw.cardText}
          hint={gw.cardTextHint}
          value={tile?.color}
          fallback="#111827"
          onChange={(color) => onChange({ tile: mergeOptional(tile, { color }) })}
        />
        <NumberField
          label={gw.cardPadding}
          hint={gw.cardPaddingHint}
          value={tile?.padding ?? 0}
          max={SPACING_MAX}
          onChange={(padding) => onChange({ tile: mergeOptional(tile, { padding: padding || undefined }) })}
        />
        <SidesFields
          legend={gw.wordsPadding}
          hint={gw.wordsPaddingHint}
          value={contentSides(tile?.contentPadding) ?? { top: 0, right: 0, bottom: 0, left: 0 }}
          max={SPACING_MAX}
          onChange={(sides) => onChange({ tile: mergeOptional(tile, { contentPadding: contentSides(sides) ? sides : undefined }) })}
        />
        <FrameFields what={gw.card} value={tile ?? {}} onChange={(patch) => onChange({ tile: mergeOptional(tile, patch) })} />
      </div>
    </div>
  );
}

/** A row's layout: one choice for its line, or one for each of its lines of columns (D187). */
function RowLayoutChoice({ row, onLayout }: { row: PageRow; onLayout: (line: number, layout: RowLayout) => void }) {
  const layouts = rowLayouts(row);
  const lw = useAdminText("builder").layoutChoice;
  if (layouts.length === 1) return <LayoutChoice value={row.layout} onChange={(layout) => onLayout(0, layout)} />;
  return (
    <div className="flex flex-col gap-4">
      {layouts.map((layout, i) => (
        <div key={i} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{fillWords(lw.line, { n: i + 1 })}</p>
          <LayoutChoice label={fillWords(lw.lineLayout, { n: i + 1 })} value={layout} onChange={(next) => onLayout(i, next)} />
        </div>
      ))}
      <p className="text-xs text-muted">{lw.linesHint}</p>
    </div>
  );
}

/** The nine layouts to choose from, as pictures. */
function LayoutChoice({ value, onChange, label }: { value: RowLayout; onChange: (layout: RowLayout) => void; label?: string }) {
  const w = useAdminText("builder");
  return (
    <div role="radiogroup" aria-label={label ?? w.layoutChoice.layout} className="grid grid-cols-3 gap-3">
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
          <span className="text-xs">{w.layouts[layout]}</span>
        </button>
      ))}
    </div>
  );
}

const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

/**
 * A part's place among globals' uses (D98), in its settings: a use says
 * whose it is and can be unlinked (made this page's own copy); a part
 * inside a use can be this page's own, or shared again.
 */
function GlobalControls({
  id,
  rows,
  onRows,
  nameOf,
}: {
  id: string;
  rows: PageRow[];
  onRows: Rows;
  nameOf: (globalId: string) => string;
}) {
  const place = usePlace(rows, id);
  const gw = useAdminText("builder").global;
  if (!place || (!place.global && !place.within)) return null;
  const within = place.within;
  return (
    <>
      {place.global && (
        <>
          <span
            className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-900 dark:bg-violet-950 dark:text-violet-100"
            title={gw.everyPage}
          >
            {fillWords(gw.mark, { name: nameOf(place.global) })}
          </span>
          <button
            type="button"
            onClick={() => onRows((current) => detachUse(current, id))}
            title={gw.unlinkHint}
            className="min-h-10 rounded-md border border-border px-3 text-sm"
          >
            {gw.unlink}
          </button>
        </>
      )}
      {within && !within.shared && !place.inLocal && (
        <label className="flex items-center gap-2 text-sm" title={fillWords(gw.notShared, { name: nameOf(within.global) })}>
          <input type="checkbox" checked={place.local} onChange={(event) => onRows((current) => setLocal(current, id, event.target.checked))} />
          {gw.onlyHere}
        </label>
      )}
      {within && within.shared && !place.global && <span className="text-xs text-muted">{fillWords(gw.partOf, { name: nameOf(within.global) })}</span>}
      {place.inLocal && !place.global && <span className="text-xs text-muted">{gw.pagesOwn}</span>}
    </>
  );
}

/** Names a row, column or component and saves it under Saved (D46). */
function SaveAsDialog({
  create,
  sharing: canShare,
  part,
  onCancel,
  onSaved,
}: {
  create: PageOwnerContext["actions"]["createPart"];
  /** Offers who else can use it (D125): a store's builder only. */
  sharing: boolean;
  part: SavedPartDraft;
  onCancel: () => void;
  onSaved: (parts: SavedPart[], id: string, global: boolean) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [global, setGlobal] = useState(false);
  const [shared, setShared] = useState<PartSharing>("private");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const w = useAdminText("builder");
  const sw = w.savedPart;
  const kind = w.savedKinds[part.kind].one.toLowerCase();
  const submit = () =>
    start(async () => {
      const sharing = canShare ? { sharing: shared } : {};
      // A global's content gets ids of its own; the part on the page keeps its ids and becomes its first use.
      const result = await create(
        global ? { kind: part.kind, content: globalContent(part.kind, part.content), name, global, ...sharing } : { ...part, name, ...sharing },
      );
      if (result.ok) onSaved(result.parts, result.id, global);
      else setProblems(result.problems);
    });
  return (
    <Modal
      open
      onClose={onCancel}
      title={fillWords(sw.saveThis, { kind })}
      footer={
        <>
          <button type="button" onClick={onCancel} className="min-h-10 rounded-md border border-border px-4 text-sm">
            {sw.cancel}
          </button>
          <button
            type="submit"
            form={`${id}-form`}
            disabled={busy}
            className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          >
            {busy ? sw.saving : sw.save}
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
          {sw.name}
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
          placeholder={sw.namePlaceholders[part.kind === "row" ? "row" : part.kind === "column" ? "column" : "block"]}
          className={field}
        />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={global} onChange={(event) => setGlobal(event.target.checked)} className="mt-1" />
          <span>
            <span className="font-medium">{w.frame.global}</span>
            <span className="block text-xs text-muted">{fillWords(sw.globalHint, { kind })}</span>
          </span>
        </label>
        <p className="text-xs text-muted">
          {fillWords(global ? sw.addedGlobal : sw.added, { kind })}
        </p>
        {canShare && <SharingChoice value={shared} onChange={setShared} />}
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
  part: PlainPart;
  onClose: () => void;
  onParts: (parts: SavedPart[]) => void;
  onUse: () => void;
  upload: Upload | null;
}) {
  const id = useId();
  const [name, setName] = useState(part.name);
  // Global (D98): its pages follow its changes; turned off, they keep what they have as their own.
  const [global, setGlobal] = useState(part.global);
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
      const result = await actions.updatePart(part.id, { ...content(), name, global, sharing: part.sharing });
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
  const w = useAdminText("builder");
  const sw = w.savedPart;

  return (
    <Modal
      open
      onClose={onClose}
      title={fillWords(sw.title, { kind: w.savedKinds[part.kind].one.toLowerCase() })}
      wide
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto self-center text-sm">
              {fillWords(part.global ? sw.deleteGlobal : sw.deleteCopy, { name: part.name })}
            </span>
            <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-10 rounded-md border border-border px-4 text-sm">
              {w.dialogs.keepIt}
            </button>
            <button type="button" onClick={remove} disabled={busy} className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-medium text-white">
              {w.tools.delete}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirmDelete(true)} className="mr-auto min-h-10 px-2 text-sm text-red-700 underline dark:text-red-400">
              {w.tools.delete}
            </button>
            <button
              type="button"
              onClick={onUse}
              disabled={dirty}
              title={dirty ? sw.saveFirst : undefined}
              className="min-h-10 rounded-md border border-border px-4 text-sm disabled:opacity-40"
            >
              {sw.addToPage}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || (!dirty && name === part.name && global === part.global)}
              className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            >
              {busy ? sw.saving : sw.saveChanges}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            {sw.name}
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={SAVED_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            className={field}
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={global} onChange={(event) => setGlobal(event.target.checked)} className="mt-1" />
          <span>
            <span className="font-medium">{w.frame.global}</span>
            <span className="block text-xs text-muted">
              {part.global
                ? `${countWords(part.uses, sw.usedOn)}${global ? "" : ` ${sw.turnedOff}`}`
                : sw.fromNowOn}
            </span>
          </span>
        </label>
        {part.kind === "row" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{w.layoutChoice.layout}</p>
            <RowLayoutChoice row={row} onLayout={(line, layout) => change((r) => setLineLayout(r, row.id, line, layout, newId))} />
          </div>
        )}
        {row.columns.map((column, index) => (
          <section key={column.id} className="flex flex-col gap-3" aria-label={part.kind === "row" ? fillWords(sw.column, { n: index + 1 }) : w.canvas.content}>
            {part.kind === "row" && <h3 className="text-sm font-medium">{fillWords(sw.column, { n: index + 1 })}</h3>}
            {column.blocks.map((block, n) => (
              <div key={block.id} className="flex flex-col gap-1">
                {block.type === "richText" ? (
                  <div className="flex flex-col gap-3">
                    <BindFields
                      blockType="richText"
                      bind={block.bind}
                      onChange={(bind) => change((r) => patchBlock<RichTextBlock>(r, block.id, { bind }))}
                    />
                    <RichTextEditor
                      value={block.doc}
                      onChange={(doc) =>
                        change((r) => updateBlock(r, block.id, (b) => (b.type === "richText" ? { ...b, doc } : b)))
                      }
                      label={part.kind === "row" ? fillWords(sw.columnText, { column: index + 1, n: n + 1 }) : fillWords(sw.text, { n: n + 1 })}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-5 rounded-md border border-border p-3">
                    {(block.type === "image" || block.type === "heading" || block.type === "button") && (
                      // A part saved to use again keeps a block's field binding (D118) like any copy; it is drawn where the page has the field.
                      <BindFields
                        blockType={block.type}
                        bind={block.bind}
                        onChange={(bind) => change((r) => patchBlock<ImageBlock | HeadingBlock | ButtonBlock>(r, block.id, { bind }))}
                      />
                    )}
                    {block.type === "image" ? (
                      <ImageFields block={block} upload={upload} onChange={(next) => change((r) => updateBlock(r, block.id, () => next))} />
                    ) : block.type === "heading" ? (
                      <HeadingFields block={block} onChange={(next) => change((r) => updateBlock(r, block.id, () => next))} />
                    ) : block.type === "contentGrid" || block.type === "product" || block.type === "site" ? (
                      <p className="text-sm text-muted">{sw.whereUsedIn[block.type]}</p>
                    ) : block.type === "menu" ||
                      block.type === "search" ||
                      block.type === "plans" ||
                      block.type === "domainSearch" ||
                      block.type === "themeStore" ||
                      block.type === "customField" ||
                      block.type === "fieldLoop" ||
                      block.type === "storePart" ? (
                      <p className="text-sm text-muted">{fillWords(sw.whereUsed, { block: w.blockNames[block.type] })}</p>
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
                    {fillWords(sw.remove, { what: w.blockThis[block.type] })}
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
                {sw.addText}
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
  flask: <path d="M9 3h6M10 3v6L4.5 18.2A1.6 1.6 0 0 0 5.9 20.6h12.2a1.6 1.6 0 0 0 1.4-2.4L14 9V3M7.5 15h9" />,
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

function DomainSearchIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
      </svg>
    </span>
  );
}

function PlansIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="5" height="14" rx="1" />
        <rect x="9.5" y="3" width="5" height="16" rx="1" />
        <rect x="16" y="7" width="5" height="12" rx="1" />
      </svg>
    </span>
  );
}

function SearchIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.5-4.5" />
      </svg>
    </span>
  );
}

function ShopIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9l1.5-5h13L20 9M4 9h16a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0A2.7 2.7 0 0 1 4 9M5.5 12v8h13v-8M10 20v-5h4v5" />
      </svg>
    </span>
  );
}

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
/** Kaizen's plans component's settings (D142): the currency and price shown, the highlighted plan, the comparison table and the buttons. */
function PlansFields({ block, plans, onChange }: { block: PlansBlock; plans: PlanChoice[]; onChange: (patch: BlockPatch<PlansBlock>) => void }) {
  const id = useId();
  const currencies = planCurrencies(plans);
  const input = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
  const pw = useAdminText("builder").plans;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{pw.hint}</p>
      {plans.length === 0 && <p className="text-sm">{pw.none}</p>}
      <label htmlFor={`${id}-currency`} className="flex flex-col gap-1 text-sm font-medium">
        {pw.currency}
        <select
          id={`${id}-currency`}
          value={block.currency && currencies.includes(block.currency) ? block.currency : ""}
          onChange={(event) => onChange({ currency: event.target.value || undefined })}
          className={input}
        >
          <option value="">{pw.currencyMost}</option>
          {currencies.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-interval`} className="flex flex-col gap-1 text-sm font-medium">
        {pw.prices}
        <select
          id={`${id}-interval`}
          value={block.interval ?? ""}
          onChange={(event) => onChange({ interval: (event.target.value || undefined) as PlansBlock["interval"] })}
          className={input}
        >
          <option value="">{pw.monthlyYearly}</option>
          <option value="month">{pw.monthly}</option>
          <option value="year">{pw.yearly}</option>
        </select>
      </label>
      <label htmlFor={`${id}-highlight`} className="flex flex-col gap-1 text-sm font-medium">
        {pw.recommend}
        <select
          id={`${id}-highlight`}
          value={plans.some((plan) => plan.id === block.highlightId) ? block.highlightId : ""}
          onChange={(event) => onChange({ highlightId: event.target.value || undefined })}
          className={input}
        >
          <option value="">{pw.noneChoice}</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
      <Check
        label={pw.comparison}
        hint={pw.comparisonHint}
        checked={block.comparison === true}
        onChange={(comparison) => onChange({ comparison: comparison ? true : undefined })}
      />
      <label htmlFor={`${id}-label`} className="flex flex-col gap-1 text-sm font-medium">
        {pw.buttonText}
        <input
          id={`${id}-label`}
          value={block.buttonLabel}
          maxLength={BUTTON_LABEL_MAX}
          placeholder={pw.buttonPlaceholder}
          onChange={(event) => onChange({ buttonLabel: event.target.value })}
          className={input}
        />
      </label>
      <label htmlFor={`${id}-href`} className="flex flex-col gap-1 text-sm font-medium">
        {pw.buttonAddress}
        <input
          id={`${id}-href`}
          value={block.buttonHref}
          placeholder="/sign-up"
          onChange={(event) => onChange({ buttonHref: event.target.value })}
          className={input}
        />
        <span className="text-xs font-normal text-muted">{pw.buttonAddressHint}</span>
      </label>
    </div>
  );
}

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
  const w = useAdminText("builder");
  const mw = w.menu;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        {mw.hintBefore}{" "}
        <a href={menusHref} target="_blank" rel="noopener" className="underline">
          {mw.menus}
        </a>
        {mw.hintAfter}
      </p>
      {menus.length === 0 ? (
        <p className="text-sm">
          {mw.none}{" "}
          <a href={menusHref} target="_blank" rel="noopener" className="underline">
            {mw.create}
          </a>
          .
        </p>
      ) : (
        <label htmlFor={`${id}-menu`} className="flex flex-col gap-1 text-sm font-medium">
          {w.blockNames.menu}
          <select
            id={`${id}-menu`}
            value={chosen ? chosen.id : ""}
            onChange={(event) => onChange({ menuId: event.target.value || undefined })}
            className="min-h-10 rounded-md border border-border bg-background px-3 font-normal"
          >
            <option value="">{mw.choose}</option>
            {menus.map((menu) => (
              <option key={menu.id} value={menu.id}>
                {menu.name} ({countWords(menu.items.length, mw.links)})
              </option>
            ))}
          </select>
        </label>
      )}
      {block.menuId && !chosen && <p className="text-sm text-red-700">{mw.gone}</p>}
      <Choices
        legend={mw.linksLegend}
        options={[
          { value: "row" as const, label: w.row.side },
          { value: "column" as const, label: w.row.stack },
        ]}
        value={block.direction ?? "row"}
        onChange={(direction) => onChange({ direction: direction === "row" ? undefined : direction })}
      />
      <p className="text-xs text-muted">{mw.phones}</p>
    </div>
  );
}

/** Under a stand-in on the canvas: the sizes it is left out at on the site (D179). */
function HiddenNote({ hideAt }: { hideAt: Size[] | undefined }) {
  const w = useAdminText("builder");
  if (!hideAt?.length) return null;
  return <span className="block text-[10px] text-muted">{fillWords(w.standIns.notAt, { sizes: hideAt.map((size) => w.sizes[size]).join(", ") })}</span>;
}

/** The store's search on the canvas: a box, and where its results go. */
function SearchStandIn({ block }: { block: SearchBlock }) {
  const sw = useAdminText("builder").standIns;
  const shop = useAdminText("builder").shopStandIns;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-11 items-center rounded-md border border-border bg-background px-3 text-sm text-muted">{shop.searchStore}</div>
      <p className="text-xs text-muted">{block.results === false ? sw.searchBox : sw.searchResults}</p>
    </div>
  );
}

/** Endings written as the field wants them, the same in every language. */
const TLD_EXAMPLE = "com, shop, store";

/** The domain search component's settings (D315): its words, the endings it suggests first, the prices' currency and the free names' button. */
function DomainSearchFields({ block, onChange }: { block: DomainSearchBlock; onChange: (patch: BlockPatch<DomainSearchBlock>) => void }) {
  const id = useId();
  const input = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
  const dw = useAdminText("builder").domainSearch;
  const field = (key: "heading" | "placeholder" | "buttonLabel" | "ctaLabel" | "ctaHref", label: string, placeholder: string, max: number, hint?: string) => (
    <label htmlFor={`${id}-${key}`} className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        id={`${id}-${key}`}
        value={block[key] ?? ""}
        maxLength={max}
        placeholder={placeholder}
        onChange={(event) => onChange(key === "heading" || key === "placeholder" ? { [key]: event.target.value || undefined } : { [key]: event.target.value })}
        className={input}
      />
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{dw.hint}</p>
      {field("heading", dw.heading, dw.headingPlaceholder, 160)}
      {field("placeholder", dw.placeholder, dw.placeholderHint, 80)}
      {field("buttonLabel", dw.button, "", BUTTON_LABEL_MAX)}
      <label htmlFor={`${id}-tlds`} className="flex flex-col gap-1 text-sm font-medium">
        {dw.tlds}
        <input
          id={`${id}-tlds`}
          defaultValue={(block.tlds ?? []).join(", ")}
          placeholder={TLD_EXAMPLE}
          onBlur={(event) => {
            const tlds = event.target.value
              .split(",")
              .map((t) => t.trim().toLowerCase().replace(/^\./, ""))
              .filter((t) => /^[a-z][a-z0-9-]{1,62}(\.[a-z][a-z0-9-]{1,62})?$/.test(t))
              .slice(0, 8);
            onChange({ tlds: tlds.length > 0 ? tlds : undefined });
          }}
          className={input}
        />
        <span className="text-xs font-normal text-muted">{dw.tldsHint}</span>
      </label>
      <label htmlFor={`${id}-currency`} className="flex flex-col gap-1 text-sm font-medium">
        {dw.currency}
        <select id={`${id}-currency`} value={block.currency ?? ""} onChange={(event) => onChange({ currency: event.target.value || undefined })} className={input}>
          <option value="">{dw.currencyAuto}</option>
          {["EUR", "NOK", "SEK", "DKK"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {field("ctaLabel", dw.cta, dw.ctaPlaceholder, BUTTON_LABEL_MAX)}
      {field("ctaHref", dw.ctaAddress, "/sign-up", 500, dw.ctaAddressHint)}
    </div>
  );
}

/** The domain search on the canvas (D315): what it is set to show, as the canvas asks no registrar. */
function DomainSearchStandIn({ block }: { block: DomainSearchBlock }) {
  const dw = useAdminText("builder").domainSearch;
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-4 text-sm">
      {block.heading && <p className="font-medium">{block.heading}</p>}
      <div className="mt-2 flex gap-2">
        <span className="flex-1 rounded-md border border-border px-3 py-2 text-muted">{block.placeholder || dw.placeholderHint}</span>
        <span className="rounded-md bg-foreground/75 px-3 py-2 text-background">{block.buttonLabel || "…"}</span>
      </div>
      <p className="mt-2 text-xs text-muted">{fillWords(dw.standIn, { currency: block.currency ? fillWords(dw.inCurrency, { currency: block.currency }) : "" })}</p>
    </div>
  );
}

/** Kaizen's plans on the canvas (D142): what the component is set to show, as the canvas reads no plans. */
function PlansStandIn({ block }: { block: PlansBlock }) {
  const pw = useAdminText("builder").plans;
  const parts = [
    block.currency ? fillWords(pw.pricesIn, { currency: block.currency }) : pw.mainCurrency,
    block.interval === "month" ? pw.monthlyPrices : block.interval === "year" ? pw.yearlyPrices : pw.bothPrices,
    block.comparison ? pw.withComparison : pw.withoutComparison,
  ];
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-4 text-sm">
      <p className="font-medium">{pw.title}</p>
      <p className="text-xs text-muted">{fillWords(pw.cards, { parts: parts.join(", ") })}</p>
    </div>
  );
}

/** A page's custom fields on the canvas (D118): which, as the canvas has no values. */
function CustomFieldStandIn({ block }: { block: CustomFieldBlock }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-4">
      <FieldsStandIn value={block} entities={["page", "article"]} mode="either" />
    </div>
  );
}

/** A page's field loop on the canvas (D120): which repeater and how, as the canvas has no rows. */
function FieldLoopStandIn({ block }: { block: FieldLoopBlock }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-4">
      <LoopStandIn value={block} entities={["page", "article"]} />
    </div>
  );
}

function LoopIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="8" height="7" rx="1.5" />
        <rect x="13" y="4" width="8" height="7" rx="1.5" />
        <rect x="3" y="14" width="8" height="6" rx="1.5" />
        <rect x="13" y="14" width="8" height="6" rx="1.5" />
      </svg>
    </span>
  );
}

function FieldsIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M4 10h16M10 10v9" />
      </svg>
    </span>
  );
}

/** A part of a store feature that is off (D178), on the canvas: the site draws nothing for it until the feature is switched on again. */
function SwitchedOffStandIn({ block }: { block: PageBlock }) {
  const feature = partFeature(block);
  const w = useAdminText("builder");
  const sw = w.standIns;
  const name =
    block.type === "storePart" ? shopPartCopy(block.part).name : block.type === "site" ? w.siteParts[block.part] : block.type === "product" ? w.productParts[block.part] : sw.thisPart;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed border-border bg-surface p-4">
      <p className="text-sm font-medium">{fillWords(sw.switchedOff, { name })}</p>
      <p className="text-xs text-muted">
        {feature ? fillWords(sw.featureOff, { feature: requirementLabel(feature) }) : sw.leftOut} {sw.comesBack}
      </p>
    </div>
  );
}

/** A working page's component on the canvas (D113): what it is, and that the site draws it with the shopper's own data. */
function StorePartStandIn({ block }: { block: StorePartBlock }) {
  const copy = shopPartCopy(block.part);
  const sw = useAdminText("builder").standIns;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed border-border bg-surface p-4">
      <p className="text-sm font-medium">{copy.name}</p>
      <p className="text-xs text-muted">{copy.hint} {sw.shopPart}</p>
    </div>
  );
}

/** A menu component on the canvas: its links' texts as the site shows them; links under a link side by side are shown in a list under it on the site. */
function MenuStandIn({ block, menus }: { block: MenuBlock; menus: MenuPreview[] }) {
  const menu = menus.find((m) => m.id === block.menuId);
  const column = block.direction === "column";
  const mw = useAdminText("builder").menu;
  if (!menu) return <p className="rounded-md bg-surface p-3 text-sm text-muted">{mw.gone}</p>;
  if (menu.items.length === 0) return <p className="rounded-md bg-surface p-3 text-sm text-muted">{fillWords(mw.noLinks, { name: menu.name })}</p>;
  // Side by side, only the top links show on the line; a mark says a link has links under it.
  const shown = column ? menu.items : menu.items.filter((item) => item.depth === 0);
  const hasUnder = (index: number) => menu.items[menu.items.indexOf(shown[index]) + 1]?.depth > shown[index].depth;
  const effect = menuHoverStyle(block.itemHover);
  const list = (
    <ul className={`flex gap-x-4 gap-y-1 text-sm ${column ? "flex-col" : "flex-wrap items-center"}`}>
      {shown.map((item, index) => (
        <li key={index} style={column ? { paddingLeft: `${item.depth}rem` } : undefined} className={`flex min-h-9 items-center gap-1 font-medium ${effect ? "kz-mi" : ""}`}>
          {effect ? (
            // As on the site, so the effect can be tried here; the first link stands for the page shown.
            <a href="#" onClick={(event) => event.preventDefault()} data-active={index === 0 ? "" : undefined} className="flex min-h-9 items-center gap-1 px-2">
              {item.text}
              {!column && hasUnder(index) && <span aria-label={mw.under}>▾</span>}
            </a>
          ) : (
            <>
              {item.text}
              {!column && hasUnder(index) && <span aria-label={mw.under}>▾</span>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <div>
      {effect ? (
        <div className="kz-menu relative" {...effect.attrs} {...(column && { "data-mh-col": "" })} style={effect.style as CSSProperties}>
          <MenuGlide slide={block.itemHover?.travel === "slide"} preview />
          {list}
        </div>
      ) : (
        list
      )}
      <HiddenNote hideAt={block.visibility?.hideAt} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site components (D80)
// ---------------------------------------------------------------------------


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
  const w = useAdminText("builder");
  const sw = w.site;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{sw.help[block.part]} {sw.leftOut}</p>
      {block.part === "logo" && (
        <NumberField
          label={w.row.height}
          hint={fillWords(sw.logoHeight, { min: LOGO_HEIGHT.min, max: LOGO_HEIGHT.max })}
          value={block.height ?? 0}
          max={LOGO_HEIGHT.max}
          onChange={(height) => onChange({ height: height >= LOGO_HEIGHT.min ? height : undefined })}
        />
      )}
      {block.part === "markets" && (
        <Choices
          legend={sw.shownAs}
          options={[
            { value: "dropdown" as const, label: sw.dropdown },
            { value: "list" as const, label: w.menu.linksLegend },
          ]}
          value={block.display ?? "dropdown"}
          onChange={(display) => onChange({ display: display === "dropdown" ? undefined : display, direction: undefined })}
        />
      )}
      {lined && (
        <Choices
          legend={w.menu.linksLegend}
          options={[
            { value: "row" as const, label: w.row.side },
            { value: "column" as const, label: w.row.stack },
          ]}
          value={block.direction ?? "row"}
          onChange={(direction) => onChange({ direction: direction === "row" ? undefined : direction })}
        />
      )}
      {/* The withdrawal link is for every visitor (D153): it cannot be hidden at any size (Advanced, Visibility). */}
      {block.part !== "menuButton" && block.part !== "withdrawal" && (
        <p className="text-xs text-muted">{sw.phones}</p>
      )}
    </div>
  );
}

/**
 * How a site component looks on the canvas (D80): a sketch of its part; the
 * preview draws it with the site's own logo, menus and details.
 */
function SiteStandIn({ block }: { block: SiteBlock }) {
  const shop = useAdminText("builder").shopStandIns;
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
  const phones = <HiddenNote hideAt={block.visibility?.hideAt} />;
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
            {icon("M4 7h16M4 12h16M4 17h16")} {shop.phonesOnly}
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
        return <span className="rounded-full border border-border px-3 py-1 text-xs">{shop.buyer}</span>;
      case "colorMode":
        return icon("M12 3a6 6 0 009 9 9 9 0 11-9-9z");
      case "signUp":
        return <span className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">{shop.startStore}</span>;
      case "business":
        return (
          <span className="flex flex-col gap-1 text-sm text-muted">
            <span>{shop.business}</span>
            <span>{shop.street}</span>
            <span className="underline">hello@example.com</span>
          </span>
        );
      case "cookies":
        return <span className="text-sm text-muted underline">{shop.cookies}</span>;
      case "withdrawal":
        return <span className="text-sm text-muted underline">{shop.withdraw}</span>;
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
/** The parts with a heading of their own (their usual words are the shopper's language's, `productPart.headings`). */
const PART_HEADINGS: Partial<Record<ProductPart, true>> = { description: true, safety: true, related: true, reviews: true };

/** A product part's name in the account's language (a stand-in's corner label). */
function ProductPartName({ part }: { part: ProductPart }) {
  return useAdminText("builder").productParts[part];
}

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
  const w = useAdminText("builder");
  const pw = w.productPart;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        {pw.help[block.part]} {pw.forProduct}
      </p>
      {block.part === "title" && (
        <>
          <Check label={pw.heart} hint={pw.heartHint} checked={block.wishlist !== false} onChange={(on) => onChange({ wishlist: on ? undefined : false })} />
          <p className="text-xs text-muted">{pw.titleStyle}</p>
        </>
      )}
      {block.part === "price" && (
        <Check label={pw.large} hint={pw.largeHint} checked={block.large !== false} onChange={(on) => onChange({ large: on ? undefined : false })} />
      )}
      {block.part === "gallery" && (
        <Check label={pw.thumbnails} hint={pw.thumbnailsHint} checked={block.thumbnails !== false} onChange={(on) => onChange({ thumbnails: on ? undefined : false })} />
      )}
      {block.part === "buy" && (
        <NumberField
          label={pw.optionsFrom}
          hint={pw.optionsFromHint}
          value={block.optionsFrom ?? OPTIONS_FROM}
          min={2}
          max={2048}
          onChange={(n) => onChange({ optionsFrom: n === OPTIONS_FROM ? undefined : Math.min(2048, Math.max(2, n)) })}
        />
      )}
      {headed && (
        <>
          <Check label={w.heading.heading} checked={block.showHeading !== false} onChange={(on) => onChange({ showHeading: on ? undefined : false })} />
          {block.showHeading !== false && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {pw.headingText}
              <input
                value={block.heading ?? ""}
                maxLength={HEADING_MAX}
                onChange={(event) => onChange({ heading: event.target.value || undefined })}
                placeholder={fillWords(pw.headingPlaceholder, { heading: pw.headings[block.part as keyof typeof pw.headings] })}
                className={field}
              />
              <span className="font-normal text-xs text-muted">{pw.headingEmpty}</span>
            </label>
          )}
        </>
      )}
      {(block.part === "fields" || block.part === "field") && (
        <FieldsSettingsFields value={block} entities={["product"]} mode={block.part === "field" ? "field" : "group"} onChange={onChange} />
      )}
      {block.part === "loop" && (
        <LoopSettingsFields
          value={productLoopConfig(block)}
          entities={["product"]}
          onChange={(patch) => onChange(productLoopPatch(block, patch))}
        />
      )}
      {block.part === "related" && (
        <>
          <NumberField
            label={w.grid.howMany}
            hint={fillWords(pw.relatedHint, { max: RELATED_MAX })}
            value={block.limit ?? 4}
            max={RELATED_MAX}
            onChange={(limit) => onChange({ limit: Math.max(1, limit) })}
          />
          <ColumnsFields part={block} fallback={(size) => (size === "sm" ? 2 : 4)} onChange={onChange} />
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
  const shop = useAdminText("builder").shopStandIns;
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
        return <span className="text-sm underline">{shop.back}</span>;
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
            <span data-kz-stand-in="title" className="font-heading text-3xl tracking-tight">
              {shop.productName}
            </span>
            {block.wishlist !== false && <span className="size-11 shrink-0 rounded-full border border-border" />}
          </span>
        );
      case "price":
        return (
          <span>
            <span className={block.large !== false ? "text-2xl font-semibold" : "font-semibold"}>499,00</span>{" "}
            <span className="text-sm text-muted">{shop.inclVat}</span>
          </span>
        );
      case "campaigns":
        return (
          <span className="block rounded-lg bg-accent p-3 text-sm text-accent-foreground">
            <span className="block font-medium">{shop.sale}</span>
            <span className="block opacity-90">The offer is taken off in the cart. (Shown while a campaign reaches the product.)</span>
          </span>
        );
      case "rating":
        return <span className="block text-sm">★★★★☆ 4.3 out of 5 (12 reviews). (Shown once the product has a published review.)</span>;
      case "reviews":
        return (
          <span className="block rounded-lg border border-border p-4 text-sm">
            <span className="block font-medium">{shop.reviews}</span>
            <span className="block">{shop.review}</span>
            <span className="block opacity-80">The product&apos;s published reviews, newest first. (Shown once there is one.)</span>
          </span>
        );
      case "notice":
        return <span className="block rounded-lg border border-border p-4 text-sm">Sold only to businesses. (Shown to private shoppers for such products.)</span>;
      case "host":
        return <span className="text-sm">Hosted by … (for outside hosts&apos; stays and rentals)</span>;
      case "buy":
        return (
          <span className="flex flex-col gap-2">
            <span className="font-medium">{shop.variants}</span>
            <span className="divide-y divide-border rounded-lg border border-border">
              {["Variant one", "Variant two"].map((name) => (
                <span key={name} className="flex items-center justify-between gap-4 p-3 text-sm">
                  <span>
                    {name}
                    <span className="block text-muted">{shop.inStock}</span>
                  </span>
                  <span className="button-primary rounded-button px-4 py-2 text-sm">{shop.addToCart}</span>
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
      case "fields":
      case "field":
        return <FieldsStandIn value={block} entities={["product"]} mode={block.part === "field" ? "field" : "group"} />;
      case "loop":
        return <LoopStandIn value={productLoopConfig(block)} entities={["product"]} />;
      case "related": {
        const columns = block.columns ?? 4;
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
        <ProductPartName part={block.part} />
      </span>
      {body}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The Theme tab (D182)
// ---------------------------------------------------------------------------

/** The content widths a theme chooses between, in pixels (`theme.ts`' Narrow, Normal and Wide in rem). */
const PRESET_WIDTHS = { narrow: 896, normal: 1024, wide: 1280 } as const;

const withElement = (value: ThemeTabValue, key: ThemeElementKey, element: ThemeTabValue["elements"][ThemeElementKey], scope = SITE_SCOPE): ThemeTabValue => {
  const elements = { ...(scope === SITE_SCOPE ? value.elements : (value.sections?.[scope] ?? {})) };
  if (element) elements[key] = element;
  else delete elements[key];
  if (scope === SITE_SCOPE) return { ...value, elements };
  // A section style's elements (D242): one that says nothing is left out.
  const sections = { ...(value.sections ?? {}) };
  if (Object.keys(elements).length > 0) sections[scope] = elements;
  else delete sections[scope];
  return { ...value, sections };
};

/** The Theme tab's elements are the whole site's unless a section style is chosen (D242). */
const SITE_SCOPE = "";

/**
 * The theme's settings for a store's rows, headings, paragraphs, lists and buttons, and its content width and body
 * background, in the page builder's sidebar beside the building blocks. What is set here is the store's look for all of
 * its pages (a part's own setting wins where it sets one); it is drawn on the canvas at once and kept with Save.
 */
function ThemePanel({
  value,
  saved,
  settings,
  onChange,
  onSave,
  install,
}: {
  value: ThemeTabValue;
  saved: ThemeTabValue;
  settings: ThemeSettings;
  onChange: (value: ThemeTabValue) => void;
  /** Saves it; the problems that stopped it, or null once saved. */
  onSave: () => Promise<string[] | null>;
  install: InstallFont;
}) {
  const { size } = useSizeEdit();
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const preset = PRESET_WIDTHS[settings.layout.width];
  const showLight = settings.mode !== "dark" || settings.visitorSwitch;
  const showDark = settings.mode !== "light" || settings.visitorSwitch;

  const [scope, setScope] = useState(SITE_SCOPE);
  const [newStyle, setNewStyle] = useState("");
  const w = useAdminText("builder");
  const tw = w.theme;
  const styleName = useStyleName();
  const styles = sectionStyleChoices(value.sections);
  const scoped = scope === SITE_SCOPE ? value.elements : (value.sections?.[scope] ?? {});
  const save = async () => {
    const checked = themeElementsSchema.safeParse(value.elements);
    const sections = sectionStylesSchema.safeParse(value.sections ?? {});
    if (!checked.success || !sections.success) {
      setProblems([...new Set([...(checked.error?.issues ?? []), ...(sections.error?.issues ?? [])].map((issue) => issue.message))]);
      setDone(false);
      return;
    }
    setBusy(true);
    setProblems([]);
    setDone(false);
    try {
      const failed = await onSave();
      if (failed) setProblems(failed);
      else setDone(true);
    } catch {
      setProblems([tw.couldNotSave]);
    } finally {
      setBusy(false);
    }
  };
  const change = (next: ThemeTabValue) => {
    setDone(false);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4" data-theme-panel="">
      <p className="text-xs text-muted">{tw.intro}</p>
      <div className="flex items-center gap-1 text-sm">
        <SizeSwitch label={w.sidebar.theme} />
        <span className="text-muted">{fillWords(tw.editedAt, { size: w.sizes[size] })}</span>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">{tw.page}</legend>
        <ContentWidthField value={value.maxWidth} presetWidth={preset} onChange={(maxWidth) => change({ ...value, maxWidth })} />
        {showLight && (
          <ColorField
            label={settings.mode === "light" || !showDark ? tw.body : tw.bodyLight}
            value={value.background.light}
            onChange={(light) => change({ ...value, background: { ...value.background, light } })}
          />
        )}
        {showDark && (
          <ColorField
            label={showLight ? tw.bodyDark : tw.body}
            value={value.background.dark}
            onChange={(dark) => change({ ...value, background: { ...value.background, dark } })}
          />
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-md border border-border p-3" data-theme-hover="">
        <legend className="px-1 text-sm font-medium">{tw.hover}</legend>
        <HoverTimingFields
          value={value.hover}
          inherited={fillWords(tw.hoverInherited, { ms: HOVER_DURATION_DEFAULT })}
          onChange={(timing) => change({ ...value, hover: { ...(value.hover?.button && { button: value.hover.button }), ...timing } })}
        />
        <ButtonHoverField
          value={value.hover?.button}
          emptyLabel={tw.fade}
          onChange={(button) => change({ ...value, hover: { ...value.hover, button } })}
        />
        <p className="text-xs text-muted">{tw.hoverHint}</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3" data-theme-scope="">
        <legend className="px-1 text-sm font-medium">{tw.elementsFor}</legend>
        <select
          aria-label={tw.elementsFor}
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          className="min-h-10 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value={SITE_SCOPE}>{tw.wholeSite}</option>
          {styles.map((name) => (
            <option key={name} value={name}>
              {fillWords(tw.sectionStyle, { name: styleName(name) })}
              {value.sections?.[name] ? ` ${tw.set}` : ""}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">
          {scope === SITE_SCOPE
            ? tw.siteScope
            : `${isCoreSectionStyle(scope) ? tw.coreHints[scope] : tw.ownStyle} ${tw.styleScope}`}
        </p>
        {scope === SITE_SCOPE && styles.length < SECTION_STYLES_MAX && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              {tw.newStyle}
              <input
                value={newStyle}
                onChange={(event) => setNewStyle(event.target.value.toLowerCase())}
                placeholder="banner"
                className="min-h-9 w-36 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={!SECTION_STYLE_NAME.test(newStyle) || styles.includes(newStyle)}
              onClick={() => {
                setScope(newStyle);
                setNewStyle("");
              }}
              className="min-h-9 rounded-md border border-border px-3 text-sm disabled:opacity-50"
            >
              {tw.addStyle}
            </button>
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        {THEME_ELEMENT_KEYS.map((key) => (
          <ThemeElementSection
            key={`${scope}:${key}`}
            elementKey={key}
            element={scoped[key]}
            onChange={(element) => change(withElement(value, key, element, scope))}
            install={install}
          />
        ))}
      </div>

      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t border-border bg-background px-4 py-3">
        {problems.length > 0 && (
          <ul role="alert" className="list-disc pl-5 text-sm text-red-700 dark:text-red-400">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            aria-busy={busy}
            className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          >
            {busy ? w.savedPart.saving : tw.save}
          </button>
          <button
            type="button"
            onClick={() => change(structuredClone(saved))}
            disabled={busy || !dirty}
            className="min-h-10 rounded-md border border-border px-4 text-sm disabled:opacity-50"
          >
            {tw.undo}
          </button>
          <span role="status" className="text-sm text-muted">
            {dirty ? tw.notSaved : done ? tw.saved : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The content's largest width in pixels, for every row that sets none of its own; empty is the theme's Narrow, Normal or Wide. */
function ContentWidthField({ value, presetWidth, onChange }: { value: number | null; presetWidth: number; onChange: (value: number | null) => void }) {
  const id = useId();
  const [text, setText] = useState(value === null ? "" : String(value));
  const invalid = text !== "" && !(Number(text) >= CONTENT_MAX_MIN && Number(text) <= CONTENT_MAX_MAX);
  const w = useAdminText("builder");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {w.row.maxWidth} <span className="font-normal text-muted">({fillWords(w.row.pixelsRange, { min: CONTENT_MAX_MIN, max: CONTENT_MAX_MAX })})</span>
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={CONTENT_MAX_MIN}
        max={CONTENT_MAX_MAX}
        placeholder={String(presetWidth)}
        value={text}
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const number = Math.round(Number(next));
          if (next === "") onChange(null);
          else if (number >= CONTENT_MAX_MIN && number <= CONTENT_MAX_MAX) onChange(number);
        }}
        className="min-h-10 w-32 rounded-md border border-border bg-background px-2 text-sm"
      />
      <PixelRange
        value={value ?? presetWidth}
        min={CONTENT_MAX_MIN}
        max={CONTENT_MAX_MAX}
        step={8}
        label={fillWords(w.row.slider, { what: w.row.maxWidth })}
        onChange={(next) => {
          setText(String(next));
          onChange(next);
        }}
        className="max-w-64"
      />
      <p id={`${id}-hint`} className="text-xs text-muted">
        {fillWords(w.theme.widthHint, { n: presetWidth })}
      </p>
    </div>
  );
}

/** One element of the theme (a row, a heading level, paragraphs, lists or buttons) in a folding section; its fields are made when it is opened. */
function ThemeElementSection({
  elementKey,
  element,
  onChange,
  install,
}: {
  elementKey: ThemeElementKey;
  element: ThemeTabValue["elements"][ThemeElementKey];
  onChange: (element: ThemeTabValue["elements"][ThemeElementKey]) => void;
  install: InstallFont;
}) {
  const [open, setOpen] = useState(false);
  const w = useAdminText("builder");
  const { name, hint } = w.elements[elementKey];
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-md border border-border" data-theme-element={elementKey}>
      <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-medium">
        {name}
        {element && <span className="rounded bg-surface px-1.5 py-0.5 text-xs font-normal text-muted">{w.theme.setMark}</span>}
      </summary>
      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-3">
          <p className="text-xs text-muted">{hint}</p>
          <ThemeElementFields elementKey={elementKey} element={element} onChange={onChange} install={install} />
          {element && (
            <button type="button" onClick={() => onChange(undefined)} className="min-h-9 self-start rounded-md border border-border px-3 text-sm">
              {fillWords(w.theme.clear, { name })}
            </button>
          )}
        </div>
      )}
    </details>
  );
}

/**
 * An element's fields: the same Typography, spacing, border, corners and shadow as the part it stands for has (a heading's, a
 * row's), each at the screen size being edited, and a row's colour. The element is edited as a part of that kind.
 */
function ThemeElementFields({
  elementKey,
  element,
  onChange,
  install,
}: {
  elementKey: ThemeElementKey;
  element: ThemeTabValue["elements"][ThemeElementKey];
  onChange: (element: ThemeTabValue["elements"][ThemeElementKey]) => void;
  install: InstallFont;
}) {
  const { size } = useSizeEdit();
  const part = elementAsPart(elementKey, element);
  const asPart = part as unknown as PartBase;
  const patch = (changes: Partial<PartBase>) => onChange(elementFromPart({ ...part, ...changes }));
  const sizedPatch = (changes: Partial<PartBase>) => patch(setAt(asPart, size, changes));
  const row = elementKey === "row";
  const heading = elementKey.startsWith("h") && elementKey.length === 2;
  const background = element?.background;
  const w = useAdminText("builder");
  return (
    <>
      {row && (
        <div className="flex flex-col gap-4">
          <RowWidthChoices
            width={element?.width ?? "content"}
            contentWidth={element?.contentWidth ?? "content"}
            // The theme says only what differs from the default: a row that keeps to the content's width needs nothing said.
            onWidth={(next) => patch({ width: next === "full" ? "full" : undefined, ...(next === "content" && { contentWidth: undefined }) } as Partial<PartBase>)}
            onContentWidth={(next) => patch({ contentWidth: next === "full" ? "full" : undefined } as Partial<PartBase>)}
          />
          <p className="text-xs text-muted">{w.theme.rowWidths}</p>
        </div>
      )}
      <TypographyFields
        part={part}
        familyDefault={heading ? w.dialogs.fonts.heading : w.dialogs.fonts.body}
        install={install}
        onChange={(changes) => patch(changes as Partial<PartBase>)}
      />
      <SpacingFields
        value={spacingAt(asPart, size)}
        defaults={row ? { padding: ROW_PADDING } : undefined}
        sized={{ part: asPart, onPatch: patch }}
        onChange={(style) => {
          const own = style.margin || style.padding ? style : undefined;
          if (size === "xl") patch({ style: own });
          else sizedPatch({ style });
        }}
      />
      <FrameFields value={viewAt(asPart, size)} sized={{ part: asPart, onPatch: patch }} onChange={sizedPatch} />
      {row &&
        (size === "xl" ? (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <ColorField
              label={w.background.colour}
              value={background?.color}
              placeholder={w.background.kinds.none}
              onChange={(color) => patch({ background: { type: "color", color, ...(background?.opacity !== undefined && { opacity: background.opacity }) } } as Partial<PartBase>)}
              onClear={() => patch({ background: undefined } as Partial<PartBase>)}
              opacity={
                background
                  ? { value: background.opacity, onChange: (opacity) => patch({ background: { ...background, opacity } } as Partial<PartBase>) }
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="border-t border-border pt-4">
            <BackgroundAtSize key={size} part={asPart as unknown as PageRow} size={size} onChange={sizedPatch} onPatch={patch} />
          </div>
        ))}
    </>
  );
}
