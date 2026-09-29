"use client";

import { useMemo, useState } from "react";

import { NO_TASK_FILTER, filterTimeEntries, formatDuration, totalMinutes } from "@/lib/work-time";
import type { AssignmentChoice } from "@/server/work-choices";
import type { TimeEntryItem } from "@/server/work-time";

import { FormDialogButton } from "./client-actions";
import { LogTimeForm } from "./log-time-form";
import { TimeEntryList } from "./time-entry-list";
import { control } from "./work-parts";

/**
 * An assignment's logged time: the entries with a search and a task filter (in
 * the browser), the total of what is shown, and "Log time" for a manual entry.
 * The clock is started on the assignment or its tasks; stopping it adds an
 * entry here.
 */
export function TimePanel({
  storeSlug,
  choice,
  entries,
  today,
  viewer,
  locale,
  truncated,
}: {
  storeSlug: string;
  /** The assignment, with its tasks, for the log-time form. */
  choice: AssignmentChoice;
  entries: TimeEntryItem[];
  today: string;
  viewer: { accountId: string; owner: boolean };
  locale: string;
  /** There is more time than was loaded. */
  truncated: boolean;
}) {
  const [query, setQuery] = useState("");
  const [task, setTask] = useState("");
  const shown = useMemo(() => filterTimeEntries(entries, { taskId: task || null, query }), [entries, task, query]);
  const filtered = query.trim() !== "" || task !== "";

  return (
    <section aria-labelledby="time-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="time-heading" className="text-lg font-semibold">
          Time
        </h2>
        <FormDialogButton label="Log time" title="Log time" primary wide={false}>
          {(close) => (
            <LogTimeForm
              storeSlug={storeSlug}
              today={today}
              choices={[choice]}
              assignmentId={choice.id}
              onDone={close}
              onCancel={close}
            />
          )}
        </FormDialogButton>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
            Search time
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Task or note"
              className={control}
              autoComplete="off"
            />
          </label>
          {choice.tasks.length > 0 && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Task
              <select value={task} onChange={(event) => setTask(event.target.value)} className={control}>
                <option value="">All tasks</option>
                <option value={NO_TASK_FILTER}>No task</option>
                {choice.tasks.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {entries.length > 0 && (
        <p role="status" className="text-sm text-muted">
          {filtered
            ? `${shown.length} of ${entries.length} ${entries.length === 1 ? "entry" : "entries"}, ${formatDuration(totalMinutes(shown))}`
            : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}, ${formatDuration(totalMinutes(entries))}`}
          {truncated && " (the most recent are shown)"}
        </p>
      )}
      <TimeEntryList
        storeSlug={storeSlug}
        entries={shown}
        viewer={viewer}
        showAssignment={false}
        locale={locale}
        empty={entries.length === 0 ? "No time logged yet. Log time by hand, or start a timer." : "No time matches."}
      />
    </section>
  );
}
