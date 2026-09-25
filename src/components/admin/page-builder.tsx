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
import { useId, useState, useTransition, type CSSProperties, type PointerEventHandler, type ReactNode } from "react";

import {
  createSavedPartAction,
  deleteSavedPartAction,
  updateSavedPartAction,
} from "@/app/admin/(gated)/platform/pages/actions";

import { hasContent, RichText } from "@/components/rich-text";
import {
  BLOCKS_MAX,
  ROW_LAYOUTS,
  ROW_LAYOUT_KEYS,
  ROWS_MAX,
  pageBlocks,
  richTextPlain,
  type BlockType,
  type PageBlock,
  type PageColumn,
  type PageRow,
  type RowLayout,
} from "@/lib/page-content";
import {
  copyBlock,
  copyColumn,
  copyRow,
  duplicateBlock,
  duplicateColumn,
  duplicateRow,
  findBlock,
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
  updateBlock,
} from "@/lib/page-rows";

import { SAVED_KIND_LABELS, SAVED_NAME_MAX, type SavedPart, type SavedPartKind } from "@/lib/saved-parts";

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
  | { kind: "palette-block"; type: BlockType }
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

const blockLabels: Record<BlockType, string> = { richText: "Rich text" };

const rowHasText = (row: PageRow) => row.columns.some(columnHasText);
const columnHasText = (column: PageColumn) => column.blocks.some(blockHasText);
const blockHasText = (block: PageBlock) => richTextPlain(block.doc).trim() !== "";

/** What a dialog is open for. */
type Dialog =
  | { kind: "edit-block"; blockId: string }
  | { kind: "edit-row"; rowId: string; columnId: string | null }
  | { kind: "delete"; what: string; run: () => void }
  | { kind: "save-as"; part: SavedPartDraft; back: Dialog | null }
  | { kind: "edit-saved"; partId: string };

/** A row, column or component about to be saved, or being changed. */
type SavedPartDraft = Pick<SavedPart, "kind" | "content">;

/** What the canvas can ask of the builder. */
type Actions = {
  onRows: Rows;
  open: (dialog: Dialog) => void;
  onAddBlock: (type: BlockType, columnId: string) => void;
  onColumn: (columnId: string) => void;
  blocksFull: boolean;
};

export function PageBuilder({
  rows,
  onRows,
  saved,
  aside,
}: {
  rows: PageRow[];
  onRows: Rows;
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
  const [tab, setTab] = useState<Tab>("components");
  const blockCount = pageBlocks({ rows }).length;
  const blocksFull = blockCount >= BLOCKS_MAX;
  const rowsFull = rows.length >= ROWS_MAX;

  const addRow = (layout: RowLayout, index = rows.length) => {
    if (!rowsFull) onRows((current) => insertRow(current, newRow(layout, newId), index));
  };
  const addBlock = (type: BlockType, columnId: string | null, index = Number.MAX_SAFE_INTEGER) => {
    if (blocksFull) return;
    const block = newBlock(type, newId);
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
    part: SavedPart,
    place: { index?: number; rowId?: string; columnIndex?: number; columnId?: string | null; blockIndex?: number } = {},
  ) => {
    if (part.kind === "row") {
      if (!rowsFull) onRows((current) => insertRow(current, copyRow(part.content, newId), place.index ?? current.length));
    } else if (part.kind === "column") {
      const column = copyColumn(part.content, newId);
      onRows((current) => {
        if (place.rowId) return insertColumn(current, place.rowId, column, place.columnIndex ?? Number.MAX_SAFE_INTEGER);
        return insertRow(current, { id: newId(), type: "row", layout: "1", columns: [column] }, current.length);
      });
    } else if (!blocksFull) {
      const block = copyBlock(part.content, newId);
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
      const part = parts.find((p) => p.id === from.partId);
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
      addBlock(from.type, columnId, place ? place.index + (after ? 1 : 0) : Number.MAX_SAFE_INTEGER);
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
        <Sidebar
          tab={tab}
          onTab={setTab}
          onAddRow={(layout) => addRow(layout)}
          onAddBlock={(type) => addBlock(type, lastColumn)}
          parts={parts}
          onOpenSaved={(partId) => setDialog({ kind: "edit-saved", partId })}
          rowsFull={rowsFull}
          blocksFull={blocksFull}
        />

        <Canvas rows={rows} dragging={dragging} target={target} actions={actions} />

        {/* On phones the title and settings come first. */}
        <div className="order-first flex min-w-0 flex-col gap-6 lg:order-none">{aside}</div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging?.kind === "palette-row" ? (
          <Tile label={ROW_LAYOUTS[dragging.layout].label} preview={<LayoutPreview layout={dragging.layout} />} lifted />
        ) : dragging?.kind === "palette-block" ? (
          <Tile label={blockLabels[dragging.type]} preview={<TextIcon />} lifted />
        ) : dragging?.kind === "block" ? (
          <BlockPreview block={findBlock(rows, dragging.blockId)?.block ?? null} />
        ) : dragging?.kind === "saved" ? (
          <SavedTile part={parts.find((p) => p.id === dragging.partId) ?? null} lifted />
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
  parts,
  onOpenSaved,
  rowsFull,
  blocksFull,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  onAddRow: (layout: RowLayout) => void;
  onAddBlock: (type: BlockType) => void;
  parts: SavedPart[];
  onOpenSaved: (partId: string) => void;
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
              <div className="grid grid-cols-2 gap-3">
                <PaletteTile
                  id="palette:block:richText"
                  data={{ kind: "palette-block", type: "richText" }}
                  label={blockLabels.richText}
                  preview={<TextIcon />}
                  onAdd={() => onAddBlock("richText")}
                  disabled={blocksFull}
                />
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
          {t.key === "saved" && <SavedList parts={parts} onOpen={onOpenSaved} />}
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
        <span key={index} style={{ flexGrow: width }} className="basis-0 rounded-sm bg-foreground/75" />
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

/** A saved part: the pointer drags it onto the page; pressing it (mouse or keyboard) opens it. */
function SavedItem({ part, onOpen }: { part: SavedPart; onOpen: () => void }) {
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
      aria-label={`${part.name}, saved ${SAVED_KIND_LABELS[part.kind].one.toLowerCase()}: open to change or add`}
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
          <TextIcon />
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
  const text = richTextPlain(block.doc).replace(/\s+/g, " ").trim();
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
  const text = column.blocks.map((b) => richTextPlain(b.doc)).join(" ").replace(/\s+/g, " ").trim();
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

function TextIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 font-serif text-lg text-background">
      T
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
  /** The drag handle, made where `useSortable` is (see `handleClass`). */
  handle: ReactNode;
  onEdit: () => void;
  editLabel: string;
  onDuplicate: () => void;
  duplicateDisabled?: boolean;
  onDelete: () => void;
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
  });
  const widths = ROW_LAYOUTS[row.layout].widths;
  const remove = () => actions.onRows((rows) => removeRow(rows, row.id));

  return (
    <li
      ref={setNodeRef}
      data-builder-item="row"
      tabIndex={0}
      aria-label={`${name}, ${ROW_LAYOUTS[row.layout].label.toLowerCase()}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`-m-4 p-4 ${isDragging ? "z-30 bg-background opacity-80 shadow-xl" : ""}`}
    >
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
      <Line at={line} />
      <SortableContext items={row.columns.map((c) => `column:${c.id}`)} strategy={horizontalListSortingStrategy}>
        <div
          style={{ "--columns": widths.map((w) => `minmax(0, ${w}fr)`).join(" ") } as CSSProperties}
          className="grid gap-8 md:[grid-template-columns:var(--columns)]"
        >
          {row.columns.map((column, index) => (
            <ColumnItem
              key={column.id}
              column={column}
              rowId={row.id}
              name={`${name}, column ${index + 1}`}
              count={row.columns.length}
              dragging={dragging}
              target={target}
              actions={actions}
            />
          ))}
        </div>
      </SortableContext>
    </li>
  );
}

function ColumnItem({
  column,
  rowId,
  name,
  count,
  dragging,
  target,
  actions,
}: {
  column: PageColumn;
  rowId: string;
  name: string;
  count: number;
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  actions: Actions;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: `column:${column.id}`,
    data: { kind: "column", columnId: column.id, rowId } satisfies DragData,
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
      <Line at={columnLine} vertical />
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
      {column.blocks.length === 0 && (
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
        onDelete={() => (blockHasText(block) ? actions.open({ kind: "delete", what: "this text", run: remove }) : remove())}
      />
      <Line at={line} />
      {hasContent(block.doc) ? (
        <RichText doc={block.doc} />
      ) : (
        <p className="rounded-md bg-surface p-3 text-sm text-muted">Empty text. Double-click or use the wrench to write.</p>
      )}
    </div>
  );
}

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
}: {
  dialog: Dialog | null;
  rows: PageRow[];
  onRows: Rows;
  open: (dialog: Dialog) => void;
  onClose: () => void;
  parts: SavedPart[];
  /** New saved parts from the server; `savedId` when one was just saved. */
  onParts: (parts: SavedPart[], savedId?: string) => void;
  onUse: (part: SavedPart) => void;
}) {
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
  const row = dialog?.kind === "edit-row" ? rows.find((r) => r.id === dialog.rowId) : null;
  const column = dialog?.kind === "edit-row" && dialog.columnId ? row?.columns.find((c) => c.id === dialog.columnId) : null;
  const savedPart = dialog?.kind === "edit-saved" ? parts.find((p) => p.id === dialog.partId) : null;

  return (
    <>
      <Modal
        open={Boolean(block)}
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
        {block && (
          <RichTextEditor
            // A new block opens with nothing written; the editor starts from what is stored.
            key={block.id}
            value={block.doc}
            onChange={(doc) => onRows((current) => updateBlock(current, block.id, (b) => ({ ...b, doc })))}
            label="Text"
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
      >
        {row && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {column ? "A column's width comes from its row's layout. " : ""}
              With fewer columns, the text of the columns that go moves to the last one.
            </p>
            <LayoutChoice
              value={row.layout}
              onChange={(layout) => onRows((current) => setRowLayout(current, row.id, layout, newId))}
            />
          </div>
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
          part={savedPart}
          onClose={onClose}
          onParts={onParts}
          onUse={() => {
            onUse(savedPart);
            onClose();
          }}
        />
      )}
    </>
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
  part,
  onCancel,
  onSaved,
}: {
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
      const result = await createSavedPartAction({ ...part, name });
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
  part,
  onClose,
  onParts,
  onUse,
}: {
  part: SavedPart;
  onClose: () => void;
  onParts: (parts: SavedPart[]) => void;
  onUse: () => void;
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
      const result = await updateSavedPartAction(part.id, { ...content(), name });
      if (!result.ok) return setProblems(result.problems);
      onParts(result.parts);
      onClose();
    });
  const remove = () =>
    start(async () => {
      const result = await deleteSavedPartAction(part.id);
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
                <RichTextEditor
                  value={block.doc}
                  onChange={(doc) => change((r) => updateBlock(r, block.id, (b) => ({ ...b, doc })))}
                  label={`${part.kind === "row" ? `Column ${index + 1}, text` : "Text"} ${n + 1}`}
                />
                {part.kind !== "block" && (
                  <button
                    type="button"
                    onClick={() => change((r) => removeBlock(r, block.id))}
                    className="w-fit text-xs text-muted underline hover:text-foreground"
                  >
                    Remove this text
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
