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
import { ADDED_BLOCKS } from "@/lib/flow-blocks";
import { SOCIAL_NETWORKS } from "@/lib/social-links";
import type { FactBlock, FlowCondition, FlowPlace, FlowStep } from "@/lib/flows";
import type { CampaignFact, ProductFact } from "@/lib/broadcasts";
import { findBroadcastFactsAction } from "../../broadcasts/actions";

import {
  changeFlowConditionAction,
  changeFlowBlockAction,
  changeFlowBlocksAction,
  startFlowLanguageAction,
  writeFlowEmailAction,
  suggestFlowSubjectsAction,
  rewriteFlowEmailAction,
  translateFlowEmailAction,
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
  /** The store's languages, its first first (M3.4: each written side by side). */
  languages: readonly string[];
};

type Selected = { kind: "trigger" } | { kind: "step"; id: string } | null;

const KINDS = ["email", "wait", "until", "tag", "if", "end"] as const;
const FIELD = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

const placeId = (place: FlowPlace) => `place:${JSON.stringify(place)}`;
const conditionValue = (c: FlowCondition) =>
  c.kind === "ordered_since_entry" ? "ordered" : c.kind === "clicked_flow_email" ? "clicked" : c.kind === "split" ? "split" : `segment:${c.segmentId}`;

function conditionLabel(c: FlowCondition, p: Props): string {
  const yes = p.w.story.conditions;
  if (c.kind === "ordered_since_entry") return yes.ordered.yes;
  if (c.kind === "clicked_flow_email") return yes.clicked.yes;
  if (c.kind === "split") return yes.split.yes;
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
  if (step.kind === "until") return { title: w.story.until[step.until].replace("{n}", String(Math.round(step.hours / 24))), line: null };
  if (step.kind === "tag") return { title: step.tag, line: null };
  if (step.kind === "if") return { title: conditionLabel(step.condition, p), line: null };
  return { title: w.canvas.kinds.end, line: null };
}

const KIND_MARK: Record<FlowStep["kind"], string> = { email: "✉", wait: "◷", until: "⧗", tag: "#", if: "⑂", end: "■" };

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

/**
 * The email as it reads, its words changed where they are (email plan M3.4): the subject and each heading, paragraph and button in the store's
 * first language, each saved when the owner clicks away (`changeFlowBlockAction()`). Emptied words are put back, not saved. Pictures, products
 * and dividers show as they are; every language side by side is under Change in the story.
 */
function EmailInPlace({ p, step }: { p: Props; step: Extract<FlowStep, { kind: "email" }> }) {
  const { w } = p;
  const first = step.content[p.locale] ? p.locale : (Object.keys(step.content)[0] ?? p.locale);
  const [locale, setLocale] = useState(first);
  const c = step.content[locale];
  const nameOf = (l: string) => {
    const name = new Intl.DisplayNames([l], { type: "language" }).of(l.split("-")[0]) ?? l;
    return name.charAt(0).toLocaleUpperCase(l) + name.slice(1);
  };
  const languages = p.languages.length > 1 ? p.languages : [];
  const [busy, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  // Each of the store's languages one press away (M3.4); one not yet written starts from the first language's words.
  const tabs =
    languages.length > 0 ? (
      <div role="group" aria-label={w.inPlace.languages} className="flex flex-wrap gap-1">
        {languages.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={l === locale}
            onClick={() => setLocale(l)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${l === locale ? "border-ink text-ink" : "border-line text-ink-2"}`}
          >
            {nameOf(l)}
            {step.content[l] ? "" : " \u00b7 " + w.inPlace.notYet}
          </button>
        ))}
      </div>
    ) : null;
  if (!c)
    return (
      <div className="flex flex-col gap-2" data-email-in-place>
        {tabs}
        <p className="text-sm text-ink-2">{w.inPlace.notWritten.replace("{language}", nameOf(locale))}</p>
        <button
          type="button"
          disabled={busy || !step.content[first]}
          onClick={() =>
            start(async () => {
              const result = await startFlowLanguageAction(p.storeSlug, p.flowId, step.id, first, locale);
              setSaid({ ok: result.status === "ok", text: result.messages.join(" ") });
            })
          }
          className="self-start rounded-full border border-line px-3 py-1 text-sm text-ink hover:border-ink"
        >
          {w.inPlace.startFrom.replace("{language}", nameOf(first))}
        </button>
        <button
          type="button"
          disabled={busy || !step.content[first]}
          onClick={() =>
            start(async () => {
              const result = await translateFlowEmailAction(p.storeSlug, p.flowId, step.id, first, locale);
              setSaid({ ok: result.status === "ok", text: result.messages.join(" ") });
            })
          }
          className="self-start rounded-full border border-line px-3 py-1 text-sm text-ink hover:border-ink"
        >
          {w.inPlace.translateFrom.replace("{language}", nameOf(first))}
        </button>
        {said && <p role="status" className="text-sm text-ink-2">{said.text}</p>}
      </div>
    );
  const change = (body: { add: (typeof ADDED_BLOCKS)[number]; at: number; words: string } | { fact: FactBlock; at: number } | { remove: number }) =>
    start(async () => {
      const result = await changeFlowBlocksAction(p.storeSlug, p.flowId, step.id, locale, body);
      setSaid({ ok: result.status === "ok", text: result.messages.join(" ") });
      setAdding(null);
    });
  const newWords = { heading: w.inPlace.newHeading, paragraph: w.canvas.newEmail.text, button: w.inPlace.newButton, divider: "" };
  // A place between blocks: + opens the kinds; one press adds that block there.
  const between = (at: number) => (
    <div className="flex flex-wrap items-center justify-center gap-1" data-in-place-between={at}>
      {adding === at ? (
        <div role="group" aria-label={w.inPlace.add} className="flex flex-wrap items-center gap-1">
          {ADDED_BLOCKS.map((k) => (
            <button
              key={k}
              type="button"
              disabled={busy}
              onClick={() => change({ add: k, at, words: newWords[k] })}
              className="rounded-full border border-line bg-card px-2.5 py-0.5 text-xs text-ink hover:border-ink"
            >
              {w.inPlace.kinds[k]}
            </button>
          ))}
          <FactFinder w={w} storeSlug={p.storeSlug} busy={busy} onAdd={(fact) => change({ fact, at })} />
        </div>
      ) : (
        <button
          type="button"
          aria-label={w.inPlace.add}
          disabled={busy}
          onClick={() => setAdding(at)}
          className="flex size-5 items-center justify-center rounded-full border border-line bg-card text-xs leading-none text-muted hover:border-ink hover:text-ink"
        >
          +
        </button>
      )}
    </div>
  );
  // Each block's remove, shown beside it; the last block stays (an email says something).
  const removable = (i: number, inner: ReactNode) => (
    <div key={i} className="group relative">
      {inner}
      {c.blocks.length > 1 && (
        <button
          type="button"
          aria-label={w.inPlace.remove}
          disabled={busy}
          onClick={() => change({ remove: i })}
          className="absolute -right-2 -top-2 hidden size-5 items-center justify-center rounded-full border border-line bg-card text-xs text-muted group-focus-within:flex group-hover:flex hover:text-danger-text"
        >
          ✕
        </button>
      )}
    </div>
  );
  const editable = (index: number, before: string, label: string, className: string, multiline: boolean) => (
    <span
      role="textbox"
      aria-label={label}
      aria-multiline={multiline || undefined}
      contentEditable={!busy}
      suppressContentEditableWarning
      data-in-place={index}
      onKeyDown={(e) => {
        if (!multiline && e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const text = e.currentTarget.textContent ?? "";
        if (text.trim() === before.trim()) return;
        if (!text.trim()) {
          e.currentTarget.textContent = before;
          return;
        }
        start(async () => {
          const result = await changeFlowBlockAction(p.storeSlug, p.flowId, step.id, locale, index, text);
          setSaid({ ok: result.status === "ok", text: result.messages.join(" ") });
        });
      }}
      className={`block rounded px-1 outline-none hover:bg-sunken/60 focus:bg-sunken focus:ring-2 focus:ring-ink/20 ${className}`}
    >
      {before}
    </span>
  );
  return (
    <div className="flex flex-col gap-2" data-email-in-place>
      {tabs}
      <p className="text-caption text-muted">
        {w.inPlace.hint} {w.inPlace.personal}
      </p>
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
        <div>
          <span className="text-caption text-muted">{w.subject}</span>
          {editable(-1, c.subject, w.subject, "text-body-strong text-ink", false)}
          <SubjectChoices
            w={w}
            busy={busy}
            suggest={() => suggestFlowSubjectsAction(p.storeSlug, p.flowId, step.id, locale)}
            onPick={(subject) =>
              start(async () => {
                const result = await changeFlowBlockAction(p.storeSlug, p.flowId, step.id, locale, -1, subject);
                setSaid({ ok: result.status === "ok", text: result.messages.join(" ") });
              })
            }
          />
        </div>
        <hr className="border-line" />
        {between(0)}
        {c.blocks.map((block, i) => {
          let inner: ReactNode;
          if (block.type === "heading") inner = editable(i, block.text, w.inPlace.heading, "text-title text-ink", false);
          else if (block.type === "paragraph") inner = editable(i, block.text, w.words, "text-sm text-ink-2 whitespace-pre-wrap", true);
          else if (block.type === "button")
            inner = (
              <div className="inline-block rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-card">{editable(i, block.text, w.inPlace.button, "", false)}</div>
            );
          else if (block.type === "image")
            // eslint-disable-next-line @next/next/no-img-element -- the email's own picture, as the reader's mail app shows it.
            inner = <img src={block.url} alt={block.alt} className="max-h-40 w-auto rounded" />;
          else if (block.type === "divider") inner = <hr className="border-line" />;
          else if (block.type === "html")
            inner = (
              <p className="rounded border border-dashed border-line px-3 py-2 font-mono text-caption text-muted" data-in-place-fact="html">
                {block.html.slice(0, 80)}
              </p>
            );
          else if (block.type === "columns")
            inner = (
              <div className="grid grid-cols-2 gap-2 text-sm text-ink-2" data-in-place-fact="columns">
                {block.cells.map((c, j) => (
                  <p key={j} className="rounded border border-line px-2 py-1">
                    {c.heading || c.text || c.buttonText || c.alt}
                  </p>
                ))}
              </div>
            );
          else if (block.type === "social")
            inner = (
              <p className="text-sm text-ink-2 underline" data-in-place-fact="social">
                {block.links.map((l) => SOCIAL_NETWORKS[l.network]).join(" · ")}
              </p>
            );
          else
            inner = (
              <p className="rounded border border-dashed border-line px-3 py-2 text-caption text-muted" data-in-place-fact={block.type}>
                {block.type === "campaign" ? w.inPlace.offer : w.inPlace.product}
                {"label" in block && block.label ? `: ${block.label}` : ""}
              </p>
            );
          return (
            <div key={i} className="flex flex-col gap-1">
              {removable(i, inner)}
              {between(i + 1)}
            </div>
          );
        })}
        {step.picks && <p className="rounded border border-dashed border-line px-3 py-2 text-caption text-muted">{w.canvas.pickKinds[step.picks]}</p>}
      </div>
      {/* Rewritten in place (M3.7): the meaning kept, every block where it was. */}
      <div role="group" aria-label={w.inPlace.rewrite.label} className="flex flex-wrap items-center gap-1" data-rewrite>
        <span className="text-caption text-muted">{w.inPlace.rewrite.label}</span>
        {(["shorter", "warmer", "direct"] as const).map((tone) => (
          <button
            key={tone}
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const result = await rewriteFlowEmailAction(p.storeSlug, p.flowId, step.id, locale, tone);
                setSaid({ ok: result.status === "ok", text: result.messages.join(" ") });
              })
            }
            className="rounded-full border border-line bg-card px-2.5 py-0.5 text-xs text-ink hover:border-ink"
          >
            {w.inPlace.rewrite[tone]}
          </button>
        ))}
      </div>
      <WriteWithAi w={w} busy={busy} onWrite={(brief) =>
        start(async () => {
          const result = await writeFlowEmailAction(p.storeSlug, p.flowId, step.id, locale, brief);
          setSaid({ ok: result.status === "ok", text: result.messages.join(" ") });
        })
      } />
      {said && (
        <p role="status" className={`text-sm ${said.ok ? "text-ink-2" : "text-danger-text"}`}>
          {said.text}
        </p>
      )}
    </div>
  );
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
    body = (
      <>
        <EmailInPlace key={step.id} p={p} step={step} />
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
  } else if (step?.kind === "until") {
    // A wait-until (M2.1): what it waits for, and the days after which the person goes on regardless.
    body = (
      <>
        <ActionForm key={`${step.id}-event`} action={changeFlowConditionAction.bind(null, p.storeSlug, p.flowId, step.id)}>
          <div role="group" aria-label={w.canvas.condition} className="flex flex-wrap gap-2">
            <span className="w-full text-caption text-muted">{w.canvas.condition}</span>
            {(["ordered", "clicked"] as const).map((e) => (
              <SubmitButton key={e} variant={step.until === e ? "primary" : "secondary"} name="condition" value={e} disabled={step.until === e}>
                {w.story.until[e].replace("{n}", String(Math.round(step.hours / 24)))}
              </SubmitButton>
            ))}
          </div>
        </ActionForm>
        <ActionForm key={`${step.id}-days`} action={changeFlowWaitAction.bind(null, p.storeSlug, p.flowId, step.id)} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {w.days}
            <input name="days" type="number" min={1} max={365} required defaultValue={Math.max(1, Math.round(step.hours / 24))} className={`${FIELD} w-24`} />
          </label>
          <SubmitButton variant="secondary">{w.save}</SubmitButton>
        </ActionForm>
      </>
    );
  } else if (step?.kind === "tag") {
    body = (
      <ActionForm key={step.id} action={changeFlowConditionAction.bind(null, p.storeSlug, p.flowId, step.id)} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {w.canvas.kinds.tag}
          <input name="tag" required maxLength={40} defaultValue={step.tag} className={FIELD} />
        </label>
        <SubmitButton variant="secondary">{w.save}</SubmitButton>
      </ActionForm>
    );
  } else if (step?.kind === "if") {
    const options = [
      { value: "ordered", label: w.story.conditions.ordered.yes },
      { value: "clicked", label: w.story.conditions.clicked.yes },
      { value: "split", label: w.story.conditions.split.choose },
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
              <span className="rounded-full border border-line bg-card px-3 py-1 text-caption text-muted">{p.trigger === "subscriber.asleep" ? w.story.endsPaused : w.story.ends}</span>
            </div>
          </div>
          {selected && <Panel p={p} selected={selected} onClose={() => setSelected(null)} />}
        </div>
      </div>
    </DndContext>
  );
}

/**
 * A product or a running campaign's offer for the email, found in the store (M3.4, the broadcast editor's finder, D352): code draws it for
 * each reader's market when the email is made, so a price is never written here.
 */
function FactFinder({ w, storeSlug, busy, onAdd }: { w: FlowsMessages; storeSlug: string; busy: boolean; onAdd: (fact: FactBlock) => void }) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState("");
  const [found, setFound] = useState<{ products: ProductFact[]; campaigns: CampaignFact[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [finding, start] = useTransition();
  const find = () =>
    start(async () => {
      setProblem(null);
      const result = await findBroadcastFactsAction(storeSlug, words);
      if (result.ok) setFound(result);
      else setProblem(result.problem);
    });
  const pill = "rounded-full border border-line bg-card px-2.5 py-0.5 text-xs text-ink hover:border-ink";
  if (!open)
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setOpen(true);
          find();
        }}
        className={pill}
      >
        {w.inPlace.fact}
      </button>
    );
  return (
    <div className="mt-1 flex w-full flex-col gap-2 rounded border border-line bg-card p-2 text-left" data-fact-finder>
      <div className="flex gap-1">
        <input
          aria-label={w.inPlace.findLabel}
          placeholder={w.inPlace.findLabel}
          value={words}
          maxLength={120}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              find();
            }
          }}
          className="min-w-0 flex-1 rounded border border-line bg-card px-2 py-1 text-sm"
        />
        <button type="button" disabled={finding} onClick={find} className={pill}>
          {w.inPlace.find}
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-caption text-danger-text">
          {problem}
        </p>
      )}
      {found && found.products.length === 0 && found.campaigns.length === 0 && <p className="text-caption text-muted">{w.inPlace.noneFound}</p>}
      {[
        { label: w.inPlace.products, rows: found?.products.map((x) => ({ id: x.id, name: x.title, note: x.price, fact: { type: "product", product: x.id, handle: x.handle, label: x.title } as FactBlock })) ?? [] },
        { label: w.inPlace.offers, rows: found?.campaigns.map((x) => ({ id: x.id, name: x.name, note: x.offer, fact: { type: "campaign", campaign: x.id, label: x.name } as FactBlock })) ?? [] },
      ]
        .filter((list) => list.rows.length > 0)
        .map((list) => (
          <ul key={list.label} aria-label={list.label} className="flex max-h-40 flex-col divide-y divide-line overflow-y-auto">
            {list.rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink">{row.name}</span>
                <span className="text-caption text-muted">{row.note}</span>
                <button type="button" disabled={busy} onClick={() => onAdd(row.fact)} className={pill}>
                  {w.inPlace.addThis}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/**
 * Words written with AI (email plan M3.7): the owner says what the email is about; the store's writer writes it from the store's facts and
 * voice for the people this email reaches, and the words replace this language's, each still changed where it is.
 */
function WriteWithAi({ w, busy, onWrite }: { w: FlowsMessages; busy: boolean; onWrite: (brief: string) => void }) {
  const [brief, setBrief] = useState("");
  return (
    <details className="rounded border border-line bg-card px-3 py-2" data-write-with-ai>
      <summary className="cursor-pointer text-sm text-ink">{w.inPlace.write.open}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-caption text-muted">
          {w.inPlace.write.label}
          <textarea
            value={brief}
            maxLength={1000}
            rows={2}
            placeholder={w.inPlace.write.placeholder}
            onChange={(e) => setBrief(e.target.value)}
            className="rounded border border-line bg-card px-2 py-1 text-sm text-ink"
          />
        </label>
        <p className="text-caption text-muted">{w.inPlace.write.note}</p>
        <button
          type="button"
          disabled={busy || brief.trim().length < 5}
          onClick={() => onWrite(brief)}
          className="self-start rounded-full bg-ink px-3 py-1 text-sm text-card disabled:opacity-50"
        >
          {busy ? w.inPlace.write.writing : w.inPlace.write.go}
        </button>
      </div>
    </details>
  );
}

/** Subject lines to choose from (email plan M3.7): the store's writer offers three from the email's words; one press makes one the subject. */
function SubjectChoices({
  w,
  busy,
  suggest,
  onPick,
}: {
  w: FlowsMessages;
  busy: boolean;
  suggest: () => Promise<{ ok: true; subjects: string[] } | { ok: false; problem: string }>;
  onPick: (subject: string) => void;
}) {
  const [subjects, setSubjects] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, start] = useTransition();
  return (
    <div className="mt-1 flex flex-col gap-1" data-subject-choices>
      <button
        type="button"
        disabled={busy || asking}
        onClick={() =>
          start(async () => {
            setProblem(null);
            const result = await suggest();
            if (result.ok) setSubjects(result.subjects);
            else setProblem(result.problem);
          })
        }
        className="self-start text-caption text-ink-2 underline underline-offset-2 hover:text-ink"
      >
        {asking ? w.inPlace.subjects.asking : w.inPlace.subjects.ask}
      </button>
      {problem && (
        <p role="alert" className="text-caption text-danger-text">
          {problem}
        </p>
      )}
      {subjects && (
        <div role="group" aria-label={w.inPlace.subjects.choose} className="flex flex-col gap-1">
          {subjects.map((subject) => (
            <button
              key={subject}
              type="button"
              disabled={busy}
              onClick={() => {
                onPick(subject);
                setSubjects(null);
              }}
              className="rounded border border-line bg-card px-2 py-1 text-left text-sm text-ink hover:border-ink"
            >
              {subject}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
