"use client";

import { useOptimistic } from "react";

import { Field, Select } from "@/components/admin/ui/field";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";

import { useAct, type ProjectsAct } from "./use-act";

/**
 * Where a list's time goes (D904 P8.3d), drawn on its settings only while the store has Work too: one of Work's assignments, by client, or
 * none. Saved as it is chosen; from then on each task of the list offers *Log time*.
 */
export function ListWork({
  listId,
  assignmentId,
  options,
  canChange,
  words,
  act,
}: {
  listId: string;
  assignmentId: string | null;
  options: { id: string; label: string }[];
  canChange: boolean;
  words: ProjectsMessages["work"];
  act: ProjectsAct;
}) {
  const { run, pending, said } = useAct(act);
  const [shown, show] = useOptimistic(assignmentId ?? "", (_, next: string) => next);

  return (
    <section aria-labelledby="list-work" className="flex flex-col gap-3" data-list-work>
      <h2 id="list-work" className="text-title text-ink">
        {words.heading}
      </h2>
      <p className="text-sm text-muted">{words.text}</p>
      <Field label={words.choose} className="max-w-md">
        {(control) => (
          <Select
            {...control}
            value={shown}
            disabled={!canChange || pending}
            onChange={(e) => {
              const next = e.target.value;
              run({ op: "list.assignment", checklistId: listId, assignmentId: next || null }, undefined, () => show(next));
            }}
            full
          >
            <option value="">{words.none}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>
    </section>
  );
}
