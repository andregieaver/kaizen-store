import { z } from "zod";

import { AUTOMATION_KINDS, PICK_KINDS, type PickKind } from "./automation-kinds";
import { broadcastContentSchema, type BroadcastContent } from "./broadcasts";
import { DATE_TRIGGER_DAYS, FLOW_TRIGGERS, isDateTrigger } from "./flow-triggers";

/**
 * Flows (D767, `docs/flows.md`, email plan M2.1): a trigger, a tree of steps a person moves along, and goals that end it early. This file is
 * the model and the walk, pure: `checkFlow()` says what is wrong with a tree, `advance()` says what a person at a place does next. The
 * tables, entering from the event log and moving on are in `src/server/flows.ts`.
 */


/** What an `if` may ask about the person. */
export type FlowCondition =
  | { kind: "ordered_since_entry" }
  | { kind: "clicked_flow_email" }
  | { kind: "in_segment"; segmentId: string };

export type FlowStep =
  /** `picks` (slice 4): products chosen for each reader by code (D653, D691) put in the email; without any for a reader, it is not sent. */
  | { id: string; kind: "email"; content: BroadcastContent; picks?: PickKind }
  | { id: string; kind: "wait"; hours: number }
  | { id: string; kind: "if"; condition: FlowCondition; then: FlowStep[]; else: FlowStep[] }
  | { id: string; kind: "end" };

/** A goal ends a person's run early, counted as reached. Slice 1 has one: an order placed after they entered. */
export type FlowGoal = { kind: "ordered" };

export const STEPS_MAX = 40;
export const DEPTH_MAX = 4;
export const WAIT_HOURS_MAX = 24 * 365;
const STEP_ID = /^[a-z0-9-]{1,24}$/;

const conditionSchema: z.ZodType<FlowCondition> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ordered_since_entry") }),
  z.object({ kind: z.literal("clicked_flow_email") }),
  z.object({ kind: z.literal("in_segment"), segmentId: z.uuid() }),
]);

export const flowStepSchema: z.ZodType<FlowStep> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ id: z.string().regex(STEP_ID), kind: z.literal("email"), content: broadcastContentSchema, picks: z.enum(PICK_KINDS).optional() }),
    z.object({ id: z.string().regex(STEP_ID), kind: z.literal("wait"), hours: z.number().int().min(1).max(WAIT_HOURS_MAX) }),
    z.object({ id: z.string().regex(STEP_ID), kind: z.literal("if"), condition: conditionSchema, then: z.array(flowStepSchema), else: z.array(flowStepSchema) }),
    z.object({ id: z.string().regex(STEP_ID), kind: z.literal("end") }),
  ]),
);

export const flowInputSchema = z.object({
  name: z.string().trim().min(1, "Give the flow a name.").max(120),
  trigger: z.enum(FLOW_TRIGGERS),
  steps: z.array(flowStepSchema),
  goals: z.array(z.object({ kind: z.literal("ordered") })).max(1),
  /** The automation a recipe does the work of (slice 3): set when the flow is made, kept through every save. */
  replaces: z.enum(AUTOMATION_KINDS).nullish(),
  /** A lapse trigger's days (slice 4): required for `customer.lapsed`, refused for any other trigger. */
  triggerDays: z.number().int().nullish(),
}).superRefine((f, ctx) => {
  // A date trigger's days in its range (DATE_TRIGGER_DAYS), and none for any other trigger.
  const range = isDateTrigger(f.trigger) ? DATE_TRIGGER_DAYS[f.trigger] : null;
  const days = f.triggerDays ?? null;
  if (range ? days === null || days < range.min || days > range.max : days !== null) {
    ctx.addIssue({ code: "custom", path: ["triggerDays"], message: range ? `Choose from ${range.min} to ${range.max} days.` : "Only a date trigger has days." });
  }
});
export type FlowInput = z.infer<typeof flowInputSchema>;

/** Every step of a tree, depth first, with its depth. */
function* walk(steps: readonly FlowStep[], depth = 1): Generator<{ step: FlowStep; depth: number }> {
  for (const step of steps) {
    yield { step, depth };
    if (step.kind === "if") {
      yield* walk(step.then, depth + 1);
      yield* walk(step.else, depth + 1);
    }
  }
}

/** What is wrong with a flow's steps, in words for the owner; empty when it may be saved. */
export function checkFlow(steps: readonly FlowStep[]): string[] {
  const problems: string[] = [];
  const all = [...walk(steps)];
  if (all.length === 0) problems.push("A flow needs at least one step.");
  if (all.length > STEPS_MAX) problems.push(`A flow has at most ${STEPS_MAX} steps.`);
  if (all.some((s) => s.depth > DEPTH_MAX)) problems.push(`Branches go at most ${DEPTH_MAX} deep.`);
  const ids = all.map((s) => s.step.id);
  if (new Set(ids).size !== ids.length) problems.push("Two steps have the same id.");
  if (!all.some((s) => s.step.kind === "email")) problems.push("A flow sends at least one email.");
  for (const { step } of all) {
    if (step.kind === "email" && Object.values(step.content).every((c) => !c.subject.trim() || c.blocks.length === 0)) {
      problems.push(`The email "${step.id}" has no subject or no words yet.`);
    }
  }
  return problems;
}

/**
 * A place in the tree: the indices down to a step, through an `if`'s branch (`["2", "then", "0"]` is the first step of the third step's
 * `then`). Stored as text joined with `/`.
 */
export type FlowPath = string[];
export const pathText = (path: FlowPath): string => path.join("/");
export const pathOf = (text: string): FlowPath => (text === "" ? [] : text.split("/"));

/** The list of steps a path's last index points into, and that index. */
function listAt(steps: readonly FlowStep[], path: FlowPath): { list: readonly FlowStep[]; index: number } | null {
  let list = steps;
  for (let i = 0; i < path.length - 1; i += 2) {
    const step = list[Number(path[i])];
    const branch = path[i + 1];
    if (!step || step.kind !== "if" || (branch !== "then" && branch !== "else")) return null;
    list = step[branch];
  }
  const index = Number(path[path.length - 1]);
  return Number.isInteger(index) && index >= 0 ? { list, index } : null;
}

/** The step a path points at, or null past the end of its list. */
export function stepAt(steps: readonly FlowStep[], path: FlowPath): FlowStep | null {
  const at = listAt(steps, path);
  return at ? (at.list[at.index] ?? null) : null;
}

/** The place after a step: the next in its list, or, at the end of a branch, the step after that branch's `if`; null at the very end. */
export function nextPath(steps: readonly FlowStep[], path: FlowPath): FlowPath | null {
  let current = path;
  for (;;) {
    const at = listAt(steps, current);
    if (!at) return null;
    if (at.index + 1 < at.list.length) return [...current.slice(0, -1), String(at.index + 1)];
    if (current.length === 1) return null;
    // The end of a branch: on after the `if` that holds it.
    current = current.slice(0, -2);
  }
}

/** What is known about a person when they move on: their facts, read by the server. */
export type FlowFacts = { orderedSinceEntry: boolean; clickedFlowEmail: boolean; segments: ReadonlySet<string> };

const holds = (condition: FlowCondition, facts: FlowFacts): boolean =>
  condition.kind === "ordered_since_entry"
    ? facts.orderedSinceEntry
    : condition.kind === "clicked_flow_email"
      ? facts.clickedFlowEmail
      : facts.segments.has(condition.segmentId);

/** What a person does next. */
export type FlowMove =
  | { do: "email"; step: Extract<FlowStep, { kind: "email" }>; next: FlowPath | null }
  | { do: "wait"; hours: number; next: FlowPath | null }
  | { do: "end"; reason: "goal" | "done" };

/**
 * From a place, what the person does next: a goal met ends the run at once; an `if` is decided from their facts and walked through; an
 * email or a wait is returned with the place after it; an `end`, or the end of the tree, ends the run. Never loops: every turn moves on.
 */
export function advance(steps: readonly FlowStep[], goals: readonly FlowGoal[], path: FlowPath | null, facts: FlowFacts): FlowMove {
  if (goals.some((g) => g.kind === "ordered") && facts.orderedSinceEntry) return { do: "end", reason: "goal" };
  let current = path;
  for (let guard = 0; current && guard <= STEPS_MAX; guard++) {
    const step = stepAt(steps, current);
    if (!step) return { do: "end", reason: "done" };
    if (step.kind === "email") return { do: "email", step, next: nextPath(steps, current) };
    if (step.kind === "wait") return { do: "wait", hours: step.hours, next: nextPath(steps, current) };
    if (step.kind === "end") return { do: "end", reason: "done" };
    const branch = holds(step.condition, facts) ? "then" : "else";
    current = step[branch].length > 0 ? [...current, branch, "0"] : nextPath(steps, current);
  }
  return { do: "end", reason: "done" };
}

/** The tree with one step replaced by `change(step)`, wherever it is; the same tree when no step has that id. Pure. */
export function replaceStep(steps: readonly FlowStep[], id: string, change: (step: FlowStep) => FlowStep): FlowStep[] {
  return steps.map((step) => {
    if (step.id === id) return change(step);
    if (step.kind === "if") return { ...step, then: replaceStep(step.then, id, change), else: replaceStep(step.else, id, change) };
    return step;
  });
}

/**
 * An email step with new words in one language (D767 slice 2, words changed where they are): its subject, and its first paragraph's
 * text (a paragraph is added first when it has none); its other blocks and languages stay as they were.
 */
export function withEmailWords(steps: readonly FlowStep[], id: string, locale: string, words: { subject: string; text: string }): FlowStep[] {
  return replaceStep(steps, id, (step) => {
    if (step.kind !== "email") return step;
    const current = step.content[locale] ?? { subject: "", preview: "", blocks: [] };
    const index = current.blocks.findIndex((b) => b.type === "paragraph");
    const blocks =
      index < 0
        ? [{ type: "paragraph" as const, text: words.text }, ...current.blocks]
        : current.blocks.map((b, i) => (i === index ? { ...b, text: words.text } : b));
    return { ...step, content: { ...step.content, [locale]: { ...current, subject: words.subject, blocks } } };
  });
}

/**
 * One piece of an email's words changed where it is (email plan M3.4): the subject (`index` -1), or a heading's, paragraph's or button's words
 * (`index` the block's place), in one language. The same tree when there is no such piece. Pure; the save checks the lengths.
 */
export function withBlockText(steps: readonly FlowStep[], id: string, locale: string, index: number, text: string): FlowStep[] {
  return replaceStep(steps, id, (step) => {
    if (step.kind !== "email") return step;
    const current = step.content[locale];
    if (!current) return step;
    if (index === -1) return { ...step, content: { ...step.content, [locale]: { ...current, subject: text } } };
    const block = current.blocks[index];
    if (!block || (block.type !== "heading" && block.type !== "paragraph" && block.type !== "button")) return step;
    const blocks = current.blocks.map((b, i) => (i === index ? { ...b, text } : b));
    return { ...step, content: { ...step.content, [locale]: { ...current, blocks } } };
  });
}

/** A wait step with a new number of days (D767 slice 2). */
export function withWaitDays(steps: readonly FlowStep[], id: string, days: number): FlowStep[] {
  return replaceStep(steps, id, (step) => (step.kind === "wait" ? { ...step, hours: Math.round(days * 24) } : step));
}

/** A step's id not yet in the tree: the kind and the lowest free number (`email-2`). Pure. */
export function freeStepId(steps: readonly FlowStep[], kind: FlowStep["kind"]): string {
  const taken = new Set([...walk(steps)].map((s) => s.step.id));
  for (let n = 1; ; n++) if (!taken.has(`${kind}-${n}`)) return `${kind}-${n}`;
}

/** A new step of a kind, with words to start from for an email (its subject and first paragraph, in `locale`). Pure. */
export function newStep(steps: readonly FlowStep[], kind: "email" | "wait" | "if" | "end", locale: string, words: { subject: string; text: string }): FlowStep {
  const id = freeStepId(steps, kind);
  if (kind === "email") return { id, kind, content: { [locale]: { subject: words.subject, preview: "", blocks: [{ type: "paragraph", text: words.text }] } } };
  if (kind === "wait") return { id, kind, hours: 24 };
  if (kind === "if") return { id, kind, condition: { kind: "ordered_since_entry" }, then: [], else: [] };
  return { id, kind };
}

/** Where a step goes (the canvas, slice 2 and its drag and drop): first in the flow, right after a step, or first in a branch. */
export type FlowPlace = { start: true } | { afterId: string } | { into: string; branch: "then" | "else" };

/**
 * The tree with `step` placed first (`start`), right after the step `afterId` in its own list, or first in a branch (`into`: the `if`
 * and which branch). The same tree when no such place exists. Pure.
 */
export function insertStep(steps: readonly FlowStep[], step: FlowStep, place: FlowPlace): FlowStep[] {
  if ("start" in place) return [step, ...steps];
  const out: FlowStep[] = [];
  for (const s of steps) {
    if ("into" in place && s.id === place.into && s.kind === "if") {
      out.push({ ...s, [place.branch]: [step, ...s[place.branch]] });
      continue;
    }
    out.push(s.kind === "if" ? { ...s, then: insertStep(s.then, step, place), else: insertStep(s.else, step, place) } : s);
    if ("afterId" in place && s.id === place.afterId) out.push(step);
  }
  return out;
}

/** The step with this id anywhere in the tree, or null. Pure. */
export function findStep(steps: readonly FlowStep[], id: string): FlowStep | null {
  for (const { step } of walk(steps)) if (step.id === id) return step;
  return null;
}

/**
 * The tree with one step moved to a place (drag and drop on the canvas). The same tree when the step or the place is missing, or the
 * place is the step itself or inside it (an `if` never goes into its own branch). Pure.
 */
export function moveStep(steps: readonly FlowStep[], id: string, place: FlowPlace): FlowStep[] {
  const step = findStep(steps, id);
  if (!step) return [...steps];
  const target = "afterId" in place ? place.afterId : "into" in place ? place.into : null;
  if (target !== null) {
    if (target === id) return [...steps];
    const inside = step.kind === "if" ? [...walk([...step.then, ...step.else])].some((x) => x.step.id === target) : false;
    if (inside || !findStep(steps, target)) return [...steps];
  }
  return insertStep(removeStep(steps, id), step, place);
}

/** The tree without one step (an `if` goes with both its branches). Pure. */
export function removeStep(steps: readonly FlowStep[], id: string): FlowStep[] {
  return steps
    .filter((s) => s.id !== id)
    .map((s) => (s.kind === "if" ? { ...s, then: removeStep(s.then, id), else: removeStep(s.else, id) } : s));
}

/** An `if` with a new condition. Pure. */
export function withCondition(steps: readonly FlowStep[], id: string, condition: FlowCondition): FlowStep[] {
  return replaceStep(steps, id, (step) => (step.kind === "if" ? { ...step, condition } : step));
}

/** An email with products picked for each reader of one kind, or with none (`null`). Pure. */
export function withStepPicks(steps: readonly FlowStep[], id: string, picks: PickKind | null): FlowStep[] {
  return replaceStep(steps, id, (step) => {
    if (step.kind !== "email") return step;
    return picks ? { ...step, picks } : { id: step.id, kind: step.kind, content: step.content };
  });
}
