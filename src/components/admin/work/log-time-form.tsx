"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { logTimeAction } from "@/app/admin/(gated)/[store]/work/actions";
import { NO_PROBLEMS, timePayload, type FormProblems } from "@/lib/work-ui";
import type { AssignmentChoice } from "@/server/work-choices";

import { Field, Problems, control, primaryButton, secondaryButton } from "./work-parts";

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * Logs time by hand: the assignment (chosen here when there is more than
 * one), a task if it was on one, the day, how long ("1h30", "1:30", "90m",
 * a bare number is minutes), a note, and whether it is billable. Sent as JSON
 * and checked by `timeEntryInput` in the browser and again on the server; the
 * server refuses a day that has not come yet where the store is.
 */
export function LogTimeForm({
  storeSlug,
  today,
  choices,
  assignmentId,
  taskId,
  onDone,
  onCancel,
}: {
  storeSlug: string;
  /** Today where the store is, `YYYY-MM-DD`: the day it starts on and the latest it can be. */
  today: string;
  choices: AssignmentChoice[];
  /** Preselected. */
  assignmentId?: string;
  taskId?: string | null;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [chosen, setChosen] = useState(assignmentId ?? choices[0]?.id ?? "");
  const [problems, setProblems] = useState<FormProblems>(NO_PROBLEMS);
  const [attempt, setAttempt] = useState(0);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const assignment = choices.find((choice) => choice.id === chosen);
  const tasks = assignment?.tasks ?? [];

  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = timePayload({
      assignmentId: chosen,
      taskId: text(form, "taskId"),
      workDate: text(form, "workDate"),
      duration: text(form, "duration"),
      note: text(form, "note"),
      billable: form.get("billable") === "on",
    });
    if (!payload.ok) {
      setProblems(payload.problems);
      setAttempt((count) => count + 1);
      return;
    }
    setProblems(NO_PROBLEMS);
    start(async () => {
      try {
        const result = await logTimeAction(storeSlug, payload.input);
        if (!result.ok) setProblems({ fields: {}, general: result.problems });
        else onDone?.();
      } catch {
        setProblems({ fields: {}, general: ["The time could not be saved. Check your connection and try again."] });
      }
    });
  };

  const err = (name: string) => problems.fields[name];
  const summary = [
    ...problems.general,
    ...(Object.keys(problems.fields).length > 0 ? ["Some fields need another look. They are marked below."] : []),
  ];

  if (choices.length === 0) {
    return (
      <p className="text-sm text-muted">There is no assignment to log time on. Add an assignment to a client first.</p>
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-4">
      {choices.length > 1 && (
        <Field label="Assignment" error={err("assignmentId")}>
          {(props) => (
            <select {...props} value={chosen} onChange={(event) => setChosen(event.target.value)} className={control}>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.clientName}: {choice.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {tasks.length > 0 && (
        // Keyed on the assignment so a change of assignment starts with no task, and opening from a task row starts on it.
        <Field key={chosen} label="Task (optional)">
          {(props) => (
            <select
              {...props}
              name="taskId"
              defaultValue={chosen === assignmentId ? (taskId ?? "") : ""}
              className={control}
            >
              <option value="">No task</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                  {task.done ? " (done)" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Day" error={err("workDate")}>
          {(props) => (
            <input
              {...props}
              name="workDate"
              type="date"
              required
              max={today}
              defaultValue={today}
              className={control}
            />
          )}
        </Field>
        <Field label="Time" error={err("duration")} hint="1h30, 1:30, 1.5h or 90m. A plain number is minutes.">
          {(props) => (
            <input
              {...props}
              name="duration"
              required
              autoFocus
              autoComplete="off"
              placeholder="1h30"
              className={control}
            />
          )}
        </Field>
      </div>
      <Field label="Note" error={err("note")} hint="What you did. Optional.">
        {(props) => <input {...props} name="note" maxLength={500} autoComplete="off" className={control} />}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="billable" defaultChecked className="size-4" />
        Billable
      </label>
      <Problems messages={summary} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving …" : "Log time"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
