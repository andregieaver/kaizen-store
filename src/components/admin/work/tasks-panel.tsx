"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useRef, useState, useTransition } from "react";

import {
  createTaskAction,
  deleteTaskAction,
  renameTaskAction,
  reorderTasksAction,
  setTaskEstimateAction,
  setTaskStatusAction,
} from "@/app/admin/(gated)/[store]/work/actions";
import { formatDuration } from "@/lib/work-time";
import { liveMinutes } from "@/lib/work-timer-ui";
import {
  NO_PROBLEMS,
  STAGE_STYLES,
  estimateField,
  moveId,
  readEstimate,
  remainingLabel,
  stageOf,
  taskPayload,
  type FormProblems,
} from "@/lib/work-ui";
import type { WorkTaskItem } from "@/server/work";
import type { AssignmentChoice } from "@/server/work-choices";

import { Modal } from "../modal";
import { LogTimeForm } from "./log-time-form";
import { useWorkTimerApi } from "./timer-context";
import { TimerToggle } from "./timer-controls";
import { Problems, errorText, primaryButton, smallButton, smallControl } from "./work-parts";

type PendingAdd = { key: string; title: string; estimatedMinutes: number | null; serverId?: string };

let counter = 0;

/**
 * An assignment's tasks: added rapidly (type, Enter, type the next), renamed in
 * place, marked done, given an estimate, started on a timer, dragged into
 * order or moved with the Up and Down buttons (the keyboard's way), and
 * deleted. A new task shows the moment Enter is pressed and the server catches
 * up behind; if it refuses, the row goes and what was typed comes back. Time
 * against each estimate moves with the running timer.
 */
export function TasksPanel({
  storeSlug,
  assignmentId,
  assignmentName,
  clientId,
  clientName,
  tasks,
  alertMinutes,
  choice,
  today,
}: {
  storeSlug: string;
  assignmentId: string;
  assignmentName: string;
  clientId: string;
  clientName: string;
  tasks: WorkTaskItem[];
  /** The assignment's warning threshold, for the colour of what is left. */
  alertMinutes: number | null;
  /** The assignment with its tasks, for "Log time" on a task. */
  choice: AssignmentChoice;
  today: string;
}) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [seen, setSeen] = useState(tasks);
  const [adds, setAdds] = useState<PendingAdd[]>([]);
  if (tasks !== seen) {
    // The server's list is what the page shows now: it is in the order the server has, and knows the new tasks.
    setSeen(tasks);
    setOrder(null);
    setAdds((current) => current.filter((add) => !add.serverId));
  }

  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState("");
  const [addProblems, setAddProblems] = useState<FormProblems>(NO_PROBLEMS);
  const [listProblems, setListProblems] = useState<string[]>([]);
  const [logFor, setLogFor] = useState<string | null | undefined>(undefined);
  const [, startReorder] = useTransition();
  const titleInput = useRef<HTMLInputElement>(null);
  const dndId = useId();

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const serverIds = tasks.map((task) => task.id);
  const ids = (order ?? serverIds)
    .filter((id) => byId.has(id))
    .concat(serverIds.filter((id) => !(order ?? serverIds).includes(id)));
  const shownAdds = adds.filter((add) => !(add.serverId && byId.has(add.serverId)));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const arrange = (next: string[]) => {
    const before = order;
    setOrder(next);
    setListProblems([]);
    startReorder(async () => {
      try {
        const result = await reorderTasksAction(storeSlug, assignmentId, next);
        if (!result.ok) {
          setOrder(before);
          setListProblems(result.problems);
        }
      } catch {
        setOrder(before);
        setListProblems(["The order could not be saved. Check your connection and try again."]);
      }
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    arrange(moveId(ids, String(active.id), to - from));
  };

  const add = () => {
    const payload = taskPayload(assignmentId, title, estimate);
    if (!payload.ok) {
      // An empty name is not an error worth shouting about while typing; only what is wrong with what was typed.
      setAddProblems(
        title.trim() === "" && Object.keys(payload.problems.fields).length === 1 ? NO_PROBLEMS : payload.problems,
      );
      return;
    }
    setAddProblems(NO_PROBLEMS);
    const key = `add-${++counter}`;
    const typed = { title, estimate };
    setAdds((current) => [
      ...current,
      { key, title: payload.input.title.trim(), estimatedMinutes: payload.input.estimatedMinutes ?? null },
    ]);
    setTitle("");
    setEstimate("");
    titleInput.current?.focus();
    void createTaskAction(storeSlug, payload.input)
      .then((result) => {
        if (result.ok) {
          setAdds((current) => current.map((entry) => (entry.key === key ? { ...entry, serverId: result.id } : entry)));
        } else {
          setAdds((current) => current.filter((entry) => entry.key !== key));
          setTitle((now) => now || typed.title);
          setEstimate((now) => now || typed.estimate);
          setAddProblems({ fields: {}, general: result.problems });
        }
      })
      .catch(() => {
        setAdds((current) => current.filter((entry) => entry.key !== key));
        setTitle((now) => now || typed.title);
        setAddProblems({ fields: {}, general: ["The task could not be saved. Check your connection and try again."] });
      });
  };

  const addMessages = [...addProblems.general, ...Object.values(addProblems.fields)];
  const empty = ids.length === 0 && shownAdds.length === 0;

  return (
    <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
      <h2 id="tasks-heading" className="text-lg font-semibold">
        Tasks
      </h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
        aria-label="Add a task"
        className="flex flex-wrap items-start gap-2"
      >
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={`${dndId}-title`} className="sr-only">
            New task
          </label>
          <input
            ref={titleInput}
            id={`${dndId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="New task, then Enter"
            autoComplete="off"
            className="min-h-10 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${dndId}-estimate`} className="sr-only">
            Estimate for the new task
          </label>
          <input
            id={`${dndId}-estimate`}
            value={estimate}
            onChange={(event) => setEstimate(event.target.value)}
            placeholder="Estimate"
            autoComplete="off"
            aria-invalid={addProblems.fields.estimate ? true : undefined}
            aria-describedby={addProblems.fields.estimate ? `${dndId}-estimate-error` : undefined}
            className="min-h-10 w-28 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <button type="submit" className={primaryButton}>
          Add task
        </button>
      </form>
      <p className="text-xs text-muted">The estimate is hours, or 1h30, 1:30 or 90m. Leave it empty for none.</p>
      {addProblems.fields.estimate && (
        <p id={`${dndId}-estimate-error`} className={errorText}>
          {addProblems.fields.estimate}
        </p>
      )}
      <Problems messages={addMessages.filter((message) => message !== addProblems.fields.estimate)} />
      <Problems messages={listProblems} />

      {empty ? (
        <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted">
          No tasks yet. Tasks split the job into parts you can estimate, time and tick off. They are optional.
        </p>
      ) : (
        <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-border rounded-lg border border-border bg-background">
              {ids.map((id, index) => {
                const task = byId.get(id)!;
                return (
                  <TaskRow
                    key={id}
                    storeSlug={storeSlug}
                    task={task}
                    assignmentId={assignmentId}
                    assignmentName={assignmentName}
                    clientId={clientId}
                    clientName={clientName}
                    alertMinutes={alertMinutes}
                    first={index === 0}
                    last={index === ids.length - 1}
                    onMove={(delta) => arrange(moveId(ids, id, delta))}
                    onLogTime={() => setLogFor(id)}
                  />
                );
              })}
              {shownAdds.map((entry) => (
                <li key={entry.key} className="flex items-center gap-3 px-4 py-3 text-sm text-muted" aria-busy="true">
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{entry.title}</span>
                  {entry.estimatedMinutes !== null && (
                    <span className="tabular-nums">{formatDuration(entry.estimatedMinutes)}</span>
                  )}
                  <span>Saving …</span>
                </li>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <Modal open={logFor !== undefined} onClose={() => setLogFor(undefined)} title="Log time" wide={false}>
        <LogTimeForm
          storeSlug={storeSlug}
          today={today}
          choices={[choice]}
          assignmentId={assignmentId}
          taskId={logFor ?? null}
          onDone={() => setLogFor(undefined)}
          onCancel={() => setLogFor(undefined)}
        />
      </Modal>
    </section>
  );
}

function TaskRow({
  storeSlug,
  task,
  assignmentId,
  assignmentName,
  clientId,
  clientName,
  alertMinutes,
  first,
  last,
  onMove,
  onLogTime,
}: {
  storeSlug: string;
  task: WorkTaskItem;
  assignmentId: string;
  assignmentName: string;
  clientId: string;
  clientName: string;
  alertMinutes: number | null;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  onLogTime: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const api = useWorkTimerApi();
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);

  // What is typed in the row's own fields, until the server's value replaces it.
  const [draft, setDraft] = useState(task.title);
  const [seenTitle, setSeenTitle] = useState(task.title);
  const [estimate, setEstimate] = useState(estimateField(task.estimatedMinutes));
  const [seenEstimate, setSeenEstimate] = useState(task.estimatedMinutes);
  const [done, setDone] = useState(task.status === "done");
  const [seenStatus, setSeenStatus] = useState(task.status);
  if (task.title !== seenTitle) {
    setSeenTitle(task.title);
    setDraft(task.title);
  }
  if (task.estimatedMinutes !== seenEstimate) {
    setSeenEstimate(task.estimatedMinutes);
    setEstimate(estimateField(task.estimatedMinutes));
  }
  if (task.status !== seenStatus) {
    setSeenStatus(task.status);
    setDone(task.status === "done");
  }

  const run = (action: () => Promise<{ ok: true } | { ok: false; problems: string[] }>, undo?: () => void) =>
    start(async () => {
      try {
        const result = await action();
        if (result.ok) setProblems([]);
        else {
          setProblems(result.problems);
          undo?.();
        }
      } catch {
        setProblems(["That did not work. Check your connection and try again."]);
        undo?.();
      }
    });

  const commitTitle = () => {
    const next = draft.trim();
    if (next === task.title) return setDraft(task.title);
    if (next === "") {
      setDraft(task.title);
      return setProblems(["A task needs a name."]);
    }
    run(
      () => renameTaskAction(storeSlug, task.id, next),
      () => setDraft(task.title),
    );
  };

  const commitEstimate = () => {
    const read = readEstimate(estimate);
    if (!read.ok) {
      setProblems([read.message]);
      return;
    }
    if (read.minutes === task.estimatedMinutes) return setEstimate(estimateField(task.estimatedMinutes));
    run(
      () => setTaskEstimateAction(storeSlug, task.id, read.minutes),
      () => setEstimate(estimateField(task.estimatedMinutes)),
    );
  };

  const live = api ? liveMinutes(api.timer, api.pendingEntry, api.now, { assignmentId, taskId: task.id }) : 0;
  const logged = task.loggedMinutes + live;
  const remaining = task.estimatedMinutes === null ? null : task.estimatedMinutes - logged;
  const stage = stageOf(remaining, alertMinutes);
  const style = STAGE_STYLES[stage];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : null), transition }}
      className={`flex flex-col gap-2 px-3 py-3 sm:px-4 ${isDragging ? "relative z-10 bg-surface shadow-md" : ""}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${task.title} to reorder`}
          className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted hover:bg-surface active:cursor-grabbing"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
        <input
          type="checkbox"
          checked={done}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked;
            setDone(next);
            run(
              () => setTaskStatusAction(storeSlug, task.id, next ? "done" : "open"),
              () => setDone(!next),
            );
          }}
          aria-label={`${task.title} is done`}
          className="size-5 shrink-0"
        />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(task.title);
              event.currentTarget.blur();
            }
          }}
          maxLength={200}
          aria-label={`Name of ${task.title}`}
          className={`min-h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-border focus:border-border ${done ? "text-muted line-through" : ""}`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-11">
        <label className="flex items-center gap-1 text-xs text-muted">
          Estimate
          <input
            value={estimate}
            onChange={(event) => setEstimate(event.target.value)}
            onBlur={commitEstimate}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setEstimate(estimateField(task.estimatedMinutes));
                event.currentTarget.blur();
              }
            }}
            placeholder="None"
            autoComplete="off"
            aria-label={`Estimate for ${task.title}`}
            className={`${smallControl} w-24 text-foreground`}
          />
        </label>
        <span className="text-xs tabular-nums">
          {formatDuration(logged)} logged
          {remaining !== null && <span className={`ml-2 ${style.text}`}>{remainingLabel(remaining)}</span>}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <TimerToggle
            target={{ assignmentId, assignmentName, clientId, clientName, taskId: task.id, taskTitle: task.title }}
            subject={task.title}
          />
          <button type="button" onClick={onLogTime} className={smallButton}>
            Log time<span className="sr-only"> on {task.title}</span>
          </button>
          <button type="button" onClick={() => onMove(-1)} disabled={first || pending} className={smallButton}>
            Move up<span className="sr-only"> {task.title}</span>
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={last || pending} className={smallButton}>
            Move down<span className="sr-only"> {task.title}</span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Delete the task ${task.title}? Time logged on it stays on the assignment.`)) return;
              run(() => deleteTaskAction(storeSlug, task.id));
            }}
            className="min-h-9 px-2 text-sm text-red-700 underline disabled:opacity-50 dark:text-red-400"
          >
            Delete<span className="sr-only"> {task.title}</span>
          </button>
        </span>
      </div>
      <Problems messages={problems} />
    </li>
  );
}
