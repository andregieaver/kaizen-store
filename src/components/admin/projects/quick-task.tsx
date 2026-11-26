"use client";

import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { Field, TextInput } from "@/components/admin/ui/field";
import { AdminLink } from "@/components/admin/ui/link";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectSourcesMessages } from "@/lib/admin-messages/project-sources.en";
import type { SourceKind } from "@/lib/projects-sources";

import { useAct, type ProjectsAct } from "./use-act";

/**
 * *Make a task* where there is no room for a source's tasks (D904 P8.3a): a support conversation in the inbox, a review in the reviews list.
 * A pair of the octopus, drawn only while the store has Projects and the person may change it. One field with a title already written; the
 * task goes to the store's list for follow-ups and links back to its source.
 */
export function QuickTask({
  base,
  kind,
  sourceId,
  label,
  words: w,
  act,
  className = "flex flex-col gap-2 border-b border-line px-4 py-2 text-sm",
}: {
  base: string;
  kind: SourceKind;
  sourceId: string;
  /** What the source is called (who a conversation is with, a reviewer's name), for the title written in advance. */
  label: string;
  words: ProjectSourcesMessages;
  act: ProjectsAct;
  className?: string;
}) {
  const { run, pending, said } = useAct(act);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [title, setTitle] = useState(fillWords(w.suggested[kind], { label }));
  return (
    <div className={className} data-quick-task={kind}>
      {!open && !done && (
        <div>
          <Button kind="quiet" size="dense" onClick={() => setOpen(true)}>
            {w.make}
          </Button>
        </div>
      )}
      {done && (
        <p>
          {fillWords(w.added, { list: w.followUps })}{" "}
          <AdminLink href={`${base}/checklists`} className="underline">
            {w.openLists}
          </AdminLink>
        </p>
      )}
      {open && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run({ op: "item.addFrom", kind, sourceId, title, checklistId: null }, (answer) => {
              if (!answer.ok) return;
              setOpen(false);
              setDone(true);
            });
          }}
        >
          <div className="min-w-0 flex-1">
            <Field label={w.title} required>
              {(control) => <TextInput {...control} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} autoFocus full />}
            </Field>
          </div>
          <Button kind="main" size="dense" type="submit" disabled={pending || title.trim() === ""}>
            {w.save}
          </Button>
          <Button kind="quiet" size="dense" onClick={() => setOpen(false)}>
            {w.cancel}
          </Button>
        </form>
      )}
      {said && (
        <p role="status" className="text-danger-text">
          {said}
        </p>
      )}
    </div>
  );
}
