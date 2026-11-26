"use client";

import { X } from "lucide-react";
import { useOptimistic, useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { Select } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import type { ProjectColour } from "@/lib/projects-model";

import { StatusPill } from "./parts";
import { useAct, type ProjectsAct } from "./use-act";

export type ProjectListView = {
  id: string;
  title: string;
  href: string;
  home: boolean;
  progress: string;
  tasks: { id: string; title: string; done: boolean; status: { name: string; colour: ProjectColour } | null; facts: string[] }[];
};

/**
 * A project's List view (D903, Life's `task-project-list.tsx` and `project-checklists-section.tsx`): each of its checklists with its open
 * tasks to tick, its home marked, and a way to take it out; under them an existing list can be added. A task is opened on its list's page.
 */
export function ProjectLists({
  projectId,
  lists,
  addable,
  canChange,
  words,
  act,
}: {
  projectId: string;
  lists: ProjectListView[];
  addable: { id: string; title: string }[];
  canChange: boolean;
  words: Pick<ProjectsMessages, "project" | "checklist">;
  act: ProjectsAct;
}) {
  const w = words.project;
  const { run, said } = useAct(act);
  const [ticked, tick] = useOptimistic(new Map<string, boolean>(), (state, change: { id: string; done: boolean }) => new Map(state).set(change.id, change.done));
  const [choice, setChoice] = useState("");

  return (
    <div className="flex flex-col gap-4">
      {lists.map((list) => (
        <section key={list.id} aria-labelledby={`list-${list.id}`} className="flex flex-col gap-2 rounded-panel border border-line bg-card p-4">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={`list-${list.id}`} className="text-title">
              <a href={list.href} className="text-ink underline-offset-2 hover:underline" aria-label={fillWords(w.openList, { title: list.title })}>
                {list.title}
              </a>
            </h2>
            {list.home && <span className="text-chip text-ink-2">{w.home}</span>}
            <span className="text-sm text-muted">{list.progress}</span>
            {canChange && (
              <Button
                kind="icon"
                size="dense"
                className="ml-auto"
                aria-label={fillWords(w.unlink, { title: list.title })}
                onClick={() => run({ op: "project.unlink", projectId, checklistId: list.id })}
              >
                <X />
              </Button>
            )}
          </header>
          {list.tasks.length > 0 && (
            <ul className="flex flex-col divide-y divide-line">
              {list.tasks.map((task) => {
                const done = ticked.get(task.id) ?? task.done;
                return (
                  <li key={task.id} className="flex items-start gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={!canChange}
                      aria-label={fillWords(words.checklist.tick, { title: task.title })}
                      onChange={(e) => {
                        const next = e.target.checked;
                        run({ op: "item.done", id: task.id, done: next }, undefined, () => tick({ id: task.id, done: next }));
                      }}
                      className="mt-1 size-4 shrink-0 accent-brand"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className={`text-body ${done ? "text-muted line-through" : "text-ink"}`}>{task.title}</span>
                      {(task.status || task.facts.length > 0) && (
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-chip text-ink-2">
                          {task.status && <StatusPill colour={task.status.colour}>{task.status.name}</StatusPill>}
                          {task.facts.map((fact) => (
                            <span key={fact}>{fact}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
      {canChange && addable.length > 0 && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (choice) run({ op: "project.link", projectId, checklistId: choice }, (answer) => answer.ok && setChoice(""));
          }}
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
            {w.linkLabel}
            <Select value={choice} onChange={(e) => setChoice(e.target.value)} full>
              <option value="">{w.linkChoose}</option>
              {addable.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" disabled={!choice}>
            {w.link}
          </Button>
        </form>
      )}
      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>
    </div>
  );
}
