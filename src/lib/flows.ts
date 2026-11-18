import { z } from "zod";

import { broadcastContentSchema, type BroadcastContent } from "./broadcasts";
import { FLOW_TRIGGERS } from "./flow-triggers";

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
  | { id: string; kind: "email"; content: BroadcastContent }
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
    z.object({ id: z.string().regex(STEP_ID), kind: z.literal("email"), content: broadcastContentSchema }),
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
});

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
