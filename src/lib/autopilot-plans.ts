import { z } from "zod";

import { readToolInput, type OwnerTool } from "./owner-tools";

/**
 * The autopilot's plans (D309, `docs/ai-autopilot.md` 7.2): a plan is the model's, its steps are not free text. Each step is a kind
 * from `STEP_KINDS` with its fields, the steps it waits for and a check in code that says it worked; `checkPlan()` refuses the whole plan
 * with the first problem in words before anything is written. Pure: the tools a person may use are given to it.
 */

export const STEP_KINDS = ["tool", "task", "question", "wait"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const CHECK_KINDS = ["none", "product", "page", "setup_step", "store_open", "count"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** The parts of `getSetupProgress()` a check may name. */
export const SETUP_CHECKS = ["features", "details", "countries", "payments", "bookings", "paymentsOn", "shipping", "products", "plan"] as const;

export const PLAN_STATUSES = ["draft", "running", "paused", "done", "stopped"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const STEP_STATUSES = ["pending", "running", "waiting", "asking", "done", "skipped", "cancelled"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const FINISHED_STEPS: readonly StepStatus[] = ["done", "skipped", "cancelled"];

export const STEPS_MAX = 30;
export const TASK_TOOLS_MAX = 12;
export const OPTIONS_MAX = 5;
export const WAIT_DAYS_MAX = 90;
/** Tries before a failing step becomes a question for the owner. */
export const STEP_TRIES = 3;
/** The manager's own tools a task's turn always has besides its step's (never the plan tools or deciding anything). */
export const TASK_EXTRA_TOOLS = ["use_skill", "recall"] as const;
/** The options of the question a step that failed `STEP_TRIES` times becomes. */
export const RETRY_OPTIONS = ["Try again", "Skip this step", "Stop the plan"] as const;

export const stepCheckSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("product"), title: z.string().trim().min(1).max(200), active: z.boolean().default(false) }),
  z.object({
    kind: z.literal("page"),
    title: z.string().trim().min(1).max(200).optional(),
    slug: z.string().trim().min(1).max(100).optional(),
    published: z.boolean().default(false),
  }),
  z.object({ kind: z.literal("setup_step"), step: z.enum(SETUP_CHECKS) }),
  z.object({ kind: z.literal("store_open") }),
  z.object({ kind: z.literal("count"), what: z.enum(["products", "pages"]), at_least: z.number().int().positive().max(100_000) }),
]);
export type StepCheck = z.infer<typeof stepCheckSchema>;

/** A step as stored: its kind's own fields in `spec`. */
export const stepSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool"), tool: z.string().min(1).max(60), args: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("task"), brief: z.string().min(1).max(1000), tools: z.array(z.string().min(1).max(60)).min(1).max(TASK_TOOLS_MAX) }),
  z.object({ kind: z.literal("question"), text: z.string().min(1).max(500), options: z.array(z.string().min(1).max(100)).max(OPTIONS_MAX) }),
  z.object({ kind: z.literal("wait"), until: z.string().datetime({ offset: true }) }),
]);
export type StepSpec = z.infer<typeof stepSpecSchema>;

export type PlannedStep = { key: string; title: string; spec: StepSpec; after: string[]; check: StepCheck };

/** A step as the model gives it to `make_plan` and `revise_plan`: flat, the fields of its kind filled in. */
export const stepInput = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{1,20}$/, "A key is up to 20 lower-case letters, digits or underscores, such as s1.").describe("A short id for the step in this plan, such as s1."),
  title: z.string().trim().min(1).max(120).describe("What the step does, in a few words the owner reads."),
  kind: z.enum(STEP_KINDS).describe("tool: one call of a tool; task: work done with a few tools from a brief; question: ask the owner; wait: until a time."),
  tool: z.string().trim().max(60).optional().describe("tool: the tool's name."),
  args: z.record(z.string(), z.unknown()).optional().describe("tool: the tool's arguments, as you would call it."),
  brief: z.string().trim().max(1000).optional().describe("task: what to do, as a note to yourself."),
  tools: z.array(z.string().trim().max(60)).max(TASK_TOOLS_MAX).optional().describe("task: the tools the task may use (1 to 12)."),
  question: z.string().trim().max(500).optional().describe("question: what to ask the owner."),
  options: z.array(z.string().trim().min(1).max(100)).max(OPTIONS_MAX).optional().describe("question: up to five answers to pick from."),
  until: z.string().trim().max(40).optional().describe("wait: until when, an ISO date and time with its offset."),
  after: z.array(z.string().trim().max(20)).max(STEPS_MAX).default([]).describe("The keys of the steps this one waits for."),
  check: z
    .object({
      kind: z.enum(CHECK_KINDS),
      title: z.string().trim().max(200).optional(),
      slug: z.string().trim().max(100).optional(),
      active: z.boolean().optional(),
      published: z.boolean().optional(),
      step: z.enum(SETUP_CHECKS).optional(),
      what: z.enum(["products", "pages"]).optional(),
      at_least: z.number().int().positive().max(100_000).optional(),
    })
    .optional()
    .describe("How to tell it worked: none (the step's own success), product, page, setup_step, store_open or count."),
});
export type StepInput = z.infer<typeof stepInput>;

export const planInput = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000).default(""),
  goal: z.uuid().optional().describe("The goal it serves, by its id from list_goals."),
  steps: z.array(stepInput).min(1).max(STEPS_MAX),
});
export type PlanInput = z.infer<typeof planInput>;

export type PlanContext = {
  scope: "store" | "platform";
  /** The tools this person may use here, by name (the role's and the features'), never the manager's own. */
  tools: Readonly<Record<string, OwnerTool>>;
  now: Date;
};

export type PlanCheck = { ok: true; steps: PlannedStep[] } | { ok: false; problem: string };

const PLATFORM_CHECKS: readonly CheckKind[] = ["none", "page", "count"];

function checkOf(raw: StepInput["check"], scope: PlanContext["scope"]): { ok: true; check: StepCheck } | { ok: false; problem: string } {
  const parsed = stepCheckSchema.safeParse(raw ?? { kind: "none" });
  if (!parsed.success) return { ok: false, problem: `its check is not complete (${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")})` };
  const check = parsed.data;
  if (scope === "platform" && (!PLATFORM_CHECKS.includes(check.kind) || (check.kind === "count" && check.what !== "pages"))) {
    return { ok: false, problem: "Kaizena Flow's own site checks only pages" };
  }
  if (check.kind === "page" && !check.title && !check.slug) return { ok: false, problem: "a page check names the page's title or address" };
  return { ok: true, check };
}

function specOf(step: StepInput, ctx: PlanContext): { ok: true; spec: StepSpec } | { ok: false; problem: string } {
  switch (step.kind) {
    case "tool": {
      const tool = step.tool ? ctx.tools[step.tool] : undefined;
      if (!step.tool) return { ok: false, problem: "a tool step names its tool" };
      if (!tool) return { ok: false, problem: `there is no tool ${step.tool} that may be used here` };
      const read = readToolInput(tool, step.args ?? {});
      if (!read.ok) return { ok: false, problem: `the arguments of ${step.tool} could not be read: ${read.problem}` };
      return { ok: true, spec: { kind: "tool", tool: step.tool, args: (step.args ?? {}) as Record<string, unknown> } };
    }
    case "task": {
      if (!step.brief) return { ok: false, problem: "a task step has a brief" };
      const tools = [...new Set(step.tools ?? [])];
      if (tools.length === 0) return { ok: false, problem: "a task step names the tools it may use" };
      const unknown = tools.find((name) => !ctx.tools[name]);
      if (unknown) return { ok: false, problem: `there is no tool ${unknown} that may be used here` };
      return { ok: true, spec: { kind: "task", brief: step.brief, tools } };
    }
    case "question": {
      if (!step.question) return { ok: false, problem: "a question step asks something" };
      return { ok: true, spec: { kind: "question", text: step.question, options: [...new Set(step.options ?? [])] } };
    }
    case "wait": {
      const until = step.until ? new Date(step.until) : null;
      if (!step.until || !until || Number.isNaN(until.getTime()) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(step.until)) {
        return { ok: false, problem: "a wait step says until when, as an ISO date and time with its offset" };
      }
      if (until.getTime() > ctx.now.getTime() + WAIT_DAYS_MAX * 86_400_000) return { ok: false, problem: `a wait is at most ${WAIT_DAYS_MAX} days` };
      return { ok: true, spec: { kind: "wait", until: until.toISOString() } };
    }
  }
}

/**
 * Every step checked, or the first problem: keys unique, the steps waited for present and earlier ones never the step itself, no loop,
 * a tool step's tool one the person may use with arguments its schema reads, a task's tools the same, a check that fits the scope.
 * `existing` are steps kept from a plan being revised (done or running), which new steps may wait for.
 */
export function checkPlan(steps: readonly StepInput[], ctx: PlanContext, existing: readonly string[] = []): PlanCheck {
  if (steps.length === 0) return { ok: false, problem: "A plan has at least one step." };
  if (steps.length + existing.length > STEPS_MAX) return { ok: false, problem: `A plan has at most ${STEPS_MAX} steps.` };
  const keys = new Set<string>(existing);
  for (const step of steps) {
    if (keys.has(step.key)) return { ok: false, problem: `Two steps are called ${step.key}.` };
    keys.add(step.key);
  }
  const planned: PlannedStep[] = [];
  for (const step of steps) {
    const where = `Step ${step.key} (${step.title})`;
    const missing = step.after.find((k) => !keys.has(k));
    if (missing) return { ok: false, problem: `${where} waits for ${missing}, which is not in the plan.` };
    if (step.after.includes(step.key)) return { ok: false, problem: `${where} waits for itself.` };
    const spec = specOf(step, ctx);
    if (!spec.ok) return { ok: false, problem: `${where}: ${spec.problem}.` };
    const check = checkOf(step.check, ctx.scope);
    if (!check.ok) return { ok: false, problem: `${where}: ${check.problem}.` };
    if ((step.kind === "question" || step.kind === "wait") && check.check.kind !== "none") {
      return { ok: false, problem: `${where}: a ${step.kind} has no check.` };
    }
    planned.push({ key: step.key, title: step.title, spec: spec.spec, after: [...new Set(step.after)], check: check.check });
  }
  const loop = findLoop(planned);
  if (loop) return { ok: false, problem: `The steps wait for one another in a circle (${loop.join(" → ")}).` };
  return { ok: true, steps: planned };
}

/** The first circle of steps waiting for one another, or null. */
export function findLoop(steps: readonly Pick<PlannedStep, "key" | "after">[]): string[] | null {
  const after = new Map(steps.map((s) => [s.key, s.after]));
  const state = new Map<string, "seen" | "done">();
  const path: string[] = [];
  const visit = (key: string): string[] | null => {
    if (state.get(key) === "done") return null;
    if (state.get(key) === "seen") return [...path.slice(path.indexOf(key)), key];
    state.set(key, "seen");
    path.push(key);
    for (const next of after.get(key) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    state.set(key, "done");
    return null;
  };
  for (const s of steps) {
    const found = visit(s.key);
    if (found) return found;
  }
  return null;
}

/** Whether a step's turn comes: everything it waits for is done or skipped. */
export function stepReady(after: readonly string[], statusByKey: ReadonlyMap<string, StepStatus>): boolean {
  return after.every((k) => {
    const s = statusByKey.get(k);
    return s === "done" || s === "skipped";
  });
}

/** The keys of the steps to skip because a step they wait for was skipped (or cancelled), directly or further back. */
export function skippedBehind(steps: readonly { key: string; after: readonly string[]; status: StepStatus }[]): string[] {
  const status = new Map(steps.map((s) => [s.key, s.status]));
  const out: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of steps) {
      if (status.get(s.key) !== "pending") continue;
      if (s.after.some((k) => status.get(k) === "skipped" || status.get(k) === "cancelled")) {
        status.set(s.key, "skipped");
        out.push(s.key);
        changed = true;
      }
    }
  }
  return out;
}

/** A plan is finished when none of its steps is left to run. */
export const planFinished = (statuses: readonly StepStatus[]) => statuses.length > 0 && statuses.every((s) => FINISHED_STEPS.includes(s));

/** A step's kind in a few words, for lists. */
export function stepWords(spec: StepSpec): string {
  switch (spec.kind) {
    case "tool":
      return `Runs ${spec.tool}`;
    case "task":
      return `Works with ${spec.tools.join(", ")}`;
    case "question":
      return `Asks: ${spec.text}`;
    case "wait":
      return `Waits until ${spec.until.slice(0, 16).replace("T", " ")} UTC`;
  }
}
