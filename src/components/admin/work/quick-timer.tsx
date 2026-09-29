"use client";

import { useState } from "react";

import type { AssignmentChoice } from "@/server/work-choices";

import { FormDialogButton } from "./client-actions";
import { LogTimeForm } from "./log-time-form";
import { useWorkTimerApi } from "./timer-context";
import { Field, control, primaryButton } from "./work-parts";

/**
 * Time for the person at the top of the Time page: start a timer on any
 * assignment (and a task of it), or log time by hand. One timer runs per
 * person: starting another stops and logs the one that was running. While a
 * timer runs, it is in the bar above, with Stop.
 */
export function QuickTimer({
  storeSlug,
  choices,
  today,
}: {
  storeSlug: string;
  choices: AssignmentChoice[];
  today: string;
}) {
  const api = useWorkTimerApi();
  const [assignmentId, setAssignmentId] = useState(choices[0]?.id ?? "");
  const [taskId, setTaskId] = useState("");
  const assignment = choices.find((choice) => choice.id === assignmentId);
  const clients = [...new Set(choices.map((choice) => choice.clientId))];

  if (choices.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted">
        There is no active assignment to log time on. Add an assignment to a client to start.
      </p>
    );
  }

  return (
    <section
      aria-labelledby="quick-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
    >
      <h2 id="quick-heading" className="font-medium">
        Track time
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Assignment" className="min-w-56 flex-1">
          {(props) => (
            <select
              {...props}
              value={assignmentId}
              onChange={(event) => {
                setAssignmentId(event.target.value);
                setTaskId("");
              }}
              className={control}
            >
              {clients.map((clientId) => (
                <optgroup key={clientId} label={choices.find((choice) => choice.clientId === clientId)?.clientName}>
                  {choices
                    .filter((choice) => choice.clientId === clientId)
                    .map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.name}
                        {choice.status === "paused" ? " (paused)" : ""}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
        {assignment && assignment.tasks.length > 0 && (
          <Field label="Task (optional)" className="min-w-48">
            {(props) => (
              <select {...props} value={taskId} onChange={(event) => setTaskId(event.target.value)} className={control}>
                <option value="">No task</option>
                {assignment.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                    {task.done ? " (done)" : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {api && (
          <button
            type="button"
            disabled={api.busy || !assignment}
            onClick={() => {
              if (!assignment) return;
              const task = assignment.tasks.find((option) => option.id === taskId);
              api.start({
                assignmentId: assignment.id,
                assignmentName: assignment.name,
                clientId: assignment.clientId,
                clientName: assignment.clientName,
                taskId: task?.id ?? null,
                taskTitle: task?.title ?? null,
              });
            }}
            className={primaryButton}
          >
            Start timer
          </button>
        )}
        <FormDialogButton label="Log time by hand" title="Log time" wide={false}>
          {(close) => (
            <LogTimeForm
              storeSlug={storeSlug}
              today={today}
              choices={choices}
              assignmentId={assignmentId}
              onDone={close}
              onCancel={close}
            />
          )}
        </FormDialogButton>
      </div>
    </section>
  );
}
