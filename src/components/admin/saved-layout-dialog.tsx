"use client";

import { useId, useState, useTransition } from "react";

import { LAYOUT_TYPE_LABELS, layoutBlocks } from "@/lib/page-layout";
import { SAVED_NAME_MAX, type SavedPart } from "@/lib/saved-parts";

import { Modal } from "./modal";
import type { PageOwnerContext } from "./page-context";

/** A saved page layout (D127), opened from Saved: its name to change, and ways to use it or delete it. Its content is not edited here. */
export function SavedLayoutDialog({
  actions,
  part,
  fits,
  onClose,
  onParts,
  onUse,
}: {
  actions: Pick<PageOwnerContext["actions"], "updatePart" | "deletePart">;
  part: Extract<SavedPart, { kind: "page" }>;
  /** It is for the kind of page being edited, so it can be used here. */
  fits: boolean;
  onClose: () => void;
  onParts: (parts: SavedPart[]) => void;
  onUse: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(part.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const layout = part.content;
  const rows = layout.rows.length;
  const save = () =>
    start(async () => {
      try {
        const result = await actions.updatePart(part.id, {
          kind: "page",
          content: part.content,
          name,
          global: false,
          sharing: part.sharing,
        });
        if (!result.ok) return setProblems(result.problems);
        onParts(result.parts);
        onClose();
      } catch {
        setProblems(["It could not be saved. Try again."]);
      }
    });
  const remove = () =>
    start(async () => {
      try {
        const result = await actions.deletePart(part.id);
        if (result.ok) {
          onParts(result.parts);
          onClose();
        } else setProblems(result.problems);
      } catch {
        setProblems(["It could not be deleted. Try again."]);
      }
    });

  return (
    <Modal
      open
      onClose={onClose}
      title="Saved page layout"
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto self-center text-sm">
              Delete “{part.name}” from Saved? Pages that used it keep their copy.
            </span>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="min-h-10 rounded-md border border-border px-4 text-sm"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              Delete
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="mr-auto min-h-10 px-2 text-sm text-red-700 underline dark:text-red-400"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={onUse}
              disabled={!fits}
              className="min-h-10 rounded-md border border-border px-4 text-sm disabled:opacity-40"
            >
              Use on this page
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || name.trim() === part.name}
              className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            >
              {busy ? "Saving …" : "Save name"}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={SAVED_NAME_MAX}
            onChange={(event) => {
              setName(event.target.value);
              setProblems([]);
            }}
            className="min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <p className="text-sm text-muted">
          Made for {LAYOUT_TYPE_LABELS[layout.pageType].many}: {rows} {rows === 1 ? "row" : "rows"} and{" "}
          {layoutBlocks(layout).length} blocks{layout.css ? ", with its own custom CSS" : ""}. Its content cannot be
          edited here; save the page again as a template to make a new one.
        </p>
        {!fits && (
          <p role="note" className="text-sm text-muted">
            It is for {LAYOUT_TYPE_LABELS[layout.pageType].many}, so it cannot be used on this page.
          </p>
        )}
        {problems.length > 0 && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problems.join(" ")}
          </p>
        )}
      </div>
    </Modal>
  );
}
