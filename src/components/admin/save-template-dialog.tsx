"use client";

import { useId, useState, useTransition } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import type { PageLayout } from "@/lib/page-layout";
import { SAVED_NAME_MAX, type SavedPart } from "@/lib/saved-parts";
import type { PartSharing } from "@/lib/templates";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";
import type { PageOwnerContext } from "./page-context";
import { SharingChoice } from "./templates-sharing";

/** What the page editor tells a person when a page's layout was saved as a template (D127). */
export const SAVED_AS_TEMPLATE = "Saved as a template. Find it under Saved.";

/** The name a page's layout starts with: the page's title, else "Untitled". */
export const defaultTemplateName = (title: string): string => title.trim().slice(0, SAVED_NAME_MAX) || "Untitled";

/**
 * Saves a page's layout as a template (D127): its rows and CSS, nothing else of the page. It is saved under Saved
 * as a page layout, and a store can share it (D125) the way it shares a saved row; Kaizen's own are the marketplace's,
 * so there is no choice there. What the page holds now is saved, whether or not the page has been.
 */
export function SaveTemplateDialog({
  open,
  create,
  layout,
  defaultName,
  canShare,
  onClose,
  onSaved,
}: {
  open: boolean;
  create: PageOwnerContext["actions"]["createPart"];
  /** The layout as the editor holds it now. */
  layout: PageLayout;
  defaultName: string;
  /** Offers who can use it (D125): a store's builder only. */
  canShare: boolean;
  onClose: () => void;
  /** The saved parts after this one was added. */
  onSaved: (parts: SavedPart[]) => void;
}) {
  const w = useAdminText("builder").templates;
  return (
    <Modal open={open} onClose={onClose} title={w.saveTitle}>
      {open && (
        <Form
          create={create}
          layout={layout}
          defaultName={defaultName}
          canShare={canShare}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function Form({
  create,
  layout,
  defaultName,
  canShare,
  onClose,
  onSaved,
}: Omit<Parameters<typeof SaveTemplateDialog>[0], "open">) {
  const id = useId();
  const [name, setName] = useState(defaultName);
  const [shared, setShared] = useState<PartSharing>("private");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const rows = layout.rows.length;
  const w = useAdminText("builder").templates;
  const type = layout.pageType;
  const names = { kind: w.layoutTypes[type].one, this: w.this[type], the: w.the[type] };

  const submit = () =>
    start(async () => {
      if (rows === 0) return setProblems([fillWords(w.saveNoRows, names)]);
      try {
        const result = await create({
          kind: "page",
          name,
          content: layout,
          global: false,
          ...(canShare ? { sharing: shared } : {}),
        });
        if (result.ok) {
          onSaved(result.parts);
          onClose();
        } else setProblems(result.problems);
      } catch {
        setProblems([w.saveFailed]);
      }
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-sm text-muted">
        {fillWords(w.saveIntro, { ...names, rows: countWords(rows, w.rows), css: layout.css ? w.saveCss : "" })}
      </p>
      <label htmlFor={`${id}-name`} className="text-sm font-medium">
        {w.name}
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
        className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm"
      />
      {canShare && <SharingChoice value={shared} onChange={setShared} />}
      {problems.length > 0 && (
        <p role="alert" className="text-sm text-danger-text">
          {problems.join(" ")}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-10 rounded-pill border border-edge px-4 text-sm">
          {w.cancel}
        </button>
        <button
          type="submit"
          disabled={busy}
          className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-50"
        >
          {busy ? w.saving : w.save}
        </button>
      </div>
    </form>
  );
}
