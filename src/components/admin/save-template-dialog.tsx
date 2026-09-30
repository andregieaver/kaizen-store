"use client";

import { useId, useState, useTransition } from "react";

import { LAYOUT_TYPE_LABELS, type PageLayout } from "@/lib/page-layout";
import { SAVED_NAME_MAX, type SavedPart } from "@/lib/saved-parts";
import type { PartSharing } from "@/lib/templates";

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
  return (
    <Modal open={open} onClose={onClose} title="Save as template">
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
  const kind = LAYOUT_TYPE_LABELS[layout.pageType].one;

  const submit = () =>
    start(async () => {
      if (rows === 0) return setProblems([`This ${kind} has no rows to save yet.`]);
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
        setProblems(["It could not be saved. Try again."]);
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
        Saves this {kind}&apos;s layout: its {rows} {rows === 1 ? "row" : "rows"}
        {layout.css ? " and its custom CSS" : ""}, as they are in the editor now. The {kind}&apos;s title, address and
        other settings stay with it.
      </p>
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
        className="min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
      />
      {canShare && <SharingChoice value={shared} onChange={setShared} />}
      {problems.length > 0 && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problems.join(" ")}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-border px-4 text-sm">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
        >
          {busy ? "Saving …" : "Save template"}
        </button>
      </div>
    </form>
  );
}
