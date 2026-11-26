import type { ReactNode } from "react";

import { adminDate } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { dueState } from "@/lib/projects-dates";
import type { ChecklistFeatures } from "@/lib/projects-features";
import type { Priority, ProjectColour } from "@/lib/projects-model";

import { StatusPill } from "./parts";

type Label = { id: string; name: string; colour: ProjectColour };

/**
 * What a task's row says of its fields (D903), shared by a list's rows and the All tasks view: its status, priority, due (late in the danger
 * colour, today in the warning one), category, tags and who does it, only those its list uses. `between` comes after the due date (a
 * list's row puts its repeat there).
 */
export function taskFacts({
  task,
  features,
  status,
  person,
  labels,
  timeZone,
  lang,
  now,
  words,
  between = [],
}: {
  task: { done?: boolean; priority: Priority | null; dueAt: string | null; allDay: boolean | null; categoryId: string | null; tagIds: readonly string[] };
  features: ChecklistFeatures;
  status: { name: string; colour: ProjectColour } | null;
  person: string | null | undefined;
  labels: readonly Label[];
  timeZone: string;
  lang: AdminLang;
  now: Date;
  words: Pick<ProjectsMessages, "priorities" | "due">;
  between?: ReactNode[];
}): ReactNode[] {
  const facts: ReactNode[] = [];
  if (features.status && status) facts.push(<StatusPill key="status" colour={status.colour}>{status.name}</StatusPill>);
  if (features.priority && task.priority) facts.push(<span key="priority" className="text-chip text-ink-2">{words.priorities[task.priority]}</span>);
  if (features.dueDate && task.dueAt) {
    const state = task.done ? "later" : dueState(task.dueAt, task.allDay, now, timeZone);
    facts.push(
      <span key="due" className={`text-chip tabular-nums ${state === "late" ? "text-danger-text" : state === "today" ? "text-warning-text" : "text-ink-2"}`}>
        {fillWords(words.due, { date: adminDate(timeZone, task.dueAt, task.allDay ? "day" : "dayTime", lang) })}
      </span>,
    );
  }
  facts.push(...between);
  const category = features.category ? labels.find((l) => l.id === task.categoryId) : undefined;
  if (category) facts.push(<StatusPill key="category" colour={category.colour}>{category.name}</StatusPill>);
  if (features.tags) for (const tag of labels.filter((l) => task.tagIds.includes(l.id))) facts.push(<StatusPill key={tag.id} colour={tag.colour}>{tag.name}</StatusPill>);
  if (features.assignment && person) facts.push(<span key="person" className="text-chip text-ink-2">{person}</span>);
  return facts;
}
