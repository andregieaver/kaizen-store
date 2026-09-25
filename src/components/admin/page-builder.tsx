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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useState, type CSSProperties, type PointerEventHandler, type ReactNode } from "react";

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
  findBlock,
  insertBlock,
  insertRow,
  moveBlock,
  moveRow,
  newBlock,
  newRow,
  removeBlock,
  removeRow,
  setRowLayout,
  updateBlock,
} from "@/lib/page-rows";

import { RichTextEditor } from "./rich-text-editor";

/**
 * The page builder (D43): a left sidebar with tabs (components, rows, and
 * two for later), the canvas of rows, each divided into columns holding
 * blocks, and the page's own settings on the right. Rows are dragged from
 * the sidebar onto the canvas and components into columns; rows and blocks
 * already on the page are dragged by their handles, blocks into any column.
 * Everything also works without a mouse: the sidebar's tiles add when
 * pressed, and rows and blocks have buttons to move and delete them.
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
  | { kind: "column"; columnId: string }
  | { kind: "canvas-end" };

const dataOf = (item: Active | Over | null): DragData | null => (item?.data.current as DragData | undefined) ?? null;
const movesRows = (data: DragData | null) => data?.kind === "palette-row" || data?.kind === "row";

/** Rows land between rows; components and blocks land in columns, before or after a block. */
const collision: CollisionDetection = (args) => {
  const rows = movesRows(dataOf(args.active));
  const targets = args.droppableContainers.filter((container) => {
    const kind = (container.data.current as DragData | undefined)?.kind;
    return container.id !== args.active.id && (rows ? kind === "row" || kind === "canvas-end" : kind === "block" || kind === "column");
  });
  const within = pointerWithin({ ...args, droppableContainers: targets });
  if (within.length > 0) {
    // Over a block inside a column: the block says where, not the column.
    const block = within.find((hit) => (hit.data?.droppableContainer.data.current as DragData | undefined)?.kind === "block");
    return block ? [block] : within;
  }
  return closestCenter({ ...args, droppableContainers: targets });
};

/** Whether the dragged item's middle is below the middle of what it is over. */
function below(active: Active, over: Over): boolean {
  const rect = active.rect.current.translated;
  if (!rect) return false;
  return rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2;
}

const blockLabels: Record<BlockType, string> = { richText: "Rich text" };

const small = "flex min-h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-xs disabled:opacity-40";

export function PageBuilder({ rows, onRows, aside }: { rows: PageRow[]; onRows: Rows; aside: ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState<DragData | null>(null);
  /** Where a dragged row, component or block would land, to show it. */
  const [target, setTarget] = useState<{ id: string; after: boolean } | null>(null);
  /** The column last worked in, where pressing a component adds it. */
  const [lastColumn, setLastColumn] = useState<string | null>(null);
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
  };

  const onDragMove = ({ active, over }: DragMoveEvent) => {
    const data = dataOf(over);
    const next =
      over && (data?.kind === "row" || data?.kind === "block") ? { id: String(over.id), after: below(active, over) } : null;
    setTarget((current) => (current?.id === next?.id && current?.after === next?.after ? current : next));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    setTarget(null);
    const from = dataOf(active);
    const to = dataOf(over);
    if (!from || !to || !over) return;
    const after = below(active, over);

    if (from.kind === "palette-row" || from.kind === "row") {
      const index =
        to.kind === "canvas-end" ? rows.length : to.kind === "row" ? rows.findIndex((r) => r.id === to.rowId) : -1;
      if (index < 0) return;
      if (from.kind === "palette-row") addRow(from.layout, to.kind === "row" && after ? index + 1 : index);
      // A row already on the page takes the place of the row it is over.
      else onRows((current) => moveRow(current, from.rowId, to.kind === "canvas-end" ? current.length : index));
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
    const row = rows.findIndex((r) => r.id === id);
    if (row >= 0) return `row ${row + 1}`;
    const block = findBlock(rows, String(id));
    if (block) return `a block in row ${rows.findIndex((r) => r.id === block.rowId) + 1}`;
    return "the page";
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
          onAddRow={(layout) => addRow(layout)}
          onAddBlock={(type) => addBlock(type, lastColumn)}
          rowsFull={rowsFull}
          blocksFull={blocksFull}
        />

        <Canvas
          rows={rows}
          onRows={onRows}
          dragging={dragging}
          target={target}
          onAddBlock={(type, columnId) => {
            addBlock(type, columnId);
            setLastColumn(columnId);
          }}
          onColumn={setLastColumn}
          blocksFull={blocksFull}
        />

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
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// The left sidebar
// ---------------------------------------------------------------------------

const TABS = [
  { key: "components", label: "Components" },
  { key: "rows", label: "Rows" },
  { key: "sections", label: "Sections" },
  { key: "layers", label: "Layers" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Sidebar({
  onAddRow,
  onAddBlock,
  rowsFull,
  blocksFull,
}: {
  onAddRow: (layout: RowLayout) => void;
  onAddBlock: (type: BlockType) => void;
  rowsFull: boolean;
  blocksFull: boolean;
}) {
  const [tab, setTab] = useState<Tab>("components");
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
          {(t.key === "sections" || t.key === "layers") && <p className="text-sm text-muted">Coming soon.</p>}
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

function Canvas({
  rows,
  onRows,
  dragging,
  target,
  onAddBlock,
  onColumn,
  blocksFull,
}: {
  rows: PageRow[];
  onRows: Rows;
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  onAddBlock: (type: BlockType, columnId: string) => void;
  onColumn: (columnId: string) => void;
  blocksFull: boolean;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const draggingRows = movesRows(dragging);
  // Existing rows show their new place by moving; new ones by a line.
  const showLine = (id: string) => target?.id === id && dragging?.kind !== "row" ? (target.after ? "after" : "before") : null;

  return (
    <section aria-labelledby="content-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="content-heading" className="sr-only">
        Content
      </h2>
      <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-4">
          {rows.map((row, index) => (
            <RowItem
              key={row.id}
              row={row}
              position={index + 1}
              count={rows.length}
              line={showLine(row.id)}
              onRows={onRows}
              dragging={dragging}
              target={target}
              confirming={confirming === row.id}
              onConfirm={(on) => setConfirming(on ? row.id : null)}
              onAddBlock={onAddBlock}
              onColumn={onColumn}
              blocksFull={blocksFull}
            />
          ))}
        </ol>
      </SortableContext>
      <CanvasEnd empty={rows.length === 0} active={draggingRows} />
    </section>
  );
}

/** Below the last row: where a row dropped goes last, and what an empty page says. */
function CanvasEnd({ empty, active }: { empty: boolean; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas-end", data: { kind: "canvas-end" } satisfies DragData });
  if (!empty && !active) return <div ref={setNodeRef} />;
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-28 items-center justify-center rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted ${
        isOver ? "border-foreground bg-surface" : "border-border"
      }`}
    >
      {empty ? "The page is empty. Drag a row here from Rows, or press one to add it." : "Drop the row here to put it last."}
    </div>
  );
}

function Line({ at }: { at: "before" | "after" | null }) {
  if (!at) return null;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 z-10 h-1 rounded-full bg-blue-600 ${at === "before" ? "-top-2.5" : "-bottom-2.5"}`}
    />
  );
}

const rowHasText = (row: PageRow) => row.columns.some((c) => c.blocks.some((b) => richTextPlain(b.doc).trim() !== ""));

function RowItem({
  row,
  position,
  count,
  line,
  onRows,
  dragging,
  target,
  confirming,
  onConfirm,
  onAddBlock,
  onColumn,
  blocksFull,
}: {
  row: PageRow;
  position: number;
  count: number;
  line: "before" | "after" | null;
  onRows: Rows;
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  confirming: boolean;
  onConfirm: (on: boolean) => void;
  onAddBlock: (type: BlockType, columnId: string) => void;
  onColumn: (columnId: string) => void;
  blocksFull: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    data: { kind: "row", rowId: row.id } satisfies DragData,
  });
  const name = `Row ${position}`;
  const layoutId = useId();
  const widths = ROW_LAYOUTS[row.layout].widths;
  const remove = () => onRows((rows) => removeRow(rows, row.id));

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex flex-col gap-3 rounded-lg border bg-background p-3 ${
        isDragging ? "z-30 border-foreground shadow-xl" : "border-border"
      }`}
    >
      <Line at={line} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${name.toLowerCase()} to move it`}
          aria-roledescription="draggable row"
          className={`${small} cursor-grab touch-none active:cursor-grabbing`}
        >
          <Grip />
        </button>
        <span className="text-sm font-medium">{name}</span>
        <label htmlFor={layoutId} className="sr-only">
          Layout of {name.toLowerCase()}
        </label>
        <select
          id={layoutId}
          value={row.layout}
          onChange={(event) => onRows((rows) => setRowLayout(rows, row.id, event.target.value as RowLayout, newId))}
          className="min-h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          {ROW_LAYOUT_KEYS.map((layout) => (
            <option key={layout} value={layout}>
              {ROW_LAYOUTS[layout].label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => onRows((rows) => moveRow(rows, row.id, position - 2))}
            disabled={position === 1}
            aria-label={`Move ${name.toLowerCase()} up`}
            className={small}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onRows((rows) => moveRow(rows, row.id, position))}
            disabled={position === count}
            aria-label={`Move ${name.toLowerCase()} down`}
            className={small}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => (rowHasText(row) ? onConfirm(true) : remove())}
            aria-label={`Delete ${name.toLowerCase()}`}
            className={small}
          >
            Delete
          </button>
        </div>
      </div>
      {confirming && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-surface p-3 text-sm">
          Delete {name.toLowerCase()} and everything in it?
          <button type="button" onClick={remove} className="min-h-9 rounded-md bg-red-700 px-3 text-white">
            Delete row
          </button>
          <button type="button" onClick={() => onConfirm(false)} className="underline">
            Keep it
          </button>
        </div>
      )}
      <div
        style={{ "--columns": widths.map((w) => `minmax(0, ${w}fr)`).join(" ") } as CSSProperties}
        className="grid gap-3 md:[grid-template-columns:var(--columns)]"
      >
        {row.columns.map((column, index) => (
          <ColumnItem
            key={column.id}
            column={column}
            name={`${name}, column ${index + 1}`}
            onRows={onRows}
            dragging={dragging}
            target={target}
            onAddBlock={onAddBlock}
            onColumn={onColumn}
            blocksFull={blocksFull}
          />
        ))}
      </div>
    </li>
  );
}

function ColumnItem({
  column,
  name,
  onRows,
  dragging,
  target,
  onAddBlock,
  onColumn,
  blocksFull,
}: {
  column: PageColumn;
  name: string;
  onRows: Rows;
  dragging: DragData | null;
  target: { id: string; after: boolean } | null;
  onAddBlock: (type: BlockType, columnId: string) => void;
  onColumn: (columnId: string) => void;
  blocksFull: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: { kind: "column", columnId: column.id } satisfies DragData,
  });
  const droppingBlock = dragging?.kind === "palette-block" || dragging?.kind === "block";
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
      role="group"
      aria-label={name}
      onFocusCapture={() => onColumn(column.id)}
      onPointerDownCapture={() => onColumn(column.id)}
      className={`flex min-h-24 min-w-0 flex-col gap-3 rounded-md border border-dashed p-2 ${
        droppingBlock && isOver ? "border-foreground bg-surface" : droppingBlock ? "border-muted" : "border-border"
      }`}
    >
      <SortableContext items={column.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        {column.blocks.map((block, index) => (
          <BlockItem
            key={block.id}
            block={block}
            columnId={column.id}
            name={`${name}, ${blockLabels[block.type].toLowerCase()} ${index + 1}`}
            first={index === 0}
            last={index === column.blocks.length - 1}
            line={line(block.id)}
            onRows={onRows}
          />
        ))}
      </SortableContext>
      {column.blocks.length === 0 && (
        <p className="flex flex-1 items-center justify-center p-2 text-center text-xs text-muted">
          Drag a component here
        </p>
      )}
      <button
        type="button"
        onClick={() => onAddBlock("richText", column.id)}
        disabled={blocksFull}
        aria-label={`Add rich text to ${name.toLowerCase()}`}
        className="w-fit text-xs text-muted underline hover:text-foreground disabled:opacity-40"
      >
        + Rich text
      </button>
    </div>
  );
}

function BlockItem({
  block,
  columnId,
  name,
  first,
  last,
  line,
  onRows,
}: {
  block: PageBlock;
  columnId: string;
  name: string;
  first: boolean;
  last: boolean;
  line: "before" | "after" | null;
  onRows: Rows;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    data: { kind: "block", blockId: block.id, columnId } satisfies DragData,
  });
  const [confirming, setConfirming] = useState(false);
  const remove = () => onRows((rows) => removeBlock(rows, block.id));
  const move = (by: number) =>
    onRows((rows) => {
      const place = findBlock(rows, block.id);
      return place ? moveBlock(rows, block.id, columnId, place.index + by) : rows;
    });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex flex-col gap-2 rounded-md bg-background ${isDragging ? "opacity-40" : ""}`}
    >
      <Line at={line} />
      <div className="flex items-center gap-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${name.toLowerCase()} to move it`}
          aria-roledescription="draggable block"
          className={`${small} cursor-grab touch-none active:cursor-grabbing`}
        >
          <Grip />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{blockLabels[block.type]}</span>
        <button type="button" onClick={() => move(-1)} disabled={first} aria-label={`Move ${name.toLowerCase()} up`} className={small}>
          ↑
        </button>
        <button type="button" onClick={() => move(1)} disabled={last} aria-label={`Move ${name.toLowerCase()} down`} className={small}>
          ↓
        </button>
        <button
          type="button"
          onClick={() => (richTextPlain(block.doc).trim() === "" ? remove() : setConfirming(true))}
          aria-label={`Delete ${name.toLowerCase()}`}
          className={small}
        >
          ✕
        </button>
      </div>
      {confirming && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-surface p-2 text-xs">
          Delete this text?
          <button type="button" onClick={remove} className="min-h-8 rounded-md bg-red-700 px-2 text-white">
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="underline">
            Keep it
          </button>
        </div>
      )}
      <RichTextEditor
        value={block.doc}
        onChange={(doc) => onRows((rows) => updateBlock(rows, block.id, (b) => ({ ...b, doc })))}
        label={name}
      />
    </div>
  );
}

function Grip() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
