"use client";

import { useOptimistic, useState, type ReactNode } from "react";

import { Button } from "@/components/admin/ui/button";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { AdminLink } from "@/components/admin/ui/link";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { ALL_FEATURES, type ChecklistFeatures } from "@/lib/projects-features";
import { isFiltering, matches, NO_FILTER, type TaskFilter } from "@/lib/projects-filter";
import type { Priority, ProjectColour } from "@/lib/projects-model";

import type { ViewLabel } from "./checklist-view";
import { taskFacts } from "./task-facts";
import { TaskFilterPanel } from "./task-filter";
import { useAct, type ProjectsAct } from "./use-act";

export type AllTask = {
  id: string;
  title: string;
  checklistId: string;
  checklistTitle: string;
  features: ChecklistFeatures;
  statusId: string | null;
  status: { name: string; colour: ProjectColour } | null;
  assignedTo: string | null;
  priority: Priority | null;
  dueAt: string | null;
  allDay: boolean | null;
  categoryId: string | null;
  tagIds: string[];
};

/** Across lists a status is each list's own, so the filters offer who does it, priority, due, category and tags. */
const ACROSS: ChecklistFeatures = { ...ALL_FEATURES, status: false };

/**
 * Every open task of the store's open lists (D903 P4.8, Life's *All items*), the soonest due first: Homer sees what is next wherever it is
 * and ticks it off here; each task names its list, a link to it. Lisa filters them as on a list (P4.11). Only the fields a task's own list
 * uses are shown.
 */
export function AllTasks({
  tasks,
  labels,
  team,
  base,
  timeZone,
  lang,
  now,
  canChange,
  words,
  act,
}: {
  tasks: AllTask[];
  labels: ViewLabel[];
  team: { id: string; name: string }[];
  base: string;
  timeZone: string;
  lang: AdminLang;
  now: string;
  canChange: boolean;
  words: Pick<ProjectsMessages, "checklist" | "filter" | "priorities" | "due" | "checklists">;
  act: ProjectsAct;
}) {
  const { run, said } = useAct(act);
  const [ticked, tick] = useOptimistic(new Set<string>(), (state, id: string) => new Set(state).add(id));
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);
  const at = new Date(now);
  const open = tasks.filter((t) => !ticked.has(t.id));
  const shown = open.filter((t) => matches(t, filter, at, timeZone));
  const filtering = isFiltering(filter);

  if (tasks.length === 0) return <EmptyState compact title={words.checklists.noOpenTasks} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{filtering ? fillWords(words.filter.showing, { shown: shown.length, total: open.length }) : countWords(open.length, words.checklists.leadOpen)}</p>
        <Button kind="quiet" size="dense" aria-expanded={filterOpen} onClick={() => setFilterOpen((o) => !o)}>
          {filtering ? countWords(Object.values(filter).flat().length, words.filter.active) : words.filter.open}
        </Button>
      </div>
      {filterOpen && (
        <TaskFilterPanel
          tasks={open}
          filter={filter}
          onChange={setFilter}
          features={ACROSS}
          statuses={[]}
          team={team}
          now={at}
          timeZone={timeZone}
          words={words.filter}
          priorityNames={words.priorities}
          labels={labels}
        />
      )}
      {shown.length === 0 ? (
        <EmptyState compact title={words.filter.nothing} />
      ) : (
        <ul className="flex flex-col rounded-panel border border-line bg-card">
          {shown.map((task) => {
            const facts: ReactNode[] = [];
            const f = task.features;
            facts.push(
              <AdminLink key="list" href={`${base}/${task.checklistId}`} className="text-chip text-ink-2 underline-offset-2 hover:underline">
                {task.checklistTitle}
              </AdminLink>,
            );
            facts.push(
              ...taskFacts({ task, features: f, status: task.status, person: team.find((p) => p.id === task.assignedTo)?.name, labels, timeZone, lang, now: at, words }),
            );
            return (
              <li key={task.id} className="flex items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                <input
                  type="checkbox"
                  checked={false}
                  disabled={!canChange}
                  onChange={() => run({ op: "item.done", id: task.id, done: true }, undefined, () => tick(task.id))}
                  aria-label={fillWords(words.checklist.tick, { title: task.title })}
                  className="mt-1 size-4 shrink-0 accent-brand"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-body text-ink">{task.title}</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">{facts}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>
    </div>
  );
}
