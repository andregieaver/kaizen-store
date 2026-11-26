"use client";

import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { Field, Select, TextInput } from "@/components/admin/ui/field";
import { AdminLink } from "@/components/admin/ui/link";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectSourcesMessages } from "@/lib/admin-messages/project-sources.en";
import type { TaskLink } from "@/lib/projects-sources";

import { useAct, type ProjectsAct } from "./use-act";

export type SourceTaskView = { id: string; title: string; done: boolean; checklistId: string; listTitle: string };

/**
 * The tasks of an order, a return, a review or a support conversation (D904 P8.3a), or about a customer (P4.7): a pair of the octopus, drawn
 * by the page only while the store has Projects and the page's own arm. Homer sees the tasks and ticks them off, and *Make a task* opens one field with a
 * title already written and the list it goes to (the store's list for follow-ups unless he picks another). Each task links to its list.
 */
export function SourceTasks({
  base,
  source,
  label,
  tasks,
  lists,
  canChange,
  words: w,
  act,
}: {
  /** `/admin/{store}`. */
  base: string;
  /** What the page is about: a source, or a customer (P4.7). */
  source: TaskLink;
  /** What the source is called (an order's number), for the suggested title; none for a conversation or a customer. */
  label: string | null;
  tasks: SourceTaskView[];
  lists: { id: string; title: string }[];
  canChange: boolean;
  words: ProjectSourcesMessages;
  act: ProjectsAct;
}) {
  const { run, pending, said } = useAct(act);
  const [open, setOpen] = useState(false);
  const suggested = fillWords(w.suggested[source.kind], { label: label ?? "" }).trim();
  const [title, setTitle] = useState(suggested);
  const followUps = lists.find((l) => l.title === w.followUps);
  const [list, setList] = useState(followUps?.id ?? "");
  const others = lists.filter((l) => l.id !== followUps?.id);

  return (
    <section aria-labelledby="source-tasks" className="rounded-lg border border-line bg-card p-5 text-sm" data-source-tasks={source.kind}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="source-tasks" className="text-title text-ink">
          {w.heading}
        </h2>
        {canChange && !open && (
          <Button kind="quiet" size="dense" onClick={() => setOpen(true)}>
            {w.make}
          </Button>
        )}
      </div>
      {tasks.length === 0 && !open && <EmptyState compact title={w.none} />}
      {tasks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={task.done}
                disabled={!canChange || pending}
                onChange={() => run({ op: "item.done", id: task.id, done: !task.done })}
                aria-label={fillWords(w.tick, { title: task.title })}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <span className="flex min-w-0 flex-col">
                <span className={task.done ? "text-muted line-through" : "text-ink"}>{task.title}</span>
                <AdminLink href={`${base}/checklists/${task.checklistId}`} className="text-chip text-muted underline-offset-2 hover:underline">
                  {fillWords(w.inList, { list: task.listTitle })}
                </AdminLink>
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run({ op: "item.addFrom", kind: source.kind, sourceId: source.id, title, checklistId: list || null }, (answer) => {
              if (answer.ok) setOpen(false);
            });
          }}
        >
          <Field label={w.title} required>
            {(control) => <TextInput {...control} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} autoFocus full />}
          </Field>
          <Field label={w.list}>
            {(control) => (
              <Select {...control} value={list} onChange={(e) => setList(e.target.value)} full>
                <option value={followUps?.id ?? ""}>{followUps ? followUps.title : fillWords(w.newList, { name: w.followUps })}</option>
                {others.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex gap-2">
            <Button kind="main" size="dense" type="submit" disabled={pending || title.trim() === ""}>
              {w.save}
            </Button>
            <Button kind="quiet" size="dense" onClick={() => setOpen(false)}>
              {w.cancel}
            </Button>
          </div>
        </form>
      )}
      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>
    </section>
  );
}
