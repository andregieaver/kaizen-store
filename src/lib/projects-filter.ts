/**
 * Filters on a checklist's tasks (D903 P4.11, Life's `checklist-item-filter.tsx`): by status, by who does it, by priority and by when it is
 * due. Within a group any chosen value matches; across groups every group must; an empty group matches all. Each value is counted over the
 * whole list, not the filtered view, so a count says what choosing it would give rather than what is already shown. Pure.
 */

import { dueState } from "./projects-dates";
import type { Priority } from "./projects-model";
import { addCalendarDays, dayIn } from "./work-dates";

export const DUE_FILTERS = ["late", "today", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

/** Who does it: an account's id, or `nobody`. A priority, or `none`. */
export type TaskFilter = { statuses: string[]; people: string[]; priorities: string[]; due: DueFilter[] };
export const NO_FILTER: TaskFilter = { statuses: [], people: [], priorities: [], due: [] };

export type FilterTask = { statusId: string | null; assignedTo: string | null; priority: Priority | null; dueAt: string | null; allDay: boolean | null };

export const isFiltering = (filter: TaskFilter): boolean => Object.values(filter).some((values) => values.length > 0);

/** The due groups a task is in: late, today, within the week to come (today counts), or no date. */
export function dueGroups(task: FilterTask, now: Date, timeZone: string): DueFilter[] {
  if (!task.dueAt) return ["none"];
  const state = dueState(task.dueAt, task.allDay, now, timeZone);
  if (state === "late") return ["late"];
  const week = dayIn(task.dueAt, timeZone) <= addCalendarDays(dayIn(now, timeZone), 6);
  return state === "today" ? ["today", "week"] : week ? ["week"] : [];
}

/** The values a task has in each group. */
function valuesOf(task: FilterTask, now: Date, timeZone: string): TaskFilter {
  return {
    statuses: task.statusId ? [task.statusId] : [],
    people: [task.assignedTo ?? "nobody"],
    priorities: [task.priority ?? "none"],
    due: dueGroups(task, now, timeZone),
  };
}

export function matches(task: FilterTask, filter: TaskFilter, now: Date, timeZone: string): boolean {
  const has = valuesOf(task, now, timeZone);
  return (Object.keys(filter) as (keyof TaskFilter)[]).every((group) => filter[group].length === 0 || filter[group].some((v) => (has[group] as string[]).includes(v)));
}

/** How many of the tasks have each value, group by group. */
export function filterCounts(tasks: readonly FilterTask[], now: Date, timeZone: string): Record<keyof TaskFilter, Map<string, number>> {
  const counts = { statuses: new Map<string, number>(), people: new Map<string, number>(), priorities: new Map<string, number>(), due: new Map<string, number>() };
  for (const task of tasks) {
    const has = valuesOf(task, now, timeZone);
    for (const group of Object.keys(counts) as (keyof TaskFilter)[]) for (const v of has[group]) counts[group].set(v, (counts[group].get(v) ?? 0) + 1);
  }
  return counts;
}

/** A value chosen or taken away in a group. */
export function toggled(filter: TaskFilter, group: keyof TaskFilter, value: string): TaskFilter {
  const values = filter[group] as string[];
  return { ...filter, [group]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] };
}
