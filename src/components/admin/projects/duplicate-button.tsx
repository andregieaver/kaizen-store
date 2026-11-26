"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Modal } from "@/components/admin/modal";
import { Button } from "@/components/admin/ui/button";
import { Field, TextInput } from "@/components/admin/ui/field";

import { useAct, type ProjectsAct } from "./use-act";

/**
 * Duplicate a list (D903 P4.2, Life's `duplicate-checklist-modal.tsx`): the copy is named before it is made, since a copy is nearly always
 * the start of a variant (this week's, the same for another shop). The name is filled in and chosen, so the quick way stays open and Enter;
 * the page then moves to the copy.
 */
export function DuplicateButton({
  listId,
  name,
  base,
  act,
  words,
}: {
  listId: string;
  /** The copy's name as it starts: "{title} (copy)" in the person's language. */
  name: string;
  base: string;
  act: ProjectsAct;
  words: { label: string; title: string; field: string; hint: string; submit: string; cancel: string };
}) {
  const router = useRouter();
  const { run, pending, said } = useAct(act);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(name);
  const make = () => run({ op: "list.duplicate", id: listId, title }, (answer) => answer.ok && answer.id && router.push(`${base}/checklists/${answer.id}`));
  return (
    <>
      <Button onClick={() => setOpen(true)}>{words.label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={words.title}>
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) make();
          }}
        >
          <Field label={words.field} hint={words.hint} required>
            {(control) => <TextInput {...control} value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.target.select()} maxLength={200} autoFocus full />}
          </Field>
          <p role="status" aria-live="polite" className="text-sm text-danger-text">
            {said}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button kind="quiet" onClick={() => setOpen(false)}>
              {words.cancel}
            </Button>
            <Button type="submit" kind="main" disabled={pending || !title.trim()} aria-busy={pending}>
              {words.submit}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
