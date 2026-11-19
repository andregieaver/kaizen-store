"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useState, useTransition, type ReactNode } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { FlowsMessages } from "@/lib/admin-messages/flows.en";
import { waitWords } from "@/lib/flow-story";
import { DATE_TRIGGER_DAYS, FLOW_TRIGGERS, isDateTrigger } from "@/lib/flow-triggers";
import type { FlowCondition, FlowPlace, FlowStep } from "@/lib/flows";

import {
  changeFlowConditionAction,
  changeFlowEmailAction,
  changeFlowLapseAction,
  changeFlowPicksAction,
  changeFlowTriggerAction,
  changeFlowWaitAction,
  dropFlowStepAction,
  moveFlowStepAction,
  removeFlowStepAction,
} from "../actions";

/**
 * The flow's canvas (D767, Customise): the flow drawn as a chart, its trigger at the top and each step a card joined by a line, an `if`
 * opening into its yes and no columns. A step is moved by dragging its card onto a place between cards, and added by dragging a kind
 * from the palette (or pressing a place's + for the keyboard); a card pressed opens its settings beside the chart. Every change is a
 * new version, switched off until tested, and the story above is drawn from the same tree. Words come from the server page (`w`).
 */

type Props = {
  storeSlug: string;
  flowId: string;
  locale: string;
  steps: FlowStep[];
  trigger: string;
  triggerDays: number | null;
  w: FlowsMessages;
  segments: ReadonlyArray<{ id: string; name: string }>;
};

type Selected = { kind: "trigger" } | { kind: "step"; id: string } | null;

const KINDS = ["email", "wait", "if", "end"] as const;
const FIELD = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

const placeId = (place: FlowPlace) => `place:${JSON.stringify(place)}`;
const conditionValue = (c: FlowCondition) => (c.kind === "ordered_since_entry" ? "ordered" : c.kind === "clicked_flow_email" ? "clicked" : `segment:${c.segmentId}`);

function conditionLabel(c: FlowCondition, p: Props): string {
  const yes = p.w.story.conditions;
  if (c.kind === "ordered_since_entry") return yes.ordered.yes;
  if (c.kind === "clicked_flow_email") return yes.clicked.yes;
  return yes.segment.yes.replace("{segment}", p.segments.find((s) => s.id === c.segmentId)?.name ?? "?");
}

/** A step's card title and its line under it. */
function cardWords(step: FlowStep, p: Props): { title: string; line: string | null } {
  const { w } = p;
  if (step.kind === "email") {
    const first = Object.values(step.content)[0];
    const text = first?.blocks.find((b) => b.type === "paragraph") as { text?: string } | undefined;
    return { title: first?.subject || w.canvas.kinds.email, line: step.picks ? w.canvas.pickKinds[step.picks] : (text?.text ?? null) };
  }
  if (step.kind === "wait") return { title: waitWords(step.hours, w.story), line: null };
  if (step.kind === "if") return { title: conditionLabel(step.condition, p), line: null };
  return { title: w.canvas.kinds.end, line: null };
}

const KIND_MARK: Record<FlowStep["kind"], string> = { email: "✉", wait: "◷", if: "⑂", end: "■" };

/** A place a step may be dropped: between cards, or first in a branch. A dragged card or kind over it lights it; + adds by keyboard. */
function Place({ place, p, busy, onAdd }: { place: FlowPlace; p: Props; busy: boolean; onAdd: (kind: (typeof KINDS)[number], place: FlowPlace) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: placeId(place) });
  const [open, setOpen] = useState(false);
  return (
    <div ref={setNodeRef} className="flex flex-col items-center" data-board-place>
      <span className="h-3 w-px bg-line" aria-hidden />
      <div className={`flex min-h-8 items-center justify-center rounded-full border border-dashed px-2 transition ${isOver ? "border-ink bg-sunken px-6" : "border-transparent"}`}>
        {open ? (
          <div role="group" aria-label={p.w.canvas.add} className="flex flex-wrap items-center gap-1">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onAdd(k, place);
                }}
                className="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink hover:border-ink"
              >
                {p.w.canvas.kinds[k]}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            aria-label={p.w.canvas.add}
            disabled={busy}
            onClick={() => setOpen(true)}
            className="flex size-6 items-center justify-center rounded-full border border-line bg-card text-sm leading-none text-muted hover:border-ink hover:text-ink"
          >
            +
          </button>
        )}
      </div>
      <span className="h-3 w-px bg-line" aria-hidden />
    </div>
  );
}

/** A step's card: dragged to move it, pressed to open its settings. */
function Card({ step, p, selected, onSelect }: { step: FlowStep; p: Props; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `step:${step.id}` });
  const { title, line } = cardWords(step, p);
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onSelect}
      data-board-card={step.kind}
      aria-label={`${p.w.canvas.kinds[step.kind]}: ${title}`}
      aria-pressed={selected}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`relative z-10 flex w-60 shrink-0 cursor-grab touch-none items-start gap-3 rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition active:cursor-grabbing ${
        selected ? "border-ink ring-2 ring-ink/15" : "border-line hover:border-ink/50"
      } ${isDragging ? "opacity-60 shadow-lg" : ""}`}
    >
      <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-sunken text-sm">
        {KIND_MARK[step.kind]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption font-medium text-muted">{p.w.canvas.kinds[step.kind]}</span>
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        {line && <span className="mt-0.5 line-clamp-2 block text-caption text-muted">{line}</span>}
      </span>
    </button>
  );
}

/** A list of steps as a column: a place before the first (`first`), then each card with a place after it; an `if` opens into two columns. */
function Column({
  steps,
  first,
  p,
  busy,
  selected,
  onSelect,
  onAdd,
}: {
  steps: readonly FlowStep[];
  first: FlowPlace;
  p: Props;
  busy: boolean;
  selected: Selected;
  onSelect: (s: Selected) => void;
  onAdd: (kind: (typeof KINDS)[number], place: FlowPlace) => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <Place place={first} p={p} busy={busy} onAdd={onAdd} />
      {steps.map((step) => (
        <div key={step.id} className="flex flex-col items-center">
          <Card step={step} p={p} selected={selected?.kind === "step" && selected.id === step.id} onSelect={() => onSelect({ kind: "step", id: step.id })} />
          {step.kind === "if" && (
            <div className="mt-3 grid w-max grid-cols-2 gap-4 border-t border-line pt-1" data-board-branches>
              {(["then", "else"] as const).map((branch) => (
                <div key={branch} className="flex min-w-64 flex-col items-center rounded-lg bg-sunken/60 px-2 pb-2" data-board-branch={branch}>
                  <span className={`mt-2 rounded-full px-2 py-0.5 text-caption font-medium ${branch === "then" ? "bg-positive-soft text-positive-text" : "bg-sunken text-ink-2"}`}>
                    {branch === "then" ? p.w.canvas.yes : p.w.canvas.no}
                  </span>
                  <Column steps={step[branch]} first={{ into: step.id, branch }} p={p} busy={busy} selected={selected} onSelect={onSelect} onAdd={onAdd} />
                </div>
              ))}
            </div>
          )}
          {step.kind !== "end" && <Place place={{ afterId: step.id }} p={p} busy={busy} onAdd={onAdd} />}
        </div>
      ))}
    </div>
  );
}

/** A kind in the palette: dragged onto a place to add a step there. */
function PaletteItem({ kind, p }: { kind: (typeof KINDS)[number]; p: Props }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `new:${kind}` });
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-board-new={kind}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`flex cursor-grab touch-none items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm font-medium text-ink shadow-sm ${isDragging ? "z-20 opacity-70 shadow-lg" : ""}`}
    >
      <span aria-hidden>{KIND_MARK[kind]}</span>
      {p.w.canvas.kinds[kind]}
    </span>
  );
}

function find(steps: readonly FlowStep[], id: string): FlowStep | null {
  for (const s of steps) {
    if (s.id === id) return s;
    if (s.kind === "if") {
      const inner = find(s.then, id) ?? find(s.else, id);
      if (inner) return inner;
    }
  }
  return null;
}

/** The settings of what is selected: the trigger, or one step. Forms post to the same actions as everywhere on the page. */
function Panel({ p, selected, onClose }: { p: Props; selected: Exclude<Selected, null>; onClose: () => void }) {
  const { w } = p;
  const step = selected.kind === "step" ? find(p.steps, selected.id) : null;
  let body: ReactNode = null;
  if (selected.kind === "trigger") {
    const range = isDateTrigger(p.trigger) ? DATE_TRIGGER_DAYS[p.trigger] : null;
    body = (
      <>
        <ActionForm action={changeFlowTriggerAction.bind(null, p.storeSlug, p.flowId)}>
          <div role="group" aria-label={w.canvas.startsWhen} className="flex flex-wrap gap-2">
            {FLOW_TRIGGERS.filter((t) => t !== p.trigger).map((t) => (
              <SubmitButton key={t} variant="secondary" name="trigger" value={t}>
                {w.canvas.triggers[t]}
              </SubmitButton>
            ))}
          </div>
        </ActionForm>
        {range && p.triggerDays !== null && (
          <ActionForm action={changeFlowLapseAction.bind(null, p.storeSlug, p.flowId)} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              {p.trigger === "customer.browsed" ? w.browseDays : w.lapseDays}
              <input name="days" type="number" min={range.min} max={range.max} required defaultValue={p.triggerDays} className={`${FIELD} w-28`} />
            </label>
            <SubmitButton variant="secondary">{w.save}</SubmitButton>
          </ActionForm>
        )}
      </>
    );
  } else if (step?.kind === "email") {
    const first = step.content[p.locale] ?? Object.values(step.content)[0];
    const text = first?.blocks.find((b) => b.type === "paragraph") as { text?: string } | undefined;
    body = (
      <>
        <ActionForm key={step.id} action={changeFlowEmailAction.bind(null, p.storeSlug, p.flowId, step.id, p.locale)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {w.subject}
            <input name="subject" required defaultValue={first?.subject ?? ""} maxLength={200} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {w.words}
            <textarea name="text" required defaultValue={text?.text ?? ""} rows={5} maxLength={5000} className={`${FIELD} py-2`} />
          </label>
          <div>
            <SubmitButton variant="secondary">{w.save}</SubmitButton>
          </div>
        </ActionForm>
        <ActionForm action={changeFlowPicksAction.bind(null, p.storeSlug, p.flowId, step.id)}>
          <div role="group" aria-label={w.canvas.picks} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-full text-caption text-muted">{w.canvas.picks}</span>
            {(["none", "cross_sell", "replenish", "browse"] as const)
              .filter((k) => k !== (step.picks ?? "none"))
              .map((k) => (
                <SubmitButton key={k} variant="secondary" name="picks" value={k}>
                  {w.canvas.pickKinds[k]}
                </SubmitButton>
              ))}
          </div>
        </ActionForm>
      </>
    );
  } else if (step?.kind === "wait") {
    body = (
      <ActionForm key={step.id} action={changeFlowWaitAction.bind(null, p.storeSlug, p.flowId, step.id)} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {w.days}
          <input name="days" type="number" min={1} max={365} required defaultValue={Math.max(1, Math.round(step.hours / 24))} className={`${FIELD} w-24`} />
        </label>
        <SubmitButton variant="secondary">{w.save}</SubmitButton>
      </ActionForm>
    );
  } else if (step?.kind === "if") {
    const options = [
      { value: "ordered", label: w.story.conditions.ordered.yes },
      { value: "clicked", label: w.story.conditions.clicked.yes },
      ...p.segments.map((s) => ({ value: `segment:${s.id}`, label: w.story.conditions.segment.yes.replace("{segment}", s.name) })),
    ];
    body = (
      <ActionForm action={changeFlowConditionAction.bind(null, p.storeSlug, p.flowId, step.id)}>
        <div role="group" aria-label={w.canvas.condition} className="flex flex-wrap gap-2">
          <span className="w-full text-caption text-muted">{w.canvas.condition}</span>
          {options
            .filter((o) => o.value !== conditionValue(step.condition))
            .map((o) => (
              <SubmitButton key={o.value} variant="secondary" name="condition" value={o.value}>
                {o.label}
              </SubmitButton>
            ))}
        </div>
      </ActionForm>
    );
  }
  const heading = selected.kind === "trigger" ? w.canvas.startsWhen : step ? `${w.canvas.kinds[step.kind]}: ${cardWords(step, p).title}` : "";
  return (
    <aside
      aria-label={heading}
      className="fixed inset-x-4 bottom-4 z-30 flex max-h-[70vh] flex-col gap-4 overflow-y-auto rounded-lg border border-line bg-card p-4 shadow-xl md:inset-x-auto md:top-24 md:right-6 md:bottom-auto md:w-80"
      data-board-panel
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-body-strong text-ink">{heading}</p>
        <button type="button" onClick={onClose} aria-label={w.canvas.close} className="text-muted hover:text-ink">
          ✕
        </button>
      </div>
      {body}
      {step && (
        <ActionForm action={removeFlowStepAction.bind(null, p.storeSlug, p.flowId, step.id)}>
          <SubmitButton variant="secondary">{step.kind === "if" ? w.canvas.removeIf : w.canvas.remove}</SubmitButton>
        </ActionForm>
      )}
      <p className="text-caption text-muted">{w.changeOff}</p>
    </aside>
  );
}

export function FlowBoard(p: Props) {
  const { w } = p;
  const [busy, startTransition] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const run = (call: () => Promise<{ status: string; messages: string[] }>) =>
    startTransition(async () => {
      const result = await call();
      // The action redraws the route itself (`refresh()`): nothing to refresh here.
      setSaid({ ok: result.status === "ok", text: result.messages.join(" ") });
    });

  const onAdd = (kind: (typeof KINDS)[number], place: FlowPlace) =>
    run(() => dropFlowStepAction(p.storeSlug, p.flowId, kind, place, p.locale, w.canvas.newEmail));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || !String(over.id).startsWith("place:")) return;
    const place = JSON.parse(String(over.id).slice("place:".length)) as FlowPlace;
    const id = String(active.id);
    if (id.startsWith("new:")) onAdd(id.slice(4) as (typeof KINDS)[number], place);
    else if (id.startsWith("step:")) run(() => moveFlowStepAction(p.storeSlug, p.flowId, id.slice(5), place));
  };

  const triggerLabel = w.canvas.triggers[p.trigger as keyof FlowsMessages["canvas"]["triggers"]] ?? p.trigger;
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-4" data-flow-board>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={w.canvas.palette}>
          <span className="text-caption text-muted">{w.canvas.palette}</span>
          {KINDS.map((k) => (
            <PaletteItem key={k} kind={k} p={p} />
          ))}
        </div>
        {said && (
          <p role="status" className={`text-sm ${said.ok ? "text-ink-2" : "text-danger-text"}`}>
            {said.text}
          </p>
        )}
        <div>
          <div className={`min-w-0 overflow-x-auto rounded-lg border border-line bg-[radial-gradient(circle,var(--color-line)_1px,transparent_1px)] [background-size:16px_16px] p-4 ${busy ? "opacity-70" : ""}`}>
            <div className="mx-auto flex w-max flex-col items-center">
              <button
                type="button"
                onClick={() => setSelected({ kind: "trigger" })}
                aria-pressed={selected?.kind === "trigger"}
                data-board-trigger
                className={`flex w-60 shrink-0 items-center gap-3 rounded-lg border-2 bg-card px-3 py-2.5 text-left shadow-sm ${
                  selected?.kind === "trigger" ? "border-ink" : "border-positive-line hover:border-positive-solid"
                }`}
              >
                <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-positive-soft text-sm">
                  ⚡
                </span>
                <span className="min-w-0">
                  <span className="block text-caption font-medium text-muted">{w.canvas.startsWhen}</span>
                  <span className="block truncate text-sm font-medium text-ink">{triggerLabel}</span>
                </span>
              </button>
              <Column steps={p.steps} first={{ start: true }} p={p} busy={busy} selected={selected} onSelect={setSelected} onAdd={onAdd} />
              <span className="rounded-full border border-line bg-card px-3 py-1 text-caption text-muted">{w.story.ends}</span>
            </div>
          </div>
          {selected && <Panel p={p} selected={selected} onClose={() => setSelected(null)} />}
        </div>
      </div>
    </DndContext>
  );
}
