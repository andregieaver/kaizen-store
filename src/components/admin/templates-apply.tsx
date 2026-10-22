"use client";

import { useId, useState } from "react";

import type { PageRow, PageType } from "@/lib/page-content";
import { countWords, fillWords } from "@/lib/admin-fill";
import { LAYOUT_TYPE_LABELS, layoutBlocks, type PageLayout } from "@/lib/page-layout";
import { cssNote, isBlankPage, layoutRoomProblem, replaceWarning, type ApplyMode } from "@/lib/page-layout-apply";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";

/** A page layout waiting to be put on the page: from Saved, or a template's copy the server made ready. */
export type PendingLayout = {
  name: string;
  layout: PageLayout;
  /** A template from another store: its uses of globals are dropped and its grids show this store's products. */
  foreign: boolean;
};

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
  const w = useAdminText("builder").templates;
  return (
    <Modal open={pending !== null} onClose={onClose} title={w.applyTitle}>
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
  const w = useAdminText("builder").templates;
  const blank = isBlankPage(rows);
  const [mode, setMode] = useState<ApplyMode>(blank ? "replace" : "add");
  const [problem, setProblem] = useState<string | null>(null);
  const { layout } = pending;
  const room = layoutRoomProblem({ rows }, layout, mode);
  const css = cssNote({ css: pageCss }, layout, mode);
  // The checks' own sentences (`replaceWarning()`) take the English kind; the dialog's words take the admin's.
  const kind = LAYOUT_TYPE_LABELS[pageType].one;
  const these = w.this[pageType];
  const here = countWords(rows.length, w.rows);
  const theirs = countWords(layout.rows.length, w.rows);
  const warning = mode === "replace" ? replaceWarning(rows, pageSaved, kind) : null;
  const replacing = warning !== null;

  const submit = () => {
    const failed = onApply(pending, mode);
    if (failed) setProblem(failed);
  };

  const options: { value: ApplyMode; label: string; hint: string }[] = [
    {
      value: "replace",
      label: fillWords(pageType === "product_layout" ? w.replaceRows : w.replaceLayout, { this: these }),
      hint: fillWords(w.replaceHint, { rows: here, this: these, layoutRows: theirs }),
    },
    {
      value: "add",
      label: w.addLabel,
      hint: fillWords(w.addHint, { layoutRows: theirs, rows: here }),
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
        <span className="font-medium">{pending.name}</span>{" "}
        {fillWords(w.applyIntro, { rows: theirs, blocks: countWords(layoutBlocks(layout).length, w.blocks), this: these })}
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.what}</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-line p-2 text-sm has-checked:border-brand has-checked:bg-sunken has-focus-visible:outline-2"
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
              className="mt-1 size-4 shrink-0 accent-brand"
            />
            <span className="flex flex-col">
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {warning && (
        <p role="note" className="rounded-md border border-warning-text p-3 text-sm">
          {warning}
        </p>
      )}
      {css && <p className="text-xs text-muted">{css}</p>}
      {(room ?? problem) && (
        <p role="alert" className="text-sm text-danger-text">
          {room ?? problem}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-10 rounded-pill border border-edge px-4 text-sm">
          {w.cancel}
        </button>
        <button
          type="submit"
          disabled={room !== null}
          className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-50"
        >
          {mode === "replace" ? (replacing ? fillWords(w.replaceCount, { rows: here }) : w.useLayout) : w.addRows}
        </button>
      </div>
    </form>
  );
}
