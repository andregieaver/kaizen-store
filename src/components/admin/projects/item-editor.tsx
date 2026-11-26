"use client";

import { ArrowUpRight, Star, Trash2 } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/admin/modal";
import { Button } from "@/components/admin/ui/button";
import { ConfirmButton } from "@/components/admin/ui/confirm-button";
import { Field, Select, TextInput } from "@/components/admin/ui/field";
import { TextArea } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { minorUnitDigits } from "@/lib/money";
import { instantOf, whenFields } from "@/lib/projects-dates";
import type { ChecklistFeatures } from "@/lib/projects-features";
import { PRIORITIES, type Priority, type ProjectColour, type StatusBucket } from "@/lib/projects-model";
import type { Recurrence } from "@/lib/projects-recurrence";

import { draftOf, RepeatField, ruleOf } from "./repeat-field";
import { useAct, type ProjectsAct } from "./use-act";

export type EditorItem = {
  id: string;
  title: string;
  description: string | null;
  done: boolean;
  archived: boolean;
  statusId: string | null;
  assignedTo: string | null;
  startAt: string | null;
  dueAt: string | null;
  allDay: boolean | null;
  priority: Priority | null;
  blockedReason: string | null;
  blockedByItemId: string | null;
  cost: { minor: number; currency: string } | null;
  recurrence: Recurrence | null;
  subtasks: { id: string; title: string; done: boolean; isGoal: boolean }[];
};

export type EditorWords = Pick<ProjectsMessages, "item" | "repeat" | "priorities" | "cancel" | "save" | "delete" | "none" | "nobody">;

/**
 * A task's editor (D903, Life's `edit-checklist-item-modal.tsx`): its title and notes always, and the fields its list uses (`features`) in
 * the order Life shows them. Save sends what changed; a subtask's change is sent at once. Dates are typed in the store's zone, a day alone
 * meaning the day as a whole.
 */
export function ItemEditor({
  item,
  features,
  statuses,
  team,
  others,
  timeZone,
  currency,
  locale,
  words,
  act,
  canChange,
  onClose,
}: {
  item: EditorItem;
  features: ChecklistFeatures;
  statuses: { id: string; name: string; colour: ProjectColour; bucket: StatusBucket }[];
  team: { id: string; name: string }[];
  /** The list's other tasks, one of which this one may wait for. */
  others: { id: string; title: string }[];
  timeZone: string;
  currency: string;
  locale: string;
  words: EditorWords;
  act: ProjectsAct;
  canChange: boolean;
  onClose: () => void;
}) {
  const w = words.item;
  const { run, pending, said } = useAct(act);
  const start = whenFields(item.startAt, item.allDay, timeZone);
  const due = whenFields(item.dueAt, item.allDay, timeZone);
  const digits = minorUnitDigits(item.cost?.currency ?? currency);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [statusId, setStatusId] = useState(item.statusId ?? "");
  const [priority, setPriority] = useState<string>(item.priority ?? "");
  const [assignedTo, setAssignedTo] = useState(item.assignedTo ?? "");
  const [startDay, setStartDay] = useState(start.day);
  const [startTime, setStartTime] = useState(start.time);
  const [dueDay, setDueDay] = useState(due.day);
  const [dueTime, setDueTime] = useState(due.time);
  const [cost, setCost] = useState(item.cost ? (item.cost.minor / 10 ** digits).toFixed(digits) : "");
  const [blockedReason, setBlockedReason] = useState(item.blockedReason ?? "");
  const [blockedBy, setBlockedBy] = useState(item.blockedByItemId ?? "");
  const [newStep, setNewStep] = useState("");
  const [repeat, setRepeat] = useState(() => draftOf(item.recurrence));
  const rule = ruleOf(repeat, item.recurrence);
  // Sent only when it changed: a task given a rule is open again.
  const ruleChanged = JSON.stringify(rule) !== JSON.stringify(ruleOf(draftOf(item.recurrence), item.recurrence));

  const save = () => {
    const startAt = instantOf(startDay, startTime, timeZone);
    const dueAt = instantOf(dueDay, dueTime, timeZone);
    const amount = Number(cost.replace(",", "."));
    run(
      {
        op: "item.update",
        id: item.id,
        patch: {
          title,
          description,
          ...(features.status && { statusId: statusId || null, blockedReason, blockedByItemId: blockedBy || null }),
          ...(features.priority && { priority: (priority || null) as Priority | null }),
          ...(features.assignment && { assignedTo: assignedTo || null }),
          ...(features.startDate && { startAt: startAt.at ?? "" }),
          ...(features.dueDate && { dueAt: dueAt.at ?? "" }),
          // A task is a whole day when its dates say no time.
          ...((features.startDate || features.dueDate) && { allDay: (dueAt.at ? dueAt.allDay : startAt.allDay) ?? null }),
          ...(features.cost && { cost: cost.trim() && Number.isFinite(amount) ? { minor: Math.round(amount * 10 ** digits), currency: item.cost?.currency ?? currency } : null }),
          ...(features.recurrence && ruleChanged && { recurrence: rule }),
        },
      },
      (answer) => answer.ok && onClose(),
    );
  };

  const addStep = () => {
    const text = newStep.trim();
    if (!text) return;
    run({ op: "subtask.add", itemId: item.id, title: text }, (answer) => answer.ok && setNewStep(""));
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={w.title}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {canChange && (
              <ConfirmButton
                kind="danger"
                question={fillWords(w.deleteConfirm, { title: item.title })}
                confirm={words.delete}
                action={() => run({ op: "item.delete", ids: [item.id] }, (answer) => answer.ok && onClose())}
              >
                {w.deleteItem}
              </ConfirmButton>
            )}
            {canChange && (
              <Button kind="quiet" onClick={() => run({ op: "item.archive", ids: [item.id], archived: !item.archived }, (answer) => answer.ok && onClose())}>
                {item.archived ? w.unarchive : w.archive}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button kind="quiet" onClick={onClose}>
              {words.cancel}
            </Button>
            {canChange && (
              <Button kind="main" onClick={save} disabled={pending || !title.trim()} aria-busy={pending}>
                {words.save}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <Field label={w.name} required>
          {(control) => <TextInput {...control} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} disabled={!canChange} full />}
        </Field>
        <Field label={w.description}>
          {(control) => <TextArea {...control} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={10000} disabled={!canChange} full />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.status && (
            <Field label={w.status}>
              {(control) => (
                <Select {...control} value={statusId} onChange={(e) => setStatusId(e.target.value)} disabled={!canChange} full>
                  <option value="">{w.noStatus}</option>
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {features.priority && (
            <Field label={w.priority}>
              {(control) => (
                <Select {...control} value={priority} onChange={(e) => setPriority(e.target.value)} disabled={!canChange} full>
                  <option value="">{words.none}</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {words.priorities[p]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {features.assignment && (
            <Field label={w.assignee}>
              {(control) => (
                <Select {...control} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={!canChange} full>
                  <option value="">{words.nobody}</option>
                  {team.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {features.cost && (
            <Field label={`${w.cost} (${item.cost?.currency ?? currency})`}>
              {(control) => <TextInput {...control} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" disabled={!canChange} full />}
            </Field>
          )}
          {features.startDate && (
            <DayAndTime label={w.startAt} day={startDay} time={startTime} onDay={setStartDay} onTime={setStartTime} disabled={!canChange} />
          )}
          {features.dueDate && <DayAndTime label={w.dueAt} day={dueDay} time={dueTime} onDay={setDueDay} onTime={setDueTime} disabled={!canChange} />}
          {features.recurrence && <RepeatField draft={repeat} onChange={setRepeat} words={words.repeat} locale={locale} disabled={!canChange} />}
          {features.status && (
            <>
              <Field label={w.blockedReason} hint={w.blockedReasonHint}>
                {(control) => <TextInput {...control} value={blockedReason} onChange={(e) => setBlockedReason(e.target.value)} maxLength={500} disabled={!canChange} full />}
              </Field>
              <Field label={w.blockedBy}>
                {(control) => (
                  <Select {...control} value={blockedBy} onChange={(e) => setBlockedBy(e.target.value)} disabled={!canChange} full>
                    <option value="">{words.none}</option>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
        </div>
        {features.subtasks && (
          <section aria-labelledby={`steps-${item.id}`} className="flex flex-col gap-2">
            <h3 id={`steps-${item.id}`} className="text-body-strong text-ink">
              {w.subtasks}
            </h3>
            {item.subtasks.length > 0 && (
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {item.subtasks.map((step) => (
                  <li key={step.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={step.done}
                      disabled={!canChange || pending}
                      aria-label={fillWords(w.subtaskDone, { title: step.title })}
                      onChange={(e) => run({ op: "subtask.update", id: step.id, patch: { done: e.target.checked } })}
                      className="size-4 shrink-0 accent-brand"
                    />
                    <span className={`min-w-0 flex-1 truncate text-body ${step.done ? "text-muted line-through" : "text-ink"}`}>{step.title}</span>
                    {step.isGoal && <span className="text-chip text-ink-2">{w.goal}</span>}
                    {canChange && (
                      <span className="flex shrink-0 items-center gap-1">
                        <Button kind="icon" size="dense" aria-label={fillWords(w.goalOn, { title: step.title })} aria-pressed={step.isGoal} onClick={() => run({ op: "subtask.update", id: step.id, patch: { isGoal: !step.isGoal } })}>
                          <Star />
                        </Button>
                        <Button kind="icon" size="dense" aria-label={fillWords(w.promote, { title: step.title })} onClick={() => run({ op: "subtask.promote", id: step.id })}>
                          <ArrowUpRight />
                        </Button>
                        <Button kind="icon" size="dense" aria-label={fillWords(w.deleteSubtask, { title: step.title })} onClick={() => run({ op: "subtask.delete", id: step.id })}>
                          <Trash2 />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canChange && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addStep();
                }}
              >
                <TextInput aria-label={w.addSubtask} value={newStep} onChange={(e) => setNewStep(e.target.value)} maxLength={500} full />
                <Button type="submit" disabled={pending || !newStep.trim()}>
                  {w.addSubtask}
                </Button>
              </form>
            )}
          </section>
        )}
        <p role="status" aria-live="polite" className="text-sm text-danger-text">
          {said}
        </p>
      </div>
    </Modal>
  );
}

/** A day and an optional time, in the store's zone. */
function DayAndTime({ label, day, time, onDay, onTime, disabled }: { label: string; day: string; time: string; onDay: (v: string) => void; onTime: (v: string) => void; disabled: boolean }) {
  return (
    <Field label={label}>
      {(control) => (
        <span className="flex gap-2">
          <TextInput {...control} type="date" value={day} onChange={(e) => onDay(e.target.value)} disabled={disabled} full />
          <TextInput type="time" aria-label={label} value={time} onChange={(e) => onTime(e.target.value)} disabled={disabled || !day} />
        </span>
      )}
    </Field>
  );
}
