"use client";

import { useId, useState } from "react";

import type { PageRow, PageType } from "@/lib/page-content";
import { LAYOUT_TYPE_LABELS, layoutBlocks, type PageLayout } from "@/lib/page-layout";
import { cssNote, isBlankPage, layoutRoomProblem, replaceWarning, type ApplyMode } from "@/lib/page-layout-apply";

import { Modal } from "./modal";

/** A page layout waiting to be put on the page: from Saved, or a template's copy the server made ready. */
export type PendingLayout = {
  name: string;
  layout: PageLayout;
  /** A template from another store: its uses of globals are dropped and its grids show this store's products. */
  foreign: boolean;
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What to do with a page layout (D127): replace the page's own layout with it, or add its rows after the ones already
 * there. Nothing is saved until the person saves the page, and the builder has no undo, so a page that has something
 * on it is told that before replacing it. Refuses (and says why) a layout the page has no room for.
 */
export function ApplyLayoutDialog({
  pending,
  rows,
  pageCss,
  pageType,
  pageSaved,
  onApply,
  onClose,
}: {
  pending: PendingLayout | null;
  rows: PageRow[];
  /** The page's own CSS. */
  pageCss: string;
  /** The kind of page being edited. */
  pageType: PageType;
  /** The page has been saved, so what it was is still there until it is saved again. */
  pageSaved: boolean;
  /** Puts the layout on the page; resolves to what went wrong, null when it worked. */
  onApply: (pending: PendingLayout, mode: ApplyMode) => string | null;
  onClose: () => void;
}) {
  return (
    <Modal open={pending !== null} onClose={onClose} title="Use a page layout">
      {pending && (
        <Choice
          pending={pending}
          rows={rows}
          pageCss={pageCss}
          pageType={pageType}
          pageSaved={pageSaved}
          onApply={onApply}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function Choice({
  pending,
  rows,
  pageCss,
  pageType,
  pageSaved,
  onApply,
  onClose,
}: {
  pending: PendingLayout;
  rows: PageRow[];
  pageCss: string;
  pageType: PageType;
  pageSaved: boolean;
  onApply: (pending: PendingLayout, mode: ApplyMode) => string | null;
  onClose: () => void;
}) {
  const id = useId();
  const blank = isBlankPage(rows);
  const [mode, setMode] = useState<ApplyMode>(blank ? "replace" : "add");
  const [problem, setProblem] = useState<string | null>(null);
  const { layout } = pending;
  const room = layoutRoomProblem({ rows }, layout, mode);
  const css = cssNote({ css: pageCss }, layout, mode);
  const kind = LAYOUT_TYPE_LABELS[pageType].one;
  const warning = mode === "replace" ? replaceWarning(rows, pageSaved, kind) : null;
  const replacing = warning !== null;

  const submit = () => {
    const failed = onApply(pending, mode);
    if (failed) setProblem(failed);
  };

  const options: { value: ApplyMode; label: string; hint: string }[] = [
    {
      value: "replace",
      label: pageType === "product_layout" ? `Replace the rows of this ${kind}` : `Replace this ${kind}'s layout`,
      hint: `The ${count(rows.length, "row")} on this ${kind} are swapped for the layout's ${count(layout.rows.length, "row")}.`,
    },
    {
      value: "add",
      label: "Add after the current rows",
      hint: `The layout's ${count(layout.rows.length, "row")} are put below the ${count(rows.length, "row")} already here.`,
    },
  ];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm">
        <span className="font-medium">{pending.name}</span> has {count(layout.rows.length, "row")} and{" "}
        {count(layoutBlocks(layout).length, "block")}. It is copied to this {kind}: what you change here never reaches
        the layout.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">What should happen?</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-sm has-checked:border-foreground has-checked:bg-surface has-focus-visible:outline-2"
          >
            <input
              type="radio"
              name={`${id}-mode`}
              value={option.value}
              checked={mode === option.value}
              onChange={() => {
                setMode(option.value);
                setProblem(null);
              }}
              className="mt-1 size-4 shrink-0 accent-foreground"
            />
            <span className="flex flex-col">
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {warning && (
        <p role="note" className="rounded-md border border-amber-700 p-3 text-sm dark:border-amber-400">
          {warning}
        </p>
      )}
      {css && <p className="text-xs text-muted">{css}</p>}
      {(room ?? problem) && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {room ?? problem}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-border px-4 text-sm">
          Cancel
        </button>
        <button
          type="submit"
          disabled={room !== null}
          className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
        >
          {mode === "replace" ? (replacing ? `Replace ${count(rows.length, "row")}` : "Use layout") : "Add rows"}
        </button>
      </div>
    </form>
  );
}
