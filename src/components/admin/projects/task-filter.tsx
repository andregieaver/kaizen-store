"use client";

import { Button } from "@/components/admin/ui/button";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import type { ChecklistFeatures } from "@/lib/projects-features";
import { DUE_FILTERS, filterCounts, toggled, type FilterTask, type TaskFilter } from "@/lib/projects-filter";
import { PRIORITIES } from "@/lib/projects-model";

import { ColourDot } from "./parts";
import { Toggle } from "./toggle";
import type { ViewStatus } from "./checklist-view";

export type FilterWords = ProjectsMessages["filter"];

type Option = { value: string; label: string; colour?: ViewStatus["colour"] };

/**
 * The filters of a checklist (D903 P4.11, Life's `checklist-item-filter.tsx`): one group for each field the list uses, offering only the
 * values its tasks have, each with how many of the list's tasks have it. Choosing narrows the list at once; Clear takes every filter off.
 */
export function TaskFilterPanel({
  tasks,
  filter,
  onChange,
  features,
  statuses,
  team,
  now,
  timeZone,
  words,
  priorityNames,
}: {
  tasks: readonly FilterTask[];
  filter: TaskFilter;
  onChange: (next: TaskFilter) => void;
  features: ChecklistFeatures;
  statuses: ViewStatus[];
  team: { id: string; name: string }[];
  now: Date;
  timeZone: string;
  words: FilterWords;
  priorityNames: ProjectsMessages["priorities"];
}) {
  const counts = filterCounts(tasks, now, timeZone);
  const inUse = (group: keyof TaskFilter, options: Option[]) => options.filter((o) => (counts[group].get(o.value) ?? 0) > 0 || (filter[group] as string[]).includes(o.value));
  const groups: { group: keyof TaskFilter; legend: string; options: Option[] }[] = [
    ...(features.status ? [{ group: "statuses" as const, legend: words.status, options: inUse("statuses", statuses.map((s) => ({ value: s.id, label: s.name, colour: s.colour }))) }] : []),
    ...(features.assignment
      ? [{ group: "people" as const, legend: words.people, options: inUse("people", [...team.map((p) => ({ value: p.id, label: p.name })), { value: "nobody", label: words.nobody }]) }]
      : []),
    ...(features.priority
      ? [{ group: "priorities" as const, legend: words.priority, options: inUse("priorities", [...[...PRIORITIES].reverse().map((p) => ({ value: p, label: priorityNames[p] })), { value: "none", label: words.none }]) }]
      : []),
    ...(features.dueDate ? [{ group: "due" as const, legend: words.due, options: inUse("due", DUE_FILTERS.map((d) => ({ value: d, label: words.dueNames[d] }))) }] : []),
  ].filter((g) => g.options.length > 1 || (g.options.length === 1 && (filter[g.group] as string[]).length > 0));

  if (groups.length === 0) return <EmptyState compact title={words.nothingToFilter} />;
  return (
    <div role="group" aria-label={words.label} className="flex flex-col gap-3 rounded-panel bg-sunken p-4">
      {groups.map(({ group, legend, options }) => (
        <div key={group} role="group" aria-label={legend} className="flex flex-wrap items-center gap-1.5">
          <span className="w-full text-sm font-medium text-ink sm:w-32">{legend}</span>
          {options.map((o) => {
            const n = counts[group].get(o.value) ?? 0;
            return (
              <Toggle key={o.value} on={(filter[group] as string[]).includes(o.value)} onClick={() => onChange(toggled(filter, group, o.value))} label={fillWords(words.option, { name: o.label, n })}>
                {o.colour && <ColourDot colour={o.colour} size="size-2" />}
                {o.label}
                <span className="tabular-nums opacity-70">{n}</span>
              </Toggle>
            );
          })}
        </div>
      ))}
      <Button kind="quiet" size="dense" className="self-start" onClick={() => onChange({ statuses: [], people: [], priorities: [], due: [] })}>
        {words.clear}
      </Button>
    </div>
  );
}
