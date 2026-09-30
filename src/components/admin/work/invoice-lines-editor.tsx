"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { formatMoney } from "@/lib/money";
import { bpToPercent } from "@/lib/work-calc";
import {
  VAT_CATEGORY_LABELS,
  dropRow,
  type DraftPreview,
  type LineErrors,
  type LineRow,
} from "@/lib/work-invoice-ui";
import { formatDay } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import { VAT_LINE_CATEGORIES, type VatLineCategory } from "@/lib/work-vat";
import type { LineTime } from "@/server/work-invoice-screens";

import { errorText, smallButton, smallControl } from "./work-parts";

export type LinesEditorProps = {
  rows: readonly LineRow[];
  onRows: (next: LineRow[]) => void;
  /** Makes a new empty row (the editor gives it its key, client's rate and assignment). */
  makeRow: () => LineRow;
  currency: string;
  locale: string;
  preview: DraftPreview | null;
  errors: Record<string, LineErrors>;
  /** Logged time attached to each saved line, by its id. */
  timeByLine: Record<string, LineTime[]>;
  onRelease: (entryIds: string[]) => void;
  releasing: boolean;
  /** The row to put the cursor in (one just added). */
  focusKey: string | null;
  onFocused: () => void;
};

/**
 * The lines of a draft (docs/work.md 7.2 WP6, from Life's `invoice-lines-editor.tsx`): each line's description,
 * hours or units, price without VAT, discount and VAT category, with its amounts as they will be issued. Add lines
 * one after another (Enter in a description makes the next), reorder by dragging or with the Move buttons, remove,
 * and take logged time back off a line. What is typed stays as typed; the parent reads it (`readDraft`), prices it
 * (`previewRows`) and saves it. On a phone each line stacks into labelled fields.
 */
export function InvoiceLinesEditor(props: LinesEditorProps) {
  const { rows, onRows, makeRow } = props;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id)
      onRows(dropRow(rows, String(active.id), String(over.id)));
  };
  const patch = (key: string, change: Partial<LineRow>) =>
    onRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          No lines yet. Add a line, or add the time you have logged and not yet
          billed.
        </p>
      ) : (
        <div>
          <div
            aria-hidden
            className="hidden gap-2 border-b border-border px-2 pb-2 text-xs font-medium tracking-wide text-muted uppercase md:grid md:grid-cols-[minmax(11rem,1fr)_9rem_6.5rem_4.5rem_10rem_6rem_6rem_2.25rem]"
          >
            <span>Description</span>
            <span>Hours or units</span>
            <span>Price</span>
            <span>Discount</span>
            <span>VAT</span>
            <span className="text-right">Without VAT</span>
            <span className="text-right">With VAT</span>
            <span />
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={rows.map((row) => row.key)}
              strategy={verticalListSortingStrategy}
            >
              <ol
                className="flex flex-col gap-3 md:gap-0"
                aria-label="Invoice lines"
              >
                {rows.map((row, index) => (
                  <LineItem
                    key={row.key}
                    row={row}
                    index={index}
                    priced={props.preview?.lines[index] ?? null}
                    errors={props.errors[row.key] ?? {}}
                    time={row.id ? (props.timeByLine[row.id] ?? []) : []}
                    currency={props.currency}
                    locale={props.locale}
                    releasing={props.releasing}
                    focus={props.focusKey === row.key}
                    onFocused={props.onFocused}
                    onPatch={(change) => patch(row.key, change)}
                    onRemove={() =>
                      onRows(rows.filter((r) => r.key !== row.key))
                    }
                    onEnter={() => onRows([...rows, makeRow()])}
                    onRelease={props.onRelease}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() => onRows([...rows, makeRow()])}
          className={smallButton}
        >
          Add line
        </button>
      </div>
    </div>
  );
}

function LineItem({
  row,
  index,
  priced,
  errors,
  time,
  currency,
  locale,
  releasing,
  focus,
  onFocused,
  onPatch,
  onRemove,
  onEnter,
  onRelease,
}: {
  row: LineRow;
  index: number;
  priced: DraftPreview["lines"][number] | null;
  errors: LineErrors;
  time: LineTime[];
  currency: string;
  locale: string;
  releasing: boolean;
  focus: boolean;
  onFocused: () => void;
  onPatch: (change: Partial<LineRow>) => void;
  onRemove: () => void;
  onEnter: () => void;
  onRelease: (entryIds: string[]) => void;
}) {
  const id = useId();
  const number = index + 1;
  const descriptionRef = useRef<HTMLInputElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.key });

  useEffect(() => {
    if (focus) {
      descriptionRef.current?.focus();
      onFocused();
    }
  }, [focus, onFocused]);

  const money = (minor: number) => formatMoney(minor, currency, locale);
  const described = (field: keyof LineErrors) =>
    errors[field]
      ? {
          "aria-invalid": true as const,
          "aria-describedby": `${id}-${field}-error`,
        }
      : {};
  const fieldError = (field: keyof LineErrors) =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} role="alert" className={errorText}>
        {errors[field]}
      </p>
    ) : null;
  const label = "text-xs text-muted md:sr-only";
  const unreadable = priced !== null && !priced.readable;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-col gap-3 rounded-lg border border-border bg-background p-3 md:rounded-none md:border-0 md:border-b md:px-2 md:py-3 ${
        isDragging ? "relative z-10 shadow-lg" : ""
      }`}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(11rem,1fr)_9rem_6.5rem_4.5rem_10rem_6rem_6rem_2.25rem] md:gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-description`} className={label}>
            Line {number} description
          </label>
          <div className="flex items-start gap-2">
            <button
              type="button"
              aria-label={`Drag line ${number} to reorder`}
              className="mt-0.5 flex min-h-9 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md border border-border text-muted active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <span aria-hidden>⋮⋮</span>
            </button>
            <input
              ref={descriptionRef}
              id={`${id}-description`}
              value={row.description}
              onChange={(event) => onPatch({ description: event.target.value })}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  row.description.trim() !== "" &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  onEnter();
                }
              }}
              placeholder="What was done"
              maxLength={600}
              autoComplete="off"
              className={`${smallControl} w-full min-w-0`}
              {...described("description")}
            />
          </div>
          {fieldError("description")}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-quantity`} className={label}>
            Line {number} {row.unit === "hour" ? "hours" : "quantity"}
          </label>
          <div className="flex gap-1">
            <input
              id={`${id}-quantity`}
              value={row.quantity}
              onChange={(event) =>
                onPatch({ quantity: event.target.value, quantityManual: true })
              }
              inputMode="decimal"
              autoComplete="off"
              className={`${smallControl} w-full min-w-0 text-right tabular-nums`}
              {...described("quantity")}
            />
            <select
              aria-label={`Line ${number} unit`}
              value={row.unit}
              onChange={(event) =>
                onPatch({ unit: event.target.value as "hour" | "unit" })
              }
              className={`${smallControl} w-[4.75rem] shrink-0`}
            >
              <option value="hour">hours</option>
              <option value="unit">units</option>
            </select>
          </div>
          {fieldError("quantity")}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-price`} className={label}>
            Line {number} price without VAT
          </label>
          <input
            id={`${id}-price`}
            value={row.price}
            onChange={(event) => onPatch({ price: event.target.value })}
            inputMode="decimal"
            autoComplete="off"
            className={`${smallControl} w-full text-right tabular-nums`}
            {...described("price")}
          />
          {fieldError("price")}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-discount`} className={label}>
            Line {number} discount in percent
          </label>
          <input
            id={`${id}-discount`}
            value={row.discount}
            onChange={(event) => onPatch({ discount: event.target.value })}
            inputMode="decimal"
            autoComplete="off"
            className={`${smallControl} w-full text-right tabular-nums`}
            {...described("discount")}
          />
          {fieldError("discount")}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-vat`} className={label}>
            Line {number} VAT
          </label>
          <select
            id={`${id}-vat`}
            value={row.vatCategory}
            onChange={(event) =>
              onPatch({ vatCategory: event.target.value as VatLineCategory })
            }
            className={`${smallControl} w-full`}
          >
            {VAT_LINE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {VAT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          {priced && (
            <p className="text-xs text-muted">
              {priced.vatBp > 0
                ? `${bpToPercent(priced.vatBp)} % VAT`
                : "No VAT on this line"}
            </p>
          )}
        </div>

        <p className="flex items-baseline justify-between gap-2 text-sm tabular-nums md:block md:pt-2 md:text-right">
          <span className="text-xs text-muted md:sr-only">Without VAT</span>
          <span>{priced && !unreadable ? money(priced.exclMinor) : "–"}</span>
        </p>
        <p className="flex items-baseline justify-between gap-2 text-sm font-medium tabular-nums md:block md:pt-2 md:text-right">
          <span className="text-xs font-normal text-muted md:sr-only">
            With VAT
          </span>
          <span>{priced && !unreadable ? money(priced.inclMinor) : "–"}</span>
        </p>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove line ${number}`}
          title="Remove line"
          className="flex size-9 items-center justify-center justify-self-end rounded-md border border-border text-muted hover:text-red-700 md:justify-self-auto dark:hover:text-red-400"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>

      {row.timeMinutes > 0 && (
        <p className="text-xs text-muted">
          {formatDuration(row.timeMinutes)} logged time on this line
          {row.quantityManual ? ", hours typed by you" : ""}
        </p>
      )}

      {time.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">
            Logged time on line {number} ({time.length}{" "}
            {time.length === 1 ? "entry" : "entries"})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {time.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-3 py-2"
              >
                <span>
                  {formatDay(entry.workDate, locale)},{" "}
                  {formatDuration(entry.minutes)}, {entry.person}
                  {entry.note ? (
                    <span className="text-muted">: {entry.note}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  disabled={releasing}
                  onClick={() => onRelease([entry.id])}
                  aria-label={`Take the ${formatDuration(entry.minutes)} on ${formatDay(entry.workDate, locale)} off line ${number}`}
                  className={smallButton}
                >
                  Release
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <button
              type="button"
              disabled={releasing}
              onClick={() => onRelease(time.map((entry) => entry.id))}
              className={smallButton}
            >
              Release all time from line {number}
            </button>
            Released time can be billed again, here or on another invoice.
          </p>
        </details>
      )}
    </li>
  );
}
