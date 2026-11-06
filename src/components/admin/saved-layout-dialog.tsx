"use client";

import { useId, useState, useTransition } from "react";

import { layoutBlocks } from "@/lib/page-layout";
import { SAVED_NAME_MAX, type SavedPart } from "@/lib/saved-parts";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";
import type { PageOwnerContext } from "./page-context";
import { countWords, fillWords } from "@/lib/admin-fill";

/** A saved page layout (D127), opened from Saved: its name to change, and ways to use it, edit its rows on the canvas or delete it. */
export function SavedLayoutDialog({
  actions,
  part,
  fits,
  onClose,
  onParts,
  onUse,
  onEditOnCanvas,
}: {
  actions: Pick<PageOwnerContext["actions"], "updatePart" | "deletePart">;
  /** Its rows on the builder's canvas, to change with every tool and save back into it (D127). */
  onEditOnCanvas: () => void;
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
  const builderWords = useAdminText("builder");
  const editWords = builderWords.savedPart.editOnCanvas;
  const w = builderWords.savedLayout;
  const types = builderWords.templates.layoutTypes[layout.pageType].many;
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
        setProblems([w.notSaved]);
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
        setProblems([w.notDeleted]);
      }
    });

  return (
    <Modal
      open
      onClose={onClose}
      title={w.title}
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto self-center text-sm">{fillWords(w.confirmDelete, { name: part.name })}</span>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="min-h-10 rounded-pill border border-edge px-4 text-sm"
            >
              {w.keep}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="min-h-10 rounded-pill bg-danger-soft px-4 text-sm font-medium text-danger-text disabled:opacity-50"
            >
              {w.delete}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="mr-auto min-h-10 px-2 text-sm text-danger-text underline"
            >
              {w.delete}
            </button>
            <button
              type="button"
              onClick={onEditOnCanvas}
              disabled={busy}
              className="min-h-10 rounded-pill border border-edge px-4 text-sm disabled:opacity-40"
            >
              {editWords}
            </button>
            <button
              type="button"
              onClick={onUse}
              disabled={!fits}
              className="min-h-10 rounded-pill border border-edge px-4 text-sm disabled:opacity-40"
            >
              {w.use}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || name.trim() === part.name}
              className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-50"
            >
              {busy ? w.saving : w.saveName}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            {w.name}
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={SAVED_NAME_MAX}
            onChange={(event) => {
              setName(event.target.value);
              setProblems([]);
            }}
            className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm"
          />
        </div>
        <p className="text-sm text-muted">
          {fillWords(w.madeFor, {
            types,
            rows: countWords(rows, w.rows),
            blocks: countWords(layoutBlocks(layout).length, w.blocks),
            css: layout.css ? w.withCss : "",
          })}
        </p>
        {!fits && (
          <p role="note" className="text-sm text-muted">
            {fillWords(w.notHere, { types })}
          </p>
        )}
        {problems.length > 0 && (
          <p role="alert" className="text-sm text-danger-text">
            {problems.join(" ")}
          </p>
        )}
      </div>
    </Modal>
  );
}
